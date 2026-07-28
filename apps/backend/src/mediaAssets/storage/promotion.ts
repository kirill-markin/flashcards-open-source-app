import {
  CopyObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import {
  assertDirectMediaBlobStorageCapabilityForMutation,
  MediaBlobWriterFenceError,
  type DirectMediaBlobStorageCapability,
  type DirectMediaBlobWriterAttemptExactInput,
} from "../blobLifecycle";
import type { BackendObservationScope } from "../../observability/sentry/events";
import { HttpError } from "../../shared/errors";
import type {
  AssertMediaAssetObjectInput,
  MediaAssetStorageContext,
  MediaAssetStorageDependencies,
  PromoteMediaAssetUploadInput,
  StoreMediaAssetBlobBytesInput,
} from "./contracts";
import {
  createMediaAssetStorageError,
  getS3ErrorStatusCode,
  isCopyObjectIfNoneMatchFailure,
  isMediaAssetObjectNotFoundError,
  runMediaAssetStorageOperationWithRetries,
} from "./errors";
import { loadMediaAssetObjectMetadataWithDependencies } from "./objects";
import {
  assertMediaAssetObjectContentMatches,
  assertMediaAssetObjectMetadataMatches,
  toBase64Sha256Digest,
  toHexSha256Digest,
  uploadProofSha256Key,
} from "./proof";

type CopyMediaAssetObjectInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  sourceStorageKey: string;
  destinationStorageKey: string;
  mimeType: string;
  sha256: string;
  observationScope: BackendObservationScope;
}>;

type DirectMediaBlobStorageCapabilityVerifier = (
  capability: DirectMediaBlobStorageCapability,
  writer: DirectMediaBlobWriterAttemptExactInput,
) => void;

function createCopySource(bucketName: string, storageKey: string): string {
  return `${bucketName}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

async function copyMediaAssetObjectIfAbsentWithDependencies(
  input: CopyMediaAssetObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.destinationStorageKey,
    observationScope: input.observationScope,
  };

  try {
    await runMediaAssetStorageOperationWithRetries(
      context,
      "copy_object",
      async () => {
        try {
          await dependencies.s3Client.send(new CopyObjectCommand({
            Bucket: config.bucketName,
            Key: input.destinationStorageKey,
            CopySource: createCopySource(config.bucketName, input.sourceStorageKey),
            ContentType: input.mimeType,
            ChecksumAlgorithm: "SHA256",
            IfNoneMatch: "*",
            MetadataDirective: "REPLACE",
            Metadata: {
              [uploadProofSha256Key]: input.sha256,
            },
          }));
        } catch (error) {
          if (isCopyObjectIfNoneMatchFailure(error)) {
            return;
          }

          throw error;
        }
      },
    );
  } catch (error) {
    throw createMediaAssetStorageError(context, "copy_object", error);
  }
}

function assertDirectStorageInputMatchesWriter(
  input: StoreMediaAssetBlobBytesInput,
): void {
  const actualSha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (
    input.workspaceId !== input.writer.workspaceId
    || input.mediaAssetId !== input.writer.mediaAssetId
    || input.storageKey !== input.writer.storageKey
    || input.mimeType !== input.writer.mimeType
    || input.sha256 !== input.writer.sha256
    || input.lastOperationId !== input.writer.operationId
    || input.bytes.byteLength !== input.writer.sizeBytes
    || actualSha256 !== input.writer.sha256
  ) {
    throw new MediaBlobWriterFenceError("verify_direct_storage_input");
  }
}

function assertDirectStorageMutationAuthorized(
  input: StoreMediaAssetBlobBytesInput,
  verifyCapability: DirectMediaBlobStorageCapabilityVerifier,
): void {
  input.signal.throwIfAborted();
  assertDirectStorageInputMatchesWriter(input);
  verifyCapability(input.storageCapability, input.writer);
}

function rethrowDirectStorageAbortReason(
  signal: AbortSignal,
  error: unknown,
): void {
  if (
    signal.aborted
    && error instanceof Error
    && error.name === "AbortError"
  ) {
    signal.throwIfAborted();
  }
}

async function assertStoredMediaAssetBlobObjectContentMatchesWithDependencies(
  input: StoreMediaAssetBlobBytesInput,
  dependencies: MediaAssetStorageDependencies,
  verifyCapability: DirectMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  const blobObjectInput: AssertMediaAssetObjectInput = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.storageKey,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
    sha256: input.sha256,
    lastOperationId: input.lastOperationId,
    observationScope: input.observationScope,
  };
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context = { ...blobObjectInput, storageKey: input.storageKey };
  let response: HeadObjectCommandOutput;
  try {
    response = await runMediaAssetStorageOperationWithRetries(
      context,
      "head_object",
      () => {
        assertDirectStorageMutationAuthorized(input, verifyCapability);
        return dependencies.s3Client.send(new HeadObjectCommand({
          Bucket: config.bucketName,
          Key: input.storageKey,
          ChecksumMode: "ENABLED",
        }), { abortSignal: input.signal });
      },
    );
  } catch (error) {
    rethrowDirectStorageAbortReason(input.signal, error);
    if (error instanceof MediaBlobWriterFenceError) throw error;
    throw createMediaAssetStorageError(context, "put_object", error);
  }
  assertMediaAssetObjectContentMatches(blobObjectInput, {
    sizeBytes: response.ContentLength ?? null, mimeType: response.ContentType ?? null,
    checksumSha256: toHexSha256Digest(response.ChecksumSHA256),
    checksumType: response.ChecksumType ?? null,
    uploadProof: {
      workspaceId: null, mediaAssetId: null, lastOperationIdSha256: null, sha256: null,
    },
  });
}

export async function storeMediaAssetBlobBytesIfAbsentWithDependencies(
  input: StoreMediaAssetBlobBytesInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  return storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier(
    input,
    dependencies,
    assertDirectMediaBlobStorageCapabilityForMutation,
  );
}

export async function storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier(
  input: StoreMediaAssetBlobBytesInput,
  dependencies: MediaAssetStorageDependencies,
  verifyCapability: DirectMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  assertDirectStorageMutationAuthorized(input, verifyCapability);
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.storageKey,
    observationScope: input.observationScope,
  };
  const checksumSha256 = toBase64Sha256Digest(input.sha256);

  try {
    const stored = await runMediaAssetStorageOperationWithRetries(
      context,
      "put_object",
      async () => {
        assertDirectStorageMutationAuthorized(input, verifyCapability);
        try {
          await dependencies.s3Client.send(new PutObjectCommand({
            Bucket: config.bucketName,
            Key: input.storageKey,
            Body: input.bytes,
            ContentType: input.mimeType,
            ChecksumSHA256: checksumSha256,
            IfNoneMatch: "*",
            Metadata: {
              [uploadProofSha256Key]: input.sha256,
            },
          }), { abortSignal: input.signal });
          return true;
        } catch (error) {
          if (getS3ErrorStatusCode(error) === 412) {
            return false;
          }

          throw error;
        }
      },
    );

    if (stored) {
      return;
    }

    await assertStoredMediaAssetBlobObjectContentMatchesWithDependencies(
      input,
      dependencies,
      verifyCapability,
    );
  } catch (error) {
    rethrowDirectStorageAbortReason(input.signal, error);
    if (error instanceof HttpError || error instanceof MediaBlobWriterFenceError) {
      throw error;
    }

    throw createMediaAssetStorageError(context, "put_object", error);
  }
}

export async function promoteVerifiedMediaAssetUploadToBlobWithDependencies(
  input: PromoteMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const uploadObjectInput: AssertMediaAssetObjectInput = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.uploadStorageKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    lastOperationId: input.lastOperationId,
    observationScope: input.observationScope,
  };
  const blobObjectInput: AssertMediaAssetObjectInput = {
    ...uploadObjectInput,
    storageKey: input.blobStorageKey,
  };

  try {
    const existingBlobMetadata = await loadMediaAssetObjectMetadataWithDependencies(blobObjectInput, dependencies);
    assertMediaAssetObjectContentMatches(blobObjectInput, existingBlobMetadata);
  } catch (error) {
    if (isMediaAssetObjectNotFoundError(error) === false) {
      throw error;
    }

    await copyMediaAssetObjectIfAbsentWithDependencies(
      {
        workspaceId: input.workspaceId,
        mediaAssetId: input.mediaAssetId,
        sourceStorageKey: input.uploadStorageKey,
        destinationStorageKey: input.blobStorageKey,
        mimeType: input.mimeType,
        sha256: input.sha256,
        observationScope: input.observationScope,
      },
      dependencies,
    );

    const copiedBlobMetadata = await loadMediaAssetObjectMetadataWithDependencies(blobObjectInput, dependencies);
    assertMediaAssetObjectContentMatches(blobObjectInput, copiedBlobMetadata);
  }
}

export async function promoteMediaAssetUploadToBlobWithDependencies(
  input: PromoteMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const uploadObjectInput: AssertMediaAssetObjectInput = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.uploadStorageKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    lastOperationId: input.lastOperationId,
    observationScope: input.observationScope,
  };
  const uploadObjectMetadata = await loadMediaAssetObjectMetadataWithDependencies(uploadObjectInput, dependencies);
  assertMediaAssetObjectMetadataMatches(uploadObjectInput, uploadObjectMetadata);

  await promoteVerifiedMediaAssetUploadToBlobWithDependencies(input, dependencies);
}

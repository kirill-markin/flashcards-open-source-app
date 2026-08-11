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
} from "../../blobLifecycle";
import {
  assertMultipartMediaBlobStorageCapabilityForMutation,
  type MultipartMediaBlobStorageCapability,
  type MultipartMediaBlobWriterAttemptExactInput,
} from "../../uploadSessions";
import type { BackendObservationScope } from "../../../observability/sentry/events";
import { HttpError } from "../../../shared/errors";
import type {
  AssertMediaAssetObjectInput,
  MediaBlobStorageContext,
  MediaAssetStorageContext,
  MediaAssetStorageDependencies,
  PromoteMediaAssetUploadInput,
  StoreCatalogImageBlobBytesInput,
  StoreMediaAssetBlobBytesInput,
} from "../contracts";
import {
  createMediaAssetStorageError,
  getS3ErrorStatusCode,
  isCopyObjectIfNoneMatchFailure,
  isMediaAssetObjectNotFoundError,
  rethrowMediaAssetStorageAbortReason,
  runMediaAssetStorageOperationWithRetries,
  runMediaAssetStorageOperationWithRetriesAndAbortSignal,
} from "../errors";
import {
  loadMediaAssetObjectMetadataWithAbortSignalAndDependencies,
  loadMediaAssetObjectMetadataWithDependencies,
} from "../objects";
import {
  assertMediaAssetObjectContentMatches,
  assertMediaAssetObjectMetadataMatches,
  toBase64Sha256Digest,
  toHexSha256Digest,
  uploadProofSha256Key,
} from "../proof";

type CopyMediaAssetObjectInput = Readonly<{
  writer: MultipartMediaBlobWriterAttemptExactInput;
  getStorageCapability: () => Promise<MultipartMediaBlobStorageCapability>;
  assertStorageMutationAuthorized: () => void;
  signal: AbortSignal;
  workspaceId: string;
  mediaAssetId: string;
  uploadStorageKey: string;
  blobStorageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  lastOperationId: string;
  observationScope: BackendObservationScope;
}>;

type DirectMediaBlobStorageCapabilityVerifier = (
  capability: DirectMediaBlobStorageCapability,
  writer: DirectMediaBlobWriterAttemptExactInput,
) => void;
type MultipartMediaBlobStorageCapabilityVerifier = (
  capability: MultipartMediaBlobStorageCapability,
  writer: MultipartMediaBlobWriterAttemptExactInput,
) => void;

export function createMediaAssetCopySource(
  bucketName: string,
  storageKey: string,
): string {
  return `${bucketName}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

async function copyMediaAssetObjectIfAbsentWithDependencies(
  input: CopyMediaAssetObjectInput,
  dependencies: MediaAssetStorageDependencies,
  verifyCapability: MultipartMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.blobStorageKey,
    observationScope: input.observationScope,
  };

  try {
    await runMediaAssetStorageOperationWithRetriesAndAbortSignal(
      context,
      "copy_object",
      input.signal,
      async () => {
        await assertMultipartPromotionMutationAuthorized(
          input,
          verifyCapability,
        );
        input.assertStorageMutationAuthorized();
        try {
          await dependencies.s3Client.send(new CopyObjectCommand({
            Bucket: config.bucketName,
            Key: input.blobStorageKey,
            CopySource: createMediaAssetCopySource(
              config.bucketName,
              input.uploadStorageKey,
            ),
            ContentType: input.mimeType,
            ChecksumAlgorithm: "SHA256",
            IfNoneMatch: "*",
            MetadataDirective: "REPLACE",
            Metadata: {
              [uploadProofSha256Key]: input.sha256,
            },
          }), { abortSignal: input.signal });
        } catch (error) {
          if (isCopyObjectIfNoneMatchFailure(error)) {
            return;
          }

          throw error;
        }
      },
    );
  } catch (error) {
    rethrowMediaAssetStorageAbortReason(input.signal);
    if (error instanceof MediaBlobWriterFenceError) {
      throw error;
    }
    throw createMediaAssetStorageError(context, "copy_object", error);
  }
}

function assertMultipartPromotionInputMatchesWriter(
  input: PromoteMediaAssetUploadInput,
): void {
  if (
    input.workspaceId !== input.writer.workspaceId
    || input.mediaAssetId !== input.writer.mediaAssetId
    || input.uploadStorageKey !== input.writer.stagingStorageKey
    || input.blobStorageKey !== input.writer.blobStorageKey
    || input.mimeType !== input.writer.mimeType
    || input.sizeBytes !== input.writer.sizeBytes
    || input.sha256 !== input.writer.sha256
    || input.lastOperationId !== input.writer.lastOperationId
  ) {
    throw new MediaBlobWriterFenceError(
      "verify_multipart_promotion_input",
    );
  }
}

async function assertMultipartPromotionMutationAuthorized(
  input: PromoteMediaAssetUploadInput,
  verifyCapability: MultipartMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  input.signal.throwIfAborted();
  assertMultipartPromotionInputMatchesWriter(input);
  const storageCapability = await input.getStorageCapability();
  input.signal.throwIfAborted();
  verifyCapability(storageCapability, input.writer);
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

type StoreContentAddressedMediaBlobBytesInput = Readonly<{
  signal: AbortSignal;
  storageKey: string;
  mimeType: string;
  sha256: string;
  bytes: Buffer;
  observationScope: BackendObservationScope;
}>;

async function storeContentAddressedMediaBlobBytesIfAbsentWithDependencies(
  input: StoreContentAddressedMediaBlobBytesInput,
  context: MediaBlobStorageContext,
  dependencies: MediaAssetStorageDependencies,
  assertMutationAuthorized: () => void,
  assertWinnerMatches: (response: HeadObjectCommandOutput) => void,
): Promise<void> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const checksumSha256 = toBase64Sha256Digest(input.sha256);
  const stored = await runMediaAssetStorageOperationWithRetries(
    context,
    "put_object",
    async () => {
      assertMutationAuthorized();
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

  const response = await runMediaAssetStorageOperationWithRetries(
    context,
    "head_object",
    () => {
      assertMutationAuthorized();
      return dependencies.s3Client.send(new HeadObjectCommand({
        Bucket: config.bucketName,
        Key: input.storageKey,
        ChecksumMode: "ENABLED",
      }), { abortSignal: input.signal });
    },
  );
  assertWinnerMatches(response);
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
  const assertMutationAuthorized = (): void => {
    assertDirectStorageMutationAuthorized(input, verifyCapability);
  };
  assertMutationAuthorized();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.storageKey,
    observationScope: input.observationScope,
  };

  try {
    await storeContentAddressedMediaBlobBytesIfAbsentWithDependencies(
      input,
      context,
      dependencies,
      assertMutationAuthorized,
      (response) => assertMediaAssetObjectContentMatches(
        {
          workspaceId: input.workspaceId,
          mediaAssetId: input.mediaAssetId,
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.bytes.byteLength,
          sha256: input.sha256,
          lastOperationId: input.lastOperationId,
          observationScope: input.observationScope,
        },
        {
          sizeBytes: response.ContentLength ?? null,
          mimeType: response.ContentType ?? null,
          eTag: response.ETag ?? null,
          checksumSha256: toHexSha256Digest(response.ChecksumSHA256),
          checksumType: response.ChecksumType ?? null,
          uploadProof: {
            workspaceId: null,
            mediaAssetId: null,
            lastOperationIdSha256: null,
            sha256: null,
          },
        },
      ),
    );
  } catch (error) {
    rethrowDirectStorageAbortReason(input.signal, error);
    if (error instanceof HttpError || error instanceof MediaBlobWriterFenceError) {
      throw error;
    }

    throw createMediaAssetStorageError(context, "put_object", error);
  }
}

function assertCatalogImageBlobStorageInput(
  input: StoreCatalogImageBlobBytesInput,
): void {
  const actualSha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (
    input.storageKey !== `media/blobs/sha256/${input.sha256.slice(0, 2)}/${input.sha256.slice(2, 4)}/${input.sha256}`
    || input.mimeType !== "image/jpeg"
    || input.sizeBytes !== input.bytes.byteLength
    || actualSha256 !== input.sha256
  ) {
    throw new TypeError("Catalog image blob storage input does not match its normalized bytes.");
  }
}

function createCatalogImageBlobObjectMismatchError(
  input: StoreCatalogImageBlobBytesInput,
  response: HeadObjectCommandOutput,
): HttpError {
  const checksumSha256 = toHexSha256Digest(response.ChecksumSHA256);
  const mismatchedFields = [
    ...(response.ContentLength === input.sizeBytes ? [] : ["sizeBytes"]),
    ...(response.ContentType === input.mimeType ? [] : ["mimeType"]),
    ...(response.ChecksumType === "FULL_OBJECT" ? [] : ["checksumType"]),
    ...(checksumSha256 === input.sha256 ? [] : ["sha256"]),
  ];
  return new HttpError(
    409,
    `Catalog image blob conflicts with stored object bytes. sha256=${input.sha256} mismatchedFields=${mismatchedFields.join(",")}`,
    "CATALOG_IMAGE_BLOB_OBJECT_MISMATCH",
  );
}

function createCatalogImageBlobStorageError(
  input: StoreCatalogImageBlobBytesInput,
  error: unknown,
): HttpError {
  return new HttpError(
    503,
    [
      "Catalog image blob storage is temporarily unavailable.",
      `sha256=${input.sha256}`,
      `storageKey=${input.storageKey}`,
      `s3StatusCode=${String(getS3ErrorStatusCode(error))}`,
      `s3ErrorClass=${error instanceof Error ? error.name : "UnknownError"}`,
    ].join(" "),
    "CATALOG_IMAGE_BLOB_STORAGE_UNAVAILABLE",
  );
}

export async function storeCatalogImageBlobBytesIfAbsentWithDependencies(
  input: StoreCatalogImageBlobBytesInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  assertCatalogImageBlobStorageInput(input);
  const context: MediaBlobStorageContext = {
    workspaceId: null,
    mediaAssetId: null,
    storageKey: input.storageKey,
    observationScope: input.observationScope,
  };
  const assertMutationAuthorized = (): void => {
    input.signal.throwIfAborted();
  };
  try {
    await storeContentAddressedMediaBlobBytesIfAbsentWithDependencies(
      input,
      context,
      dependencies,
      assertMutationAuthorized,
      (response) => {
        if (
          response.ContentLength !== input.sizeBytes
          || response.ContentType !== input.mimeType
          || response.ChecksumType !== "FULL_OBJECT"
          || toHexSha256Digest(response.ChecksumSHA256) !== input.sha256
        ) {
          throw createCatalogImageBlobObjectMismatchError(input, response);
        }
      },
    );
  } catch (error) {
    rethrowDirectStorageAbortReason(input.signal, error);
    if (error instanceof HttpError) {
      throw error;
    }
    throw createCatalogImageBlobStorageError(input, error);
  }
}

export async function promoteVerifiedMediaAssetUploadToBlobWithDependencies(
  input: PromoteMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  return promoteVerifiedMediaAssetUploadToBlobWithCapabilityVerifier(
    input,
    dependencies,
    assertMultipartMediaBlobStorageCapabilityForMutation,
  );
}

export async function promoteVerifiedMediaAssetUploadToBlobWithCapabilityVerifier(
  input: PromoteMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
  verifyCapability: MultipartMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  await assertMultipartPromotionMutationAuthorized(input, verifyCapability);
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
    const existingBlobMetadata =
      await loadMediaAssetObjectMetadataWithAbortSignalAndDependencies(
        blobObjectInput,
        input.signal,
        dependencies,
      );
    assertMediaAssetObjectContentMatches(blobObjectInput, existingBlobMetadata);
  } catch (error) {
    rethrowMediaAssetStorageAbortReason(input.signal);
    if (isMediaAssetObjectNotFoundError(error) === false) {
      throw error;
    }

    await copyMediaAssetObjectIfAbsentWithDependencies(
      {
        writer: input.writer,
        getStorageCapability: input.getStorageCapability,
        assertStorageMutationAuthorized:
          input.assertStorageMutationAuthorized,
        signal: input.signal,
        workspaceId: input.workspaceId,
        mediaAssetId: input.mediaAssetId,
        uploadStorageKey: input.uploadStorageKey,
        blobStorageKey: input.blobStorageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        lastOperationId: input.lastOperationId,
        observationScope: input.observationScope,
      },
      dependencies,
      verifyCapability,
    );

    const copiedBlobMetadata =
      await loadMediaAssetObjectMetadataWithAbortSignalAndDependencies(
        blobObjectInput,
        input.signal,
        dependencies,
      );
    assertMediaAssetObjectContentMatches(blobObjectInput, copiedBlobMetadata);
  }
}

export async function promoteMediaAssetUploadToBlobWithDependencies(
  input: PromoteMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  return promoteMediaAssetUploadToBlobWithCapabilityVerifier(
    input,
    dependencies,
    assertMultipartMediaBlobStorageCapabilityForMutation,
  );
}

export async function promoteMediaAssetUploadToBlobWithCapabilityVerifier(
  input: PromoteMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
  verifyCapability: MultipartMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  await assertMultipartPromotionMutationAuthorized(input, verifyCapability);
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
  const uploadObjectMetadata =
    await loadMediaAssetObjectMetadataWithAbortSignalAndDependencies(
      uploadObjectInput,
      input.signal,
      dependencies,
    );
  assertMediaAssetObjectMetadataMatches(uploadObjectInput, uploadObjectMetadata);

  await promoteVerifiedMediaAssetUploadToBlobWithCapabilityVerifier(
    input,
    dependencies,
    verifyCapability,
  );
}

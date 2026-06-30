import {
  CopyObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { BackendObservationScope } from "../../observability/sentry";
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
  isCopyObjectIfNoneMatchFailure,
  isMediaAssetObjectNotFoundError,
  runMediaAssetStorageOperationWithRetries,
} from "./errors";
import { loadMediaAssetObjectMetadataWithDependencies } from "./objects";
import {
  assertMediaAssetObjectContentMatches,
  assertMediaAssetObjectMetadataMatches,
  toBase64Sha256Digest,
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

async function assertStoredMediaAssetBlobObjectContentMatchesWithDependencies(
  input: StoreMediaAssetBlobBytesInput,
  dependencies: MediaAssetStorageDependencies,
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
  const objectMetadata = await loadMediaAssetObjectMetadataWithDependencies(blobObjectInput, dependencies);
  assertMediaAssetObjectContentMatches(blobObjectInput, objectMetadata);
}

export async function storeMediaAssetBlobBytesIfAbsentWithDependencies(
  input: StoreMediaAssetBlobBytesInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
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
          }));
          return true;
        } catch (error) {
          if (isCopyObjectIfNoneMatchFailure(error)) {
            return false;
          }

          throw error;
        }
      },
    );

    if (stored) {
      return;
    }

    await assertStoredMediaAssetBlobObjectContentMatchesWithDependencies(input, dependencies);
  } catch (error) {
    if (error instanceof HttpError && error.code === "MEDIA_ASSET_UPLOAD_MISMATCH") {
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

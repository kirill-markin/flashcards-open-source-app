import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import type { CreatedMultipartMediaAssetUpload } from "../types";
import {
  createExpiresAt,
  multipartUploadExpiresSeconds,
} from "./config";
import type {
  AbortMultipartMediaAssetUploadInput,
  AssertMediaAssetObjectInput,
  CompleteMultipartMediaAssetUploadInput,
  CreateMultipartMediaAssetUploadInput,
  MediaAssetStorageContext,
  MediaAssetStorageDependencies,
} from "./contracts";
import {
  createMediaAssetStorageError,
  isNoSuchMultipartUploadError,
  runMediaAssetStorageOperationWithRetries,
} from "./errors";
import {
  hashMediaAssetObjectContentWithDependencies,
  loadMediaAssetObjectMetadataWithDependencies,
} from "./objects";
import {
  assertMediaAssetObjectContentHashMatches,
  assertMediaAssetObjectShapeAndProofMatches,
  createUploadProofMetadata,
  toBase64Sha256Digest,
} from "./proof";
import { promoteVerifiedMediaAssetUploadToBlobWithDependencies } from "./promotion";

export async function createMultipartMediaAssetUploadWithDependencies(
  input: CreateMultipartMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<CreatedMultipartMediaAssetUpload> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.stagingStorageKey,
    observationScope: input.observationScope,
  };
  const uploadProofMetadata = createUploadProofMetadata(input);

  try {
    const response = await runMediaAssetStorageOperationWithRetries(
      context,
      "create_multipart_upload",
      async () => dependencies.s3Client.send(new CreateMultipartUploadCommand({
        Bucket: config.bucketName,
        Key: input.stagingStorageKey,
        ContentType: input.mimeType,
        ChecksumAlgorithm: "SHA256",
        Metadata: uploadProofMetadata,
      })),
    );
    if (response.UploadId === undefined || response.UploadId.trim() === "") {
      throw new Error(
        `S3 create_multipart_upload did not return UploadId for workspaceId=${input.workspaceId} mediaAssetId=${input.mediaAssetId}.`,
      );
    }

    return {
      storageKey: input.stagingStorageKey,
      s3UploadId: response.UploadId,
      expiresAt: createExpiresAt(multipartUploadExpiresSeconds),
    };
  } catch (error) {
    throw createMediaAssetStorageError(context, "create_multipart_upload", error);
  }
}

export async function completeMultipartMediaAssetUploadWithDependencies(
  input: CompleteMultipartMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.stagingStorageKey,
    observationScope: input.observationScope,
  };
  const completedParts = [...input.parts]
    .sort((left, right) => left.partNumber - right.partNumber)
    .map((part) => ({
      PartNumber: part.partNumber,
      ETag: part.eTag,
      ChecksumSHA256: toBase64Sha256Digest(part.sha256),
    }));

  try {
    await runMediaAssetStorageOperationWithRetries(
      context,
      "complete_multipart_upload",
      async () => dependencies.s3Client.send(new CompleteMultipartUploadCommand({
        Bucket: config.bucketName,
        Key: input.stagingStorageKey,
        UploadId: input.s3UploadId,
        MultipartUpload: {
          Parts: completedParts,
        },
      })),
    );
  } catch (error) {
    if (isNoSuchMultipartUploadError(error) === false) {
      throw createMediaAssetStorageError(context, "complete_multipart_upload", error);
    }
  }

  const stagingObjectInput: AssertMediaAssetObjectInput = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.stagingStorageKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    lastOperationId: input.lastOperationId,
    observationScope: input.observationScope,
  };
  const stagingObjectMetadata = await loadMediaAssetObjectMetadataWithDependencies(stagingObjectInput, dependencies);
  assertMediaAssetObjectShapeAndProofMatches(stagingObjectInput, stagingObjectMetadata);
  const stagingObjectContent = await hashMediaAssetObjectContentWithDependencies(stagingObjectInput, dependencies);
  assertMediaAssetObjectContentHashMatches(stagingObjectInput, stagingObjectContent);

  await promoteVerifiedMediaAssetUploadToBlobWithDependencies(
    {
      workspaceId: input.workspaceId,
      mediaAssetId: input.mediaAssetId,
      uploadStorageKey: input.stagingStorageKey,
      blobStorageKey: input.blobStorageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      lastOperationId: input.lastOperationId,
      observationScope: input.observationScope,
    },
    dependencies,
  );
}

export async function abortMultipartMediaAssetUploadWithDependencies(
  input: AbortMultipartMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.stagingStorageKey,
    observationScope: input.observationScope,
  };

  try {
    await runMediaAssetStorageOperationWithRetries(
      context,
      "abort_multipart_upload",
      async () => dependencies.s3Client.send(new AbortMultipartUploadCommand({
        Bucket: config.bucketName,
        Key: input.stagingStorageKey,
        UploadId: input.s3UploadId,
      })),
    );
  } catch (error) {
    if (isNoSuchMultipartUploadError(error)) {
      return;
    }

    throw createMediaAssetStorageError(context, "abort_multipart_upload", error);
  }
}

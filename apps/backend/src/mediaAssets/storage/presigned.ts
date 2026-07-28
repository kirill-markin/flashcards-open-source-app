import {
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  PresignedMediaAssetDownload,
  PresignedMediaAssetUpload,
  PresignedMediaAssetUploadPart,
} from "../types";
import {
  createExpiresAt,
  downloadUrlExpiresSeconds,
  uploadUrlExpiresSeconds,
} from "./config";
import type {
  MediaAssetStorageContext,
  MediaAssetStorageDependencies,
  PresignMediaAssetDownloadInput,
  PresignMediaAssetUploadInput,
  PresignMultipartMediaAssetUploadPartsInput,
} from "./contracts";
import { buildMediaUploadStagingStorageKey } from "../storageKeys";
import {
  createMediaAssetStorageError,
  runMediaAssetStorageOperationWithRetries,
} from "./errors";
import {
  createUploadProofHeaders,
  createUploadProofMetadata,
  toBase64Sha256Digest,
} from "./proof";

export async function createPresignedMediaAssetUploadWithDependencies(
  input: PresignMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<PresignedMediaAssetUpload> {
  if (
    input.storageKey !== buildMediaUploadStagingStorageKey(
      input.workspaceId,
      input.mediaAssetId,
      input.lastOperationId,
    )
  ) {
    throw new TypeError("Presigned media uploads must target their exact staging key.");
  }
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.storageKey,
    observationScope: input.observationScope,
  };
  const checksumSha256 = toBase64Sha256Digest(input.sha256);
  const uploadProofMetadata = createUploadProofMetadata(input);
  const uploadProofHeaders = createUploadProofHeaders(uploadProofMetadata);
  const requiredUploadHeaders = {
    "content-type": input.mimeType,
    "if-none-match": "*",
    "x-amz-checksum-sha256": checksumSha256,
    ...uploadProofHeaders,
  };
  const requiredUploadHeaderNames = Object.keys(requiredUploadHeaders);

  try {
    const url = await runMediaAssetStorageOperationWithRetries(
      context,
      "create_presigned_upload",
      async () => getSignedUrl(
        dependencies.s3Client,
        new PutObjectCommand({
          Bucket: config.bucketName,
          Key: input.storageKey,
          ContentType: input.mimeType,
          ChecksumSHA256: checksumSha256,
          Metadata: uploadProofMetadata,
          IfNoneMatch: "*",
        }),
        {
          expiresIn: uploadUrlExpiresSeconds,
          signableHeaders: new Set(requiredUploadHeaderNames),
          unhoistableHeaders: new Set([
            "x-amz-checksum-sha256",
            ...Object.keys(uploadProofHeaders),
          ]),
        },
      ),
    );

    return {
      method: "PUT",
      url,
      expiresAt: createExpiresAt(uploadUrlExpiresSeconds),
      headers: requiredUploadHeaders,
    };
  } catch (error) {
    throw createMediaAssetStorageError(context, "create_presigned_upload", error);
  }
}

export async function createPresignedMediaAssetUploadPartsWithDependencies(
  input: PresignMultipartMediaAssetUploadPartsInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<ReadonlyArray<PresignedMediaAssetUploadPart>> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.stagingStorageKey,
    observationScope: input.observationScope,
  };

  try {
    return await runMediaAssetStorageOperationWithRetries(
      context,
      "create_presigned_part_upload",
      async () => Promise.all(input.parts.map(async (part) => {
        const checksumSha256 = toBase64Sha256Digest(part.sha256);
        const requiredUploadHeaders = {
          "x-amz-checksum-sha256": checksumSha256,
        };
        const url = await getSignedUrl(
          dependencies.s3Client,
          new UploadPartCommand({
            Bucket: config.bucketName,
            Key: input.stagingStorageKey,
            UploadId: input.s3UploadId,
            PartNumber: part.partNumber,
            ChecksumSHA256: checksumSha256,
          }),
          {
            expiresIn: uploadUrlExpiresSeconds,
            signableHeaders: new Set(Object.keys(requiredUploadHeaders)),
            unhoistableHeaders: new Set(Object.keys(requiredUploadHeaders)),
          },
        );

        return {
          partNumber: part.partNumber,
          method: "PUT",
          url,
          expiresAt: createExpiresAt(uploadUrlExpiresSeconds),
          headers: requiredUploadHeaders,
        };
      })),
    );
  } catch (error) {
    throw createMediaAssetStorageError(context, "create_presigned_part_upload", error);
  }
}

export async function createPresignedMediaAssetDownloadWithDependencies(
  input: PresignMediaAssetDownloadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<PresignedMediaAssetDownload> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.storageKey,
    observationScope: input.observationScope,
  };

  try {
    const url = await runMediaAssetStorageOperationWithRetries(
      context,
      "create_presigned_download",
      async () => getSignedUrl(
        dependencies.s3Client,
        new GetObjectCommand({
          Bucket: config.bucketName,
          Key: input.storageKey,
        }),
        { expiresIn: downloadUrlExpiresSeconds },
      ),
    );

    return {
      method: "GET",
      url,
      expiresAt: createExpiresAt(downloadUrlExpiresSeconds),
      rangeRequests: true,
    };
  } catch (error) {
    throw createMediaAssetStorageError(context, "create_presigned_download", error);
  }
}

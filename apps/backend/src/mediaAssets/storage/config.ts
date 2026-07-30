import { S3Client } from "@aws-sdk/client-s3";

export type MediaAssetsStorageConfig = Readonly<{
  bucketName: string;
}>;

export const uploadUrlExpiresSeconds = 15 * 60;
export const downloadUrlExpiresSeconds = 60 * 60;
export const multipartUploadExpiresSeconds = 24 * 60 * 60;

let mediaAssetsS3Client: S3Client | undefined;
let mediaBlobCleanupS3Client: S3Client | undefined;

export function getMediaAssetsS3Client(): S3Client {
  if (mediaAssetsS3Client !== undefined) {
    return mediaAssetsS3Client;
  }

  mediaAssetsS3Client = new S3Client({});
  return mediaAssetsS3Client;
}

export function getMediaBlobCleanupS3Client(): S3Client {
  if (mediaBlobCleanupS3Client !== undefined) {
    return mediaBlobCleanupS3Client;
  }

  mediaBlobCleanupS3Client = new S3Client({ maxAttempts: 1 });
  return mediaBlobCleanupS3Client;
}

function getRequiredMediaAssetsEnv(envName: string): string {
  const value = process.env[envName];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${envName} is required for media asset storage.`);
  }

  return value.trim();
}

export function getMediaAssetsStorageConfig(): MediaAssetsStorageConfig {
  return {
    bucketName: getRequiredMediaAssetsEnv("MEDIA_ASSETS_S3_BUCKET_NAME"),
  };
}

export function createExpiresAt(expiresSeconds: number): string {
  return new Date(Date.now() + expiresSeconds * 1_000).toISOString();
}

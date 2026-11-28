import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { isStandaloneDeployment, readStandaloneSecretFile } from "../../deployment/standalone";

/**
 * `content_read` on the standalone store, which reports no FULL_OBJECT checksum (none on single-part
 * objects, COMPOSITE on multipart ones even after a self-copy): media proofs hash the bytes they read.
 */
export type MediaAssetsFullObjectChecksumSource = "store" | "content_read";

export type MediaAssetsStorageConfig = Readonly<{
  bucketName: string;
  fullObjectChecksumSource: MediaAssetsFullObjectChecksumSource;
  /** The standalone store answers a conditional delete of a missing key with 412, not 404. */
  conditionalDeleteOfMissingKeyFails: boolean;
}>;

/** `private` sends requests over the internal address; `public_presign` only signs URLs that browsers and phones open. */
export type MediaAssetsS3ClientPurpose = "private" | "public_presign";

type MediaAssetsS3ClientOptions = Readonly<Pick<
  S3ClientConfig,
  "maxAttempts" | "requestChecksumCalculation" | "responseChecksumValidation"
>>;

type StandaloneMediaStorageEndpoints = Readonly<{
  privateEndpoint: string;
  publicEndpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}>;

export const uploadUrlExpiresSeconds = 15 * 60;
export const downloadUrlExpiresSeconds = 60 * 60;
export const multipartUploadExpiresSeconds = 24 * 60 * 60;
/**
 * Largest upload session accepted while proofs read content. One completion reads and hashes the whole
 * object twice (staging proof, then blob proof) around one store-side copy, inside the ~21 s completion
 * operation budget, and a retry repeats every read. RustFS 1.0.6 streamed about 110 MiB/s on a 10-core
 * laptop: 512 MiB took 12 s warm and 26 s cold, 256 MiB about 5.5 s, which leaves a slower host headroom.
 */
export const maximumContentReadMediaUploadBytes = 256 * 1024 * 1024;

let mediaAssetsS3Client: S3Client | undefined;
let mediaBlobCleanupS3Client: S3Client | undefined;
let mediaAssetsPresignS3Client: S3Client | undefined;

function getRequiredMediaAssetsEnv(envName: string): string {
  const value = process.env[envName];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${envName} is required for media asset storage.`);
  }

  return value.trim();
}

function getRequiredStandaloneEndpoint(envName: string): string {
  const value = getRequiredMediaAssetsEnv(envName);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${envName} must be an absolute http(s) origin for media asset storage, got "${value}".`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error(`${envName} must be a bare http(s) origin without credentials, path, query, or fragment, got "${value}".`);
  }

  return url.origin;
}

function getStandaloneMediaStorageEndpoints(): StandaloneMediaStorageEndpoints {
  return {
    privateEndpoint: getRequiredStandaloneEndpoint("MEDIA_ASSETS_S3_ENDPOINT"),
    publicEndpoint: getRequiredStandaloneEndpoint("MEDIA_ASSETS_S3_PUBLIC_ENDPOINT"),
    region: getRequiredMediaAssetsEnv("MEDIA_ASSETS_S3_REGION"),
    accessKeyId: getRequiredMediaAssetsEnv("MEDIA_ASSETS_S3_ACCESS_KEY_ID"),
    secretAccessKey: readStandaloneSecretFile("MEDIA_ASSETS_S3_SECRET_ACCESS_KEY_FILE"),
  };
}

/**
 * Outside standalone this is the SDK default chain, exactly as AWS runs it. On standalone every input
 * is required and explicit, so the client never reaches AWS or ambient AWS credentials.
 */
export function createMediaAssetsS3Client(
  purpose: MediaAssetsS3ClientPurpose,
  options: MediaAssetsS3ClientOptions,
): S3Client {
  if (isStandaloneDeployment() === false) {
    return new S3Client({ ...options });
  }

  const endpoints = getStandaloneMediaStorageEndpoints();
  return new S3Client({
    ...options,
    endpoint: purpose === "private" ? endpoints.privateEndpoint : endpoints.publicEndpoint,
    region: endpoints.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: endpoints.accessKeyId,
      secretAccessKey: endpoints.secretAccessKey,
    },
  });
}

export function getMediaAssetsS3Client(): S3Client {
  if (mediaAssetsS3Client !== undefined) {
    return mediaAssetsS3Client;
  }

  mediaAssetsS3Client = createMediaAssetsS3Client("private", {});
  return mediaAssetsS3Client;
}

export function getMediaBlobCleanupS3Client(): S3Client {
  if (mediaBlobCleanupS3Client !== undefined) {
    return mediaBlobCleanupS3Client;
  }

  mediaBlobCleanupS3Client = createMediaAssetsS3Client("private", { maxAttempts: 1 });
  return mediaBlobCleanupS3Client;
}

/** On AWS the private client signs too: one endpoint serves both. */
export function getMediaAssetsPresignS3Client(): S3Client {
  if (isStandaloneDeployment() === false) {
    return getMediaAssetsS3Client();
  }
  if (mediaAssetsPresignS3Client !== undefined) {
    return mediaAssetsPresignS3Client;
  }

  mediaAssetsPresignS3Client = createMediaAssetsS3Client("public_presign", {});
  return mediaAssetsPresignS3Client;
}

export function getMediaAssetsFullObjectChecksumSource(): MediaAssetsFullObjectChecksumSource {
  return isStandaloneDeployment() ? "content_read" : "store";
}

export function getMediaAssetsStorageConfig(): MediaAssetsStorageConfig {
  return {
    bucketName: getRequiredMediaAssetsEnv("MEDIA_ASSETS_S3_BUCKET_NAME"),
    fullObjectChecksumSource: getMediaAssetsFullObjectChecksumSource(),
    conditionalDeleteOfMissingKeyFails: isStandaloneDeployment(),
  };
}

export function createExpiresAt(expiresSeconds: number): string {
  return new Date(Date.now() + expiresSeconds * 1_000).toISOString();
}

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpError, type MediaAssetStorageErrorDetails } from "../shared/errors";
import {
  addBackendBreadcrumb,
  type BackendObservationScope,
} from "../observability/sentry";
import type {
  MediaAssetObjectMetadata,
  PresignedMediaAssetDownload,
  PresignedMediaAssetUpload,
} from "./types";

export type MediaAssetsStorageConfig = Readonly<{
  bucketName: string;
}>;

type MediaAssetStorageContext = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  observationScope: BackendObservationScope;
}>;

type PresignMediaAssetUploadInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  mimeType: string;
  sha256: string;
  observationScope: BackendObservationScope;
}>;

type PresignMediaAssetDownloadInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  observationScope: BackendObservationScope;
}>;

type AssertMediaAssetObjectInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  observationScope: BackendObservationScope;
}>;

type MediaAssetStorageOperation =
  | "create_presigned_upload"
  | "create_presigned_download"
  | "head_object";

type MediaAssetStorageDependencies = Readonly<{
  s3Client: S3Client;
  getMediaAssetsStorageConfigFn: typeof getMediaAssetsStorageConfig;
}>;

const maxS3AttemptCount = 3;
const uploadUrlExpiresSeconds = 15 * 60;
const downloadUrlExpiresSeconds = 60 * 60;

let mediaAssetsS3Client: S3Client | undefined;

function getMediaAssetsS3Client(): S3Client {
  if (mediaAssetsS3Client !== undefined) {
    return mediaAssetsS3Client;
  }

  mediaAssetsS3Client = new S3Client({});
  return mediaAssetsS3Client;
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

function getS3ErrorStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) {
    return null;
  }

  const metadata = (error as Readonly<{
    $metadata?: Readonly<{
      httpStatusCode?: unknown;
    }>;
  }>).$metadata;

  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : null;
}

function getS3ErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function getS3ErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatS3ErrorSummary(error: unknown): string {
  const errorName = getS3ErrorName(error);
  const errorMessage = getS3ErrorMessage(error);
  const statusCode = getS3ErrorStatusCode(error);
  const statusSuffix = statusCode === null ? "" : ` status=${statusCode}`;
  return `${errorName}${statusSuffix}: ${errorMessage}`;
}

function isHeadObjectUploadNotAvailableStatusCode(statusCode: number | null): boolean {
  return statusCode === 403 || statusCode === 404;
}

function createExpiresAt(expiresSeconds: number): string {
  return new Date(Date.now() + expiresSeconds * 1_000).toISOString();
}

function toBase64Sha256Digest(sha256: string): string {
  return Buffer.from(sha256, "hex").toString("base64");
}

function toHexSha256Digest(checksumSha256: string | undefined): string | null {
  if (checksumSha256 === undefined || checksumSha256.trim() === "") {
    return null;
  }

  return Buffer.from(checksumSha256, "base64").toString("hex");
}

async function runMediaAssetStorageOperationWithRetries<Result>(
  context: MediaAssetStorageContext,
  operation: MediaAssetStorageOperation,
  bucketName: string,
  run: () => Promise<Result>,
): Promise<Result> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxS3AttemptCount; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === maxS3AttemptCount) {
        break;
      }

      addBackendBreadcrumb({
        action: "media_asset_storage_retry",
        scope: context.observationScope,
        details: {
          operation,
          attempt,
          maxAttempts: maxS3AttemptCount,
          bucketName,
          workspaceId: context.workspaceId,
          mediaAssetId: context.mediaAssetId,
          storageKey: context.storageKey,
          statusCode: getS3ErrorStatusCode(error),
          errorClass: getS3ErrorName(error),
          errorMessage: getS3ErrorMessage(error),
        },
      });
    }
  }

  if (lastError === null) {
    throw new Error(
      `S3 ${operation} failed without an error for workspaceId=${context.workspaceId} mediaAssetId=${context.mediaAssetId} s3://${bucketName}/${context.storageKey}.`,
    );
  }

  throw lastError;
}

function createMediaAssetStorageError(
  context: MediaAssetStorageContext,
  bucketName: string,
  operation: MediaAssetStorageOperation,
  error: unknown,
): HttpError {
  const errorSummary = formatS3ErrorSummary(error);
  const location = `workspaceId=${context.workspaceId} mediaAssetId=${context.mediaAssetId} s3://${bucketName}/${context.storageKey}`;
  const details: MediaAssetStorageErrorDetails = {
    operation,
    workspaceId: context.workspaceId,
    mediaAssetId: context.mediaAssetId,
    storageKey: context.storageKey,
    bucketName,
    s3StatusCode: getS3ErrorStatusCode(error),
    s3ErrorClass: getS3ErrorName(error),
    s3ErrorMessage: getS3ErrorMessage(error),
  };
  if (operation === "head_object" && isHeadObjectUploadNotAvailableStatusCode(details.s3StatusCode)) {
    return new HttpError(
      409,
      `Uploaded media asset is not available in S3 for ${location}: ${errorSummary}`,
      "MEDIA_ASSET_UPLOAD_NOT_FOUND",
      { mediaAssetStorage: details },
    );
  }

  return new HttpError(
    503,
    `Media asset storage ${operation} failed for ${location}: ${errorSummary}`,
    "MEDIA_ASSET_STORAGE_UNAVAILABLE",
    { mediaAssetStorage: details },
  );
}

function createMediaAssetUploadMismatchError(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): HttpError {
  return new HttpError(
    409,
    [
      "Uploaded media asset does not match declared metadata",
      `workspaceId=${input.workspaceId}`,
      `mediaAssetId=${input.mediaAssetId}`,
      `storageKey=${input.storageKey}`,
      `expectedSizeBytes=${input.sizeBytes}`,
      `actualSizeBytes=${objectMetadata.sizeBytes ?? "unknown"}`,
      `expectedMimeType=${input.mimeType}`,
      `actualMimeType=${objectMetadata.mimeType ?? "unknown"}`,
      `expectedSha256=${input.sha256}`,
      `actualSha256=${objectMetadata.checksumSha256 ?? "unknown"}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_MISMATCH",
  );
}

function assertMediaAssetObjectMetadataMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  if (
    objectMetadata.sizeBytes !== input.sizeBytes
    || objectMetadata.mimeType !== input.mimeType
    || objectMetadata.checksumSha256 !== input.sha256
  ) {
    throw createMediaAssetUploadMismatchError(input, objectMetadata);
  }
}

export async function createPresignedMediaAssetUploadWithDependencies(
  input: PresignMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<PresignedMediaAssetUpload> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.storageKey,
    observationScope: input.observationScope,
  };
  const checksumSha256 = toBase64Sha256Digest(input.sha256);

  try {
    const url = await runMediaAssetStorageOperationWithRetries(
      context,
      "create_presigned_upload",
      config.bucketName,
      async () => getSignedUrl(
        dependencies.s3Client,
        new PutObjectCommand({
          Bucket: config.bucketName,
          Key: input.storageKey,
          ContentType: input.mimeType,
          ChecksumSHA256: checksumSha256,
          IfNoneMatch: "*",
        }),
        {
          expiresIn: uploadUrlExpiresSeconds,
          signableHeaders: new Set(["content-type"]),
          unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
        },
      ),
    );

    return {
      method: "PUT",
      url,
      expiresAt: createExpiresAt(uploadUrlExpiresSeconds),
      headers: {
        "content-type": input.mimeType,
        "if-none-match": "*",
        "x-amz-checksum-sha256": checksumSha256,
      },
    };
  } catch (error) {
    throw createMediaAssetStorageError(context, config.bucketName, "create_presigned_upload", error);
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
      config.bucketName,
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
    };
  } catch (error) {
    throw createMediaAssetStorageError(context, config.bucketName, "create_presigned_download", error);
  }
}

export async function loadMediaAssetObjectMetadataWithDependencies(
  input: AssertMediaAssetObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<MediaAssetObjectMetadata> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.storageKey,
    observationScope: input.observationScope,
  };

  try {
    const response = await runMediaAssetStorageOperationWithRetries(
      context,
      "head_object",
      config.bucketName,
      async () => dependencies.s3Client.send(new HeadObjectCommand({
        Bucket: config.bucketName,
        Key: input.storageKey,
        ChecksumMode: "ENABLED",
      })),
    );

    return {
      sizeBytes: typeof response.ContentLength === "number" ? response.ContentLength : null,
      mimeType: typeof response.ContentType === "string" ? response.ContentType : null,
      checksumSha256: toHexSha256Digest(response.ChecksumSHA256),
    };
  } catch (error) {
    throw createMediaAssetStorageError(context, config.bucketName, "head_object", error);
  }
}

export async function assertMediaAssetObjectMatchesWithDependencies(
  input: AssertMediaAssetObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const objectMetadata = await loadMediaAssetObjectMetadataWithDependencies(input, dependencies);
  assertMediaAssetObjectMetadataMatches(input, objectMetadata);
}

export async function createPresignedMediaAssetUpload(
  input: PresignMediaAssetUploadInput,
): Promise<PresignedMediaAssetUpload> {
  return createPresignedMediaAssetUploadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function createPresignedMediaAssetDownload(
  input: PresignMediaAssetDownloadInput,
): Promise<PresignedMediaAssetDownload> {
  return createPresignedMediaAssetDownloadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function assertMediaAssetObjectMatches(
  input: AssertMediaAssetObjectInput,
): Promise<void> {
  return assertMediaAssetObjectMatchesWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

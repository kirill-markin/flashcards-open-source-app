import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
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
  lastOperationId: string;
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
  lastOperationId: string;
  observationScope: BackendObservationScope;
}>;

type PromoteMediaAssetUploadInput = Readonly<{
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

type MediaAssetStorageOperation =
  | "create_presigned_upload"
  | "create_presigned_download"
  | "head_object"
  | "copy_object";

type MediaAssetStorageDependencies = Readonly<{
  s3Client: S3Client;
  getMediaAssetsStorageConfigFn: typeof getMediaAssetsStorageConfig;
}>;

const maxS3AttemptCount = 3;
const uploadUrlExpiresSeconds = 15 * 60;
const downloadUrlExpiresSeconds = 60 * 60;
const uploadProofWorkspaceIdKey = "flashcards-workspace-id";
const uploadProofMediaAssetIdKey = "flashcards-media-asset-id";
const uploadProofLastOperationIdSha256Key = "flashcards-last-operation-id-sha256";
const uploadProofSha256Key = "flashcards-sha256";

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

function createCopySource(bucketName: string, storageKey: string): string {
  return `${bucketName}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

function hashUploadProofValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createUploadProofMetadata(input: Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  lastOperationId: string;
  sha256: string;
}>): Readonly<Record<string, string>> {
  return {
    [uploadProofWorkspaceIdKey]: input.workspaceId,
    [uploadProofMediaAssetIdKey]: input.mediaAssetId,
    [uploadProofLastOperationIdSha256Key]: hashUploadProofValue(input.lastOperationId),
    [uploadProofSha256Key]: input.sha256,
  };
}

function createUploadProofHeaders(metadata: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [`x-amz-meta-${key}`, value]),
  );
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
  const publicLocation = `workspaceId=${context.workspaceId} mediaAssetId=${context.mediaAssetId}`;
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
      `Uploaded media asset is not available in object storage for ${publicLocation}. Upload the file through a fresh media upload intent, then retry completion.`,
      "MEDIA_ASSET_UPLOAD_NOT_FOUND",
      { mediaAssetStorage: details },
    );
  }

  return new HttpError(
    503,
    `Media asset storage ${operation} failed for ${publicLocation}. Retry shortly and use requestId if the failure persists.`,
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

function createMediaAssetUploadProofMismatchError(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): HttpError {
  return new HttpError(
    409,
    [
      "Uploaded media asset proof does not match the authenticated upload intent",
      `workspaceId=${input.workspaceId}`,
      `mediaAssetId=${input.mediaAssetId}`,
      `expectedSha256=${input.sha256}`,
      `actualProofSha256=${objectMetadata.uploadProof.sha256 ?? "unknown"}`,
      `actualProofWorkspaceId=${objectMetadata.uploadProof.workspaceId ?? "unknown"}`,
      `actualProofMediaAssetId=${objectMetadata.uploadProof.mediaAssetId ?? "unknown"}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
  );
}

function assertMediaAssetObjectContentMatches(
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

function assertMediaAssetObjectUploadProofMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  const expectedLastOperationIdSha256 = hashUploadProofValue(input.lastOperationId);
  if (
    objectMetadata.uploadProof.workspaceId !== input.workspaceId
    || objectMetadata.uploadProof.mediaAssetId !== input.mediaAssetId
    || objectMetadata.uploadProof.lastOperationIdSha256 !== expectedLastOperationIdSha256
    || objectMetadata.uploadProof.sha256 !== input.sha256
  ) {
    throw createMediaAssetUploadProofMismatchError(input, objectMetadata);
  }
}

function assertMediaAssetObjectMetadataMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  assertMediaAssetObjectContentMatches(input, objectMetadata);
  assertMediaAssetObjectUploadProofMatches(input, objectMetadata);
}

function isMediaAssetObjectNotFoundError(error: unknown): boolean {
  return error instanceof HttpError && error.code === "MEDIA_ASSET_UPLOAD_NOT_FOUND";
}

function isCopyObjectIfNoneMatchFailure(error: unknown): boolean {
  const statusCode = getS3ErrorStatusCode(error);
  return statusCode === 409 || statusCode === 412;
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
      config.bucketName,
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
      uploadProof: {
        workspaceId: response.Metadata?.[uploadProofWorkspaceIdKey] ?? null,
        mediaAssetId: response.Metadata?.[uploadProofMediaAssetIdKey] ?? null,
        lastOperationIdSha256: response.Metadata?.[uploadProofLastOperationIdSha256Key] ?? null,
        sha256: response.Metadata?.[uploadProofSha256Key] ?? null,
      },
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

async function copyMediaAssetObjectIfAbsentWithDependencies(
  input: Readonly<{
    workspaceId: string;
    mediaAssetId: string;
    sourceStorageKey: string;
    destinationStorageKey: string;
    mimeType: string;
    sha256: string;
    observationScope: BackendObservationScope;
  }>,
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
      config.bucketName,
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
    throw createMediaAssetStorageError(context, config.bucketName, "copy_object", error);
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

export async function promoteMediaAssetUploadToBlob(
  input: PromoteMediaAssetUploadInput,
): Promise<void> {
  return promoteMediaAssetUploadToBlobWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

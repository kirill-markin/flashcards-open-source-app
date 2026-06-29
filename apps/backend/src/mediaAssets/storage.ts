import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpError, type MediaAssetStorageErrorDetails } from "../shared/errors";
import {
  addBackendBreadcrumb,
  type BackendObservationScope,
} from "../observability/sentry";
import type {
  CompleteMediaAssetUploadPartInput,
  CreatedMultipartMediaAssetUpload,
  MediaAssetObjectMetadata,
  PresignedMediaAssetDownload,
  PresignedMediaAssetUpload,
  PresignedMediaAssetUploadPart,
  MediaAssetUploadSessionPartRequest,
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

type CreateMultipartMediaAssetUploadInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  stagingStorageKey: string;
  mimeType: string;
  sha256: string;
  lastOperationId: string;
  observationScope: BackendObservationScope;
}>;

type PresignMultipartMediaAssetUploadPartsInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  stagingStorageKey: string;
  s3UploadId: string;
  parts: ReadonlyArray<MediaAssetUploadSessionPartRequest>;
  observationScope: BackendObservationScope;
}>;

type StoreMediaAssetBlobBytesInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  mimeType: string;
  sha256: string;
  lastOperationId: string;
  bytes: Buffer;
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

type CompleteMultipartMediaAssetUploadInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  stagingStorageKey: string;
  blobStorageKey: string;
  s3UploadId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  lastOperationId: string;
  parts: ReadonlyArray<CompleteMediaAssetUploadPartInput>;
  observationScope: BackendObservationScope;
}>;

type AbortMultipartMediaAssetUploadInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  stagingStorageKey: string;
  s3UploadId: string;
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
  | "create_multipart_upload"
  | "create_presigned_part_upload"
  | "complete_multipart_upload"
  | "abort_multipart_upload"
  | "head_object"
  | "get_object"
  | "copy_object"
  | "put_object";

type MediaAssetStorageDependencies = Readonly<{
  s3Client: S3Client;
  getMediaAssetsStorageConfigFn: typeof getMediaAssetsStorageConfig;
}>;

const maxS3AttemptCount = 3;
const uploadUrlExpiresSeconds = 15 * 60;
const downloadUrlExpiresSeconds = 60 * 60;
const multipartUploadExpiresSeconds = 24 * 60 * 60;
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

function isHeadObjectUploadNotAvailableStatusCode(statusCode: number | null): boolean {
  return statusCode === 403 || statusCode === 404;
}

function isUploadNotAvailableStorageError(operation: MediaAssetStorageOperation, statusCode: number | null): boolean {
  if (operation === "head_object") {
    return isHeadObjectUploadNotAvailableStatusCode(statusCode);
  }

  return operation === "get_object" && statusCode === 404;
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

type MediaAssetObjectBodyChunk = Uint8Array | string;

type MediaAssetObjectBody = AsyncIterable<MediaAssetObjectBodyChunk>;

type MediaAssetObjectContentHash = Readonly<{
  sizeBytes: number;
  sha256: string;
}>;

function isMediaAssetObjectBody(value: unknown): value is MediaAssetObjectBody {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function toMediaAssetObjectBodyChunkBytes(chunk: MediaAssetObjectBodyChunk): Uint8Array {
  return typeof chunk === "string" ? Buffer.from(chunk) : chunk;
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
          workspaceId: context.workspaceId,
          mediaAssetId: context.mediaAssetId,
          statusCode: getS3ErrorStatusCode(error),
          errorClass: getS3ErrorName(error),
        },
      });
    }
  }

  if (lastError === null) {
    throw new Error(
      `S3 ${operation} failed without an error for workspaceId=${context.workspaceId} mediaAssetId=${context.mediaAssetId}.`,
    );
  }

  throw lastError;
}

function createMediaAssetStorageError(
  context: MediaAssetStorageContext,
  operation: MediaAssetStorageOperation,
  error: unknown,
): HttpError {
  const publicLocation = `workspaceId=${context.workspaceId} mediaAssetId=${context.mediaAssetId}`;
  const s3StatusCode = getS3ErrorStatusCode(error);
  const isUploadNotAvailable = isUploadNotAvailableStorageError(operation, s3StatusCode);
  const details: MediaAssetStorageErrorDetails = {
    operation,
    workspaceId: context.workspaceId,
    mediaAssetId: context.mediaAssetId,
    s3StatusCode,
    s3ErrorClass: getS3ErrorName(error),
    reason: isUploadNotAvailable ? "upload_not_available" : "storage_temporarily_unavailable",
    retryable: isUploadNotAvailable === false,
  };
  if (isUploadNotAvailable) {
    return new HttpError(
      409,
      `Completed media upload is not available for ${publicLocation}. Upload the file through a fresh media upload session, then retry completion.`,
      "MEDIA_ASSET_UPLOAD_NOT_FOUND",
      { mediaAssetStorage: details },
    );
  }

  return new HttpError(
    503,
    `Media asset transfer is temporarily unavailable for ${publicLocation}. Retry shortly and use requestId if the failure persists.`,
    "MEDIA_ASSET_STORAGE_UNAVAILABLE",
    { mediaAssetStorage: details },
  );
}

function createMediaAssetUploadMismatchError(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): HttpError {
  const mismatchedFields = [
    ...(objectMetadata.sizeBytes === input.sizeBytes ? [] : ["sizeBytes"]),
    ...(objectMetadata.mimeType === input.mimeType ? [] : ["mimeType"]),
    ...(objectMetadata.checksumSha256 === input.sha256 ? [] : ["sha256"]),
  ];

  return new HttpError(
    409,
    [
      "Uploaded media asset does not match declared metadata",
      `workspaceId=${input.workspaceId}`,
      `mediaAssetId=${input.mediaAssetId}`,
      `mismatchedFields=${mismatchedFields.join(",")}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_MISMATCH",
  );
}

function createMediaAssetUploadContentHashMismatchError(
  input: AssertMediaAssetObjectInput,
  objectContent: MediaAssetObjectContentHash,
): HttpError {
  const mismatchedFields = [
    ...(objectContent.sizeBytes === input.sizeBytes ? [] : ["sizeBytes"]),
    ...(objectContent.sha256 === input.sha256 ? [] : ["sha256"]),
  ];

  return new HttpError(
    409,
    [
      "Uploaded media asset bytes do not match declared metadata",
      `workspaceId=${input.workspaceId}`,
      `mediaAssetId=${input.mediaAssetId}`,
      `mismatchedFields=${mismatchedFields.join(",")}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_MISMATCH",
  );
}

function createMediaAssetUploadProofMismatchError(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): HttpError {
  const expectedLastOperationIdSha256 = hashUploadProofValue(input.lastOperationId);
  const mismatchedProofFields = [
    ...(objectMetadata.uploadProof.workspaceId === input.workspaceId ? [] : ["workspaceId"]),
    ...(objectMetadata.uploadProof.mediaAssetId === input.mediaAssetId ? [] : ["mediaAssetId"]),
    ...(objectMetadata.uploadProof.lastOperationIdSha256 === expectedLastOperationIdSha256 ? [] : ["lastOperationId"]),
    ...(objectMetadata.uploadProof.sha256 === input.sha256 ? [] : ["sha256"]),
  ];

  return new HttpError(
    409,
    [
      "Uploaded media asset proof does not match the authenticated upload session",
      `workspaceId=${input.workspaceId}`,
      `mediaAssetId=${input.mediaAssetId}`,
      `mismatchedProofFields=${mismatchedProofFields.join(",")}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
  );
}

function assertMediaAssetObjectContentMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  assertMediaAssetObjectShapeMatches(input, objectMetadata);
  if (objectMetadata.checksumSha256 !== input.sha256) {
    throw createMediaAssetUploadMismatchError(input, objectMetadata);
  }
}

function assertMediaAssetObjectShapeMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  if (
    objectMetadata.sizeBytes !== input.sizeBytes
    || objectMetadata.mimeType !== input.mimeType
  ) {
    throw createMediaAssetUploadMismatchError(input, objectMetadata);
  }
}

function assertMediaAssetObjectContentHashMatches(
  input: AssertMediaAssetObjectInput,
  objectContent: MediaAssetObjectContentHash,
): void {
  if (
    objectContent.sizeBytes !== input.sizeBytes
    || objectContent.sha256 !== input.sha256
  ) {
    throw createMediaAssetUploadContentHashMismatchError(input, objectContent);
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

function assertMediaAssetObjectShapeAndProofMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  assertMediaAssetObjectShapeMatches(input, objectMetadata);
  assertMediaAssetObjectUploadProofMatches(input, objectMetadata);
}

function isNoSuchMultipartUploadError(error: unknown): boolean {
  return getS3ErrorStatusCode(error) === 404 && getS3ErrorName(error) === "NoSuchUpload";
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
      checksumType: response.ChecksumType ?? null,
      uploadProof: {
        workspaceId: response.Metadata?.[uploadProofWorkspaceIdKey] ?? null,
        mediaAssetId: response.Metadata?.[uploadProofMediaAssetIdKey] ?? null,
        lastOperationIdSha256: response.Metadata?.[uploadProofLastOperationIdSha256Key] ?? null,
        sha256: response.Metadata?.[uploadProofSha256Key] ?? null,
      },
    };
  } catch (error) {
    throw createMediaAssetStorageError(context, "head_object", error);
  }
}

export async function assertMediaAssetObjectMatchesWithDependencies(
  input: AssertMediaAssetObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const objectMetadata = await loadMediaAssetObjectMetadataWithDependencies(input, dependencies);
  assertMediaAssetObjectMetadataMatches(input, objectMetadata);
}

async function hashMediaAssetObjectContentWithDependencies(
  input: AssertMediaAssetObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<MediaAssetObjectContentHash> {
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
      "get_object",
      async () => dependencies.s3Client.send(new GetObjectCommand({
        Bucket: config.bucketName,
        Key: input.storageKey,
      })),
    );
    const body = response.Body;
    if (isMediaAssetObjectBody(body) === false) {
      throw new Error(
        `S3 get_object did not return a readable body for workspaceId=${input.workspaceId} mediaAssetId=${input.mediaAssetId}.`,
      );
    }

    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const chunk of body) {
      const bytes = toMediaAssetObjectBodyChunkBytes(chunk);
      sizeBytes += bytes.byteLength;
      hash.update(bytes);
    }

    return {
      sizeBytes,
      sha256: hash.digest("hex"),
    };
  } catch (error) {
    throw createMediaAssetStorageError(context, "get_object", error);
  }
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

async function promoteVerifiedMediaAssetUploadToBlobWithDependencies(
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

export async function createMultipartMediaAssetUpload(
  input: CreateMultipartMediaAssetUploadInput,
): Promise<CreatedMultipartMediaAssetUpload> {
  return createMultipartMediaAssetUploadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function createPresignedMediaAssetUpload(
  input: PresignMediaAssetUploadInput,
): Promise<PresignedMediaAssetUpload> {
  return createPresignedMediaAssetUploadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function createPresignedMediaAssetUploadParts(
  input: PresignMultipartMediaAssetUploadPartsInput,
): Promise<ReadonlyArray<PresignedMediaAssetUploadPart>> {
  return createPresignedMediaAssetUploadPartsWithDependencies(input, {
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

export async function storeMediaAssetBlobBytesIfAbsent(
  input: StoreMediaAssetBlobBytesInput,
): Promise<void> {
  return storeMediaAssetBlobBytesIfAbsentWithDependencies(input, {
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

export async function completeMultipartMediaAssetUpload(
  input: CompleteMultipartMediaAssetUploadInput,
): Promise<void> {
  return completeMultipartMediaAssetUploadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function abortMultipartMediaAssetUpload(
  input: AbortMultipartMediaAssetUploadInput,
): Promise<void> {
  return abortMultipartMediaAssetUploadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

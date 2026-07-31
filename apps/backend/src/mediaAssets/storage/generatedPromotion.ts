import {
  CopyObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import {
  assertGeneratedMediaBlobStorageCapabilityForMutation,
  type GeneratedMediaBlobStorageCapability,
  type GeneratedMediaBlobWriterExactInput,
} from "../../chat/cardImages/promotion/jobs";
import { addBackendBreadcrumb, type BackendObservationScope } from "../../observability/sentry";
import { MediaBlobWriterFenceError } from "../blobLifecycle";
import { imageJpegCardMediaBlobMimeType, type MediaAssetObjectMetadata } from "../types";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../storageKeys";
import { getMediaAssetsS3Client, getMediaAssetsStorageConfig } from "./config";
import type { MediaAssetStorageDependencies } from "./contracts";
import { getS3ErrorStatusCode } from "./errors";
import {
  createUploadProofMetadata, toBase64Sha256Digest, toHexSha256Digest,
  uploadProofLastOperationIdSha256Key,
  uploadProofMediaAssetIdKey, uploadProofSha256Key, uploadProofWorkspaceIdKey,
} from "./proof";
const maximumS3Attempts = 3;
let generatedMediaPromotionS3Client: S3Client | undefined;
type GeneratedMediaStorageRequestInput = Readonly<{
  workspaceId: string; mediaAssetId: string; operationId: string; signal: AbortSignal;
  observationScope: BackendObservationScope;
}>;
export type GeneratedMediaStagingObjectInput = GeneratedMediaStorageRequestInput
  & Readonly<{ stagingStorageKey: string }>;
export type GeneratedMediaStagingObject = Readonly<{
  stagingStorageKey: string; mimeType: typeof imageJpegCardMediaBlobMimeType; sizeBytes: number; sha256: string;
}>;
export type StoreGeneratedMediaStagingObjectInput = GeneratedMediaStagingObjectInput & Readonly<{
  bytes: Buffer; mimeType: typeof imageJpegCardMediaBlobMimeType; sizeBytes: number; sha256: string;
}>;
export type GeneratedMediaObjectPromotionInput = GeneratedMediaStagingObjectInput & Readonly<{
  writer: GeneratedMediaBlobWriterExactInput;
  storageCapability: GeneratedMediaBlobStorageCapability;
  blobStorageKey: string; mimeType: string; sizeBytes: number; sha256: string;
}>;
type GeneratedMediaObjectMetadata = MediaAssetObjectMetadata & Readonly<{ customMetadata: Readonly<Record<string, string>> }>;
type GeneratedMediaBlobStorageCapabilityVerifier = (
  storageCapability: GeneratedMediaBlobStorageCapability,
  writer: GeneratedMediaBlobWriterExactInput,
) => void;
export class GeneratedMediaPromotionStorageTerminalError extends Error {
  constructor(readonly code: string, readonly safeMessage: string, readonly statusCode: number | null) {
    super(safeMessage);
    this.name = "GeneratedMediaPromotionStorageTerminalError";
  }
}
export class GeneratedMediaPromotionStorageTransientError extends Error {
  readonly code = "S3_TRANSIENT";
  readonly safeMessage = "Object storage remained temporarily unavailable after bounded retries.";
  constructor(readonly statusCode: number | null) {
    super("Object storage remained temporarily unavailable after bounded retries.");
    this.name = "GeneratedMediaPromotionStorageTransientError";
  }
}
function isTransientS3Error(error: unknown, statusCode: number | null): boolean {
  const fields = typeof error === "object" && error !== null ? error as Readonly<{ $retryable?: unknown; code?: unknown; name?: unknown }> : null;
  return fields?.$retryable !== undefined
    || (typeof fields?.name === "string"
      && ["TimeoutError", "RequestTimeout", "RequestTimeoutException"].includes(fields.name))
    || (typeof fields?.code === "string"
      && ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH",
        "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(fields.code))
    || (statusCode !== null && ([408, 409, 425, 429].includes(statusCode) || statusCode >= 500));
}
async function waitForRetry(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, 50);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
async function runS3<Result>(
  input: GeneratedMediaStorageRequestInput,
  operation: "head_object" | "copy_object" | "put_object",
  run: () => Promise<Result>,
): Promise<Result> {
  let lastStatusCode: number | null = null;
  for (let attempt = 1; attempt <= maximumS3Attempts; attempt += 1) {
    input.signal.throwIfAborted();
    try {
      return await run();
    } catch (error) {
      input.signal.throwIfAborted();
      lastStatusCode = getS3ErrorStatusCode(error);
      if (!isTransientS3Error(error, lastStatusCode)) throw error;
      if (attempt === maximumS3Attempts) break;
      addBackendBreadcrumb({
        action: "media_asset_storage_retry",
        scope: input.observationScope,
        details: {
          operation, attempt, maxAttempts: maximumS3Attempts,
          workspaceId: input.workspaceId, mediaAssetId: input.mediaAssetId,
          statusCode: lastStatusCode, errorClass: error instanceof Error ? error.name : "UnknownError",
        },
      });
      await waitForRetry(input.signal);
    }
  }
  throw new GeneratedMediaPromotionStorageTransientError(lastStatusCode);
}
function toMetadata(response: Readonly<{
  ContentLength?: number; ContentType?: string; ETag?: string;
  ChecksumSHA256?: string;
  ChecksumType?: "COMPOSITE" | "FULL_OBJECT";
  Metadata?: Readonly<Record<string, string>>;
}>): GeneratedMediaObjectMetadata {
  return {
    sizeBytes: response.ContentLength ?? null,
    mimeType: response.ContentType ?? null,
    eTag: response.ETag ?? null,
    checksumSha256: toHexSha256Digest(response.ChecksumSHA256),
    checksumType: response.ChecksumType ?? null,
    customMetadata: response.Metadata ?? {},
    uploadProof: {
      workspaceId: response.Metadata?.[uploadProofWorkspaceIdKey] ?? null,
      mediaAssetId: response.Metadata?.[uploadProofMediaAssetIdKey] ?? null,
      lastOperationIdSha256: response.Metadata?.[uploadProofLastOperationIdSha256Key] ?? null,
      sha256: response.Metadata?.[uploadProofSha256Key] ?? null,
    },
  };
}
function terminal(code: string, safeMessage: string, statusCode: number | null): never {
  throw new GeneratedMediaPromotionStorageTerminalError(code, safeMessage, statusCode);
}
function validateStagingIdentity(input: GeneratedMediaStagingObjectInput): void {
  if (input.stagingStorageKey !== buildMediaUploadStagingStorageKey(
    input.workspaceId, input.mediaAssetId, input.operationId,
  )) terminal("INVALID_STORAGE_KEY", "Generated-media staging storage key is not deterministic.", null);
}
function validateContent(input: Readonly<{
  mimeType: string; sizeBytes: number; sha256: string;
}>): void {
  const proofFieldsValid = input.mimeType === input.mimeType.trim().toLowerCase()
    && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(input.mimeType)
    && /^[0-9a-f]{64}$/u.test(input.sha256)
    && Number.isSafeInteger(input.sizeBytes) && input.sizeBytes > 0;
  if (!proofFieldsValid) terminal("INVALID_MEDIA_PROOF", "Generated-media promotion proof fields are not normalized.", null);
}
function assertPromotionInputMatchesWriter(input: GeneratedMediaObjectPromotionInput): void {
  if (
    input.workspaceId !== input.writer.workspaceId
    || input.mediaAssetId !== input.writer.mediaAssetId
    || input.operationId !== input.writer.operationId
    || input.stagingStorageKey !== input.writer.stagingStorageKey
    || input.blobStorageKey !== input.writer.blobStorageKey
    || input.mimeType !== input.writer.mimeType
    || input.sizeBytes !== input.writer.sizeBytes
    || input.sha256 !== input.writer.sha256
  ) {
    throw new MediaBlobWriterFenceError("verify_generated_storage_input");
  }
}
function assertPromotionMutationAuthorized(
  input: GeneratedMediaObjectPromotionInput,
  verifyCapability: GeneratedMediaBlobStorageCapabilityVerifier,
): void {
  input.signal.throwIfAborted();
  assertPromotionInputMatchesWriter(input);
  verifyCapability(input.storageCapability, input.writer);
}
function validatePromotionInput(
  input: GeneratedMediaObjectPromotionInput,
  verifyCapability: GeneratedMediaBlobStorageCapabilityVerifier,
): void {
  assertPromotionMutationAuthorized(input, verifyCapability);
  validateStagingIdentity(input);
  validateContent(input);
  if (input.blobStorageKey !== buildMediaBlobStorageKey(input.sha256)) {
    terminal("INVALID_STORAGE_KEY", "Generated-media blob storage key is not deterministic.", null);
  }
}
async function headObject(
  input: GeneratedMediaStorageRequestInput,
  key: string,
  dependencies: MediaAssetStorageDependencies,
  authorizeAttempt: () => void,
): Promise<GeneratedMediaObjectMetadata | null> {
  try {
    return toMetadata(await runS3(input, "head_object", async () => {
      authorizeAttempt();
      return dependencies.s3Client.send(
        new HeadObjectCommand({
          Bucket: dependencies.getMediaAssetsStorageConfigFn().bucketName,
          Key: key,
          ChecksumMode: "ENABLED",
        }),
        { abortSignal: input.signal },
      );
    }));
  } catch (error) {
    input.signal.throwIfAborted();
    const statusCode = getS3ErrorStatusCode(error);
    if (statusCode === 403 || statusCode === 404) return null;
    if (error instanceof GeneratedMediaPromotionStorageTransientError) throw error;
    if (statusCode === null) throw error;
    terminal("S3_REQUEST_REJECTED", "Object storage rejected the promotion request.", statusCode);
  }
}
function contentMatches(input: GeneratedMediaObjectPromotionInput, metadata: MediaAssetObjectMetadata): boolean {
  return metadata.sizeBytes === input.sizeBytes
    && metadata.mimeType === input.mimeType
    && metadata.checksumSha256 === input.sha256
    && metadata.checksumType === "FULL_OBJECT";
}
function readStagingObject(
  input: GeneratedMediaStagingObjectInput,
  metadata: GeneratedMediaObjectMetadata,
): GeneratedMediaStagingObject {
  const sha256 = metadata.checksumSha256;
  const sizeBytes = metadata.sizeBytes;
  const metadataKeys = Object.keys(metadata.customMetadata).sort();
  const expectedMetadataKeys = [
    uploadProofLastOperationIdSha256Key,
    uploadProofMediaAssetIdKey,
    uploadProofSha256Key,
    uploadProofWorkspaceIdKey,
  ].sort();
  if (metadata.mimeType !== imageJpegCardMediaBlobMimeType
    || typeof sizeBytes !== "number"
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 1
    || sha256 === null
    || !/^[0-9a-f]{64}$/u.test(sha256)
    || metadata.checksumType !== "FULL_OBJECT") {
    terminal("STAGING_CONTENT_INVALID", "Staged generated-media MIME type, byte size, or SHA-256 checksum is invalid.", null);
  }
  if (metadata.uploadProof.sha256 !== sha256) {
    terminal("STAGING_CONTENT_INVALID", "Staged generated-media checksum does not match its immutable content proof.", null);
  }
  const proof = createUploadProofMetadata({
    workspaceId: input.workspaceId, mediaAssetId: input.mediaAssetId,
    lastOperationId: input.operationId, sha256,
  });
  if (metadataKeys.length !== expectedMetadataKeys.length
    || metadataKeys.some((key, index) => key !== expectedMetadataKeys[index])
    || metadata.uploadProof.workspaceId !== proof[uploadProofWorkspaceIdKey]
    || metadata.uploadProof.mediaAssetId !== proof[uploadProofMediaAssetIdKey]
    || metadata.uploadProof.lastOperationIdSha256 !== proof[uploadProofLastOperationIdSha256Key]) {
    terminal("STAGING_PROOF_INVALID", "Staged generated-media ownership proof does not match the durable job.", null);
  }
  return {
    stagingStorageKey: input.stagingStorageKey,
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes,
    sha256,
  };
}
function assertStaging(
  input: GeneratedMediaObjectPromotionInput,
  metadata: GeneratedMediaObjectMetadata,
): void {
  const staging = readStagingObject(input, metadata);
  if (staging.sizeBytes !== input.sizeBytes
    || staging.mimeType !== input.mimeType
    || staging.sha256 !== input.sha256) {
    terminal("STAGING_CONTENT_INVALID", "Staged generated-media MIME type, byte size, or SHA-256 does not match the job.", null);
  }
}
function assertPermanent(input: GeneratedMediaObjectPromotionInput, metadata: GeneratedMediaObjectMetadata): void {
  const tenantNeutral = Object.keys(metadata.customMetadata).length === 1
    && metadata.customMetadata[uploadProofSha256Key] === input.sha256;
  if (!contentMatches(input, metadata) || !tenantNeutral) {
    terminal("PERMANENT_BLOB_CONFLICT", "The permanent object conflicts with the job or contains tenant metadata.", null);
  }
}
async function copyObject(
  input: GeneratedMediaObjectPromotionInput,
  dependencies: MediaAssetStorageDependencies,
  verifyCapability: GeneratedMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  const bucketName = dependencies.getMediaAssetsStorageConfigFn().bucketName;
  try {
    await runS3(input, "copy_object", async () => {
      assertPromotionMutationAuthorized(input, verifyCapability);
      return dependencies.s3Client.send(
        new CopyObjectCommand({
          Bucket: bucketName,
          Key: input.blobStorageKey,
          CopySource: `${bucketName}/${input.stagingStorageKey.split("/").map(encodeURIComponent).join("/")}`,
          ContentType: input.mimeType,
          ChecksumAlgorithm: "SHA256",
          IfNoneMatch: "*",
          MetadataDirective: "REPLACE",
          Metadata: { [uploadProofSha256Key]: input.sha256 },
        }),
        { abortSignal: input.signal },
      );
    });
  } catch (error) {
    input.signal.throwIfAborted();
    const statusCode = getS3ErrorStatusCode(error);
    if (statusCode === 412) return;
    if (error instanceof GeneratedMediaPromotionStorageTransientError) throw error;
    if (statusCode === null) throw error;
    terminal("S3_REQUEST_REJECTED", "Object storage rejected the promotion request.", statusCode);
  }
}
async function putStagingObject(
  input: StoreGeneratedMediaStagingObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const bucketName = dependencies.getMediaAssetsStorageConfigFn().bucketName;
  try {
    await runS3(input, "put_object", async () => dependencies.s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: input.stagingStorageKey,
        Body: input.bytes,
        ContentType: input.mimeType,
        ChecksumSHA256: toBase64Sha256Digest(input.sha256),
        IfNoneMatch: "*",
        Metadata: createUploadProofMetadata({
          workspaceId: input.workspaceId, mediaAssetId: input.mediaAssetId,
          lastOperationId: input.operationId, sha256: input.sha256,
        }),
      }),
      { abortSignal: input.signal },
    ));
  } catch (error) {
    input.signal.throwIfAborted();
    const statusCode = getS3ErrorStatusCode(error);
    if (statusCode === 412) return;
    if (error instanceof GeneratedMediaPromotionStorageTransientError) throw error;
    if (statusCode === null) throw error;
    terminal("S3_REQUEST_REJECTED", "Object storage rejected the staging request.", statusCode);
  }
}
export async function loadGeneratedMediaStagingObjectWithDependencies(
  input: GeneratedMediaStagingObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<GeneratedMediaStagingObject | null> {
  validateStagingIdentity(input);
  const metadata = await headObject(
    input,
    input.stagingStorageKey,
    dependencies,
    () => input.signal.throwIfAborted(),
  );
  return metadata === null ? null : readStagingObject(input, metadata);
}
export async function storeGeneratedMediaStagingObjectWithDependencies(
  input: StoreGeneratedMediaStagingObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<GeneratedMediaStagingObject> {
  validateStagingIdentity(input);
  validateContent(input);
  if (input.mimeType !== imageJpegCardMediaBlobMimeType
    || input.bytes.byteLength !== input.sizeBytes
    || createHash("sha256").update(input.bytes).digest("hex") !== input.sha256) {
    terminal("INVALID_MEDIA_PROOF", "Generated-media staging bytes do not match normalized metadata.", null);
  }
  await putStagingObject(input, dependencies);
  const stored = await loadGeneratedMediaStagingObjectWithDependencies(input, dependencies);
  if (stored === null) throw new GeneratedMediaPromotionStorageTransientError(404);
  if (stored.sizeBytes !== input.sizeBytes || stored.sha256 !== input.sha256) {
    terminal("STAGING_CONTENT_INVALID", "The deterministic staging key already contains different generated-media bytes.", null);
  }
  return stored;
}
export async function promoteGeneratedMediaObjectWithDependencies(
  input: GeneratedMediaObjectPromotionInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  return promoteGeneratedMediaObjectWithCapabilityVerifier(
    input,
    dependencies,
    assertGeneratedMediaBlobStorageCapabilityForMutation,
  );
}
export async function promoteGeneratedMediaObjectWithCapabilityVerifier(
  input: GeneratedMediaObjectPromotionInput,
  dependencies: MediaAssetStorageDependencies,
  verifyCapability: GeneratedMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  validatePromotionInput(input, verifyCapability);
  const staging = await headObject(
    input,
    input.stagingStorageKey,
    dependencies,
    () => input.signal.throwIfAborted(),
  );
  if (staging === null) terminal("STAGING_NOT_FOUND", "The staged object is missing.", 404);
  assertStaging(input, staging);
  const authorizePermanentAttempt = (): void => {
    assertPromotionMutationAuthorized(input, verifyCapability);
  };
  const existing = await headObject(
    input,
    input.blobStorageKey,
    dependencies,
    authorizePermanentAttempt,
  );
  if (existing !== null) {
    assertPermanent(input, existing);
    return;
  }
  await copyObject(input, dependencies, verifyCapability);
  const promoted = await headObject(
    input,
    input.blobStorageKey,
    dependencies,
    authorizePermanentAttempt,
  );
  if (promoted === null) throw new GeneratedMediaPromotionStorageTransientError(404);
  assertPermanent(input, promoted);
}
export async function promoteGeneratedMediaObject(
  input: GeneratedMediaObjectPromotionInput,
): Promise<void> {
  return promoteGeneratedMediaObjectWithDependencies(input, {
    s3Client: getGeneratedMediaPromotionS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}
export function getGeneratedMediaPromotionS3Client(): S3Client {
  if (generatedMediaPromotionS3Client !== undefined) {
    return generatedMediaPromotionS3Client;
  }
  generatedMediaPromotionS3Client = new S3Client({ maxAttempts: 1 });
  return generatedMediaPromotionS3Client;
}
export async function loadGeneratedMediaStagingObject(
  input: GeneratedMediaStagingObjectInput,
): Promise<GeneratedMediaStagingObject | null> {
  return loadGeneratedMediaStagingObjectWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}
export async function storeGeneratedMediaStagingObject(
  input: StoreGeneratedMediaStagingObjectInput,
): Promise<GeneratedMediaStagingObject> {
  return storeGeneratedMediaStagingObjectWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

import { CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { addBackendBreadcrumb, type BackendObservationScope } from "../../observability/sentry";
import type { MediaAssetObjectMetadata } from "../types";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../storageKeys";
import { getMediaAssetsS3Client, getMediaAssetsStorageConfig } from "./config";
import type { MediaAssetStorageDependencies } from "./contracts";
import { getS3ErrorStatusCode } from "./errors";
import {
  createUploadProofMetadata, toHexSha256Digest, uploadProofLastOperationIdSha256Key,
  uploadProofMediaAssetIdKey, uploadProofSha256Key, uploadProofWorkspaceIdKey,
} from "./proof";
const maximumS3Attempts = 3;
export type GeneratedMediaObjectPromotionInput = Readonly<{
  workspaceId: string; mediaAssetId: string; operationId: string;
  stagingStorageKey: string; blobStorageKey: string;
  mimeType: string; sizeBytes: number; sha256: string;
  observationScope: BackendObservationScope; signal: AbortSignal;
}>;
type GeneratedMediaObjectMetadata = MediaAssetObjectMetadata & Readonly<{ customMetadata: Readonly<Record<string, string>> }>;
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
  input: GeneratedMediaObjectPromotionInput,
  operation: "head_object" | "copy_object",
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
          statusCode: lastStatusCode,
          errorClass: error instanceof Error ? error.name : "UnknownError",
        },
      });
      await waitForRetry(input.signal);
    }
  }
  throw new GeneratedMediaPromotionStorageTransientError(lastStatusCode);
}
function toMetadata(response: Readonly<{
  ContentLength?: number; ContentType?: string; ChecksumSHA256?: string;
  ChecksumType?: "COMPOSITE" | "FULL_OBJECT";
  Metadata?: Readonly<Record<string, string>>;
}>): GeneratedMediaObjectMetadata {
  return {
    sizeBytes: response.ContentLength ?? null,
    mimeType: response.ContentType ?? null,
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
function validateInput(input: GeneratedMediaObjectPromotionInput): void {
  const keysMatch = input.stagingStorageKey === buildMediaUploadStagingStorageKey(
    input.workspaceId, input.mediaAssetId, input.operationId,
  ) && input.blobStorageKey === buildMediaBlobStorageKey(input.sha256);
  const proofFieldsValid = input.mimeType === input.mimeType.trim().toLowerCase()
    && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(input.mimeType)
    && /^[0-9a-f]{64}$/u.test(input.sha256)
    && Number.isSafeInteger(input.sizeBytes) && input.sizeBytes > 0;
  if (!keysMatch) terminal(
    "INVALID_STORAGE_KEY", "Generated-media promotion storage keys are not deterministic.", null,
  );
  if (!proofFieldsValid) terminal(
    "INVALID_MEDIA_PROOF", "Generated-media promotion proof fields are not normalized.", null,
  );
}
async function headObject(
  input: GeneratedMediaObjectPromotionInput,
  key: string,
  dependencies: MediaAssetStorageDependencies,
): Promise<GeneratedMediaObjectMetadata | null> {
  try {
    return toMetadata(await runS3(input, "head_object", async () => dependencies.s3Client.send(
      new HeadObjectCommand({
        Bucket: dependencies.getMediaAssetsStorageConfigFn().bucketName,
        Key: key,
        ChecksumMode: "ENABLED",
      }),
      { abortSignal: input.signal },
    )));
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
function assertStaging(input: GeneratedMediaObjectPromotionInput, metadata: GeneratedMediaObjectMetadata): void {
  const proof = createUploadProofMetadata({
    workspaceId: input.workspaceId, mediaAssetId: input.mediaAssetId,
    lastOperationId: input.operationId, sha256: input.sha256,
  });
  if (!contentMatches(input, metadata)) terminal(
    "STAGING_CONTENT_INVALID",
    "Staged generated-media MIME type, byte size, or SHA-256 does not match the job.",
    null,
  );
  if (
    metadata.uploadProof.workspaceId !== proof[uploadProofWorkspaceIdKey]
    || metadata.uploadProof.mediaAssetId !== proof[uploadProofMediaAssetIdKey]
    || metadata.uploadProof.lastOperationIdSha256
      !== proof[uploadProofLastOperationIdSha256Key]
    || metadata.uploadProof.sha256 !== proof[uploadProofSha256Key]
  ) terminal(
    "STAGING_PROOF_INVALID",
    "Staged generated-media ownership proof does not match the durable job.",
    null,
  );
}
function assertPermanent(input: GeneratedMediaObjectPromotionInput, metadata: GeneratedMediaObjectMetadata): void {
  const tenantNeutral = Object.keys(metadata.customMetadata).length === 1
    && metadata.customMetadata[uploadProofSha256Key] === input.sha256;
  if (!contentMatches(input, metadata) || !tenantNeutral) terminal(
    "PERMANENT_BLOB_CONFLICT",
    "The permanent object conflicts with the job or contains tenant metadata.",
    null,
  );
}
async function copyObject(
  input: GeneratedMediaObjectPromotionInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const bucketName = dependencies.getMediaAssetsStorageConfigFn().bucketName;
  try {
    await runS3(input, "copy_object", async () => dependencies.s3Client.send(
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
    ));
  } catch (error) {
    input.signal.throwIfAborted();
    const statusCode = getS3ErrorStatusCode(error);
    if (statusCode === 412) return;
    if (error instanceof GeneratedMediaPromotionStorageTransientError) throw error;
    if (statusCode === null) throw error;
    terminal("S3_REQUEST_REJECTED", "Object storage rejected the promotion request.", statusCode);
  }
}
export async function promoteGeneratedMediaObjectWithDependencies(
  input: GeneratedMediaObjectPromotionInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  validateInput(input);
  const staging = await headObject(input, input.stagingStorageKey, dependencies);
  if (staging === null) terminal("STAGING_NOT_FOUND", "The staged object is missing.", 404);
  assertStaging(input, staging);
  const existing = await headObject(input, input.blobStorageKey, dependencies);
  if (existing !== null) {
    assertPermanent(input, existing);
    return;
  }
  await copyObject(input, dependencies);
  const promoted = await headObject(input, input.blobStorageKey, dependencies);
  if (promoted === null) throw new GeneratedMediaPromotionStorageTransientError(404);
  assertPermanent(input, promoted);
}
export async function promoteGeneratedMediaObject(
  input: GeneratedMediaObjectPromotionInput,
): Promise<void> {
  return promoteGeneratedMediaObjectWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

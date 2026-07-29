import {
  addBackendRuntimeBreadcrumb,
} from "../../observability/runtime";
import { HttpError, type MediaAssetStorageErrorDetails } from "../../shared/errors";
import type {
  MediaAssetStorageContext,
  MediaAssetStorageOperation,
} from "./contracts";

const maxS3AttemptCount = 3;

export const mediaAssetStorageMaximumAttemptCount = maxS3AttemptCount;

export type MultipartCompletionReconciliationStorageTerminalErrorCode =
  | "MULTIPART_UPLOAD_NOT_FOUND"
  | "MULTIPART_PARTS_INVALID"
  | "MULTIPART_PARTS_FINGERPRINT_MISMATCH"
  | "MULTIPART_STAGING_OBJECT_MISMATCH"
  | "MULTIPART_BLOB_OBJECT_MISMATCH"
  | "S3_REQUEST_REJECTED";

export type MultipartCompletionReconciliationS3Diagnostics = Readonly<{
  operation: MediaAssetStorageOperation;
  statusCode: number | null;
  errorClass: string;
  awsRequestId: string | null;
  awsExtendedRequestId: string | null;
}>;

export class MultipartCompletionReconciliationStorageTransientError extends Error {
  readonly code = "MULTIPART_STORAGE_TRANSIENT";
  readonly safeMessage =
    "Multipart completion storage is temporarily unavailable.";

  constructor(
    readonly operation: MediaAssetStorageOperation,
    readonly statusCode: number | null,
    cause: unknown,
  ) {
    super(
      `Multipart completion reconciliation storage operation failed transiently. operation=${operation}; statusCode=${String(statusCode)}`,
      { cause },
    );
    this.name = "MultipartCompletionReconciliationStorageTransientError";
  }
}

export class MultipartCompletionReconciliationStorageTerminalError extends Error {
  readonly safeMessage: string;

  constructor(
    readonly code: MultipartCompletionReconciliationStorageTerminalErrorCode,
    safeMessage: string,
    readonly s3Diagnostics:
      MultipartCompletionReconciliationS3Diagnostics | null,
    cause: unknown | null,
  ) {
    super(safeMessage, { cause });
    this.name = "MultipartCompletionReconciliationStorageTerminalError";
    this.safeMessage = safeMessage;
  }
}

type S3ResponseMetadata = Readonly<{
  httpStatusCode?: unknown;
  requestId?: unknown;
  extendedRequestId?: unknown;
}>;

function getS3ResponseMetadata(error: unknown): S3ResponseMetadata | null {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) {
    return null;
  }

  const metadata = (error as Readonly<{ $metadata?: unknown }>).$metadata;
  return typeof metadata === "object" && metadata !== null
    ? metadata as S3ResponseMetadata
    : null;
}

export function getS3ErrorStatusCode(error: unknown): number | null {
  const metadata = getS3ResponseMetadata(error);
  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : null;
}

function getS3ErrorName(error: unknown): string {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z0-9._-]{1,128}$/u.test(errorName)
    ? errorName
    : "UnknownError";
}

function getSafeAwsRequestId(value: unknown): string | null {
  return typeof value === "string"
    && /^[\x21-\x7e]{1,512}$/u.test(value)
    ? value
    : null;
}

export function createMultipartCompletionReconciliationS3Diagnostics(
  operation: MediaAssetStorageOperation,
  error: unknown,
): MultipartCompletionReconciliationS3Diagnostics {
  const metadata = getS3ResponseMetadata(error);
  return {
    operation,
    statusCode: getS3ErrorStatusCode(error),
    errorClass: getS3ErrorName(error),
    awsRequestId: getSafeAwsRequestId(metadata?.requestId),
    awsExtendedRequestId: getSafeAwsRequestId(metadata?.extendedRequestId),
  };
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

export async function runMediaAssetStorageOperationWithRetries<Result>(
  context: MediaAssetStorageContext,
  operation: MediaAssetStorageOperation,
  run: () => Promise<Result>,
): Promise<Result> {
  return runMediaAssetStorageOperationWithRetriesAndOptionalAbortSignal(
    context,
    operation,
    null,
    run,
  );
}

async function runMediaAssetStorageOperationWithRetriesAndOptionalAbortSignal<Result>(
  context: MediaAssetStorageContext,
  operation: MediaAssetStorageOperation,
  signal: AbortSignal | null,
  run: () => Promise<Result>,
): Promise<Result> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxS3AttemptCount; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await run();
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
      if (attempt === maxS3AttemptCount) {
        break;
      }

      addBackendRuntimeBreadcrumb({
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

export function runMediaAssetStorageOperationWithRetriesAndAbortSignal<Result>(
  context: MediaAssetStorageContext,
  operation: MediaAssetStorageOperation,
  signal: AbortSignal,
  run: () => Promise<Result>,
): Promise<Result> {
  return runMediaAssetStorageOperationWithRetriesAndOptionalAbortSignal(
    context,
    operation,
    signal,
    run,
  );
}

export function rethrowMediaAssetStorageAbortReason(signal: AbortSignal): void {
  if (signal.aborted) signal.throwIfAborted();
}

export function createMediaAssetStorageError(
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

export function isNoSuchMultipartUploadError(error: unknown): boolean {
  return getS3ErrorStatusCode(error) === 404 && getS3ErrorName(error) === "NoSuchUpload";
}

export function isMediaAssetObjectNotFoundError(error: unknown): boolean {
  return error instanceof HttpError && error.code === "MEDIA_ASSET_UPLOAD_NOT_FOUND";
}

export function isCopyObjectIfNoneMatchFailure(error: unknown): boolean {
  const statusCode = getS3ErrorStatusCode(error);
  return statusCode === 409 || statusCode === 412;
}

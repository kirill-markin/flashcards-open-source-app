import {
  addBackendRuntimeBreadcrumb,
} from "../../observability/runtime";
import { HttpError, type MediaAssetStorageErrorDetails } from "../../shared/errors";
import type {
  MediaAssetStorageContext,
  MediaAssetStorageOperation,
} from "./contracts";

const maxS3AttemptCount = 3;

export function getS3ErrorStatusCode(error: unknown): number | null {
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

export async function runMediaAssetStorageOperationWithRetries<Result>(
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

import { setTimeout as wait } from "node:timers/promises";
import { runDatabaseOperationsWithDeadline } from "../../database";
import { DatabaseCommitOutcomeUnknownError } from "../../database/transient";
import {
  createBackendObservationScope,
  type BackendObservationScope,
} from "../../observability/sentry";
import type { RequestContext } from "../../server/requestContext";
import { HttpError } from "../../shared/errors";
import type {
  CompleteMediaAssetUploadPartInput,
  MediaAssetUploadSession,
} from "../types";
import { passthroughMediaBlobNormalizationVersion } from "../types";
import {
  createMediaAssetUploadSessionCompletedPartsFingerprint,
  type MultipartMediaBlobWriterAttemptInput,
} from "../uploadSessions";

export function getRequestContextUserId(requestContext: RequestContext | null): string | null {
  return requestContext === null ? null : requestContext.userId;
}

export function createMediaAssetsScope(
  requestId: string,
  route: string,
  method: string,
  userId: string | null,
  workspaceId: string | null,
  clientAppVersion: string | null,
  clientPlatform: string | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    workspaceId,
    null,
    null,
    null,
    clientAppVersion,
    clientPlatform,
  );
}

export const multipartWriterHeartbeatIntervalMs = 5_000;
export const multipartWriterLeaseStorageAbortHeadroomMs = 250;
export const multipartWriterLeaseExpiryObservationPaddingMs = 100;
const multipartDatabaseCommitReplayDelayMs = 25;
export const multipartResolutionRetryBaseDelayMs = 50;
export const multipartResolutionRetryMaximumDelayMs = 250;

export type MultipartCompletionRequestDeadline = Readonly<{
  deadlineAtMs: number;
  signal: AbortSignal;
  dispose: () => void;
}>;

export type MultipartDatabaseCommitReplay = <Result>(
  operation: () => Promise<Result>,
) => Promise<Result>;

export const runDatabaseOperationOnce: MultipartDatabaseCommitReplay =
  <Result>(operation: () => Promise<Result>): Promise<Result> => operation();

export function createMultipartCompletionRequestDeadline(
  deadlineAtMs: number,
): MultipartCompletionRequestDeadline {
  const controller = new AbortController();
  const deadlineError = createMultipartCompletionDeadlineError();
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    controller.abort(deadlineError);
    return Object.freeze({
      deadlineAtMs,
      signal: controller.signal,
      dispose: () => {},
    });
  }
  const timer = setTimeout(
    () => controller.abort(deadlineError),
    remainingMs,
  );
  timer.unref();
  return Object.freeze({
    deadlineAtMs,
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  });
}

export function assertMultipartCompletionRequestActive(
  deadlineAtMs: number,
  signal: AbortSignal,
): void {
  signal.throwIfAborted();
  if (Date.now() >= deadlineAtMs) {
    throw createMultipartCompletionDeadlineError();
  }
}

export async function replayMultipartDatabaseCommitUnknownUntilDeadline<Result>(
  operation: () => Promise<Result>,
  deadlineAtMs: number,
  signal: AbortSignal,
): Promise<Result> {
  for (;;) {
    assertMultipartCompletionRequestActive(deadlineAtMs, signal);
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DatabaseCommitOutcomeUnknownError)) {
        throw error;
      }
      assertMultipartCompletionRequestActive(deadlineAtMs, signal);
      const waitMs = Math.min(
        multipartDatabaseCommitReplayDelayMs,
        deadlineAtMs - Date.now(),
      );
      if (waitMs <= 0) throw createMultipartCompletionDeadlineError();
      try {
        await wait(waitMs, undefined, { signal });
      } catch (waitError) {
        if (signal.aborted) signal.throwIfAborted();
        throw waitError;
      }
    }
  }
}

export function createMultipartDatabaseCommitReplay(
  requestDeadline: MultipartCompletionRequestDeadline,
): MultipartDatabaseCommitReplay {
  return <Result>(operation: () => Promise<Result>): Promise<Result> =>
    replayMultipartDatabaseCommitUnknownUntilDeadline(
      () => runDatabaseOperationsWithDeadline(
        requestDeadline.deadlineAtMs,
        operation,
      ),
      requestDeadline.deadlineAtMs,
      requestDeadline.signal,
    );
}

export function hasSqlState(error: unknown, sqlState: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === sqlState;
}

export function toMultipartAttemptInput(
  attemptToken: string,
  userId: string,
  session: MediaAssetUploadSession,
  parts: ReadonlyArray<CompleteMediaAssetUploadPartInput>,
): MultipartMediaBlobWriterAttemptInput {
  return {
    attemptToken,
    userId,
    workspaceId: session.workspaceId,
    sessionId: session.sessionId,
    mediaAssetId: session.mediaAssetId,
    lastModifiedByReplicaId: session.lastModifiedByReplicaId,
    lastOperationId: session.lastOperationId,
    sha256: session.mediaBlobSha256,
    stagingStorageKey: session.stagingStorageKey,
    blobStorageKey: session.blobStorageKey,
    s3UploadId: session.s3UploadId,
    mimeType: session.mimeType,
    sizeBytes: session.sizeBytes,
    partSizeBytes: session.partSizeBytes,
    partCount: session.partCount,
    sourceUrl: session.sourceUrl,
    assetCreatedAt: session.assetCreatedAt,
    clientUpdatedAt: session.clientUpdatedAt,
    expiresAt: session.expiresAt,
    normalizationVersion: passthroughMediaBlobNormalizationVersion,
    completedPartsFingerprint:
      createMediaAssetUploadSessionCompletedPartsFingerprint(parts),
  };
}

export function createUploadSessionExpiredError(
  session: MediaAssetUploadSession,
): HttpError {
  return new HttpError(
    409,
    `Media asset upload session is expired. sessionId=${session.sessionId} expiresAt=${session.expiresAt}`,
    "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
  );
}

export function createMultipartCompletionDeadlineError(): HttpError {
  return new HttpError(
    503,
    "Multipart completion could not safely finish within the request deadline. Retry the same completion request without aborting the upload session.",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
}

export function createMultipartCompletionInProgressError(
  statusCode: 409 | 503,
  message: string,
  retryAfterSeconds: number,
): HttpError {
  return new HttpError(
    statusCode,
    message,
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
    { retryAfterSeconds },
  );
}

export function createMultipartCompletionHandedOffError(): HttpError {
  return createMultipartCompletionInProgressError(
    503,
    "Multipart completion was accepted for durable processing. Retry after the Retry-After delay without aborting or replacing the upload session.",
    1,
  );
}

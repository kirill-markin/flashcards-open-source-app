import {
  ApiError,
  apiNetworkRetryMaximumAttemptCount,
  abortMediaAssetUploadSession,
  completeMediaAssetUploadSession,
  createApiNetworkRetryDelayMs,
  isAuthRedirectError,
} from "../../../api";
import type { MediaTransferQueueRecord } from "../../../localDb/mediaTransfers";
import { isIndexedDbOpenRecoveryError } from "../../../localDb/core/indexedDbOpenRecovery";
import type {
  CompleteMediaAssetUploadPartInput,
  MediaAsset,
  MediaAssetUploadSession,
} from "../../../types";
import {
  classifyMediaUploadError,
  describeApiError,
  describeUploadError,
  normalizeMediaUploadError,
  PermanentMediaUploadError,
  readErrorName,
  readUploadLifecycleCancellationError,
  RetryableMediaUploadError,
  throwIfUploadLifecycleCancelled,
  type MediaUploadClaimHeartbeat,
  type MediaUploadFailure,
} from "./mediaUploadClaimLifecycle";
import type { UploadedMediaPart } from "./signedPartUpload";

export type MediaUploadCompletionResult = Readonly<{
  mediaAsset: MediaAsset;
  retryableCompletionCause: ApiError | null;
}>;

type MediaUploadCompletionTerminalReason = "retry_exhausted" | "interrupted";

export class MediaUploadCompletionTerminalError extends PermanentMediaUploadError {
  readonly reason: MediaUploadCompletionTerminalReason;
  readonly completionCause: ApiError;
  readonly interruptionCause: Error | null;

  constructor(
    reason: MediaUploadCompletionTerminalReason,
    completionCause: ApiError,
    interruptionCause: Error | null,
  ) {
    const interruptionDescription = interruptionCause === null
      ? "none"
      : describeUploadError(interruptionCause);
    super(
      `Media upload completion stopped for this local run: reason=${reason}, `
      + `completionError=${describeApiError(completionCause)}, `
      + `interruptionError=${interruptionDescription}`,
    );
    this.name = "MediaUploadCompletionTerminalError";
    this.reason = reason;
    this.completionCause = completionCause;
    this.interruptionCause = interruptionCause;
  }
}

const sameSessionCompletionRetryErrorCodes: ReadonlySet<string> = new Set([
  "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
  "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
]);

function toCompleteParts(uploadedParts: ReadonlyArray<UploadedMediaPart>): ReadonlyArray<CompleteMediaAssetUploadPartInput> {
  return uploadedParts.map((part) => ({
    partNumber: part.partNumber,
    eTag: part.eTag,
    sha256: part.sha256,
  }));
}

export function isSameSessionCompletionRetryError(error: unknown): error is ApiError {
  return error instanceof ApiError
    && error.code !== null
    && sameSessionCompletionRetryErrorCodes.has(error.code);
}

async function waitForCompletionRetry(
  delayMs: number,
  heartbeat: MediaUploadClaimHeartbeat,
  signal: AbortSignal,
): Promise<void> {
  let timerId: number | null = null;
  let abortHandler: (() => void) | null = null;
  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        timerId = window.setTimeout(resolve, delayMs);
      }),
      heartbeat.waitForFailure(),
      new Promise<void>((_resolve, reject) => {
        abortHandler = () => {
          reject(readUploadLifecycleCancellationError(signal));
        };
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener("abort", abortHandler, { once: true });
      }),
    ]);
  } finally {
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }
    if (abortHandler !== null) {
      signal.removeEventListener("abort", abortHandler);
    }
  }

  throwIfUploadLifecycleCancelled(signal);
  await heartbeat.throwIfFailed();
  throwIfUploadLifecycleCancelled(signal);
}

async function validateCompletionOwnership(
  heartbeat: MediaUploadClaimHeartbeat,
  signal: AbortSignal,
  retryableCompletionCause: ApiError | null,
): Promise<void> {
  try {
    throwIfUploadLifecycleCancelled(signal);
    await heartbeat.throwIfFailed();
    throwIfUploadLifecycleCancelled(signal);
  } catch (error) {
    if (isIndexedDbOpenRecoveryError(error)) {
      throw error;
    }

    if (retryableCompletionCause !== null) {
      throw new MediaUploadCompletionTerminalError(
        "interrupted",
        retryableCompletionCause,
        normalizeMediaUploadError(error),
      );
    }
    throw error;
  }
}

export async function completeMultipartUploadSession(
  transfer: MediaTransferQueueRecord,
  uploadSession: MediaAssetUploadSession,
  uploadedParts: ReadonlyArray<UploadedMediaPart>,
  heartbeat: MediaUploadClaimHeartbeat,
  signal: AbortSignal,
): Promise<MediaUploadCompletionResult> {
  const request = {
    parts: toCompleteParts(uploadedParts),
  };
  const completionSignal = AbortSignal.any([signal, heartbeat.failureSignal]);
  let attemptNumber = 1;
  let lastRetryableCompletionError: ApiError | null = null;

  while (true) {
    await validateCompletionOwnership(heartbeat, signal, lastRetryableCompletionError);

    try {
      const result = await completeMediaAssetUploadSession(
        transfer.workspaceId,
        uploadSession.sessionId,
        request,
        completionSignal,
      );
      await validateCompletionOwnership(heartbeat, signal, lastRetryableCompletionError);
      return {
        mediaAsset: result.mediaAsset,
        retryableCompletionCause: lastRetryableCompletionError,
      };
    } catch (error) {
      if (isIndexedDbOpenRecoveryError(error)) {
        throw error;
      }

      if (error instanceof MediaUploadCompletionTerminalError) {
        throw error;
      }
      if (isSameSessionCompletionRetryError(error) === false) {
        await validateCompletionOwnership(heartbeat, signal, lastRetryableCompletionError);
        if (lastRetryableCompletionError !== null) {
          throw new MediaUploadCompletionTerminalError(
            "interrupted",
            lastRetryableCompletionError,
            normalizeMediaUploadError(error),
          );
        }
        throw error;
      }
      lastRetryableCompletionError = error;
      await validateCompletionOwnership(heartbeat, signal, lastRetryableCompletionError);
      if (attemptNumber >= apiNetworkRetryMaximumAttemptCount) {
        throw new MediaUploadCompletionTerminalError("retry_exhausted", error, null);
      }

      const delayMs = error.retryAfterMs ?? createApiNetworkRetryDelayMs(attemptNumber);
      console.warn("Media upload completion retry", {
        transferId: transfer.transferId,
        workspaceId: transfer.workspaceId,
        mediaAssetId: transfer.mediaAssetId,
        sessionId: uploadSession.sessionId,
        code: error.code,
        attemptNumber,
        maximumAttemptCount: apiNetworkRetryMaximumAttemptCount,
        nextAttemptNumber: attemptNumber + 1,
        delayMs,
      });
      try {
        await waitForCompletionRetry(delayMs, heartbeat, signal);
      } catch (interruptionError) {
        if (isIndexedDbOpenRecoveryError(interruptionError)) {
          throw interruptionError;
        }

        throw new MediaUploadCompletionTerminalError(
          "interrupted",
          error,
          normalizeMediaUploadError(interruptionError),
        );
      }
      attemptNumber += 1;
    }
  }
}

function warnUploadSessionAbortFailure(
  transfer: MediaTransferQueueRecord,
  sessionId: string,
  error: unknown,
): void {
  console.warn("Media upload session abort failed", {
    transferId: transfer.transferId,
    workspaceId: transfer.workspaceId,
    mediaAssetId: transfer.mediaAssetId,
    sessionId,
    errorName: readErrorName(error),
    errorMessage: describeUploadError(error),
  });
}

export async function abortUploadSessionAfterFailure(
  transfer: MediaTransferQueueRecord,
  sessionId: string,
): Promise<unknown | null> {
  try {
    await abortMediaAssetUploadSession(transfer.workspaceId, sessionId);
    return null;
  } catch (error) {
    warnUploadSessionAbortFailure(transfer, sessionId, error);
    return error;
  }
}

function describeUploadSessionCleanupFailure(primaryFailure: MediaUploadFailure, abortFailure: MediaUploadFailure): string {
  return `Media upload session cleanup failed after upload error: primaryError=${primaryFailure.message}, abortError=${abortFailure.message}`;
}

export function combineUploadFailureWithAbortFailure(primaryError: unknown, abortError: unknown | null): unknown {
  if (abortError === null || isIndexedDbOpenRecoveryError(primaryError)) {
    return primaryError;
  }

  if (isIndexedDbOpenRecoveryError(abortError)) {
    return abortError;
  }

  if (isAuthRedirectError(primaryError)) {
    return primaryError;
  }

  if (isAuthRedirectError(abortError)) {
    return abortError;
  }

  const primaryFailure = classifyMediaUploadError(primaryError);
  const abortFailure = classifyMediaUploadError(abortError);
  if (primaryFailure.kind === "retryable" || abortFailure.kind === "retryable") {
    return new RetryableMediaUploadError(describeUploadSessionCleanupFailure(primaryFailure, abortFailure));
  }

  return new PermanentMediaUploadError(describeUploadSessionCleanupFailure(primaryFailure, abortFailure));
}

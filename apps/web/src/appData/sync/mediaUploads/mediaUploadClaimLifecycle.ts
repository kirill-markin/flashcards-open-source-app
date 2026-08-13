import {
  ApiContractError,
  ApiError,
} from "../../../api";
import { isIndexedDbOpenRecoveryError } from "../../../localDb/core/indexedDbOpenRecovery";
import {
  claimNextDueMediaTransferByKind,
  markClaimedMediaTransferFailed,
  markMediaUploadTransferCompletionTerminal,
  recoverStaleInProgressMediaTransfersByKind,
  renewInProgressMediaTransferClaim,
  type MediaTransferQueueRecord,
} from "../../../localDb/mediaTransfers";

export type MediaUploadFailureKind = "retryable" | "permanent";

export type MediaUploadFailure = Readonly<{
  kind: MediaUploadFailureKind;
  message: string;
}>;

export type MediaUploadClaimHeartbeat = Readonly<{
  failureSignal: AbortSignal;
  getClaimedAt: () => string;
  throwIfFailed: () => Promise<void>;
  waitForFailure: () => Promise<void>;
  stop: () => Promise<unknown | null>;
}>;

export class RetryableMediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableMediaUploadError";
  }
}

export class PermanentMediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentMediaUploadError";
  }
}

const retryBaseDelayMs = 30_000;
const retryMaximumDelayMs = 30 * 60_000;
const staleMediaUploadClaimLeaseMs = 30 * 60_000;
const mediaUploadClaimHeartbeatMs = 5 * 60_000;
const permanentlyFailedNextAttemptAt = "9999-12-31T23:59:59.999Z";
const retryableUploadSessionErrorCodes: ReadonlySet<string> = new Set([
  "MEDIA_ASSET_STORAGE_UNAVAILABLE",
  "MEDIA_ASSET_UPLOAD_NOT_FOUND",
  "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
  "MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND",
  "MEDIA_ASSET_UPLOAD_SESSION_RECOVERY_FAILED",
]);

export function claimNextDueUploadTransfer(
  workspaceId: string,
  claimedAt: string,
): Promise<MediaTransferQueueRecord | null> {
  return claimNextDueMediaTransferByKind(workspaceId, "upload", claimedAt);
}

export function readErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== "") {
    return error.name;
  }

  return typeof error;
}

export function readUploadLifecycleCancellationError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === "string" && reason.trim() !== "") {
    return new Error(reason);
  }
  return new Error("Media upload lifecycle was cancelled");
}

export function throwIfUploadLifecycleCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw readUploadLifecycleCancellationError(signal);
  }
}

export function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return String(error);
}

export function normalizeMediaUploadError(error: unknown): Error {
  return error instanceof Error ? error : new Error(readErrorMessage(error));
}

function isTransientStatusCode(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function isRetryableApiError(error: ApiError): boolean {
  if (error.statusCode === 0 || isTransientStatusCode(error.statusCode)) {
    return true;
  }

  return error.code !== null && retryableUploadSessionErrorCodes.has(error.code);
}

export function describeApiError(error: ApiError): string {
  return [
    error.message,
    `endpoint=${error.endpoint}`,
    `status=${error.statusCode}`,
    `code=${error.code ?? "none"}`,
    `requestId=${error.requestId ?? "none"}`,
    `responseBodyKind=${error.responseBodyKind}`,
  ].join(" ");
}

export function describeUploadError(error: unknown): string {
  if (error instanceof ApiError) {
    return describeApiError(error);
  }

  return readErrorMessage(error);
}

export function classifyMediaUploadError(error: unknown): MediaUploadFailure {
  if (error instanceof RetryableMediaUploadError) {
    return {
      kind: "retryable",
      message: error.message,
    };
  }

  if (error instanceof PermanentMediaUploadError || error instanceof ApiContractError) {
    return {
      kind: "permanent",
      message: describeUploadError(error),
    };
  }

  if (error instanceof ApiError) {
    return {
      kind: isRetryableApiError(error) ? "retryable" : "permanent",
      message: describeApiError(error),
    };
  }

  return {
    kind: "retryable",
    message: readErrorMessage(error),
  };
}

function createRetryNextAttemptAt(transfer: MediaTransferQueueRecord, failedAt: string): string {
  const nextAttemptCount = transfer.attemptCount + 1;
  const uncappedDelayMs = retryBaseDelayMs * (2 ** Math.max(0, nextAttemptCount - 1));
  const delayMs = Math.min(uncappedDelayMs, retryMaximumDelayMs);
  return new Date(new Date(failedAt).getTime() + delayMs).toISOString();
}

function createStaleUploadClaimCutoff(recoveredAt: string): string {
  return new Date(new Date(recoveredAt).getTime() - staleMediaUploadClaimLeaseMs).toISOString();
}

function requireInProgressUploadClaimedAt(transfer: MediaTransferQueueRecord): string {
  if (transfer.claimedAt === null) {
    throw new PermanentMediaUploadError(`Media upload transfer claim is missing: transferId=${transfer.transferId}`);
  }

  return transfer.claimedAt;
}

async function renewUploadTransferClaim(
  transfer: MediaTransferQueueRecord,
  expectedClaimedAt: string,
): Promise<string> {
  const renewedAt = new Date().toISOString();
  const renewedTransfer = await renewInProgressMediaTransferClaim({
    transferId: transfer.transferId,
    kind: "upload",
    expectedClaimedAt,
    renewedAt,
  });
  return requireInProgressUploadClaimedAt(renewedTransfer);
}

export function startUploadClaimHeartbeat(
  transfer: MediaTransferQueueRecord,
  hasFailed: () => boolean,
): MediaUploadClaimHeartbeat {
  let claimedAt = requireInProgressUploadClaimedAt(transfer);
  let heartbeatError: unknown = null;
  let renewalTask: Promise<void> = Promise.resolve();
  let didStop = false;
  let resolveHeartbeatFailure: (() => void) | null = null;
  const heartbeatFailureController = new AbortController();
  const heartbeatFailurePromise = new Promise<void>((resolve) => {
    resolveHeartbeatFailure = resolve;
  });

  const queueRenewal = (): void => {
    if (heartbeatError !== null || didStop || hasFailed()) {
      return;
    }

    renewalTask = renewalTask
      .then(async (): Promise<void> => {
        if (hasFailed()) {
          return;
        }
        claimedAt = await renewUploadTransferClaim(transfer, claimedAt);
      })
      .catch((error: unknown): void => {
        heartbeatError = error;
        if (hasFailed() === false && isIndexedDbOpenRecoveryError(error) === false) {
          heartbeatFailureController.abort(error);
        }
        resolveHeartbeatFailure?.();
      });
  };

  const timerId = window.setInterval(queueRenewal, mediaUploadClaimHeartbeatMs);
  queueRenewal();

  return {
    failureSignal: heartbeatFailureController.signal,
    getClaimedAt: () => claimedAt,
    throwIfFailed: async (): Promise<void> => {
      await renewalTask;
      if (heartbeatError !== null) {
        throw heartbeatError;
      }
      if (hasFailed()) {
        return;
      }
    },
    waitForFailure: () => heartbeatFailurePromise,
    stop: async (): Promise<unknown | null> => {
      if (didStop === false) {
        didStop = true;
        window.clearInterval(timerId);
      }

      await renewalTask;
      return heartbeatError;
    },
  };
}

export async function recoverStaleUploadTransferClaims(workspaceId: string, recoveredAt: string): Promise<void> {
  const staleClaimedBefore = createStaleUploadClaimCutoff(recoveredAt);
  await recoverStaleInProgressMediaTransfersByKind({
    workspaceId,
    kind: "upload",
    staleClaimedBefore,
    recoveredAt,
    nextAttemptAt: recoveredAt,
    lastError: `Media upload transfer reclaimed after stale in-progress claim: staleClaimedBefore=${staleClaimedBefore}, recoveredAt=${recoveredAt}`,
  });
}

function createUploadTransferFailure(
  transfer: MediaTransferQueueRecord,
  error: unknown,
): Readonly<{
  failedAt: string;
  lastError: string;
  nextAttemptAt: string;
}> {
  const failedAt = new Date().toISOString();
  const failure = classifyMediaUploadError(error);
  const nextAttemptAt = failure.kind === "retryable"
    ? createRetryNextAttemptAt(transfer, failedAt)
    : permanentlyFailedNextAttemptAt;
  return {
    failedAt,
    lastError: `Media upload transfer failed (${failure.kind}): transferId=${transfer.transferId}, workspaceId=${transfer.workspaceId}, mediaAssetId=${transfer.mediaAssetId}, error=${failure.message}`,
    nextAttemptAt,
  };
}

export async function markUploadTransferFailed(
  transfer: MediaTransferQueueRecord,
  claimedAt: string,
  error: unknown,
): Promise<void> {
  const failure = createUploadTransferFailure(transfer, error);
  await markClaimedMediaTransferFailed({
    transferId: transfer.transferId,
    kind: "upload",
    expectedClaimedAt: claimedAt,
    failedAt: failure.failedAt,
    lastError: failure.lastError,
    nextAttemptAt: failure.nextAttemptAt,
  });
}

export async function markUploadTransferCompletionTerminal(
  transfer: MediaTransferQueueRecord,
  error: unknown,
): Promise<void> {
  const failure = createUploadTransferFailure(transfer, error);
  await markMediaUploadTransferCompletionTerminal({
    transferId: transfer.transferId,
    workspaceId: transfer.workspaceId,
    mediaAssetId: transfer.mediaAssetId,
    failedAt: failure.failedAt,
    lastError: failure.lastError,
    nextAttemptAt: permanentlyFailedNextAttemptAt,
  });
}

export async function markAuthRedirectUploadTransferRetryable(
  transfer: MediaTransferQueueRecord,
  claimedAt: string,
): Promise<void> {
  const failedAt = new Date().toISOString();
  await markClaimedMediaTransferFailed({
    transferId: transfer.transferId,
    kind: "upload",
    expectedClaimedAt: claimedAt,
    failedAt,
    lastError: `Media upload transfer paused for browser authentication: transferId=${transfer.transferId}, workspaceId=${transfer.workspaceId}, mediaAssetId=${transfer.mediaAssetId}`,
    nextAttemptAt: failedAt,
  });
}

import { setTimeout as wait } from "node:timers/promises";
import {
  DatabaseDeadlineExceededError,
  runDatabaseOperationsWithDeadline,
} from "../../../database";
import {
  DatabaseCommitOutcomeUnknownError,
  getDatabaseErrorFields,
  isTransientDatabaseError,
  TransientDatabaseHttpError,
} from "../../../database/transient";
import {
  captureBackendWarning,
  type BackendObservationScope,
} from "../../../observability/sentry";
import { HttpError } from "../../../shared/errors";
import {
  MediaBlobLifecycleBusyError,
  MediaBlobWriterFenceError,
} from "../../blobLifecycle";
import type {
  MediaAsset,
  MediaAssetUploadSession,
} from "../../types";
import {
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  isMediaAssetUploadSessionExpired,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
  type MultipartMediaBlobStorageCapability,
  type MultipartMediaBlobWriterAttemptBeginStatus,
  type MultipartMediaBlobWriterAttemptExactInput,
  type MultipartMediaBlobWriterAttemptFailureStatus,
  type MultipartMediaBlobWriterAttemptHandoffStatus,
  type MultipartMediaBlobWriterAttemptInput,
  type MultipartMediaBlobWriterAttemptResult,
} from "../../uploadSessions";
import {
  assertMultipartCompletionRequestActive,
  createMultipartCompletionDeadlineError,
  createMultipartCompletionHandedOffError,
  createMultipartCompletionRequestDeadline,
  hasSqlState,
  multipartResolutionRetryBaseDelayMs,
  multipartResolutionRetryMaximumDelayMs,
  multipartWriterLeaseExpiryObservationPaddingMs,
  type MultipartCompletionRequestDeadline,
  type MultipartDatabaseCommitReplay,
} from "../requestBoundary";

export function isMultipartCompletionDeadlineFailure(
  error: unknown,
  operationDeadline: MultipartCompletionRequestDeadline,
  requestDeadline: MultipartCompletionRequestDeadline,
): boolean {
  return operationDeadline.signal.aborted
    || requestDeadline.signal.aborted
    || error instanceof DatabaseDeadlineExceededError
    || hasSqlState(error, "57014")
    || hasSqlState(error, "55P03")
    || (
      error instanceof HttpError
      && error.code
        === "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED"
    );
}

export function mapMultipartCompletionDeadlineError(
  error: unknown,
  operationDeadline: MultipartCompletionRequestDeadline,
  requestDeadline: MultipartCompletionRequestDeadline,
): unknown {
  if (error instanceof HttpError) return error;
  if (
    requestDeadline.signal.aborted
    || operationDeadline.signal.aborted
  ) {
    if (requestDeadline.signal.aborted) {
      return requestDeadline.signal.reason instanceof HttpError
        ? requestDeadline.signal.reason
        : createMultipartCompletionDeadlineError();
    }
    return operationDeadline.signal.reason instanceof HttpError
      ? operationDeadline.signal.reason
      : createMultipartCompletionDeadlineError();
  }
  if (
    error instanceof DatabaseDeadlineExceededError
    || hasSqlState(error, "57014")
    || hasSqlState(error, "55P03")
  ) {
    return createMultipartCompletionDeadlineError();
  }
  return error;
}

export function createMultipartCompletionResolutionError(
  completionError: unknown,
  resolutionError: unknown,
): Error {
  const diagnosticCause = new AggregateError(
    [completionError, resolutionError],
    "Multipart completion and exact attempt resolution both failed.",
  );
  if (resolutionError instanceof HttpError) {
    const preservedError = new HttpError(
      resolutionError.statusCode,
      resolutionError.message,
      resolutionError.code ?? undefined,
      resolutionError.details ?? undefined,
    );
    Object.defineProperty(preservedError, "cause", {
      value: diagnosticCause,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return preservedError;
  }
  return diagnosticCause;
}

export function createMultipartAttemptError(
  status:
    | MultipartMediaBlobWriterAttemptBeginStatus
    | MultipartMediaBlobWriterAttemptFailureStatus
    | MultipartMediaBlobWriterAttemptHandoffStatus,
  leaseExpiresAt: string | null,
): Error {
  if (status === "cleanup_claimed") {
    return new MediaBlobLifecycleBusyError();
  }
  if (status === "access_denied") {
    return new HttpError(
      403,
      "Workspace access changed during multipart completion.",
      "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED",
    );
  }
  if (status === "replica_mismatch") {
    return new HttpError(
      400,
      "lastModifiedByReplicaId must reference a workspace replica accessible to the authenticated user.",
      "MEDIA_ASSET_REPLICA_INVALID",
    );
  }
  if (status === "busy") {
    const leaseExpiresAtMs = leaseExpiresAt === null
      ? Number.NaN
      : Date.parse(leaseExpiresAt);
    if (!Number.isFinite(leaseExpiresAtMs)) {
      return new TypeError(
        "Multipart writer busy status did not include a valid lease expiry.",
      );
    }
    return new HttpError(
      409,
      "Multipart completion is already in progress. Retry after the active writer lease expires.",
      "MEDIA_ASSET_WRITER_BUSY",
      {
        retryAfterSeconds: Math.max(
          1,
          Math.min(60, Math.ceil((leaseExpiresAtMs - Date.now()) / 1_000)),
        ),
      },
    );
  }
  return new HttpError(
    409,
    `Multipart completion conflicts with its current writer state. status=${status}`,
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
  );
}

export function isMultipartAppliedStatus(
  status:
    | MultipartMediaBlobWriterAttemptBeginStatus
    | MultipartMediaBlobWriterAttemptFailureStatus
    | MultipartMediaBlobWriterAttemptHandoffStatus,
): status is "already_applied" | "live_applied" | "referenced" {
  return status === "already_applied"
    || status === "live_applied"
    || status === "referenced";
}

export async function replayCompletedMultipartResultWithDependencies(
  userId: string,
  session: MediaAssetUploadSession,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  loadMediaAssetForReplay: (
    userId: string,
    session: MediaAssetUploadSession,
  ) => Promise<MediaAsset>,
): Promise<Readonly<{ mediaAsset: MediaAsset; applied: false }>> {
  const mediaAsset = await replayDatabaseCommit(
    () => loadMediaAssetForReplay(
      userId,
      session,
    ),
  );
  return { mediaAsset, applied: false };
}

export async function replayCompletedMultipartResult(
  userId: string,
  session: MediaAssetUploadSession,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  loadMediaAssetForReplay:
    typeof loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
): Promise<Readonly<{ mediaAsset: MediaAsset; applied: false }>> {
  return replayCompletedMultipartResultWithDependencies(
    userId,
    session,
    replayDatabaseCommit,
    loadMediaAssetForReplay,
  );
}

export function isExpiredMultipartCompletionCleanupRequired(
  session: MediaAssetUploadSession,
): boolean {
  return (
    session.state === "active"
    || session.state === "aborting"
  ) && isMediaAssetUploadSessionExpired(session);
}

type MultipartAttemptResolutionDependencies = Readonly<{
  handoffCompletionAttemptAfterAccessRevocationFn:
    typeof handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation;
  resolveCompletionAttemptFailureWithOwnerFn:
    typeof resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner;
}>;

export async function resolveMultipartAttemptFailure(
  writer: MultipartMediaBlobWriterAttemptExactInput,
  dependencies: MultipartAttemptResolutionDependencies,
): Promise<MultipartMediaBlobWriterAttemptHandoffStatus> {
  const resolveWithCurrentAccess =
    async (): Promise<MultipartMediaBlobWriterAttemptFailureStatus> => {
      try {
        return await dependencies.resolveCompletionAttemptFailureWithOwnerFn(
          writer,
        );
      } catch (error) {
        if (hasSqlState(error, "42501")) return "access_denied";
        throw error;
      }
    };
  const status = await resolveWithCurrentAccess();
  if (status !== "access_denied" && status !== "replica_mismatch") {
    return status;
  }
  return dependencies.handoffCompletionAttemptAfterAccessRevocationFn(
    writer,
  );
}

export type MultipartExactResolutionResult<Result> =
  | Readonly<{
    kind: "resolved";
    value: Result;
  }>
  | Readonly<{
    kind: "safe_lease_expired";
    resolutionError: unknown;
  }>;

function isRetryableMultipartResolutionError(error: unknown): boolean {
  return error instanceof DatabaseCommitOutcomeUnknownError
    || error instanceof TransientDatabaseHttpError
    || isTransientDatabaseError(error);
}

function calculateMultipartResolutionRetryDelayMs(attempt: number): number {
  return Math.min(
    multipartResolutionRetryMaximumDelayMs,
    multipartResolutionRetryBaseDelayMs * (2 ** Math.min(attempt - 1, 8)),
  );
}

function captureMultipartResolutionRetryWarning(
  observationScope: BackendObservationScope,
  attempt: number,
  delayMs: number,
  leaseExpiresAtMs: number,
  error: unknown,
): void {
  const fields = getDatabaseErrorFields(error);
  try {
    captureBackendWarning({
      action: "media_asset_upload_session_completion_resolution_retry",
      scope: observationScope,
      details: {
        attempt,
        delayMs,
        leaseExpiresAtMs,
        sqlState: fields.sqlState,
        errorCode: fields.errorCode,
        errorClass: fields.errorClass,
        errorMessage: fields.errorMessage,
      },
    });
  } catch {
    // Observability must not interrupt exact multipart attempt resolution.
  }
}

async function waitForMultipartWriterLeaseExpiry(
  deadline: MultipartCompletionRequestDeadline,
): Promise<void> {
  const remainingMs = deadline.deadlineAtMs - Date.now();
  if (remainingMs <= 0) return;
  try {
    await wait(remainingMs, undefined, { signal: deadline.signal });
  } catch (error) {
    if (deadline.signal.aborted) return;
    throw error;
  }
}

export async function resolveMultipartOperationExactlyUntilSafe<Result>(
  operation: () => Promise<Result>,
  lastConfirmedLeaseExpiresAtMs: number,
  requestDeadline: MultipartCompletionRequestDeadline,
  observationScope: BackendObservationScope,
): Promise<MultipartExactResolutionResult<Result>> {
  if (
    !Number.isSafeInteger(lastConfirmedLeaseExpiresAtMs)
    || lastConfirmedLeaseExpiresAtMs < 1
  ) {
    throw new RangeError(
      "Exact multipart resolution requires a valid confirmed lease expiry.",
    );
  }
  const safeLeaseExpiryAtMs =
    lastConfirmedLeaseExpiresAtMs
      + multipartWriterLeaseExpiryObservationPaddingMs;
  if (safeLeaseExpiryAtMs >= requestDeadline.deadlineAtMs) {
    throw new RangeError(
      "Confirmed multipart writer lease does not expire safely before the request resolution deadline.",
    );
  }
  const cleanupDeadline =
    createMultipartCompletionRequestDeadline(safeLeaseExpiryAtMs);
  let attempt = 1;
  let lastResolutionError: unknown = null;
  try {
    for (;;) {
      if (Date.now() >= safeLeaseExpiryAtMs) {
        return {
          kind: "safe_lease_expired",
          resolutionError: lastResolutionError,
        };
      }
      try {
        const value = await runDatabaseOperationsWithDeadline(
          safeLeaseExpiryAtMs,
          operation,
        );
        return { kind: "resolved", value };
      } catch (error) {
        lastResolutionError = error;
        if (!isRetryableMultipartResolutionError(error)) {
          await waitForMultipartWriterLeaseExpiry(cleanupDeadline);
          return {
            kind: "safe_lease_expired",
            resolutionError: error,
          };
        }
        const remainingMs = safeLeaseExpiryAtMs - Date.now();
        if (remainingMs <= 0) {
          return {
            kind: "safe_lease_expired",
            resolutionError: error,
          };
        }
        const delayMs = Math.min(
          calculateMultipartResolutionRetryDelayMs(attempt),
          remainingMs,
        );
        captureMultipartResolutionRetryWarning(
          observationScope,
          attempt,
          delayMs,
          lastConfirmedLeaseExpiresAtMs,
          error,
        );
        try {
          await wait(delayMs, undefined, {
            signal: cleanupDeadline.signal,
          });
        } catch (waitError) {
          if (!cleanupDeadline.signal.aborted) throw waitError;
        }
        attempt += 1;
      }
    }
  } finally {
    cleanupDeadline.dispose();
  }
}

export type MultipartWriterLease = Readonly<{
  storageCapability: MultipartMediaBlobStorageCapability;
  leaseExpiresAt: string;
}>;

type MultipartWriterLeaseRenewalOutcome =
  | MultipartMediaBlobWriterAttemptBeginStatus
  | "completion_pending"
  | "acquired"
  | "expired_takeover"
  | "replayed_reservation_mismatch"
  | "replayed_normalization_mismatch"
  | "replayed_writer_mismatch";

export class MultipartWriterLeaseRenewalRejectedError extends Error {
  readonly durableOutcome: MultipartWriterLeaseRenewalOutcome;
  readonly fallbackError: Error;

  constructor(
    durableOutcome: MultipartWriterLeaseRenewalOutcome,
    fallbackError: Error,
  ) {
    super(
      `Multipart writer lease renewal no longer matched the exact foreground writer. durableOutcome=${durableOutcome}`,
    );
    this.name = "MultipartWriterLeaseRenewalRejectedError";
    this.durableOutcome = durableOutcome;
    this.fallbackError = fallbackError;
  }
}

function createMultipartWriterLeaseRenewalFenceFallback(): Error {
  const fenceError =
    new MediaBlobWriterFenceError("multipart_attempt_renewal");
  const fallbackError = createMultipartAttemptError("stale_attempt", null);
  Object.defineProperty(fallbackError, "cause", {
    value: fenceError,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return fallbackError;
}

function classifyMultipartWriterLeaseRenewalMismatch(
  renewal: Extract<
    MultipartMediaBlobWriterAttemptResult,
    Readonly<{ reservationToken: string }>
  >,
  writer: MultipartMediaBlobWriterAttemptExactInput,
): MultipartWriterLeaseRenewalOutcome {
  if (renewal.status !== "replayed") return renewal.status;
  const reservationMatches =
    renewal.reservationToken === writer.reservationToken;
  const normalizationMatches =
    renewal.normalizationVersion === writer.normalizationVersion;
  if (!reservationMatches && !normalizationMatches) {
    return "replayed_writer_mismatch";
  }
  if (!reservationMatches) return "replayed_reservation_mismatch";
  return "replayed_normalization_mismatch";
}

export async function renewMultipartWriterLease(
  input: MultipartMediaBlobWriterAttemptInput,
  writer: MultipartMediaBlobWriterAttemptExactInput,
  writerLeaseTargetAtMs: number,
  operationDeadline: MultipartCompletionRequestDeadline,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettled:
    typeof beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
): Promise<MultipartWriterLease> {
  const renewal = await replayDatabaseCommit(
    () =>
      beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettled(
        input,
        writerLeaseTargetAtMs,
        operationDeadline.deadlineAtMs,
        operationDeadline.signal,
      ),
  );
  if (!("reservationToken" in renewal)) {
    const fallbackError = renewal.status === "completion_pending"
      ? createMultipartCompletionHandedOffError()
      : createMultipartAttemptError(
        renewal.status,
        "leaseExpiresAt" in renewal ? renewal.leaseExpiresAt : null,
      );
    throw new MultipartWriterLeaseRenewalRejectedError(
      renewal.status,
      fallbackError,
    );
  }
  if (
    renewal.status !== "replayed"
    || renewal.reservationToken !== writer.reservationToken
    || renewal.normalizationVersion !== writer.normalizationVersion
  ) {
    const durableOutcome = classifyMultipartWriterLeaseRenewalMismatch(
      renewal,
      writer,
    );
    throw new MultipartWriterLeaseRenewalRejectedError(
      durableOutcome,
      createMultipartWriterLeaseRenewalFenceFallback(),
    );
  }
  return {
    storageCapability: renewal.storageCapability,
    leaseExpiresAt: renewal.leaseExpiresAt,
  };
}

export type MultipartWriterHeartbeat = Readonly<{
  signal: AbortSignal;
  getStorageCapability: () => Promise<MultipartMediaBlobStorageCapability>;
  assertStorageMutationAuthorized: () => void;
  renewNow: () => Promise<void>;
  stop: () => Promise<void>;
  stopAndRenewForFinalization: () => Promise<void>;
  getLastConfirmedLeaseExpiresAtMs: () => number;
  throwIfFailed: () => void;
}>;

export function parseMultipartWriterLeaseExpiresAtMs(leaseExpiresAt: string): number {
  const leaseExpiresAtMs = Date.parse(leaseExpiresAt);
  if (!Number.isFinite(leaseExpiresAtMs)) {
    throw new TypeError(
      "Multipart writer lease did not include a valid expiry.",
    );
  }
  return leaseExpiresAtMs;
}

export function createMultipartWriterHeartbeat(
  initialLease: MultipartWriterLease,
  requestSignal: AbortSignal,
  operationDeadlineAtMs: number,
  writerLeaseTargetAtMs: number,
  leaseStorageAbortHeadroomMs: number,
  heartbeatIntervalMs: number,
  renewLease: () => Promise<MultipartWriterLease>,
): MultipartWriterHeartbeat {
  if (
    !Number.isSafeInteger(heartbeatIntervalMs)
    || heartbeatIntervalMs < 1
  ) {
    throw new RangeError(
      "Multipart writer heartbeat interval must be a positive integer.",
    );
  }
  if (
    !Number.isSafeInteger(operationDeadlineAtMs)
    || operationDeadlineAtMs < 1
    || !Number.isSafeInteger(writerLeaseTargetAtMs)
    || !Number.isSafeInteger(leaseStorageAbortHeadroomMs)
    || leaseStorageAbortHeadroomMs < 1
    || operationDeadlineAtMs >= writerLeaseTargetAtMs
    || writerLeaseTargetAtMs - operationDeadlineAtMs
      <= leaseStorageAbortHeadroomMs
  ) {
    throw new RangeError(
      "Multipart writer heartbeat requires a valid operation cutoff, absolute lease target, and storage-abort safety margin.",
    );
  }
  assertMultipartCompletionRequestActive(
    operationDeadlineAtMs,
    requestSignal,
  );
  const stopController = new AbortController();
  const failureController = new AbortController();
  const storageSignal = AbortSignal.any([
    requestSignal,
    failureController.signal,
  ]);
  const heartbeatWaitSignal = AbortSignal.any([
    requestSignal,
    stopController.signal,
    failureController.signal,
  ]);
  let latestLease = initialLease;
  let lastConfirmedLeaseExpiresAtMs =
    parseMultipartWriterLeaseExpiresAtMs(initialLease.leaseExpiresAt);
  let latestLeaseStorageAbortAtMs = 0;
  let leaseAbortTimer: NodeJS.Timeout | null = null;
  let renewalPromise: Promise<void> | null = null;
  let stopped = false;

  const fail = (error: unknown): void => {
    if (!failureController.signal.aborted) {
      failureController.abort(error);
    }
  };
  const failAndThrow = (error: unknown): never => {
    fail(error);
    storageSignal.throwIfAborted();
    throw new Error("Multipart writer heartbeat failure did not abort storage.");
  };
  const assertOperationActive = (): void => {
    storageSignal.throwIfAborted();
    if (Date.now() >= operationDeadlineAtMs) {
      failAndThrow(createMultipartCompletionDeadlineError());
    }
  };
  const assertStorageAuthorizationActive = (): void => {
    assertOperationActive();
    if (Date.now() >= latestLeaseStorageAbortAtMs) {
      failAndThrow(new MediaBlobWriterFenceError(
        "multipart_attempt_lease_storage_abort_deadline",
      ));
    }
  };
  const confirmLease = (lease: MultipartWriterLease): void => {
    assertOperationActive();
    const leaseExpiresAtMs = parseMultipartWriterLeaseExpiresAtMs(
      lease.leaseExpiresAt,
    );
    if (leaseExpiresAtMs >= writerLeaseTargetAtMs) {
      throw new MediaBlobWriterFenceError(
        "multipart_attempt_absolute_lease_target",
      );
    }
    const abortAtMs =
      leaseExpiresAtMs - leaseStorageAbortHeadroomMs;
    if (abortAtMs <= Date.now()) {
      throw new MediaBlobWriterFenceError(
        "multipart_attempt_lease_storage_abort_headroom",
      );
    }
    lastConfirmedLeaseExpiresAtMs = leaseExpiresAtMs;
    latestLeaseStorageAbortAtMs = abortAtMs;
    if (leaseAbortTimer !== null) clearTimeout(leaseAbortTimer);
    leaseAbortTimer = setTimeout(() => {
      fail(new MediaBlobWriterFenceError(
        "multipart_attempt_lease_storage_abort_deadline",
      ));
    }, abortAtMs - Date.now());
    leaseAbortTimer.unref();
    latestLease = lease;
  };
  confirmLease(initialLease);
  const renewNow = (): Promise<void> => {
    if (renewalPromise !== null) return renewalPromise;
    assertStorageAuthorizationActive();
    if (stopped) {
      throw new Error("Multipart writer heartbeat is already stopped.");
    }
    const operation = renewLease()
      .then((renewedLease) => {
        confirmLease(renewedLease);
        assertStorageAuthorizationActive();
      })
      .catch((error: unknown) => {
        fail(error);
        throw error;
      });
    renewalPromise = operation.finally(() => {
      renewalPromise = null;
    });
    return renewalPromise;
  };
  const loop = async (): Promise<void> => {
    try {
      while (!stopped) {
        try {
          await wait(
            heartbeatIntervalMs,
            undefined,
            { signal: heartbeatWaitSignal },
          );
        } catch (error) {
          if (stopped) return;
          if (requestSignal.aborted) requestSignal.throwIfAborted();
          throw error;
        }
        if (stopped) return;
        await renewNow();
      }
    } catch (error) {
      fail(error);
    }
  };
  const loopPromise = loop();
  const stop = async (): Promise<void> => {
    if (!stopped) {
      stopped = true;
      stopController.abort();
    }
    await loopPromise;
    if (renewalPromise !== null) {
      await renewalPromise.catch(() => {});
    }
    if (leaseAbortTimer !== null) {
      clearTimeout(leaseAbortTimer);
      leaseAbortTimer = null;
    }
  };
  const stopAndRenewForFinalization = async (): Promise<void> => {
    await stop();
    assertOperationActive();
    try {
      confirmLease(await renewLease());
    } catch (error) {
      fail(error);
      throw error;
    }
    assertOperationActive();
  };

  return Object.freeze({
    signal: storageSignal,
    getStorageCapability: async () => {
      assertStorageAuthorizationActive();
      if (renewalPromise !== null) await renewalPromise;
      assertStorageAuthorizationActive();
      return latestLease.storageCapability;
    },
    assertStorageMutationAuthorized: assertStorageAuthorizationActive,
    renewNow,
    stop,
    stopAndRenewForFinalization,
    getLastConfirmedLeaseExpiresAtMs: () =>
      lastConfirmedLeaseExpiresAtMs,
    throwIfFailed: () => storageSignal.throwIfAborted(),
  });
}

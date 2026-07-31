import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { Hono } from "hono";
import {
  loadMediaAssetForWorkspace,
  loadMediaAssetWithBlobForWorkspace,
} from "../mediaAssets";
import {
  assertMediaAssetUploadSessionPartNumbersInRange,
  assertMediaAssetUploadSessionCompletionPartsMatch,
  assertMediaAssetUploadSessionSupportsDurableCompletion,
  beginMediaAssetUploadSessionAbortForWorkspace,
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  closeMediaAssetUploadSessionCurrentBlobWriter,
  completeMediaAssetUploadSessionForWorkspace,
  handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  isMediaAssetUploadSessionExpired,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  loadMediaAssetUploadSessionForCompletionForWorkspace,
  loadMediaAssetUploadSessionForWorkspace,
  resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
  type MediaAssetUploadSessionAbortStartWithWriterResult,
  type MultipartMediaBlobStorageCapability,
  type MultipartMediaBlobWriterAttemptBeginStatus,
  type MultipartMediaBlobWriterAttemptExactInput,
  type MultipartMediaBlobWriterAttemptFailureStatus,
  type MultipartMediaBlobWriterAttemptHandoffStatus,
  type MultipartMediaBlobWriterAttemptInput,
  type MultipartMediaBlobWriterAttemptResult,
} from "../mediaAssets/uploadSessions";
import {
  assertMultipartCompletionRequestActive,
  createMediaAssetsScope,
  createMultipartCompletionDeadlineError,
  createMultipartCompletionHandedOffError,
  createMultipartCompletionInProgressError,
  createMultipartCompletionRequestDeadline,
  createMultipartDatabaseCommitReplay,
  createUploadSessionExpiredError,
  getRequestContextUserId,
  hasSqlState,
  multipartResolutionRetryBaseDelayMs,
  multipartResolutionRetryMaximumDelayMs,
  multipartWriterHeartbeatIntervalMs,
  multipartWriterLeaseExpiryObservationPaddingMs,
  multipartWriterLeaseStorageAbortHeadroomMs,
  runDatabaseOperationOnce,
  toMultipartAttemptInput,
  type MultipartCompletionRequestDeadline,
  type MultipartDatabaseCommitReplay,
} from "../mediaAssets/multipart/requestBoundary";
import {
  createMultipartUploadSessionAtApplicationBoundary,
  multipartUploadSessionCreationApplicationDependencies,
  multipartUploadSessionCreationClaimLeaseDurationMs,
} from "../mediaAssets/multipart/creationBoundary";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../mediaAssets/storageKeys";
import {
  abortMultipartMediaAssetUpload,
  completeMultipartMediaAssetUpload,
  createPresignedMediaAssetDownload,
  createPresignedMediaAssetUploadParts,
} from "../mediaAssets/storage";
import {
  parseCompleteMediaAssetUploadSessionInput,
  parseMediaAssetImageIngestionMetadataHeaders,
  parseMediaAssetIdParam,
  parseMediaAssetUploadSessionCreateInput,
  parseMediaAssetUploadSessionIdParam,
  parseMediaAssetUploadSessionPartUrlsInput,
} from "../mediaAssets/validators";
import { assertUserHasWorkspaceAccess } from "../workspaces";
import {
  loadRequestContextFromRequest,
  loadRequestContextFromRequestWithAbortSignal,
  parseWorkspaceIdParam,
  type RequestContext,
} from "../server/requestContext";
import { parseJsonBody } from "../server/requestParsing";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  captureBackendWarning,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { AppEnv } from "../server/app";
import { HttpError } from "../shared/errors";
import {
  MediaBlobLifecycleBusyError,
  MediaBlobWriterFenceError,
} from "../mediaAssets/blobLifecycle";
import {
  DatabaseDeadlineExceededError,
  runDatabaseOperationsWithDeadline,
} from "../database";
import {
  DatabaseCommitOutcomeUnknownError,
  getDatabaseErrorFields,
  isTransientDatabaseError,
  TransientDatabaseHttpError,
} from "../database/transient";
import type {
  CompleteMediaAssetUploadPartInput,
  MediaAsset,
  MediaAssetUploadSession,
} from "../mediaAssets/types";
import { isValidMediaAssetLastOperationId } from "../mediaAssets/lastOperationId";
import { createDirectImageIngestionRoutes } from "./directImageIngestion";
import {
  createMultipartCompletionWriterLeaseTargetAtMs,
  createStandaloneMultipartCompletionRequestTiming,
  getMultipartCompletionRequestTimingContext,
} from "../server/multipartCompletionRequestTiming";

type MediaAssetsRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

function isMultipartCompletionDeadlineFailure(
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

function mapMultipartCompletionDeadlineError(
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

function createMultipartAttemptError(
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

function isMultipartAppliedStatus(
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

async function replayCompletedMultipartResult(
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

async function resolveMultipartAttemptFailure(
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

type MultipartExactResolutionResult<Result> =
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

type MultipartWriterLease = Readonly<{
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

class MultipartWriterLeaseRenewalRejectedError extends Error {
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

async function renewMultipartWriterLease(
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

type MultipartWriterHeartbeat = Readonly<{
  signal: AbortSignal;
  getStorageCapability: () => Promise<MultipartMediaBlobStorageCapability>;
  assertStorageMutationAuthorized: () => void;
  renewNow: () => Promise<void>;
  stop: () => Promise<void>;
  stopAndRenewForFinalization: () => Promise<void>;
  getLastConfirmedLeaseExpiresAtMs: () => number;
  throwIfFailed: () => void;
}>;

function parseMultipartWriterLeaseExpiresAtMs(leaseExpiresAt: string): number {
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

async function beginUploadSessionAbort(
  userId: string,
  workspaceId: string,
  sessionId: string,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
): Promise<MediaAssetUploadSessionAbortStartWithWriterResult> {
  return replayDatabaseCommit(
    () => beginMediaAssetUploadSessionAbortForWorkspace(
      userId,
      workspaceId,
      sessionId,
    ),
  );
}

export async function abortMultipartUploadSessionAtApplicationBoundary(
  userId: string,
  abortStart: MediaAssetUploadSessionAbortStartWithWriterResult,
  observationScope: BackendObservationScope,
  signal: AbortSignal,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  abortMultipartMediaAssetUploadFn: typeof abortMultipartMediaAssetUpload,
): Promise<MediaAssetUploadSession> {
  if (abortStart.status === "already_aborted") {
    return abortStart.uploadSession;
  }
  if (abortStart.status === "completion_in_progress") {
    throw createMultipartCompletionInProgressError(
      503,
      "Multipart completion has a live foreground writer. Retry abort after the Retry-After delay; no upload state was changed.",
      1,
    );
  }
  if (abortStart.status === "completion_pending") {
    throw createMultipartCompletionInProgressError(
      409,
      "Multipart completion is being durably reconciled. Retry abort after completion settles; no upload state was changed.",
      1,
    );
  }
  const session = abortStart.uploadSession;
  await abortMultipartMediaAssetUploadFn({
    signal,
    workspaceId: session.workspaceId,
    mediaAssetId: session.mediaAssetId,
    stagingStorageKey: session.stagingStorageKey,
    s3UploadId: session.s3UploadId,
    observationScope,
  });
  const closure = await replayDatabaseCommit(
    () => closeMediaAssetUploadSessionCurrentBlobWriter({
      userId,
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      mediaAssetId: session.mediaAssetId,
      lastModifiedByReplicaId: session.lastModifiedByReplicaId,
      lastOperationId: session.lastOperationId,
      sha256: session.mediaBlobSha256,
      storageKey: session.blobStorageKey,
      mimeType: session.mimeType,
      sizeBytes: session.sizeBytes,
      expiresAt: session.expiresAt,
    }),
  );
  if (closure === "cleanup_claimed") {
    throw new MediaBlobLifecycleBusyError();
  }
  const closedSession = await replayDatabaseCommit(
    () => loadMediaAssetUploadSessionForCompletionForWorkspace(
      userId,
      session.workspaceId,
      session.sessionId,
    ),
  );
  if (closedSession.state === "aborted") return closedSession;
  if (closedSession.state === "completed") {
    throw new HttpError(
      409,
      `Media asset upload session completed while aborting. sessionId=${session.sessionId} closure=${closure}`,
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
    );
  }
  throw new HttpError(
    409,
    `Multipart abort conflicts with its current writer state. status=${closure}`,
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
  );
}

export type MultipartCompletionApplicationDependencies = Readonly<{
  abortMultipartMediaAssetUploadFn: typeof abortMultipartMediaAssetUpload;
  beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn:
    typeof beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled;
  completeMultipartMediaAssetUploadFn:
    typeof completeMultipartMediaAssetUpload;
  completeMediaAssetUploadSessionForWorkspaceFn:
    typeof completeMediaAssetUploadSessionForWorkspace;
  handoffCompletionAttemptAfterAccessRevocationFn:
    typeof handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation;
  loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn:
    typeof loadMediaAssetForCompletedUploadSessionReplayForWorkspace;
  resolveCompletionAttemptFailureWithOwnerFn:
    typeof resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner;
}>;

const multipartCompletionApplicationDependencies:
MultipartCompletionApplicationDependencies = Object.freeze({
  abortMultipartMediaAssetUploadFn: abortMultipartMediaAssetUpload,
  beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn:
    beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  completeMultipartMediaAssetUploadFn: completeMultipartMediaAssetUpload,
  completeMediaAssetUploadSessionForWorkspaceFn:
    completeMediaAssetUploadSessionForWorkspace,
  handoffCompletionAttemptAfterAccessRevocationFn:
    handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn:
    loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  resolveCompletionAttemptFailureWithOwnerFn:
    resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
});

type MultipartCompletionApplicationResult = Awaited<
  ReturnType<typeof completeMediaAssetUploadSessionForWorkspace>
>;

function isMultipartHandoffAppliedStatus(
  status: MultipartMediaBlobWriterAttemptHandoffStatus,
): boolean {
  return status === "already_applied"
    || status === "live_applied"
    || status === "referenced";
}

function createMultipartCompletionSafeLeaseExpiryError(
  completionError: unknown,
  resolutionError: unknown,
): Error {
  const diagnosticCause = new AggregateError(
    [completionError, resolutionError],
    "Multipart completion failed and exact resolution remained unavailable until the confirmed writer lease expired safely.",
  );
  if (completionError instanceof HttpError) {
    const preservedError = new HttpError(
      completionError.statusCode,
      completionError.message,
      completionError.code ?? undefined,
      completionError.details ?? undefined,
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

async function handoffAcceptedMultipartAttempt(
  completionError: unknown,
  userId: string,
  session: MediaAssetUploadSession,
  writer: MultipartMediaBlobWriterAttemptExactInput,
  lastConfirmedLeaseExpiresAtMs: number,
  observationScope: BackendObservationScope,
  requestDeadline: MultipartCompletionRequestDeadline,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  dependencies: MultipartCompletionApplicationDependencies,
): Promise<MultipartCompletionApplicationResult> {
  let resolution:
    MultipartExactResolutionResult<MultipartMediaBlobWriterAttemptHandoffStatus>;
  try {
    resolution = await resolveMultipartOperationExactlyUntilSafe(
      () =>
        dependencies.handoffCompletionAttemptAfterAccessRevocationFn(
          writer,
        ),
      lastConfirmedLeaseExpiresAtMs,
      requestDeadline,
      observationScope,
    );
  } catch (handoffError) {
    throw createMultipartCompletionResolutionError(
      completionError,
      mapMultipartCompletionDeadlineError(
        handoffError,
        requestDeadline,
        requestDeadline,
      ),
    );
  }

  if (resolution.kind === "safe_lease_expired") {
    if (resolution.resolutionError === null) throw completionError;
    throw createMultipartCompletionSafeLeaseExpiryError(
      completionError,
      resolution.resolutionError,
    );
  }
  const handoffStatus = resolution.value;
  if (
    handoffStatus === "handed_off"
    || handoffStatus === "already_pending"
  ) {
    throw createMultipartCompletionHandedOffError();
  }
  if (isMultipartHandoffAppliedStatus(handoffStatus)) {
    return replayCompletedMultipartResult(
      userId,
      session,
      replayDatabaseCommit,
      dependencies
        .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
    );
  }
  if (
    handoffStatus !== "failed"
  ) {
    throw createMultipartAttemptError(
      handoffStatus,
      null,
    );
  }
  throw createMultipartAttemptError("stale_attempt", null);
}

async function resolveRecoveredMultipartAttempt(
  completionError: unknown,
  userId: string,
  session: MediaAssetUploadSession,
  attemptInput: MultipartMediaBlobWriterAttemptInput,
  writerLeaseTargetAtMs: number,
  observationScope: BackendObservationScope,
  requestDeadline: MultipartCompletionRequestDeadline,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  dependencies: MultipartCompletionApplicationDependencies,
): Promise<MultipartCompletionApplicationResult> {
  let recovery:
    MultipartExactResolutionResult<Awaited<
    ReturnType<
      typeof beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled
    >
    >>;
  try {
    recovery = await resolveMultipartOperationExactlyUntilSafe(
      () =>
        dependencies.beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn(
          attemptInput,
          writerLeaseTargetAtMs,
          writerLeaseTargetAtMs,
          requestDeadline.signal,
        ),
      writerLeaseTargetAtMs - 1,
      requestDeadline,
      observationScope,
    );
  } catch (resolutionError) {
    throw createMultipartCompletionResolutionError(
      completionError,
      mapMultipartCompletionDeadlineError(
        resolutionError,
        requestDeadline,
        requestDeadline,
      ),
    );
  }
  if (recovery.kind === "safe_lease_expired") {
    if (recovery.resolutionError === null) throw completionError;
    throw createMultipartCompletionSafeLeaseExpiryError(
      completionError,
      recovery.resolutionError,
    );
  }
  const recoveredAttempt = recovery.value;

  if (!("reservationToken" in recoveredAttempt)) {
    if (recoveredAttempt.status === "completion_pending") {
      throw createMultipartCompletionHandedOffError();
    }
    if (isMultipartAppliedStatus(recoveredAttempt.status)) {
      return replayCompletedMultipartResult(
        userId,
        session,
        replayDatabaseCommit,
        dependencies
          .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
      );
    }
    throw completionError;
  }

  const writer: MultipartMediaBlobWriterAttemptExactInput = {
    ...attemptInput,
    reservationToken: recoveredAttempt.reservationToken,
    normalizationVersion: recoveredAttempt.normalizationVersion,
  };
  return handoffAcceptedMultipartAttempt(
    completionError,
    userId,
    session,
    writer,
    parseMultipartWriterLeaseExpiresAtMs(recoveredAttempt.leaseExpiresAt),
    observationScope,
    requestDeadline,
    replayDatabaseCommit,
    dependencies,
  );
}

export async function completeMultipartUploadSessionAtApplicationBoundary(
  userId: string,
  session: MediaAssetUploadSession,
  parts: ReadonlyArray<CompleteMediaAssetUploadPartInput>,
  attemptToken: string,
  observationScope: BackendObservationScope,
  operationDeadline: MultipartCompletionRequestDeadline,
  writerLeaseTargetAtMs: number,
  requestDeadline: MultipartCompletionRequestDeadline,
  dependencies: MultipartCompletionApplicationDependencies,
): Promise<MultipartCompletionApplicationResult> {
  if (
    createMultipartCompletionWriterLeaseTargetAtMs(
      operationDeadline.deadlineAtMs,
      requestDeadline.deadlineAtMs,
    ) !== writerLeaseTargetAtMs
    || writerLeaseTargetAtMs - operationDeadline.deadlineAtMs
      <= multipartWriterLeaseStorageAbortHeadroomMs
    || requestDeadline.deadlineAtMs - writerLeaseTargetAtMs
      <= multipartWriterLeaseExpiryObservationPaddingMs
  ) {
    throw new RangeError(
      "Multipart completion writer lease target does not preserve the request timing and storage-safety margins.",
    );
  }
  const replayOperationDatabaseCommit =
    createMultipartDatabaseCommitReplay(operationDeadline);
  const replayResolutionDatabaseCommit =
    createMultipartDatabaseCommitReplay(requestDeadline);

  if (
    session.state === "completed"
    && isValidMediaAssetLastOperationId(session.lastOperationId) === false
  ) {
    return replayCompletedMultipartResult(
      userId,
      session,
      replayResolutionDatabaseCommit,
      dependencies
        .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
    );
  }
  if (
    session.state === "completing"
    && isValidMediaAssetLastOperationId(session.lastOperationId) === false
  ) {
    try {
      const legacyAbort = await beginUploadSessionAbort(
        userId,
        session.workspaceId,
        session.sessionId,
        replayOperationDatabaseCommit,
      );
      await abortMultipartUploadSessionAtApplicationBoundary(
        userId,
        legacyAbort,
        observationScope,
        operationDeadline.signal,
        replayResolutionDatabaseCommit,
        dependencies.abortMultipartMediaAssetUploadFn,
      );
    } catch (error) {
      if (
        !(error instanceof HttpError)
        || error.code !== "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED"
      ) {
        throw error;
      }
      const completedSession = await replayResolutionDatabaseCommit(
        () => loadMediaAssetUploadSessionForCompletionForWorkspace(
          userId,
          session.workspaceId,
          session.sessionId,
        ),
      );
      if (completedSession.state !== "completed") throw error;
      return replayCompletedMultipartResult(
        userId,
        completedSession,
        replayResolutionDatabaseCommit,
        dependencies
          .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
      );
    }
  }
  if (session.state === "active" || session.state === "completing") {
    assertMediaAssetUploadSessionSupportsDurableCompletion(session);
  }
  if (isExpiredMultipartCompletionCleanupRequired(session)) {
    const expiry = await beginUploadSessionAbort(
      userId,
      session.workspaceId,
      session.sessionId,
      replayOperationDatabaseCommit,
    );
    await abortMultipartUploadSessionAtApplicationBoundary(
      userId,
      expiry,
      observationScope,
      operationDeadline.signal,
      replayResolutionDatabaseCommit,
      dependencies.abortMultipartMediaAssetUploadFn,
    );
    throw createUploadSessionExpiredError(session);
  }
  if (session.state === "active" || session.state === "completing") {
    assertMediaAssetUploadSessionCompletionPartsMatch(session, parts);
  }

  const attemptInput = toMultipartAttemptInput(
    attemptToken,
    userId,
    session,
    parts,
  );
  let attempt: Awaited<
    ReturnType<
      typeof beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled
    >
  >;
  try {
    attempt = await replayOperationDatabaseCommit(
      () =>
        dependencies.beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn(
          attemptInput,
          writerLeaseTargetAtMs,
          operationDeadline.deadlineAtMs,
          operationDeadline.signal,
        ),
    );
  } catch (error) {
    const completionError = mapMultipartCompletionDeadlineError(
      error,
      operationDeadline,
      requestDeadline,
    );
    if (
      completionError instanceof HttpError
      && completionError.code
        === "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED"
    ) {
      return resolveRecoveredMultipartAttempt(
        completionError,
        userId,
        session,
        attemptInput,
        writerLeaseTargetAtMs,
        observationScope,
        requestDeadline,
        replayResolutionDatabaseCommit,
        dependencies,
      );
    }
    throw completionError;
  }

  if (!("reservationToken" in attempt)) {
    if (attempt.status === "completion_pending") {
      throw createMultipartCompletionHandedOffError();
    }
    if (isMultipartAppliedStatus(attempt.status)) {
      return replayCompletedMultipartResult(
        userId,
        session,
        replayResolutionDatabaseCommit,
        dependencies
          .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
      );
    }
    if (
      session.state === "completed"
      && attempt.status === "writer_conflict"
    ) {
      return replayCompletedMultipartResult(
        userId,
        session,
        replayResolutionDatabaseCommit,
        dependencies
          .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
      );
    }
    if (
      attempt.status === "aborted"
      && isMediaAssetUploadSessionExpired(session)
    ) {
      throw createUploadSessionExpiredError(session);
    }
    throw createMultipartAttemptError(
      attempt.status,
      "leaseExpiresAt" in attempt ? attempt.leaseExpiresAt : null,
    );
  }

  let writer: MultipartMediaBlobWriterAttemptExactInput | null = null;
  let heartbeat: MultipartWriterHeartbeat | null = null;
  let lastConfirmedLeaseExpiresAtMs =
    parseMultipartWriterLeaseExpiresAtMs(attempt.leaseExpiresAt);
  try {
    operationDeadline.signal.throwIfAborted();
    const acquiredWriter: MultipartMediaBlobWriterAttemptExactInput = {
      ...attemptInput,
      reservationToken: attempt.reservationToken,
      normalizationVersion: attempt.normalizationVersion,
    };
    writer = acquiredWriter;
    heartbeat = createMultipartWriterHeartbeat(
      {
        storageCapability: attempt.storageCapability,
        leaseExpiresAt: attempt.leaseExpiresAt,
      },
      operationDeadline.signal,
      operationDeadline.deadlineAtMs,
      writerLeaseTargetAtMs,
      multipartWriterLeaseStorageAbortHeadroomMs,
      multipartWriterHeartbeatIntervalMs,
      async (): Promise<MultipartWriterLease> => {
        const renewal = await renewMultipartWriterLease(
          attemptInput,
          acquiredWriter,
          writerLeaseTargetAtMs,
          operationDeadline,
          replayOperationDatabaseCommit,
          dependencies
            .beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn,
        );
        return renewal;
      },
    );
    await heartbeat.renewNow();
    await dependencies.completeMultipartMediaAssetUploadFn({
      writer: acquiredWriter,
      getStorageCapability: heartbeat.getStorageCapability,
      assertStorageMutationAuthorized:
        heartbeat.assertStorageMutationAuthorized,
      signal: heartbeat.signal,
      workspaceId: session.workspaceId,
      mediaAssetId: session.mediaAssetId,
      stagingStorageKey: session.stagingStorageKey,
      blobStorageKey: session.blobStorageKey,
      s3UploadId: session.s3UploadId,
      mimeType: session.mimeType,
      sizeBytes: session.sizeBytes,
      sha256: session.mediaBlobSha256,
      lastOperationId: session.lastOperationId,
      parts,
      observationScope,
    });
    await heartbeat.stopAndRenewForFinalization();
    heartbeat.throwIfFailed();
    return await replayOperationDatabaseCommit(
      () => dependencies.completeMediaAssetUploadSessionForWorkspaceFn(
        userId,
        session.workspaceId,
        session.sessionId,
        acquiredWriter,
      ),
    );
  } catch (completionError) {
    if (heartbeat !== null) {
      await heartbeat.stop();
      lastConfirmedLeaseExpiresAtMs =
        heartbeat.getLastConfirmedLeaseExpiresAtMs();
    }
    const exactWriter: MultipartMediaBlobWriterAttemptExactInput =
      writer ?? {
        ...attemptInput,
        reservationToken: attempt.reservationToken,
        normalizationVersion: attempt.normalizationVersion,
      };
    if (
      isMultipartCompletionDeadlineFailure(
        completionError,
        operationDeadline,
        requestDeadline,
      )
    ) {
      return handoffAcceptedMultipartAttempt(
        mapMultipartCompletionDeadlineError(
          completionError,
          operationDeadline,
          requestDeadline,
        ),
        userId,
        session,
        exactWriter,
        lastConfirmedLeaseExpiresAtMs,
        observationScope,
        requestDeadline,
        replayResolutionDatabaseCommit,
        dependencies,
      );
    }
    if (
      completionError instanceof MultipartWriterLeaseRenewalRejectedError
    ) {
      try {
        captureBackendWarning({
          action: "media_asset_upload_session_completion_renewal_rejected",
          scope: observationScope,
          details: {
            mediaAssetId: session.mediaAssetId,
            sessionId: session.sessionId,
            durableOutcome: completionError.durableOutcome,
          },
        });
      } catch {
        // Observability must not interrupt exact multipart attempt resolution.
      }
      if (
        completionError.durableOutcome === "already_applied"
        || completionError.durableOutcome === "live_applied"
        || completionError.durableOutcome === "referenced"
      ) {
        return replayCompletedMultipartResult(
          userId,
          session,
          replayResolutionDatabaseCommit,
          dependencies
            .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
        );
      }
      return handoffAcceptedMultipartAttempt(
        completionError.fallbackError,
        userId,
        session,
        exactWriter,
        lastConfirmedLeaseExpiresAtMs,
        observationScope,
        requestDeadline,
        replayResolutionDatabaseCommit,
        dependencies,
      );
    }
    let exactResolution:
      MultipartExactResolutionResult<MultipartMediaBlobWriterAttemptHandoffStatus>;
    try {
      exactResolution = await resolveMultipartOperationExactlyUntilSafe(
        () => resolveMultipartAttemptFailure(
          exactWriter,
          dependencies,
        ),
        lastConfirmedLeaseExpiresAtMs,
        requestDeadline,
        observationScope,
      );
    } catch (resolutionError) {
      throw createMultipartCompletionResolutionError(
        completionError,
        mapMultipartCompletionDeadlineError(
          resolutionError,
          operationDeadline,
          requestDeadline,
        ),
      );
    }
    if (exactResolution.kind === "safe_lease_expired") {
      if (exactResolution.resolutionError === null) throw completionError;
      throw createMultipartCompletionResolutionError(
        completionError,
        exactResolution.resolutionError,
      );
    }
    const resolution = exactResolution.value;
    if (isMultipartAppliedStatus(resolution)) {
      return replayCompletedMultipartResult(
        userId,
        session,
        replayResolutionDatabaseCommit,
        dependencies
          .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
      );
    }
    if (resolution === "handed_off" || resolution === "already_pending") {
      throw createMultipartCompletionHandedOffError();
    }
    if (resolution === "unreferenced_restored") throw completionError;
    if (resolution === "unreferenced") {
      throw createMultipartAttemptError("access_denied", null);
    }
    throw createMultipartAttemptError(resolution, null);
  } finally {
    if (heartbeat !== null) await heartbeat.stop();
  }
}

export function createMediaAssetsRoutes(options: MediaAssetsRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.route("/", createDirectImageIngestionRoutes(options));

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      const input = parseMediaAssetUploadSessionCreateInput(await parseJsonBody(context.req.raw));
      mediaAssetId = input.mediaAssetId;
      sessionId = randomUUID();
      const claimToken = randomUUID();
      const storageKey = buildMediaMultipartUploadStagingStorageKey(workspaceId, input.mediaAssetId, sessionId);
      const blobStorageKey = buildMediaBlobStorageKey(input.sha256);
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const applicationResult =
        await createMultipartUploadSessionAtApplicationBoundary(
          loadedContext.requestContext.userId,
          workspaceId,
          sessionId,
          claimToken,
          input,
          storageKey,
          blobStorageKey,
          scope,
          context.req.raw.signal,
          multipartUploadSessionCreationClaimLeaseDurationMs,
          multipartUploadSessionCreationApplicationDependencies,
        );
      const sessionResult = applicationResult.sessionResult;
      if (sessionResult.status === "already_available") {
        addBackendBreadcrumb({
          action: applicationResult.multipartUploadCreated
            ? "media_asset_upload_session_concurrent_media_reuse"
            : "media_asset_upload_session_media_reuse",
          scope,
          details: {
            statusCode: 200,
            mediaAssetId: input.mediaAssetId,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            applied: sessionResult.applied,
          },
        });
        return context.json({
          workspaceId,
          mediaAssetId: input.mediaAssetId,
          status: "already_available",
          mediaAsset: sessionResult.mediaAsset,
          uploadSession: null,
        });
      }

      sessionId = sessionResult.uploadSession.sessionId;
      addBackendBreadcrumb({
        action: "media_asset_upload_session_create",
        scope,
        details: {
          statusCode: 201,
          mediaAssetId: input.mediaAssetId,
          sessionId,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          partSizeBytes: input.partSizeBytes,
          partCount: input.partCount,
        },
      });
      return context.json({
        workspaceId,
        mediaAssetId: input.mediaAssetId,
        status: "upload_required",
        mediaAsset: null,
        uploadSession: {
          sessionId: sessionResult.uploadSession.sessionId,
          expiresAt: sessionResult.uploadSession.expiresAt,
          partSizeBytes: sessionResult.uploadSession.partSizeBytes,
          partCount: sessionResult.uploadSession.partCount,
        },
      }, 201);
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_create_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/parts", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      sessionId = parseMediaAssetUploadSessionIdParam(context.req.param("sessionId"));
      const input = parseMediaAssetUploadSessionPartUrlsInput(await parseJsonBody(context.req.raw));
      const session = await loadMediaAssetUploadSessionForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
      );
      mediaAssetId = session.mediaAssetId;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      if (isMediaAssetUploadSessionExpired(session)) {
        const expiry = await beginUploadSessionAbort(
          loadedContext.requestContext.userId,
          workspaceId,
          sessionId,
          runDatabaseOperationOnce,
        );
        await abortMultipartUploadSessionAtApplicationBoundary(
          loadedContext.requestContext.userId,
          expiry,
          scope,
          context.req.raw.signal,
          runDatabaseOperationOnce,
          abortMultipartMediaAssetUpload,
        );
        throw createUploadSessionExpiredError(session);
      }
      assertMediaAssetUploadSessionPartNumbersInRange(session, input.parts);
      const partUrls = await createPresignedMediaAssetUploadParts({
        workspaceId,
        mediaAssetId: session.mediaAssetId,
        stagingStorageKey: session.stagingStorageKey,
        s3UploadId: session.s3UploadId,
        parts: input.parts,
        observationScope: scope,
      });

      addBackendBreadcrumb({
        action: "media_asset_upload_session_part_urls_create",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId: session.mediaAssetId,
          sessionId,
          partCount: input.parts.length,
        },
      });
      return context.json({ sessionId, partUrls });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_part_urls_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_part_urls_create_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/complete", async (context) => {
    const observedAtMs = Date.now();
    const timingContext = getMultipartCompletionRequestTimingContext();
    const requestTiming = timingContext === null
      ? createStandaloneMultipartCompletionRequestTiming(observedAtMs)
      : timingContext.timing;
    const requestDeadlineAtMs =
      requestTiming?.requestDeadlineAtMs ?? observedAtMs;
    const operationDeadlineAtMs =
      requestTiming?.operationDeadlineAtMs ?? observedAtMs;
    const writerLeaseTargetAtMs =
      requestTiming?.writerLeaseTargetAtMs ?? observedAtMs;
    const requestDeadline =
      createMultipartCompletionRequestDeadline(requestDeadlineAtMs);
    const operationDeadline =
      createMultipartCompletionRequestDeadline(operationDeadlineAtMs);
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      if (
        requestTiming === null
        || observedAtMs >= requestTiming.acquisitionDeadlineAtMs
        || observedAtMs >= requestTiming.integrationDeadlineAtMs
      ) {
        throw createMultipartCompletionDeadlineError();
      }
      return await runDatabaseOperationsWithDeadline(
        requestDeadlineAtMs,
        async () => {
          const prepared = await runDatabaseOperationsWithDeadline(
            operationDeadlineAtMs,
            async () => {
              const loadedContext =
                await loadRequestContextFromRequestWithAbortSignal(
                  context.req.raw,
                  options.allowedOrigins,
                  operationDeadline.signal,
                );
              requestContext = loadedContext.requestContext;
              const parsedWorkspaceId = parseWorkspaceIdParam(
                context.req.param("workspaceId"),
              );
              workspaceId = parsedWorkspaceId;
              await assertUserHasWorkspaceAccess(
                loadedContext.requestContext.userId,
                parsedWorkspaceId,
              );
              const parsedSessionId = parseMediaAssetUploadSessionIdParam(
                context.req.param("sessionId"),
              );
              sessionId = parsedSessionId;
              const input = parseCompleteMediaAssetUploadSessionInput(
                await parseJsonBody(context.req.raw),
              );
              const session =
                await loadMediaAssetUploadSessionForCompletionForWorkspace(
                  loadedContext.requestContext.userId,
                  parsedWorkspaceId,
                  parsedSessionId,
                );
              return {
                loadedContext,
                input,
                session,
                workspaceId: parsedWorkspaceId,
                sessionId: parsedSessionId,
              };
            },
          );
          const {
            loadedContext,
            input,
            session,
            workspaceId: preparedWorkspaceId,
            sessionId: preparedSessionId,
          } = prepared;
          mediaAssetId = session.mediaAssetId;
          const scope = createMediaAssetsScope(
            requestId,
            context.req.path,
            context.req.method,
            loadedContext.requestContext.userId,
            preparedWorkspaceId,
            context.get("clientAppVersion"),
            context.get("clientPlatform"),
          );
          const result =
            await completeMultipartUploadSessionAtApplicationBoundary(
              loadedContext.requestContext.userId,
              session,
              input.parts,
              randomUUID(),
              scope,
              operationDeadline,
              writerLeaseTargetAtMs,
              requestDeadline,
              multipartCompletionApplicationDependencies,
            );

          addBackendBreadcrumb({
            action: "media_asset_upload_session_complete",
            scope,
            details: {
              statusCode: 200,
              mediaAssetId: session.mediaAssetId,
              sessionId: preparedSessionId,
              mimeType: session.mimeType,
              sizeBytes: session.sizeBytes,
              applied: result.applied,
            },
          });
          return context.json(result);
        },
      );
    } catch (error) {
      const mappedError = mapMultipartCompletionDeadlineError(
        error,
        operationDeadline,
        requestDeadline,
      );
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(mappedError),
      };
      reportBackendExceptionOrBreadcrumb(
        mappedError,
        { action: "media_asset_upload_session_complete_error", error: normalizeCaughtError(mappedError), scope, details },
        { action: "media_asset_upload_session_complete_error", scope, details },
      );
      throw mappedError;
    } finally {
      operationDeadline.dispose();
      requestDeadline.dispose();
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/abort", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      sessionId = parseMediaAssetUploadSessionIdParam(context.req.param("sessionId"));
      const abortStart = await beginUploadSessionAbort(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
        runDatabaseOperationOnce,
      );
      const session = abortStart.uploadSession;
      mediaAssetId = session.mediaAssetId;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const abortedSession =
        await abortMultipartUploadSessionAtApplicationBoundary(
          loadedContext.requestContext.userId,
          abortStart,
          scope,
          context.req.raw.signal,
          runDatabaseOperationOnce,
          abortMultipartMediaAssetUpload,
        );

      addBackendBreadcrumb({
        action: "media_asset_upload_session_abort",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId: session.mediaAssetId,
          sessionId,
        },
      });
      return context.json({ sessionId, abortedAt: abortedSession.abortedAt });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_abort_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_abort_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/media-assets/:mediaAssetId", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      mediaAssetId = parseMediaAssetIdParam(context.req.param("mediaAssetId"));
      const mediaAsset = await loadMediaAssetForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        mediaAssetId,
      );
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));

      addBackendBreadcrumb({
        action: "media_asset_get",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId,
        },
      });
      return context.json({ mediaAsset });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_get_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_get_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/media-assets/:mediaAssetId/download-url", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      mediaAssetId = parseMediaAssetIdParam(context.req.param("mediaAssetId"));
      const { mediaAsset, mediaBlob } = await loadMediaAssetWithBlobForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        mediaAssetId,
      );
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const download = await createPresignedMediaAssetDownload({
        workspaceId,
        mediaAssetId,
        storageKey: mediaBlob.storageKey,
        observationScope: scope,
      });

      addBackendBreadcrumb({
        action: "media_asset_download_url_create",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId,
        },
      });
      return context.json({ mediaAsset, download });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_download_url_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_download_url_create_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}

import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { DatabaseDeadlineExceededError } from "../../../database";
import {
  DatabaseCommitOutcomeUnknownError,
  getDatabaseErrorFields,
  isTransientDatabaseError,
  TransientDatabaseHttpError,
} from "../../../database/transient";
import { addBackendRuntimeBreadcrumb } from "../../../observability/runtime";
import type { BackendObservationScope } from "../../../observability/sentry";
import {
  authorizeMediaBlobCleanup,
  claimNextMediaBlobCleanup,
  completeMediaBlobCleanup,
  recordMediaBlobCleanupFailure,
  renewMediaBlobCleanupLease,
  type MediaBlobCleanupClaim,
  type MediaBlobCleanupFailureDisposition,
  type MediaBlobCleanupFailurePhase,
  type MediaBlobCleanupLeaseRenewalPhase,
} from "./repository";
import {
  deletePermanentMediaBlob,
  MediaBlobCleanupStorageAmbiguousDeleteError,
  MediaBlobCleanupStorageConditionalConflictError,
  MediaBlobCleanupStorageTerminalError,
  MediaBlobCleanupStorageTransientError,
  type PermanentMediaBlobDeleteOutcome,
} from "../../storage";

const minimumNewCandidateBudgetMs = 1_000;
const cleanupLeaseFinalizationReserveMs = 1_000;
const maximumDatabaseAttemptCount = 3;
const databaseRetryBaseDelayMs = 50;
const cleanupRetryBaseDelayMs = 60_000;
const cleanupRetryMaximumDelayMs = 3_600_000;

export type MediaBlobCleanupOutcome =
  | "deleted"
  | "not_found"
  | "blocked"
  | "stale"
  | "already_completed"
  | "retry_scheduled"
  | "reconciliation_required"
  | "interrupted";

export type MediaBlobCleanupResult = Readonly<{
  sha256: string;
  cleanupGeneration: number;
  outcome: MediaBlobCleanupOutcome;
}>;

export type MediaBlobCleanupBatchInput = Readonly<{
  leaseDurationMs: number;
  maximumCandidates: number;
  deadlineAtMs: number;
  observationScope: BackendObservationScope;
  signal: AbortSignal;
}>;

export type MediaBlobCleanupBatchResult = Readonly<{
  claimed: number;
  deleted: number;
  notFound: number;
  blocked: number;
  stale: number;
  alreadyCompleted: number;
  retryScheduled: number;
  reconciliationRequired: number;
  interrupted: number;
  results: ReadonlyArray<MediaBlobCleanupResult>;
}>;

export class MediaBlobCleanupBatchError extends Error {
  readonly result: MediaBlobCleanupBatchResult;
  readonly failures: ReadonlyArray<Error>;

  constructor(
    result: MediaBlobCleanupBatchResult,
    failures: ReadonlyArray<Error>,
  ) {
    super(
      `Media-blob cleanup batch completed with ${String(failures.length)} deferred failure(s).`,
      { cause: failures.at(-1) },
    );
    this.name = "MediaBlobCleanupBatchError";
    this.result = result;
    this.failures = Object.freeze([...failures]);
  }
}

export type MediaBlobCleanupProcessorDependencies = Readonly<{
  claimFn: typeof claimNextMediaBlobCleanup;
  authorizeFn: typeof authorizeMediaBlobCleanup;
  renewFn: typeof renewMediaBlobCleanupLease;
  deleteFn: typeof deletePermanentMediaBlob;
  completeFn: typeof completeMediaBlobCleanup;
  recordFailureFn: typeof recordMediaBlobCleanupFailure;
  createTokenFn: () => string;
  nowFn: () => number;
  waitFn: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;
}>;

type CleanupDatabasePhase =
  | "claim"
  | "authorize"
  | "renew"
  | "complete"
  | "record_failure";

type ClaimProcessingResult = Readonly<{
  result: MediaBlobCleanupResult;
  deferredErrors: ReadonlyArray<Error>;
}>;

const noDeferredErrors: ReadonlyArray<Error> = Object.freeze([]);

class MediaBlobCleanupLeaseLostError extends Error {
  constructor(readonly status: "completed" | "stale") {
    super(`Media-blob cleanup lease renewal returned ${status}.`);
    this.name = "MediaBlobCleanupLeaseLostError";
  }
}

class MediaBlobCleanupFailurePersistenceError extends Error {
  readonly code = "MEDIA_BLOB_CLEANUP_FAILURE_PERSISTENCE_FAILED";

  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "MediaBlobCleanupFailurePersistenceError";
  }
}

class MediaBlobCleanupReconciliationRequiredError extends Error {
  readonly code = "MEDIA_BLOB_CLEANUP_RECONCILIATION_REQUIRED";

  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "MediaBlobCleanupReconciliationRequiredError";
  }
}

type MediaBlobCleanupStorageError =
  | MediaBlobCleanupStorageAmbiguousDeleteError
  | MediaBlobCleanupStorageConditionalConflictError
  | MediaBlobCleanupStorageTerminalError
  | MediaBlobCleanupStorageTransientError;

function isMediaBlobCleanupStorageError(
  error: unknown,
): error is MediaBlobCleanupStorageError {
  return error instanceof MediaBlobCleanupStorageAmbiguousDeleteError
    || error instanceof MediaBlobCleanupStorageConditionalConflictError
    || error instanceof MediaBlobCleanupStorageTerminalError
    || error instanceof MediaBlobCleanupStorageTransientError;
}

function isRetryableDatabaseFailure(error: unknown): boolean {
  return error instanceof DatabaseCommitOutcomeUnknownError
    || error instanceof TransientDatabaseHttpError
    || isTransientDatabaseError(error);
}

async function runDatabaseOperation<Result>(
  phase: CleanupDatabasePhase,
  claim: MediaBlobCleanupClaim | null,
  input: MediaBlobCleanupBatchInput,
  dependencies: MediaBlobCleanupProcessorDependencies,
  operation: () => Promise<Result>,
): Promise<Result> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maximumDatabaseAttemptCount; attempt += 1) {
    input.signal.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      input.signal.throwIfAborted();
      if (!isRetryableDatabaseFailure(error)) throw error;
      lastError = error;
      if (attempt === maximumDatabaseAttemptCount) break;
      const delayMs = databaseRetryBaseDelayMs * (2 ** (attempt - 1));
      const errorFields = getDatabaseErrorFields(error);
      addBackendRuntimeBreadcrumb({
        action: "media_blob_cleanup_retry",
        scope: input.observationScope,
        details: {
          phase,
          attempt,
          maxAttempts: maximumDatabaseAttemptCount,
          sha256: claim?.sha256 ?? null,
          cleanupGeneration: claim?.cleanupGeneration ?? null,
          statusCode: null,
          errorCode: errorFields.errorCode,
          errorClass: errorFields.errorClass,
        },
      });
      if (dependencies.nowFn() + delayMs >= input.deadlineAtMs) {
        throw new DatabaseDeadlineExceededError(
          "executor_operations",
          input.deadlineAtMs,
          error,
        );
      }
      await dependencies.waitFn(delayMs, input.signal);
    }
  }
  throw lastError;
}

function toResult(
  claim: MediaBlobCleanupClaim,
  outcome: MediaBlobCleanupOutcome,
): MediaBlobCleanupResult {
  return Object.freeze({
    sha256: claim.sha256,
    cleanupGeneration: claim.cleanupGeneration,
    outcome,
  });
}

function countOutcome(
  results: ReadonlyArray<MediaBlobCleanupResult>,
  outcome: MediaBlobCleanupOutcome,
): number {
  return results.filter((result) => result.outcome === outcome).length;
}

function toBatchResult(
  results: ReadonlyArray<MediaBlobCleanupResult>,
  interruptedBeforeClaim: boolean,
): MediaBlobCleanupBatchResult {
  const immutableResults = Object.freeze([...results]);
  return Object.freeze({
    claimed: immutableResults.length,
    deleted: countOutcome(immutableResults, "deleted"),
    notFound: countOutcome(immutableResults, "not_found"),
    blocked: countOutcome(immutableResults, "blocked"),
    stale: countOutcome(immutableResults, "stale"),
    alreadyCompleted: countOutcome(immutableResults, "already_completed"),
    retryScheduled: countOutcome(immutableResults, "retry_scheduled"),
    reconciliationRequired: countOutcome(
      immutableResults,
      "reconciliation_required",
    ),
    interrupted:
      countOutcome(immutableResults, "interrupted")
      + (interruptedBeforeClaim ? 1 : 0),
    results: immutableResults,
  });
}

function normalizeDeferredError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Media-blob cleanup failed with a non-Error value.", {
      cause: error,
    });
}

function isInterrupted(
  error: unknown,
  signal: AbortSignal,
): boolean {
  return signal.aborted || error instanceof DatabaseDeadlineExceededError;
}

function createRenewableDeadlineSignal(
  parentSignal: AbortSignal,
  invocationDeadlineAtMs: number,
  leaseExpiresAtMs: number,
  nowMs: number,
): Readonly<{
  signal: AbortSignal;
  refresh: (renewedLeaseExpiresAtMs: number, refreshedAtMs: number) => void;
  dispose: () => void;
}> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  const refresh = (
    renewedLeaseExpiresAtMs: number,
    refreshedAtMs: number,
  ): void => {
    if (timer !== null) clearTimeout(timer);
    const storageDeadlineAtMs = Math.min(
      invocationDeadlineAtMs - cleanupLeaseFinalizationReserveMs,
      renewedLeaseExpiresAtMs - cleanupLeaseFinalizationReserveMs,
    );
    timer = setTimeout(
      () => controller.abort(
        new Error("Media-blob cleanup storage lease deadline reached."),
      ),
      Math.max(0, storageDeadlineAtMs - refreshedAtMs),
    );
    timer.unref();
  };
  refresh(leaseExpiresAtMs, nowMs);
  return {
    signal: AbortSignal.any([parentSignal, controller.signal]),
    refresh,
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
    },
  };
}

function resolveFailurePhase(
  error: unknown,
  currentPhase: MediaBlobCleanupFailurePhase,
): MediaBlobCleanupFailurePhase {
  if (isMediaBlobCleanupStorageError(error)) {
    return error.operation;
  }
  return currentPhase;
}

function resolveFailureDisposition(
  error: unknown,
  deleteTransitionMayHaveCommitted: boolean,
): MediaBlobCleanupFailureDisposition {
  return (
    !deleteTransitionMayHaveCommitted
    && (
      error instanceof MediaBlobCleanupStorageTransientError
      || isRetryableDatabaseFailure(error)
    )
  )
    ? "retry"
    : "terminal";
}

function boundedFailureField(value: string | null, fallback: string): string {
  const normalized = value === null || value.length === 0 ? fallback : value;
  return normalized.slice(0, 128);
}

function resolveFailureFields(error: unknown): Readonly<{
  errorCode: string;
  errorClass: string;
}> {
  const databaseFields = getDatabaseErrorFields(error);
  const explicitCode = isMediaBlobCleanupStorageError(error)
    ? error.code
    : error instanceof MediaBlobCleanupReconciliationRequiredError
    || error instanceof MediaBlobCleanupFailurePersistenceError
    ? error.code
    : databaseFields.errorCode;
  return {
    errorCode: boundedFailureField(explicitCode, "UNCLASSIFIED_FAILURE"),
    errorClass: boundedFailureField(
      error instanceof Error ? error.name : databaseFields.errorClass,
      "UnknownError",
    ),
  };
}

function cleanupRetryDelayMs(failureCount: number): number {
  return Math.min(
    cleanupRetryMaximumDelayMs,
    cleanupRetryBaseDelayMs * (2 ** Math.min(failureCount, 5)),
  );
}

async function persistCleanupFailure(
  claim: MediaBlobCleanupClaim,
  phase: MediaBlobCleanupFailurePhase,
  error: unknown,
  deleteTransitionMayHaveCommitted: boolean,
  input: MediaBlobCleanupBatchInput,
  dependencies: MediaBlobCleanupProcessorDependencies,
): Promise<ClaimProcessingResult> {
  const disposition = resolveFailureDisposition(
    error,
    deleteTransitionMayHaveCommitted,
  );
  const retryDelayMs = disposition === "retry"
    ? cleanupRetryDelayMs(claim.failureCount)
    : 0;
  const failureFields = resolveFailureFields(error);
  const failureToken = dependencies.createTokenFn();
  const decision = await runDatabaseOperation(
    "record_failure",
    claim,
    input,
    dependencies,
    () => dependencies.recordFailureFn(
      claim,
      {
        failureToken,
        disposition,
        retryDelayMs,
        phase,
        ...failureFields,
      },
      input.deadlineAtMs,
    ),
  );
  addBackendRuntimeBreadcrumb({
    action: "media_blob_cleanup_failure_recorded",
    scope: input.observationScope,
    details: {
      phase,
      disposition,
      status: decision.status,
      sha256: claim.sha256,
      cleanupGeneration: claim.cleanupGeneration,
      failureCount: decision.failureCount,
      nextAttemptAt: decision.nextAttemptAt,
      errorCode: failureFields.errorCode,
      errorClass: failureFields.errorClass,
    },
  });
  if (decision.status === "completed") {
    return {
      result: toResult(claim, "already_completed"),
      deferredErrors: noDeferredErrors,
    };
  }
  if (decision.status === "retry_scheduled") {
    return {
      result: toResult(claim, "retry_scheduled"),
      deferredErrors: Object.freeze([normalizeDeferredError(error)]),
    };
  }
  if (decision.status === "reconciliation_required") {
    return {
      result: toResult(claim, "reconciliation_required"),
      deferredErrors: Object.freeze([normalizeDeferredError(error)]),
    };
  }
  return {
    result: toResult(
      claim,
      deleteTransitionMayHaveCommitted ? "reconciliation_required" : "stale",
    ),
    deferredErrors: Object.freeze([normalizeDeferredError(error)]),
  };
}

async function persistCleanupFailureOrReport(
  claim: MediaBlobCleanupClaim,
  phase: MediaBlobCleanupFailurePhase,
  error: unknown,
  deleteTransitionMayHaveCommitted: boolean,
  input: MediaBlobCleanupBatchInput,
  dependencies: MediaBlobCleanupProcessorDependencies,
): Promise<ClaimProcessingResult> {
  const normalizedError = normalizeDeferredError(error);
  if (
    input.signal.aborted
    || dependencies.nowFn() >= input.deadlineAtMs
  ) {
    return {
      result: toResult(
        claim,
        deleteTransitionMayHaveCommitted
          ? "reconciliation_required"
          : "interrupted",
      ),
      deferredErrors: Object.freeze([
        normalizedError,
        new MediaBlobCleanupFailurePersistenceError(
          "Media-blob cleanup failure state could not be persisted because the invocation deadline or abort signal was exhausted.",
          normalizedError,
        ),
      ]),
    };
  }
  try {
    return await persistCleanupFailure(
      claim,
      phase,
      normalizedError,
      deleteTransitionMayHaveCommitted,
      input,
      dependencies,
    );
  } catch (persistenceError) {
    return {
      result: toResult(
        claim,
        deleteTransitionMayHaveCommitted
          ? "reconciliation_required"
          : "interrupted",
      ),
      deferredErrors: Object.freeze([
        normalizedError,
        new MediaBlobCleanupFailurePersistenceError(
          "Media-blob cleanup failed to persist its exact failure state.",
          persistenceError,
        ),
      ]),
    };
  }
}

async function processClaim(
  claim: MediaBlobCleanupClaim,
  input: MediaBlobCleanupBatchInput,
  dependencies: MediaBlobCleanupProcessorDependencies,
): Promise<ClaimProcessingResult> {
  if (claim.status === "blocked") {
    return {
      result: toResult(claim, "blocked"),
      deferredErrors: noDeferredErrors,
    };
  }
  if (claim.status === "stale") {
    return {
      result: toResult(claim, "stale"),
      deferredErrors: noDeferredErrors,
    };
  }
  if (claim.status === "completed") {
    return {
      result: toResult(claim, "already_completed"),
      deferredErrors: noDeferredErrors,
    };
  }
  if (claim.status === "retry_wait") {
    return {
      result: toResult(claim, "retry_scheduled"),
      deferredErrors: noDeferredErrors,
    };
  }
  if (claim.status === "reconciliation_required") {
    return {
      result: toResult(claim, "reconciliation_required"),
      deferredErrors: noDeferredErrors,
    };
  }

  let leaseExpiresAt = claim.leaseExpiresAt;
  let leaseExpiresAtMs = Date.parse(leaseExpiresAt);
  if (!Number.isFinite(leaseExpiresAtMs)) {
    throw new TypeError("Cleanup claim has an invalid lease expiry.");
  }
  const storageDeadlineAtMs = Math.min(
    input.deadlineAtMs,
    leaseExpiresAtMs - cleanupLeaseFinalizationReserveMs,
  );
  if (
    input.signal.aborted
    || dependencies.nowFn() + minimumNewCandidateBudgetMs
      >= storageDeadlineAtMs
  ) {
    return {
      result: toResult(claim, "interrupted"),
      deferredErrors: noDeferredErrors,
    };
  }
  const deadlineSignal = createRenewableDeadlineSignal(
    input.signal,
    input.deadlineAtMs,
    leaseExpiresAtMs,
    dependencies.nowFn(),
  );
  const storageInput: MediaBlobCleanupBatchInput = {
    ...input,
    deadlineAtMs: storageDeadlineAtMs,
    signal: deadlineSignal.signal,
  };
  let currentPhase: MediaBlobCleanupFailurePhase = "authorize";
  let deleteTransitionMayHaveCommitted = false;

  const renewLease = async (
    nextPhase: MediaBlobCleanupLeaseRenewalPhase,
  ): Promise<void> => {
    deadlineSignal.signal.throwIfAborted();
    currentPhase = "renew";
    const renewalDeadlineAtMs = Math.min(
      input.deadlineAtMs,
      leaseExpiresAtMs,
    );
    const renewalToken = dependencies.createTokenFn();
    if (nextPhase === "delete_object") {
      deleteTransitionMayHaveCommitted = true;
    }
    const renewal = await runDatabaseOperation(
      "renew",
      claim,
      { ...input, deadlineAtMs: renewalDeadlineAtMs },
      dependencies,
      () => dependencies.renewFn(
        claim,
        renewalToken,
        nextPhase,
        leaseExpiresAt,
        input.leaseDurationMs,
        renewalDeadlineAtMs,
      ),
    );
    if (renewal.status !== "renewed") {
      if (nextPhase === "delete_object") {
        deleteTransitionMayHaveCommitted = false;
      }
      throw new MediaBlobCleanupLeaseLostError(renewal.status);
    }
    if (renewal.leaseExpiresAt === null) {
      throw new TypeError("Cleanup renewal did not return a lease expiry.");
    }
    const renewedLeaseExpiresAtMs = Date.parse(renewal.leaseExpiresAt);
    if (!Number.isFinite(renewedLeaseExpiresAtMs)) {
      throw new TypeError("Cleanup renewal has an invalid lease expiry.");
    }
    leaseExpiresAt = renewal.leaseExpiresAt;
    leaseExpiresAtMs = renewedLeaseExpiresAtMs;
    deadlineSignal.refresh(leaseExpiresAtMs, dependencies.nowFn());
    currentPhase = nextPhase;
  };

  try {
    currentPhase = "authorize";
    const authorization = await runDatabaseOperation(
      "authorize",
      claim,
      storageInput,
      dependencies,
      () => dependencies.authorizeFn(claim, storageDeadlineAtMs),
    );
    if (authorization.status === "blocked") {
      return {
        result: toResult(claim, "blocked"),
        deferredErrors: noDeferredErrors,
      };
    }
    if (authorization.status === "stale") {
      return {
        result: toResult(claim, "stale"),
        deferredErrors: noDeferredErrors,
      };
    }
    if (authorization.status === "completed") {
      return {
        result: toResult(claim, "already_completed"),
        deferredErrors: noDeferredErrors,
      };
    }
    if (authorization.storageKey !== claim.storageKey) {
      throw new TypeError(
        "Cleanup authorization did not return the exact claimed permanent storage key.",
      );
    }
    const deleteOutcome: PermanentMediaBlobDeleteOutcome =
      await dependencies.deleteFn({
        sha256: claim.sha256,
        storageKey: authorization.storageKey,
        cleanupGeneration: claim.cleanupGeneration,
        renewLease: async (operation) => renewLease(operation),
        signal: deadlineSignal.signal,
        observationScope: input.observationScope,
      });
    await renewLease("complete");
    const completionDeadlineAtMs = Math.min(input.deadlineAtMs, leaseExpiresAtMs);
    const completion = await runDatabaseOperation(
      "complete",
      claim,
      { ...input, deadlineAtMs: completionDeadlineAtMs },
      dependencies,
      () => dependencies.completeFn(claim, completionDeadlineAtMs),
    );
    if (
      completion !== "completed"
      && deleteTransitionMayHaveCommitted
    ) {
      return {
        result: toResult(claim, "reconciliation_required"),
        deferredErrors: Object.freeze([
          new MediaBlobCleanupReconciliationRequiredError(
            "Media-blob cleanup completion was rejected after the delete transition committed.",
            new MediaBlobCleanupLeaseLostError("stale"),
          ),
        ]),
      };
    }
    return {
      result: completion === "completed"
        ? toResult(claim, deleteOutcome)
        : toResult(claim, "stale"),
      deferredErrors: noDeferredErrors,
    };
  } catch (error) {
    if (error instanceof MediaBlobCleanupLeaseLostError) {
      if (
        deleteTransitionMayHaveCommitted
        && error.status !== "completed"
      ) {
        return {
          result: toResult(claim, "reconciliation_required"),
          deferredErrors: Object.freeze([
            new MediaBlobCleanupReconciliationRequiredError(
              "Media-blob cleanup lost its exact lease after the delete transition may have committed.",
              error,
            ),
          ]),
        };
      }
      return {
        result: toResult(
          claim,
          error.status === "completed" ? "already_completed" : "stale",
        ),
        deferredErrors: noDeferredErrors,
      };
    }
    if (isMediaBlobCleanupStorageError(error)) {
      return persistCleanupFailureOrReport(
        claim,
        resolveFailurePhase(error, currentPhase),
        error,
        deleteTransitionMayHaveCommitted,
        input,
        dependencies,
      );
    }
    if (
      isInterrupted(error, input.signal)
      || isInterrupted(error, deadlineSignal.signal)
    ) {
      if (deleteTransitionMayHaveCommitted) {
        const reconciliationError =
          new MediaBlobCleanupReconciliationRequiredError(
            "Media-blob cleanup was interrupted after the delete transition may have committed.",
            error,
          );
        return persistCleanupFailureOrReport(
          claim,
          currentPhase,
          reconciliationError,
          true,
          input,
          dependencies,
        );
      }
      return {
        result: toResult(claim, "interrupted"),
        deferredErrors: noDeferredErrors,
      };
    }
    return persistCleanupFailureOrReport(
      claim,
      resolveFailurePhase(error, currentPhase),
      error,
      deleteTransitionMayHaveCommitted,
      input,
      dependencies,
    );
  } finally {
    deadlineSignal.dispose();
  }
}

export async function runMediaBlobCleanupBatchWithDependencies(
  input: MediaBlobCleanupBatchInput,
  dependencies: MediaBlobCleanupProcessorDependencies,
): Promise<MediaBlobCleanupBatchResult> {
  if (
    !Number.isSafeInteger(input.maximumCandidates)
    || input.maximumCandidates < 1
    || input.maximumCandidates > 100
  ) {
    throw new RangeError("maximumCandidates must be between 1 and 100.");
  }
  const results: Array<MediaBlobCleanupResult> = [];
  let interruptedBeforeClaim = false;
  const deferredErrors: Array<Error> = [];
  while (results.length < input.maximumCandidates) {
    if (
      input.signal.aborted
      || dependencies.nowFn() + minimumNewCandidateBudgetMs
        >= input.deadlineAtMs
    ) {
      interruptedBeforeClaim = true;
      break;
    }
    let claim: MediaBlobCleanupClaim | null;
    try {
      const cleanupToken = dependencies.createTokenFn();
      claim = await runDatabaseOperation(
        "claim",
        null,
        input,
        dependencies,
        () => dependencies.claimFn(
          cleanupToken,
          input.leaseDurationMs,
          input.deadlineAtMs,
        ),
      );
    } catch (error) {
      if (isInterrupted(error, input.signal)) {
        interruptedBeforeClaim = true;
        break;
      }
      throw new MediaBlobCleanupBatchError(
        toBatchResult(results, false),
        [...deferredErrors, normalizeDeferredError(error)],
      );
    }
    if (claim === null) break;
    let processed: ClaimProcessingResult;
    try {
      processed = await processClaim(claim, input, dependencies);
    } catch (error) {
      throw new MediaBlobCleanupBatchError(
        toBatchResult(
          [...results, toResult(claim, "interrupted")],
          false,
        ),
        [...deferredErrors, normalizeDeferredError(error)],
      );
    }
    results.push(processed.result);
    deferredErrors.push(...processed.deferredErrors);
    if (processed.result.outcome === "interrupted") break;
  }
  const result = toBatchResult(results, interruptedBeforeClaim);
  if (deferredErrors.length > 0) {
    throw new MediaBlobCleanupBatchError(result, deferredErrors);
  }
  return result;
}

const defaultDependencies: MediaBlobCleanupProcessorDependencies = {
  claimFn: claimNextMediaBlobCleanup,
  authorizeFn: authorizeMediaBlobCleanup,
  renewFn: renewMediaBlobCleanupLease,
  deleteFn: deletePermanentMediaBlob,
  completeFn: completeMediaBlobCleanup,
  recordFailureFn: recordMediaBlobCleanupFailure,
  createTokenFn: randomUUID,
  nowFn: Date.now,
  waitFn: async (delayMs, signal) => {
    await wait(delayMs, undefined, { signal });
  },
};

export async function runMediaBlobCleanupBatch(
  input: MediaBlobCleanupBatchInput,
): Promise<MediaBlobCleanupBatchResult> {
  return runMediaBlobCleanupBatchWithDependencies(input, defaultDependencies);
}

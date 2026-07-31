import {
  appendManagedImageToCardSideInExecutor,
  isManagedImageSettlementConflictError,
  managedImageMarkdownComplexitySettlementConflictCode,
  markPendingManagedImageFailedOnCardSideInExecutor,
  markPendingManagedImageReadyOnCardSideInExecutor,
  type ManagedImageSettlementConflictError,
} from "../../../cards";
import { DatabaseDeadlineExceededError, type DatabaseExecutor } from "../../../database";
import { unsafeTransactionWithDeadline } from "../../../database/unsafe";
import {
  DatabaseCommitOutcomeUnknownError, isTransientDatabaseError, TransientDatabaseHttpError,
} from "../../../database/transient";
import {
  findMediaAssetRowForUpdateInExecutor, mapMediaAssetRow,
  upsertMediaAssetSnapshotWithBlobNormalizationInExecutor,
} from "../../../mediaAssets/persistence";
import {
  finalizeMediaBlobWriterInExecutor,
} from "../../../mediaAssets/blobLifecycle";
import {
  GeneratedMediaPromotionStorageTerminalError, GeneratedMediaPromotionStorageTransientError,
  promoteGeneratedMediaObject,
} from "../../../mediaAssets/storage";
import type { MediaAsset } from "../../../mediaAssets/types";
import type { BackendObservationScope } from "../../../observability/sentry";
import { HttpError } from "../../../shared/errors";
import { lockWorkspaceSyncMetadataForHotChangesInExecutor } from "../../../sync/replication/changes";
import {
  applyGeneratedMediaPromotionJobScopeWithExecutor, claimGeneratedMediaPromotionJobs,
  failGeneratedMediaPromotionJobAfterAccessRevocation,
  failGeneratedMediaPromotionJobWithBlobWriterInExecutor,
  failGeneratedMediaPromotionJobWithExecutor, GeneratedMediaPromotionJobAccessRevokedError,
  GeneratedMediaPromotionJobLeaseLostError,
  isGeneratedMediaPromotionOperationAppliedWithExecutor,
  loadGeneratedMediaPromotionProtocolVersionInExecutor,
  markGeneratedMediaBlobWriterAmbiguous,
  markGeneratedMediaPromotionJobAppliedWithExecutor, rescheduleGeneratedMediaPromotionJobWithExecutor,
  reserveGeneratedMediaBlobWriter,
  type ClaimedGeneratedMediaPromotionJob, type GeneratedMediaBlobWriterReservation,
  type SafeGeneratedMediaPromotionJobError,
} from "./jobs";
const maximumJobAttempts = 5;
const retryBaseDelayMs = 30_000;
const retryMaximumDelayMs = 15 * 60_000;
const minimumNewJobBudgetMs = 1_000;

function toSafeManagedImageSettlementConflict(
  error: ManagedImageSettlementConflictError,
): SafeGeneratedMediaPromotionJobError {
  return {
    code: error.conflictCode,
    message: error.message,
  };
}

export type GeneratedMediaPromotionJobOutcome =
  | "applied"
  | "ambiguous"
  | "failed"
  | "interrupted"
  | "lease_lost"
  | "rescheduled";
export type GeneratedMediaPromotionJobResult = Readonly<{
  jobId: string; workspaceId: string; outcome: GeneratedMediaPromotionJobOutcome;
  retryCount: number; errorCode: string | null;
}>;
export type GeneratedMediaPromotionBatchInput = Readonly<{
  leaseOwner: string; leaseDurationMs: number; maximumJobs: number; deadlineAtMs: number;
  observationScope: BackendObservationScope; signal: AbortSignal;
}>;
export type GeneratedMediaPromotionBatchResult = Readonly<{
  claimed: number; applied: number; ambiguous: number; failed: number;
  interrupted: number; leaseLost: number; rescheduled: number;
  results: ReadonlyArray<GeneratedMediaPromotionJobResult>;
}>;
export type GeneratedMediaPromotionProcessorDependencies = Readonly<{
  claimJobsFn: typeof claimGeneratedMediaPromotionJobs; promoteObjectFn: typeof promoteGeneratedMediaObject;
  reserveWriterFn: typeof reserveGeneratedMediaBlobWriter;
  applyJobFn: typeof applyGeneratedMediaPromotionJob;
  rescheduleJobFn: typeof rescheduleGeneratedMediaPromotionJob;
  failJobFn: typeof failGeneratedMediaPromotionJob;
  failAfterAccessRevocationFn: typeof failGeneratedMediaPromotionJobAfterAccessRevocation;
  markWriterAmbiguousFn: typeof markGeneratedMediaBlobWriterAmbiguous;
  nowFn: () => number;
}>;
function assertPersistedMediaIdentity(
  mediaAsset: MediaAsset,
  job: ClaimedGeneratedMediaPromotionJob,
): void {
  if (
    mediaAsset.mediaAssetId !== job.mediaAssetId
    || mediaAsset.workspaceId !== job.workspaceId
    || mediaAsset.mimeType !== job.mimeType
    || mediaAsset.sizeBytes !== job.sizeBytes
    || mediaAsset.sha256 !== job.sha256
    || mediaAsset.sourceUrl !== null
    || mediaAsset.deletedAt !== null
    || mediaAsset.lastModifiedByReplicaId !== job.replicaId
    || mediaAsset.lastOperationId !== job.operationId
  ) {
    throw new HttpError(
      409,
      "The generated media asset identity conflicts with the durable promotion job.",
      "GENERATED_MEDIA_ASSET_IMMUTABLE_CONFLICT",
    );
  }
}
async function applyGeneratedMediaPromotionJobInExecutor(
  executor: DatabaseExecutor,
  reservation: GeneratedMediaBlobWriterReservation,
): Promise<ManagedImageSettlementConflictError | null> {
  const job = reservation.writer;
  if (await isGeneratedMediaPromotionOperationAppliedWithExecutor(
    executor,
    job.jobId,
    job.operationId,
  )) {
    return null;
  }
  await applyGeneratedMediaPromotionJobScopeWithExecutor(executor, job);
  const protocolVersion = await loadGeneratedMediaPromotionProtocolVersionInExecutor(
    executor,
    job.workspaceId,
    job.jobId,
  );
  await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, job.workspaceId);
  const cardMutationInput = {
    cardId: job.cardId, targetSide: job.targetSide,
    mediaAssetId: job.mediaAssetId, altText: job.altText,
  };
  const cardMutationMetadata = {
    clientUpdatedAt: job.createdAt, lastModifiedByReplicaId: job.replicaId,
    lastOperationId: job.operationId,
  };
  const registerMediaAsset = async (lockedExecutor: DatabaseExecutor): Promise<void> => {
    const existingRow = await findMediaAssetRowForUpdateInExecutor(
      lockedExecutor,
      job.workspaceId,
      job.mediaAssetId,
    );
    if (existingRow !== null) {
      assertPersistedMediaIdentity(mapMediaAssetRow(existingRow), job);
    }
    const mediaResult = await upsertMediaAssetSnapshotWithBlobNormalizationInExecutor(
      lockedExecutor,
      job.workspaceId,
      {
        mediaAssetId: job.mediaAssetId, mimeType: job.mimeType,
        sizeBytes: job.sizeBytes, sha256: job.sha256,
        sourceUrl: null, createdAt: job.createdAt, deletedAt: null,
      },
      {
        clientUpdatedAt: job.createdAt, lastModifiedByReplicaId: job.replicaId,
        lastOperationId: job.operationId,
      },
      reservation.normalizationVersion,
    );
    assertPersistedMediaIdentity(mediaResult.mediaAsset, job);
    await finalizeMediaBlobWriterInExecutor(lockedExecutor, {
      reservationToken: reservation.reservationToken,
      sha256: job.sha256,
      workspaceId: job.workspaceId,
      mediaAssetId: job.mediaAssetId,
    });
  };
  if (protocolVersion === 2) {
    try {
      await markPendingManagedImageReadyOnCardSideInExecutor(
        executor,
        job.workspaceId,
        cardMutationInput,
        cardMutationMetadata,
        registerMediaAsset,
      );
    } catch (error) {
      if (!isManagedImageSettlementConflictError(error)) throw error;
      await failGeneratedMediaPromotionJobWithBlobWriterInExecutor(executor, {
        ...reservation.writer,
        error: toSafeManagedImageSettlementConflict(error),
      });
      return error;
    }
  }
  if (protocolVersion === 1) {
    await registerMediaAsset(executor);
    await appendManagedImageToCardSideInExecutor(
      executor,
      job.workspaceId,
      cardMutationInput,
      cardMutationMetadata,
    );
  }
  await markGeneratedMediaPromotionJobAppliedWithExecutor(executor, job);
  return null;
}
export async function applyGeneratedMediaPromotionJob(
  reservation: GeneratedMediaBlobWriterReservation,
  deadlineAtMs: number,
): Promise<void> {
  const settlementConflict = await unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => (
    applyGeneratedMediaPromotionJobInExecutor(executor, reservation)
  ));
  if (settlementConflict !== null) throw settlementConflict;
}
export async function rescheduleGeneratedMediaPromotionJob(
  job: ClaimedGeneratedMediaPromotionJob,
  deadlineAtMs: number,
  nextAttemptAt: Date,
  error: SafeGeneratedMediaPromotionJobError,
): Promise<void> {
  return unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => {
    await rescheduleGeneratedMediaPromotionJobWithExecutor(executor, { ...job, nextAttemptAt, error });
  });
}
export async function failGeneratedMediaPromotionJob(
  job: ClaimedGeneratedMediaPromotionJob,
  deadlineAtMs: number,
  error: SafeGeneratedMediaPromotionJobError,
  reservation: GeneratedMediaBlobWriterReservation | null,
): Promise<void> {
  const settlementConflict = await unsafeTransactionWithDeadline(
    deadlineAtMs,
    async (executor): Promise<ManagedImageSettlementConflictError | null> => {
      await applyGeneratedMediaPromotionJobScopeWithExecutor(executor, job);
      const protocolVersion = await loadGeneratedMediaPromotionProtocolVersionInExecutor(
        executor,
        job.workspaceId,
        job.jobId,
      );
      let terminalErrorValue = error;
      let cardSettlementConflict: ManagedImageSettlementConflictError | null = null;
      if (protocolVersion === 2) {
        try {
          await markPendingManagedImageFailedOnCardSideInExecutor(
            executor,
            job.workspaceId,
            {
              cardId: job.cardId,
              targetSide: job.targetSide,
              mediaAssetId: job.mediaAssetId,
              altText: job.altText,
            },
            {
              clientUpdatedAt: job.createdAt,
              lastModifiedByReplicaId: job.replicaId,
              lastOperationId: job.operationId,
            },
          );
        } catch (transitionError) {
          if (!isManagedImageSettlementConflictError(transitionError)) {
            throw transitionError;
          }
          cardSettlementConflict = transitionError;
          terminalErrorValue = toSafeManagedImageSettlementConflict(transitionError);
        }
      }
      if (reservation === null) {
        await failGeneratedMediaPromotionJobWithExecutor(
          executor,
          { ...job, error: terminalErrorValue },
        );
        return cardSettlementConflict;
      }
      await failGeneratedMediaPromotionJobWithBlobWriterInExecutor(executor, {
        ...reservation.writer,
        error: terminalErrorValue,
      });
      return cardSettlementConflict;
    },
  );
  if (settlementConflict !== null) throw settlementConflict;
}
function terminalError(error: unknown): SafeGeneratedMediaPromotionJobError | null {
  if (error instanceof GeneratedMediaPromotionStorageTerminalError) {
    return { code: error.code, message: error.safeMessage };
  }
  if (error instanceof GeneratedMediaPromotionJobAccessRevokedError) {
    return {
      code: error.code,
      message: "Workspace access was revoked before generated-media promotion completed.",
    };
  }
  if (error instanceof HttpError) {
    return {
      code: "IMMUTABLE_CONFLICT",
      message: "The durable generated-media job conflicts with current card or media state.",
    };
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return {
      code: "INVALID_JOB_PAYLOAD",
      message: "The durable generated-media job payload is invalid.",
    };
  }
  return null;
}
function isTransientFailure(error: unknown): boolean {
  return error instanceof GeneratedMediaPromotionStorageTransientError
    || error instanceof TransientDatabaseHttpError
    || (error instanceof HttpError && error.code === "MEDIA_BLOB_LIFECYCLE_BUSY")
    || isTransientDatabaseError(error);
}
function retryError(error: unknown): SafeGeneratedMediaPromotionJobError {
  return error instanceof GeneratedMediaPromotionStorageTransientError
    ? { code: error.code, message: error.safeMessage }
    : { code: "DATABASE_TRANSIENT", message: "PostgreSQL is temporarily unavailable." };
}
function calculateRetryAt(job: ClaimedGeneratedMediaPromotionJob, nowMs: number): Date {
  const delayMs = Math.min(retryBaseDelayMs * (2 ** job.retryCount), retryMaximumDelayMs);
  return new Date(nowMs + delayMs);
}
function result(
  job: ClaimedGeneratedMediaPromotionJob,
  outcome: GeneratedMediaPromotionJobOutcome,
  errorCode: string | null,
): GeneratedMediaPromotionJobResult {
  return {
    jobId: job.jobId, workspaceId: job.workspaceId, outcome,
    retryCount: job.retryCount, errorCode,
  };
}
async function settleKnownFailure(
  job: ClaimedGeneratedMediaPromotionJob,
  input: GeneratedMediaPromotionBatchInput,
  dependencies: GeneratedMediaPromotionProcessorDependencies,
  error: SafeGeneratedMediaPromotionJobError,
  retryable: boolean,
  reservation: GeneratedMediaBlobWriterReservation | null,
): Promise<GeneratedMediaPromotionJobResult> {
  try {
    if (retryable && job.retryCount < maximumJobAttempts - 1) {
      await dependencies.rescheduleJobFn(
        job, input.deadlineAtMs, calculateRetryAt(job, dependencies.nowFn()), error,
      );
      return result(job, "rescheduled", error.code);
    }
    const terminalErrorValue = retryable
      ? {
        code: "RETRY_EXHAUSTED",
        message: "Generated-media promotion exhausted its bounded transient retry budget.",
      }
      : error;
    await dependencies.failJobFn(
      job,
      input.deadlineAtMs,
      terminalErrorValue,
      reservation,
    );
    return result(job, "failed", terminalErrorValue.code);
  } catch (transitionError) {
    if (transitionError instanceof GeneratedMediaPromotionJobLeaseLostError) {
      return result(job, "lease_lost", null);
    }
    if (isManagedImageSettlementConflictError(transitionError)) {
      return result(job, "failed", transitionError.conflictCode);
    }
    if (transitionError instanceof DatabaseCommitOutcomeUnknownError) {
      return result(job, "ambiguous", "DATABASE_COMMIT_OUTCOME_UNKNOWN");
    }
    if (transitionError instanceof GeneratedMediaPromotionJobAccessRevokedError) {
      return settleAccessRevocation(job, input, dependencies);
    }
    if (
      input.signal.aborted
      || transitionError instanceof DatabaseDeadlineExceededError
    ) {
      return result(job, "interrupted", "WORKER_DEADLINE");
    }
    throw transitionError;
  }
}

async function settleAccessRevocation(
  job: ClaimedGeneratedMediaPromotionJob,
  input: GeneratedMediaPromotionBatchInput,
  dependencies: GeneratedMediaPromotionProcessorDependencies,
): Promise<GeneratedMediaPromotionJobResult> {
  try {
    const outcome = await dependencies.failAfterAccessRevocationFn(
      job,
      input.deadlineAtMs,
    );
    if (outcome === "applied") return result(job, "applied", null);
    if (outcome === "failed") {
      return result(job, "failed", "WORKSPACE_ACCESS_REVOKED");
    }
    if (outcome === "failed_markdown_complexity") {
      return result(
        job,
        "failed",
        managedImageMarkdownComplexitySettlementConflictCode,
      );
    }
    return result(job, "interrupted", "WORKSPACE_ACCESS_RECHECK_REQUIRED");
  } catch (error) {
    if (error instanceof GeneratedMediaPromotionJobLeaseLostError) {
      return result(job, "lease_lost", null);
    }
    if (error instanceof DatabaseCommitOutcomeUnknownError) {
      return result(job, "ambiguous", "DATABASE_COMMIT_OUTCOME_UNKNOWN");
    }
    if (input.signal.aborted || error instanceof DatabaseDeadlineExceededError) {
      return result(job, "interrupted", "WORKER_DEADLINE");
    }
    throw error;
  }
}

export async function processClaimedGeneratedMediaPromotionJobWithDependencies(
  job: ClaimedGeneratedMediaPromotionJob,
  input: GeneratedMediaPromotionBatchInput,
  dependencies: GeneratedMediaPromotionProcessorDependencies,
): Promise<GeneratedMediaPromotionJobResult> {
  let reservation: GeneratedMediaBlobWriterReservation | null = null;
  try {
    input.signal.throwIfAborted();
    reservation = await dependencies.reserveWriterFn(job, input.deadlineAtMs);
    if (reservation.state === "finalized" || reservation.state === "ambiguous") {
      await dependencies.applyJobFn(reservation, input.deadlineAtMs);
      return result(job, "applied", null);
    }
    const writer = reservation.writer;
    await dependencies.promoteObjectFn({
      writer,
      storageCapability: reservation.storageCapability,
      workspaceId: writer.workspaceId, mediaAssetId: writer.mediaAssetId,
      operationId: writer.operationId, stagingStorageKey: writer.stagingStorageKey,
      blobStorageKey: writer.blobStorageKey, mimeType: writer.mimeType,
      sizeBytes: writer.sizeBytes, sha256: writer.sha256,
      observationScope: input.observationScope, signal: input.signal,
    });
    input.signal.throwIfAborted();
    await dependencies.applyJobFn(reservation, input.deadlineAtMs);
    return result(job, "applied", null);
  } catch (error) {
    if (error instanceof GeneratedMediaPromotionJobLeaseLostError) {
      return result(job, "lease_lost", null);
    }
    if (isManagedImageSettlementConflictError(error)) {
      return result(job, "failed", error.conflictCode);
    }
    if (error instanceof GeneratedMediaPromotionJobAccessRevokedError) {
      return settleAccessRevocation(
        reservation?.writer ?? job,
        input,
        dependencies,
      );
    }
    if (error instanceof DatabaseCommitOutcomeUnknownError) {
      if (reservation === null) {
        return result(job, "ambiguous", "DATABASE_COMMIT_OUTCOME_UNKNOWN");
      }
      let ambiguityTransitionError: unknown = null;
      try {
        await dependencies.markWriterAmbiguousFn(
          reservation,
          input.deadlineAtMs,
        );
      } catch (transitionError) {
        ambiguityTransitionError = transitionError;
      }
      try {
        await dependencies.applyJobFn(reservation, input.deadlineAtMs);
        return result(job, "applied", null);
      } catch (operationReplayError) {
        if (operationReplayError instanceof GeneratedMediaPromotionJobLeaseLostError) {
          return result(job, "lease_lost", null);
        }
        if (isManagedImageSettlementConflictError(operationReplayError)) {
          return result(job, "failed", operationReplayError.conflictCode);
        }
        if (operationReplayError instanceof GeneratedMediaPromotionJobAccessRevokedError) {
          return settleAccessRevocation(reservation.writer, input, dependencies);
        }
        if (
          operationReplayError instanceof DatabaseCommitOutcomeUnknownError
          || operationReplayError instanceof DatabaseDeadlineExceededError
          || isTransientFailure(operationReplayError)
        ) {
          return result(job, "ambiguous", "DATABASE_COMMIT_OUTCOME_UNKNOWN");
        }
        const knownTerminalError = terminalError(operationReplayError);
        if (knownTerminalError !== null) {
          return settleKnownFailure(
            job,
            input,
            dependencies,
            knownTerminalError,
            false,
            reservation,
          );
        }
        if (ambiguityTransitionError !== null) {
          throw new AggregateError(
            [ambiguityTransitionError, operationReplayError],
            "Generated-media promotion ambiguity transition and deterministic operation replay both failed.",
          );
        }
        throw operationReplayError;
      }
    }
    if (input.signal.aborted || error instanceof DatabaseDeadlineExceededError) {
      return result(job, "interrupted", "WORKER_DEADLINE");
    }
    if (isTransientFailure(error)) {
      return settleKnownFailure(
        job,
        input,
        dependencies,
        retryError(error),
        true,
        reservation,
      );
    }
    const knownTerminalError = terminalError(error);
    if (knownTerminalError !== null) {
      return settleKnownFailure(
        job,
        input,
        dependencies,
        knownTerminalError,
        false,
        reservation,
      );
    }
    throw error;
  }
}
function countOutcome(
  results: ReadonlyArray<GeneratedMediaPromotionJobResult>,
  outcome: GeneratedMediaPromotionJobOutcome,
): number {
  return results.filter((item) => item.outcome === outcome).length;
}
export async function runGeneratedMediaPromotionBatchWithDependencies(
  input: GeneratedMediaPromotionBatchInput,
  dependencies: GeneratedMediaPromotionProcessorDependencies,
): Promise<GeneratedMediaPromotionBatchResult> {
  const results: Array<GeneratedMediaPromotionJobResult> = [];
  while (
    results.length < input.maximumJobs
    && !input.signal.aborted
    && dependencies.nowFn() + minimumNewJobBudgetMs < input.deadlineAtMs
  ) {
    const claimed = await dependencies.claimJobsFn({
      leaseOwner: input.leaseOwner,
      leaseDurationMs: input.leaseDurationMs,
      limit: 1,
      deadlineAtMs: input.deadlineAtMs,
    });
    const job = claimed[0];
    if (job === undefined) break;
    const jobResult = await processClaimedGeneratedMediaPromotionJobWithDependencies(
      job, input, dependencies,
    );
    results.push(jobResult);
    if (jobResult.outcome === "interrupted") break;
  }
  return {
    claimed: results.length,
    applied: countOutcome(results, "applied"),
    ambiguous: countOutcome(results, "ambiguous"),
    failed: countOutcome(results, "failed"),
    interrupted: countOutcome(results, "interrupted"),
    leaseLost: countOutcome(results, "lease_lost"),
    rescheduled: countOutcome(results, "rescheduled"),
    results,
  };
}
const defaultDependencies: GeneratedMediaPromotionProcessorDependencies = {
  claimJobsFn: claimGeneratedMediaPromotionJobs,
  reserveWriterFn: reserveGeneratedMediaBlobWriter,
  promoteObjectFn: promoteGeneratedMediaObject,
  applyJobFn: applyGeneratedMediaPromotionJob,
  rescheduleJobFn: rescheduleGeneratedMediaPromotionJob,
  failJobFn: failGeneratedMediaPromotionJob,
  failAfterAccessRevocationFn: failGeneratedMediaPromotionJobAfterAccessRevocation,
  markWriterAmbiguousFn: markGeneratedMediaBlobWriterAmbiguous,
  nowFn: Date.now,
};
export async function runGeneratedMediaPromotionBatch(
  input: GeneratedMediaPromotionBatchInput,
): Promise<GeneratedMediaPromotionBatchResult> {
  return runGeneratedMediaPromotionBatchWithDependencies(input, defaultDependencies);
}

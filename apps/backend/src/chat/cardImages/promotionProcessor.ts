import { appendManagedImageToCardSideInExecutor } from "../../cards";
import { DatabaseDeadlineExceededError, type DatabaseExecutor } from "../../database";
import { unsafeTransactionWithDeadline } from "../../database/unsafe";
import {
  DatabaseCommitOutcomeUnknownError, isTransientDatabaseError, TransientDatabaseHttpError,
} from "../../database/transient";
import {
  findMediaAssetRowForUpdateInExecutor, mapMediaAssetRow,
  upsertMediaAssetSnapshotWithBlobNormalizationInExecutor,
} from "../../mediaAssets/persistence";
import {
  GeneratedMediaPromotionStorageTerminalError, GeneratedMediaPromotionStorageTransientError,
  promoteGeneratedMediaObject,
} from "../../mediaAssets/storage";
import {
  imageJpegCardMediaBlobMimeType, imageJpegCardMediaBlobNormalizationVersion,
  passthroughMediaBlobNormalizationVersion, type MediaAsset,
} from "../../mediaAssets/types";
import type { BackendObservationScope } from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import { lockWorkspaceSyncMetadataForHotChangesInExecutor } from "../../sync/replication/changes";
import {
  applyGeneratedMediaPromotionJobScopeWithExecutor, claimGeneratedMediaPromotionJobs,
  failGeneratedMediaPromotionJobWithExecutor, GeneratedMediaPromotionJobAccessRevokedError,
  GeneratedMediaPromotionJobLeaseLostError,
  markGeneratedMediaPromotionJobAppliedWithExecutor, rescheduleGeneratedMediaPromotionJobWithExecutor,
  type ClaimedGeneratedMediaPromotionJob, type SafeGeneratedMediaPromotionJobError,
} from "./promotionJobs";
const maximumJobAttempts = 5;
const retryBaseDelayMs = 30_000;
const retryMaximumDelayMs = 15 * 60_000;
const minimumNewJobBudgetMs = 1_000;
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
  applyJobFn: typeof applyGeneratedMediaPromotionJob;
  rescheduleJobFn: typeof rescheduleGeneratedMediaPromotionJob;
  failJobFn: typeof failGeneratedMediaPromotionJob; nowFn: () => number;
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
  job: ClaimedGeneratedMediaPromotionJob,
): Promise<void> {
  await applyGeneratedMediaPromotionJobScopeWithExecutor(executor, job);
  await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, job.workspaceId);
  const existingRow = await findMediaAssetRowForUpdateInExecutor(
    executor, job.workspaceId, job.mediaAssetId,
  );
  if (existingRow !== null) {
    assertPersistedMediaIdentity(mapMediaAssetRow(existingRow), job);
  }
  const mediaResult = await upsertMediaAssetSnapshotWithBlobNormalizationInExecutor(
    executor,
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
    job.mimeType === imageJpegCardMediaBlobMimeType
      ? imageJpegCardMediaBlobNormalizationVersion
      : passthroughMediaBlobNormalizationVersion,
  );
  assertPersistedMediaIdentity(mediaResult.mediaAsset, job);
  await appendManagedImageToCardSideInExecutor(
    executor, job.workspaceId,
    {
      cardId: job.cardId, targetSide: job.targetSide,
      mediaAssetId: job.mediaAssetId, altText: job.altText,
    },
    {
      clientUpdatedAt: job.createdAt, lastModifiedByReplicaId: job.replicaId,
      lastOperationId: job.operationId,
    },
  );
  await markGeneratedMediaPromotionJobAppliedWithExecutor(executor, job);
}
export async function applyGeneratedMediaPromotionJob(
  job: ClaimedGeneratedMediaPromotionJob,
  deadlineAtMs: number,
): Promise<void> {
  return unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => (
    applyGeneratedMediaPromotionJobInExecutor(executor, job)
  ));
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
): Promise<void> {
  return unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => {
    await failGeneratedMediaPromotionJobWithExecutor(executor, { ...job, error });
  });
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
    await dependencies.failJobFn(job, input.deadlineAtMs, terminalErrorValue);
    return result(job, "failed", terminalErrorValue.code);
  } catch (transitionError) {
    if (transitionError instanceof GeneratedMediaPromotionJobLeaseLostError) {
      return result(job, "lease_lost", null);
    }
    if (transitionError instanceof DatabaseCommitOutcomeUnknownError) {
      return result(job, "ambiguous", "DATABASE_COMMIT_OUTCOME_UNKNOWN");
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
export async function processClaimedGeneratedMediaPromotionJobWithDependencies(
  job: ClaimedGeneratedMediaPromotionJob,
  input: GeneratedMediaPromotionBatchInput,
  dependencies: GeneratedMediaPromotionProcessorDependencies,
): Promise<GeneratedMediaPromotionJobResult> {
  try {
    input.signal.throwIfAborted();
    await dependencies.promoteObjectFn({
      workspaceId: job.workspaceId, mediaAssetId: job.mediaAssetId,
      operationId: job.operationId, stagingStorageKey: job.stagingStorageKey,
      blobStorageKey: job.blobStorageKey, mimeType: job.mimeType,
      sizeBytes: job.sizeBytes, sha256: job.sha256,
      observationScope: input.observationScope, signal: input.signal,
    });
    input.signal.throwIfAborted();
    await dependencies.applyJobFn(job, input.deadlineAtMs);
    return result(job, "applied", null);
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
    if (isTransientFailure(error)) {
      return settleKnownFailure(job, input, dependencies, retryError(error), true);
    }
    const knownTerminalError = terminalError(error);
    if (knownTerminalError !== null) {
      return settleKnownFailure(job, input, dependencies, knownTerminalError, false);
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
  promoteObjectFn: promoteGeneratedMediaObject,
  applyJobFn: applyGeneratedMediaPromotionJob,
  rescheduleJobFn: rescheduleGeneratedMediaPromotionJob,
  failJobFn: failGeneratedMediaPromotionJob,
  nowFn: Date.now,
};
export async function runGeneratedMediaPromotionBatch(
  input: GeneratedMediaPromotionBatchInput,
): Promise<GeneratedMediaPromotionBatchResult> {
  return runGeneratedMediaPromotionBatchWithDependencies(input, defaultDependencies);
}

import type { Handler } from "aws-lambda";
import {
  runGeneratedMediaPromotionBatch,
  type GeneratedMediaPromotionBatchResult,
} from "../../chat/cardImages/promotion/processor";
import {
  MediaBlobCleanupBatchError,
  runMediaBlobCleanupBatch,
  type MediaBlobCleanupBatchResult,
} from "../../mediaAssets/blobLifecycle/cleanup/processor";
import {
  addBackendBreadcrumb, captureBackendException, createBackendObservationScope,
  type BackendObservationScope,
  type GeneratedMediaPromotionBatchDetails,
  initializeBackendSentry, type MediaBlobCleanupBatchDetails,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../../observability/sentry";
initializeBackendSentry("generated-media-promotion");
export const generatedMediaPromotionMaximumJobs = 5;
export const generatedMediaPromotionLeaseDurationMs = 180_000;
export const mediaBlobCleanupMaximumCandidates = 5;
export const mediaBlobCleanupLeaseDurationMs = 60_000;
export const generatedMediaPromotionFinalizationReserveMs = 10_000;
export const mediaBlobCleanupMinimumStartBudgetMs = 1_000;
export const mediaBlobCleanupEnabledEnvironmentName =
  "MEDIA_BLOB_CLEANUP_ENABLED";
type GeneratedMediaPromotionResponse = Omit<GeneratedMediaPromotionBatchResult, "results"> & Readonly<{
  ok: true;
  cleanup: Omit<MediaBlobCleanupBatchResult, "results">;
}>;
function emptyDetails(): GeneratedMediaPromotionBatchDetails {
  return {
    maximumJobs: generatedMediaPromotionMaximumJobs,
    claimed: 0, applied: 0, ambiguous: 0, failed: 0,
    interrupted: 0, leaseLost: 0, rescheduled: 0, results: [],
  };
}
function toDetails(result: GeneratedMediaPromotionBatchResult): GeneratedMediaPromotionBatchDetails {
  return {
    maximumJobs: generatedMediaPromotionMaximumJobs,
    claimed: result.claimed, applied: result.applied, ambiguous: result.ambiguous,
    failed: result.failed, interrupted: result.interrupted,
    leaseLost: result.leaseLost, rescheduled: result.rescheduled,
    results: result.results.map((item) => ({
      jobId: item.jobId, outcome: item.outcome,
      retryCount: item.retryCount, errorCode: item.errorCode,
    })),
  };
}
function emptyCleanupResult(): MediaBlobCleanupBatchResult {
  return {
    claimed: 0, deleted: 0, notFound: 0, blocked: 0, stale: 0,
    alreadyCompleted: 0, retryScheduled: 0, reconciliationRequired: 0,
    interrupted: 0, results: [],
  };
}
function interruptedCleanupResult(): MediaBlobCleanupBatchResult {
  return {
    ...emptyCleanupResult(),
    interrupted: 1,
  };
}
export function readMediaBlobCleanupEnabled(
  value: string | undefined,
): boolean {
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    `${mediaBlobCleanupEnabledEnvironmentName} must be true or false when set.`,
  );
}
export function resolveMediaBlobCleanupFailureResult(
  error: unknown,
): MediaBlobCleanupBatchResult {
  return error instanceof MediaBlobCleanupBatchError
    ? error.result
    : emptyCleanupResult();
}
function toCleanupDetails(result: MediaBlobCleanupBatchResult): MediaBlobCleanupBatchDetails {
  return {
    maximumCandidates: mediaBlobCleanupMaximumCandidates,
    claimed: result.claimed, deleted: result.deleted, notFound: result.notFound,
    blocked: result.blocked, stale: result.stale,
    alreadyCompleted: result.alreadyCompleted,
    retryScheduled: result.retryScheduled,
    reconciliationRequired: result.reconciliationRequired,
    interrupted: result.interrupted,
    results: result.results.map((item) => ({
      sha256: item.sha256,
      cleanupGeneration: item.cleanupGeneration,
      outcome: item.outcome,
    })),
  };
}

export type GeneratedMediaScheduledWorkloadDependencies = Readonly<{
  runPromotionFn: typeof runGeneratedMediaPromotionBatch;
  runCleanupFn: typeof runMediaBlobCleanupBatch;
  nowFn: () => number;
}>;

export type GeneratedMediaScheduledWorkloadInput = Readonly<{
  leaseOwner: string;
  deadlineAtMs: number;
  cleanupEnabled: boolean;
  observationScope: BackendObservationScope;
  signal: AbortSignal;
}>;

export type GeneratedMediaScheduledWorkloadResult = Readonly<{
  promotion: GeneratedMediaPromotionBatchResult;
  cleanup: MediaBlobCleanupBatchResult;
}>;

export async function runGeneratedMediaScheduledWorkloads(
  input: GeneratedMediaScheduledWorkloadInput,
  dependencies: GeneratedMediaScheduledWorkloadDependencies,
): Promise<GeneratedMediaScheduledWorkloadResult> {
  let promotionResult: GeneratedMediaPromotionBatchResult | null = null;
  let promotionError: unknown = null;
  try {
    promotionResult = await dependencies.runPromotionFn({
      leaseOwner: input.leaseOwner,
      leaseDurationMs: generatedMediaPromotionLeaseDurationMs,
      maximumJobs: generatedMediaPromotionMaximumJobs,
      deadlineAtMs: input.deadlineAtMs,
      observationScope: input.observationScope,
      signal: input.signal,
    });
    addBackendBreadcrumb({
      action: "generated_media_promotion_batch_completed",
      scope: input.observationScope,
      details: toDetails(promotionResult),
    });
  } catch (error) {
    promotionError = error;
    captureBackendException({
      action: "generated_media_promotion_batch_failed",
      error: normalizeCaughtError(error),
      scope: input.observationScope,
      details: emptyDetails(),
    });
  }

  let cleanupResult = emptyCleanupResult();
  let cleanupError: unknown = null;
  if (
    !input.cleanupEnabled
    || input.signal.aborted
    || dependencies.nowFn() + mediaBlobCleanupMinimumStartBudgetMs
      >= input.deadlineAtMs
  ) {
    cleanupResult = interruptedCleanupResult();
    addBackendBreadcrumb({
      action: "media_blob_cleanup_batch_completed",
      scope: input.observationScope,
      details: toCleanupDetails(cleanupResult),
    });
  } else {
    try {
      cleanupResult = await dependencies.runCleanupFn({
        leaseDurationMs: mediaBlobCleanupLeaseDurationMs,
        maximumCandidates: mediaBlobCleanupMaximumCandidates,
        deadlineAtMs: input.deadlineAtMs,
        observationScope: input.observationScope,
        signal: input.signal,
      });
      addBackendBreadcrumb({
        action: "media_blob_cleanup_batch_completed",
        scope: input.observationScope,
        details: toCleanupDetails(cleanupResult),
      });
    } catch (error) {
      cleanupError = error;
      cleanupResult = resolveMediaBlobCleanupFailureResult(error);
      captureBackendException({
        action: "media_blob_cleanup_batch_failed",
        error: normalizeCaughtError(error),
        scope: input.observationScope,
        details: toCleanupDetails(cleanupResult),
      });
    }
  }

  if (promotionError !== null && cleanupError !== null) {
    throw new AggregateError(
      [promotionError, cleanupError],
      "Generated-media promotion and media-blob cleanup both failed.",
    );
  }
  if (promotionError !== null) throw promotionError;
  if (cleanupError !== null) throw cleanupError;
  if (promotionResult === null) {
    throw new Error(
      "Generated-media promotion did not return a result or a failure.",
    );
  }
  return {
    promotion: promotionResult,
    cleanup: cleanupResult,
  };
}

const scheduledWorkloadDependencies: GeneratedMediaScheduledWorkloadDependencies = {
  runPromotionFn: runGeneratedMediaPromotionBatch,
  runCleanupFn: runMediaBlobCleanupBatch,
  nowFn: Date.now,
};

const generatedMediaPromotionHandler: Handler<unknown, GeneratedMediaPromotionResponse> =
async (_event, context) => {
  const observationScope = createBackendObservationScope(
    "generated-media-promotion", context.awsRequestId ?? null,
    null, null, null, null, null, null, null, null, null,
  );
  const deadlineAtMs = Date.now()
    + Math.max(0, context.getRemainingTimeInMillis() - generatedMediaPromotionFinalizationReserveMs);
  const abortController = new AbortController();
  const deadlineTimer = setTimeout(
    () => abortController.abort(new Error("Generated-media promotion worker deadline reached.")),
    Math.max(0, deadlineAtMs - Date.now()),
  );
  try {
    const workloadResult = await runGeneratedMediaScheduledWorkloads(
      {
        leaseOwner: `generated-media-promotion:${context.awsRequestId}`,
        deadlineAtMs,
        cleanupEnabled: readMediaBlobCleanupEnabled(
          process.env[mediaBlobCleanupEnabledEnvironmentName],
        ),
        observationScope,
        signal: abortController.signal,
      },
      scheduledWorkloadDependencies,
    );
    const result = workloadResult.promotion;
    const cleanupResult = workloadResult.cleanup;
    return {
      ok: true,
      claimed: result.claimed, applied: result.applied, ambiguous: result.ambiguous,
      failed: result.failed, interrupted: result.interrupted,
      leaseLost: result.leaseLost, rescheduled: result.rescheduled,
      cleanup: {
        claimed: cleanupResult.claimed, deleted: cleanupResult.deleted,
        notFound: cleanupResult.notFound, blocked: cleanupResult.blocked,
        stale: cleanupResult.stale,
        alreadyCompleted: cleanupResult.alreadyCompleted,
        retryScheduled: cleanupResult.retryScheduled,
        reconciliationRequired: cleanupResult.reconciliationRequired,
        interrupted: cleanupResult.interrupted,
      },
    };
  } finally {
    clearTimeout(deadlineTimer);
  }
};
export const handler = wrapBackendHandler(generatedMediaPromotionHandler);

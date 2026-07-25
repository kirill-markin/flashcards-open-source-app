import type { Handler } from "aws-lambda";
import {
  runGeneratedMediaPromotionBatch,
  type GeneratedMediaPromotionBatchResult,
} from "../../chat/cardImages/promotionProcessor";
import {
  addBackendBreadcrumb, captureBackendException, createBackendObservationScope,
  initializeBackendSentry, normalizeCaughtError, type GeneratedMediaPromotionBatchDetails,
  wrapBackendHandler,
} from "../../observability/sentry";
initializeBackendSentry("generated-media-promotion");
export const generatedMediaPromotionMaximumJobs = 5;
export const generatedMediaPromotionLeaseDurationMs = 180_000;
export const generatedMediaPromotionFinalizationReserveMs = 10_000;
type GeneratedMediaPromotionResponse = Omit<GeneratedMediaPromotionBatchResult, "results"> & Readonly<{
  ok: true;
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
    const result = await runGeneratedMediaPromotionBatch({
      leaseOwner: `generated-media-promotion:${context.awsRequestId}`,
      leaseDurationMs: generatedMediaPromotionLeaseDurationMs,
      maximumJobs: generatedMediaPromotionMaximumJobs,
      deadlineAtMs,
      observationScope,
      signal: abortController.signal,
    });
    addBackendBreadcrumb({
      action: "generated_media_promotion_batch_completed",
      scope: observationScope,
      details: toDetails(result),
    });
    return {
      ok: true,
      claimed: result.claimed, applied: result.applied, ambiguous: result.ambiguous,
      failed: result.failed, interrupted: result.interrupted,
      leaseLost: result.leaseLost, rescheduled: result.rescheduled,
    };
  } catch (error) {
    captureBackendException({
      action: "generated_media_promotion_batch_failed",
      error: normalizeCaughtError(error),
      scope: observationScope,
      details: emptyDetails(),
    });
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
  }
};
export const handler = wrapBackendHandler(generatedMediaPromotionHandler);

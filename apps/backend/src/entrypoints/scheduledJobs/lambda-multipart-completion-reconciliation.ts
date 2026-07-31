import type { Handler } from "aws-lambda";
import {
  MultipartCompletionFailureReportBatchError,
  MultipartCompletionReconciliationBatchError,
  runMultipartCompletionFailureReportBatch,
  runMultipartCompletionReconciliationBatch,
  type MultipartCompletionFailureReportBatchResult,
  type MultipartCompletionReconciliationBatchResult,
} from "../../mediaAssets/multipart/completionReconciliation";
import { createCloudWatchRecord } from "../../observability/cloudWatch";
import {
  addBackendSentryBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  type BackendObservationScope,
  type MultipartCompletionFailureReportBatchDetails,
  type MultipartCompletionReconciliationBatchDetails,
  type MultipartCompletionReconciliationTerminalFailureDetails,
  wrapBackendHandler,
} from "../../observability/sentry";

initializeBackendSentry("multipart-completion-reconciliation");

export const multipartCompletionReconciliationMaximumJobs = 5;
export const multipartCompletionFailureReportMaximumJobs = 5;
export const multipartCompletionReconciliationLeaseDurationMs = 180_000;
export const multipartCompletionReconciliationFinalizationReserveMs = 10_000;

export function calculateMultipartCompletionReconciliationDeadlineAtMs(
  nowMs: number,
  remainingTimeMs: number,
): number {
  if (
    Number.isSafeInteger(nowMs) === false
    || nowMs < 1
    || Number.isSafeInteger(remainingTimeMs) === false
    || remainingTimeMs < 0
  ) {
    throw new RangeError(
      "Multipart completion reconciliation deadline inputs must be non-negative safe integers.",
    );
  }
  return nowMs + Math.max(
    0,
    remainingTimeMs
      - multipartCompletionReconciliationFinalizationReserveMs,
  );
}

type MultipartCompletionReconciliationResponse =
  Omit<MultipartCompletionReconciliationBatchResult, "results">
  & Readonly<{ ok: true }>;

function emptyFailureReportDetails():
MultipartCompletionFailureReportBatchDetails {
  return {
    maximumReports: multipartCompletionFailureReportMaximumJobs,
    claimed: 0,
    ambiguous: 0,
    leaseLost: 0,
    reported: 0,
    results: [],
  };
}

function toFailureReportDetails(
  result: MultipartCompletionFailureReportBatchResult,
): MultipartCompletionFailureReportBatchDetails {
  return {
    maximumReports: multipartCompletionFailureReportMaximumJobs,
    claimed: result.claimed,
    ambiguous: result.ambiguous,
    leaseLost: result.leaseLost,
    reported: result.reported,
    results: result.results.map((item) => ({
      failureEventId: item.failureEventId,
      outcome: item.outcome,
    })),
  };
}

function failureReportDetails(
  result: MultipartCompletionFailureReportBatchResult | null,
): MultipartCompletionFailureReportBatchDetails {
  return result === null
    ? emptyFailureReportDetails()
    : toFailureReportDetails(result);
}

function emptyDetails(
  reports: MultipartCompletionFailureReportBatchDetails,
): MultipartCompletionReconciliationBatchDetails {
  return {
    maximumJobs: multipartCompletionReconciliationMaximumJobs,
    claimed: 0,
    applied: 0,
    ambiguous: 0,
    failed: 0,
    interrupted: 0,
    leaseLost: 0,
    rescheduled: 0,
    results: [],
    failureReports: reports,
  };
}

function toDetails(
  result: MultipartCompletionReconciliationBatchResult,
  reports: MultipartCompletionFailureReportBatchDetails,
): MultipartCompletionReconciliationBatchDetails {
  return {
    maximumJobs: multipartCompletionReconciliationMaximumJobs,
    claimed: result.claimed,
    applied: result.applied,
    ambiguous: result.ambiguous,
    failed: result.failed,
    interrupted: result.interrupted,
    leaseLost: result.leaseLost,
    rescheduled: result.rescheduled,
    results: result.results.map((item) => ({
      attemptToken: item.attemptToken,
      outcome: item.outcome,
      retryCount: item.retryCount,
      errorCode: item.errorCode,
    })),
    failureReports: reports,
  };
}

export function getMultipartCompletionReconciliationFailureDetails(
  error: unknown,
  completedFailureReports: MultipartCompletionFailureReportBatchResult | null,
): MultipartCompletionReconciliationBatchDetails {
  const reports = error instanceof MultipartCompletionFailureReportBatchError
    ? toFailureReportDetails(error.partialResult)
    : failureReportDetails(completedFailureReports);
  if (error instanceof MultipartCompletionReconciliationBatchError) {
    return toDetails(error.partialResult, reports);
  }
  return emptyDetails(reports);
}

export function reportMultipartCompletionReconciliationBatchCompleted(
  result: MultipartCompletionReconciliationBatchResult,
  failureReports: MultipartCompletionFailureReportBatchResult,
  observationScope: BackendObservationScope,
): void {
  const event = {
    action: "multipart_completion_reconciliation_batch_completed",
    scope: observationScope,
    details: toDetails(result, toFailureReportDetails(failureReports)),
  } as const;
  console.log(createCloudWatchRecord(event));
  addBackendSentryBreadcrumb(event);
}

export function reportMultipartCompletionReconciliationTerminalFailure(
  details: MultipartCompletionReconciliationTerminalFailureDetails,
  observationScope: BackendObservationScope,
): void {
  const event = {
    action: "multipart_completion_reconciliation_job_terminally_failed",
    scope: observationScope,
    details,
  } as const;
  console.log(createCloudWatchRecord(event));
  addBackendSentryBreadcrumb(event);
}

const multipartCompletionReconciliationHandler: Handler<
  unknown,
  MultipartCompletionReconciliationResponse
> = async (_event, context) => {
  const observationScope = createBackendObservationScope(
    "multipart-completion-reconciliation",
    context.awsRequestId ?? null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  const deadlineAtMs =
    calculateMultipartCompletionReconciliationDeadlineAtMs(
      Date.now(),
      context.getRemainingTimeInMillis(),
  );
  const abortController = new AbortController();
  const deadlineTimer = setTimeout(
    () => abortController.abort(
      new Error("Multipart completion reconciliation worker deadline reached."),
    ),
    Math.max(0, deadlineAtMs - Date.now()),
  );
  let failureReportResult: MultipartCompletionFailureReportBatchResult | null =
    null;
  try {
    failureReportResult = await runMultipartCompletionFailureReportBatch({
      leaseOwner:
        `multipart-completion-failure-report:${context.awsRequestId}`,
      leaseDurationMs: multipartCompletionReconciliationLeaseDurationMs,
      maximumReports: multipartCompletionFailureReportMaximumJobs,
      deadlineAtMs,
      reportTerminalFailure: (details) =>
        reportMultipartCompletionReconciliationTerminalFailure(
          details,
          observationScope,
        ),
      signal: abortController.signal,
    });
    const result = await runMultipartCompletionReconciliationBatch({
      leaseOwner: `multipart-completion-reconciliation:${context.awsRequestId}`,
      leaseDurationMs: multipartCompletionReconciliationLeaseDurationMs,
      maximumJobs: multipartCompletionReconciliationMaximumJobs,
      deadlineAtMs,
      observationScope,
      signal: abortController.signal,
    });
    reportMultipartCompletionReconciliationBatchCompleted(
      result,
      failureReportResult,
      observationScope,
    );
    return {
      ok: true,
      claimed: result.claimed,
      applied: result.applied,
      ambiguous: result.ambiguous,
      failed: result.failed,
      interrupted: result.interrupted,
      leaseLost: result.leaseLost,
      rescheduled: result.rescheduled,
    };
  } catch (error) {
    captureBackendException({
      action: "multipart_completion_reconciliation_batch_failed",
      error: normalizeCaughtError(error),
      scope: observationScope,
      details: getMultipartCompletionReconciliationFailureDetails(
        error,
        failureReportResult,
      ),
    });
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
  }
};

export const handler = wrapBackendHandler(
  multipartCompletionReconciliationHandler,
);

import { DatabaseDeadlineExceededError } from "../../../database";
import {
  unsafeQueryWithDeadline,
  unsafeTransactionWithDeadline,
} from "../../../database/unsafe";
import {
  DatabaseCommitOutcomeUnknownError,
  isTransientDatabaseError,
  TransientDatabaseHttpError,
} from "../../../database/transient";
import type {
  MultipartCompletionReconciliationTerminalFailureDetails,
} from "../../../observability/sentry";
import { isLowercaseWorkspaceId } from "../../../workspaces/identity";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const safeErrorCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;
const minimumNewReportBudgetMs = 1_000;

export type ClaimedMultipartCompletionFailureReport = Readonly<{
  failureEventId: string;
  attemptToken: string;
  workspaceId: string;
  retryCount: number;
  errorCode: string;
  deliveryAttempt: number;
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
}>;

export type MultipartCompletionFailureReportBatchInput = Readonly<{
  leaseOwner: string;
  leaseDurationMs: number;
  maximumReports: number;
  deadlineAtMs: number;
  reportTerminalFailure: (
    details: MultipartCompletionReconciliationTerminalFailureDetails,
  ) => void;
  signal: AbortSignal;
}>;

export type MultipartCompletionFailureReportOutcome =
  | "ambiguous"
  | "lease_lost"
  | "reported";

export type MultipartCompletionFailureReportResult = Readonly<{
  failureEventId: string;
  outcome: MultipartCompletionFailureReportOutcome;
}>;

export type MultipartCompletionFailureReportBatchResult = Readonly<{
  claimed: number;
  ambiguous: number;
  leaseLost: number;
  reported: number;
  results: ReadonlyArray<MultipartCompletionFailureReportResult>;
}>;

type ClaimedFailureReportRow = Readonly<{
  failure_event_id: string;
  attempt_token: string;
  workspace_id: string;
  reconciliation_retry_count: number;
  reconciliation_last_error_code: string;
  failure_report_delivery_count: number;
  failure_report_lease_token: string;
  failure_report_lease_owner: string;
  failure_report_lease_expires_at: Date;
}>;

type StatusRow = Readonly<{ status: string }>;

export class MultipartCompletionFailureReportLeaseLostError extends Error {
  readonly code = "MULTIPART_COMPLETION_FAILURE_REPORT_LEASE_LOST";

  constructor(failureEventId: string) {
    super(
      `Multipart completion failure-report lease is no longer active. failureEventId=${failureEventId}`,
    );
    this.name = "MultipartCompletionFailureReportLeaseLostError";
  }
}

function toIsoString(value: Date | null, fieldName: string): string {
  if (
    value === null
    || value instanceof Date === false
    || Number.isFinite(value.getTime()) === false
  ) {
    throw new TypeError(`PostgreSQL returned an invalid ${fieldName}.`);
  }
  return value.toISOString();
}

function requireUuid(value: string, fieldName: string): void {
  if (uuidPattern.test(value) === false) {
    throw new TypeError(`${fieldName} must be a lowercase UUID.`);
  }
}

function requireClaimedFailureReport(
  report: ClaimedMultipartCompletionFailureReport,
): void {
  requireUuid(report.failureEventId, "failureEventId");
  requireUuid(report.attemptToken, "attemptToken");
  if (isLowercaseWorkspaceId(report.workspaceId) === false) {
    throw new TypeError("workspaceId must be a lowercase UUID.");
  }
  requireUuid(report.leaseToken, "leaseToken");
  if (
    report.leaseOwner !== report.leaseOwner.trim()
    || report.leaseOwner.length < 1
    || report.leaseOwner.length > 200
    || controlCharacterPattern.test(report.leaseOwner)
  ) {
    throw new TypeError("failure report leaseOwner is invalid.");
  }
  if (
    Number.isSafeInteger(report.retryCount) === false
    || report.retryCount < 0
    || Number.isSafeInteger(report.deliveryAttempt) === false
    || report.deliveryAttempt < 1
  ) {
    throw new RangeError(
      "Failure report retry and delivery counts must be non-negative safe integers.",
    );
  }
  if (safeErrorCodePattern.test(report.errorCode) === false) {
    throw new TypeError("Failure report errorCode is invalid.");
  }
}

function toClaimedFailureReport(
  row: ClaimedFailureReportRow,
): ClaimedMultipartCompletionFailureReport {
  const report: ClaimedMultipartCompletionFailureReport = {
    failureEventId: row.failure_event_id,
    attemptToken: row.attempt_token,
    workspaceId: row.workspace_id,
    retryCount: row.reconciliation_retry_count,
    errorCode: row.reconciliation_last_error_code,
    deliveryAttempt: row.failure_report_delivery_count,
    leaseToken: row.failure_report_lease_token,
    leaseOwner: row.failure_report_lease_owner,
    leaseExpiresAt: toIsoString(
      row.failure_report_lease_expires_at,
      "failure_report_lease_expires_at",
    ),
  };
  requireClaimedFailureReport(report);
  return report;
}

function validateClaimInput(
  input: Readonly<{
    leaseOwner: string;
    leaseDurationMs: number;
    limit: number;
  }>,
): void {
  if (
    input.leaseOwner !== input.leaseOwner.trim()
    || input.leaseOwner.length < 1
    || input.leaseOwner.length > 200
    || controlCharacterPattern.test(input.leaseOwner)
  ) {
    throw new TypeError(
      "leaseOwner must be 1 to 200 trimmed characters without control characters.",
    );
  }
  if (
    Number.isSafeInteger(input.leaseDurationMs) === false
    || input.leaseDurationMs < 1
    || input.leaseDurationMs > 3_600_000
  ) {
    throw new RangeError("leaseDurationMs must be between 1 and 3600000.");
  }
  if (
    Number.isSafeInteger(input.limit) === false
    || input.limit < 1
    || input.limit > 100
  ) {
    throw new RangeError("limit must be between 1 and 100.");
  }
}

export async function claimMultipartCompletionFailureReports(
  input: Readonly<{
    leaseOwner: string;
    leaseDurationMs: number;
    limit: number;
    deadlineAtMs: number;
  }>,
): Promise<ReadonlyArray<ClaimedMultipartCompletionFailureReport>> {
  validateClaimInput(input);
  const result = await unsafeQueryWithDeadline<ClaimedFailureReportRow>(
    input.deadlineAtMs,
    "SELECT * FROM content.claim_media_upload_session_completion_failure_reports($1, $2, $3)",
    [input.leaseOwner, input.leaseDurationMs, input.limit],
  );
  return result.rows.map(toClaimedFailureReport);
}

export async function finishMultipartCompletionFailureReport(
  report: ClaimedMultipartCompletionFailureReport,
  deadlineAtMs: number,
): Promise<void> {
  requireClaimedFailureReport(report);
  const result = await unsafeQueryWithDeadline<StatusRow>(
    deadlineAtMs,
    `SELECT content.finish_media_upload_session_completion_failure_report(
       $1, $2, $3
     ) AS status`,
    [report.failureEventId, report.attemptToken, report.leaseToken],
  );
  const status = result.rows[0]?.status;
  if (typeof status !== "string" || status === "") {
    throw new TypeError("PostgreSQL returned an invalid reconciliation status.");
  }
  if (status === "reported" || status === "already_reported") return;
  throw new MultipartCompletionFailureReportLeaseLostError(
    report.failureEventId,
  );
}

function toTerminalFailureDetails(
  report: ClaimedMultipartCompletionFailureReport,
): MultipartCompletionReconciliationTerminalFailureDetails {
  return {
    failureEventId: report.failureEventId,
    attemptToken: report.attemptToken,
    workspaceId: report.workspaceId,
    retryCount: report.retryCount,
    errorCode: report.errorCode,
    deliveryAttempt: report.deliveryAttempt,
  };
}

export async function deliverMultipartCompletionFailureReport(
  report: ClaimedMultipartCompletionFailureReport,
  deadlineAtMs: number,
  reportTerminalFailure:
    MultipartCompletionFailureReportBatchInput["reportTerminalFailure"],
): Promise<void> {
  requireClaimedFailureReport(report);
  await unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => {
    const lockResult = await executor.query<StatusRow>(
      `SELECT content.lock_media_upload_session_completion_failure_report_delivery(
         $1, $2, $3
       ) AS status`,
      [report.failureEventId, report.attemptToken, report.leaseToken],
    );
    const lockStatus = lockResult.rows[0]?.status;
    if (lockStatus === "already_reported") return;
    if (lockStatus !== "ready") {
      throw new MultipartCompletionFailureReportLeaseLostError(
        report.failureEventId,
      );
    }

    reportTerminalFailure(toTerminalFailureDetails(report));
    const finishResult = await executor.query<StatusRow>(
      `SELECT content.finish_media_upload_session_completion_failure_report(
         $1, $2, $3
       ) AS status`,
      [report.failureEventId, report.attemptToken, report.leaseToken],
    );
    const finishStatus = finishResult.rows[0]?.status;
    if (finishStatus === "reported" || finishStatus === "already_reported") {
      return;
    }
    throw new MultipartCompletionFailureReportLeaseLostError(
      report.failureEventId,
    );
  });
}

export type MultipartCompletionFailureReportProcessorDependencies = Readonly<{
  claimReportsFn: typeof claimMultipartCompletionFailureReports;
  deliverReportFn: typeof deliverMultipartCompletionFailureReport;
  finishReportFn: typeof finishMultipartCompletionFailureReport;
  nowFn: () => number;
}>;

function failureReportResult(
  report: ClaimedMultipartCompletionFailureReport,
  outcome: MultipartCompletionFailureReportOutcome,
): MultipartCompletionFailureReportResult {
  return {
    failureEventId: report.failureEventId,
    outcome,
  };
}

async function deliverFailureReportWithConfirmation(
  report: ClaimedMultipartCompletionFailureReport,
  input: MultipartCompletionFailureReportBatchInput,
  dependencies: MultipartCompletionFailureReportProcessorDependencies,
): Promise<MultipartCompletionFailureReportResult> {
  try {
    await dependencies.deliverReportFn(
      report,
      input.deadlineAtMs,
      input.reportTerminalFailure,
    );
    return failureReportResult(report, "reported");
  } catch (error) {
    if (error instanceof MultipartCompletionFailureReportLeaseLostError) {
      return failureReportResult(report, "lease_lost");
    }
    if (error instanceof DatabaseCommitOutcomeUnknownError) {
      try {
        await dependencies.finishReportFn(report, input.deadlineAtMs);
        return failureReportResult(report, "reported");
      } catch (confirmationError) {
        if (
          confirmationError instanceof MultipartCompletionFailureReportLeaseLostError
        ) {
          return failureReportResult(report, "lease_lost");
        }
        if (
          input.signal.aborted
          || confirmationError instanceof DatabaseDeadlineExceededError
          || confirmationError instanceof DatabaseCommitOutcomeUnknownError
          || confirmationError instanceof TransientDatabaseHttpError
          || isTransientDatabaseError(confirmationError)
        ) {
          return failureReportResult(report, "ambiguous");
        }
        throw confirmationError;
      }
    }
    if (
      input.signal.aborted
      || error instanceof DatabaseDeadlineExceededError
      || error instanceof TransientDatabaseHttpError
      || isTransientDatabaseError(error)
    ) {
      return failureReportResult(report, "ambiguous");
    }
    throw error;
  }
}

export async function processClaimedMultipartCompletionFailureReportWithDependencies(
  report: ClaimedMultipartCompletionFailureReport,
  input: MultipartCompletionFailureReportBatchInput,
  dependencies: MultipartCompletionFailureReportProcessorDependencies,
): Promise<MultipartCompletionFailureReportResult> {
  requireClaimedFailureReport(report);
  input.signal.throwIfAborted();
  return deliverFailureReportWithConfirmation(
    report,
    input,
    dependencies,
  );
}

function countFailureReportOutcome(
  results: ReadonlyArray<MultipartCompletionFailureReportResult>,
  outcome: MultipartCompletionFailureReportOutcome,
): number {
  return results.filter((item) => item.outcome === outcome).length;
}

function toFailureReportBatchResult(
  results: ReadonlyArray<MultipartCompletionFailureReportResult>,
): MultipartCompletionFailureReportBatchResult {
  return {
    claimed: results.length,
    ambiguous: countFailureReportOutcome(results, "ambiguous"),
    leaseLost: countFailureReportOutcome(results, "lease_lost"),
    reported: countFailureReportOutcome(results, "reported"),
    results,
  };
}

export class MultipartCompletionFailureReportBatchError extends Error {
  constructor(
    readonly partialResult: MultipartCompletionFailureReportBatchResult,
    cause: unknown,
  ) {
    super(
      "Multipart completion failure-report batch failed after processing one or more reports.",
      { cause },
    );
    this.name = "MultipartCompletionFailureReportBatchError";
  }
}

export async function runMultipartCompletionFailureReportBatchWithDependencies(
  input: MultipartCompletionFailureReportBatchInput,
  dependencies: MultipartCompletionFailureReportProcessorDependencies,
): Promise<MultipartCompletionFailureReportBatchResult> {
  const results: Array<MultipartCompletionFailureReportResult> = [];
  try {
    while (
      results.length < input.maximumReports
      && input.signal.aborted === false
      && dependencies.nowFn() + minimumNewReportBudgetMs < input.deadlineAtMs
    ) {
      const claimed = await dependencies.claimReportsFn({
        leaseOwner: input.leaseOwner,
        leaseDurationMs: input.leaseDurationMs,
        limit: 1,
        deadlineAtMs: input.deadlineAtMs,
      });
      const report = claimed[0];
      if (report === undefined) break;
      results.push(
        await processClaimedMultipartCompletionFailureReportWithDependencies(
          report,
          input,
          dependencies,
        ),
      );
    }
  } catch (error) {
    throw new MultipartCompletionFailureReportBatchError(
      toFailureReportBatchResult(results),
      error,
    );
  }
  return toFailureReportBatchResult(results);
}

const defaultDependencies: MultipartCompletionFailureReportProcessorDependencies = {
  claimReportsFn: claimMultipartCompletionFailureReports,
  deliverReportFn: deliverMultipartCompletionFailureReport,
  finishReportFn: finishMultipartCompletionFailureReport,
  nowFn: Date.now,
};

export async function runMultipartCompletionFailureReportBatch(
  input: MultipartCompletionFailureReportBatchInput,
): Promise<MultipartCompletionFailureReportBatchResult> {
  return runMultipartCompletionFailureReportBatchWithDependencies(
    input,
    defaultDependencies,
  );
}

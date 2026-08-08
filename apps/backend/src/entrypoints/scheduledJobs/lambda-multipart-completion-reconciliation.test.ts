import assert from "node:assert/strict";
import test from "node:test";
import { createBackendObservationScope } from "../../observability/sentry";
import {
  MultipartCompletionFailureReportBatchError,
  type MultipartCompletionFailureReportBatchResult,
} from "../../mediaAssets/multipart/completion/completionFailureReports";
import {
  MultipartCompletionReconciliationBatchError,
  type MultipartCompletionReconciliationBatchResult,
} from "../../mediaAssets/multipart/completion/completionReconciliation";
import {
  calculateMultipartCompletionReconciliationDeadlineAtMs,
  getMultipartCompletionReconciliationFailureDetails,
  multipartCompletionFailureReportMaximumJobs,
  multipartCompletionReconciliationFinalizationReserveMs,
  multipartCompletionReconciliationLeaseDurationMs,
  multipartCompletionReconciliationMaximumJobs,
  reportMultipartCompletionReconciliationBatchCompleted,
  reportMultipartCompletionReconciliationTerminalFailure,
} from "./lambda-multipart-completion-reconciliation";

test("multipart completion worker keeps a finalization reserve and bounded batch", () => {
  const nowMs = 1_800_000_000_000;
  assert.equal(multipartCompletionReconciliationMaximumJobs, 5);
  assert.equal(multipartCompletionFailureReportMaximumJobs, 5);
  assert.equal(multipartCompletionReconciliationLeaseDurationMs, 180_000);
  assert.equal(multipartCompletionReconciliationFinalizationReserveMs, 10_000);
  assert.equal(
    calculateMultipartCompletionReconciliationDeadlineAtMs(nowMs, 120_000),
    nowMs + 110_000,
  );
  assert.equal(
    calculateMultipartCompletionReconciliationDeadlineAtMs(nowMs, 5_000),
    nowMs,
  );
});

test("multipart completion worker rejects invalid deadline inputs", () => {
  assert.throws(
    () => calculateMultipartCompletionReconciliationDeadlineAtMs(0, 1),
    RangeError,
  );
  assert.throws(
    () => calculateMultipartCompletionReconciliationDeadlineAtMs(1, -1),
    RangeError,
  );
});

test("multipart completion worker emits a flattened batch Lambda JSON message", () => {
  const failureReports: MultipartCompletionFailureReportBatchResult = {
    claimed: 0,
    ambiguous: 0,
    leaseLost: 0,
    reported: 0,
    results: [],
  };
  const result: MultipartCompletionReconciliationBatchResult = {
    claimed: 2,
    applied: 1,
    ambiguous: 0,
    failed: 1,
    interrupted: 0,
    leaseLost: 0,
    rescheduled: 0,
    results: [
      {
        attemptToken: "attempt-applied",
        workspaceId: "workspace-1",
        outcome: "applied",
        retryCount: 0,
        errorCode: null,
      },
      {
        attemptToken: "attempt-failed",
        workspaceId: "workspace-1",
        outcome: "failed",
        retryCount: 1,
        errorCode: "MULTIPART_BLOB_OBJECT_MISMATCH",
      },
    ],
  };
  const originalConsoleLog = console.log;
  let message: unknown = null;
  console.log = (value?: unknown): void => {
    message = value;
  };
  try {
    reportMultipartCompletionReconciliationBatchCompleted(
      result,
      failureReports,
      createBackendObservationScope(
        "multipart-completion-reconciliation",
        "request-1",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
    );
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(typeof message, "object");
  assert.notEqual(message, null);
  const lambdaEnvelope = {
    timestamp: "2026-07-29T00:00:00.000Z",
    level: "INFO",
    requestId: "request-1",
    message: message as Readonly<Record<string, unknown>>,
  };
  assert.equal(
    lambdaEnvelope.message.action,
    "multipart_completion_reconciliation_batch_completed",
  );
  assert.equal(lambdaEnvelope.message.failed, 1);
  assert.deepEqual(lambdaEnvelope.message.failureReports, {
    maximumReports: multipartCompletionFailureReportMaximumJobs,
    claimed: 0,
    ambiguous: 0,
    leaseLost: 0,
    reported: 0,
    results: [],
  });
  assert.equal("details" in lambdaEnvelope.message, false);
});

test("multipart completion worker emits one flattened metric event per terminal failure", () => {
  const originalConsoleLog = console.log;
  let message: unknown = null;
  console.log = (value?: unknown): void => {
    message = value;
  };
  try {
    reportMultipartCompletionReconciliationTerminalFailure(
      {
        failureEventId: "55555555-5555-4555-8555-555555555555",
        attemptToken: "attempt-failed",
        workspaceId: "workspace-1",
        retryCount: 4,
        errorCode: "RETRY_EXHAUSTED",
        deliveryAttempt: 2,
      },
      createBackendObservationScope(
        "multipart-completion-reconciliation",
        "request-1",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
    );
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(typeof message, "object");
  assert.notEqual(message, null);
  const lambdaEnvelope = {
    timestamp: "2026-07-29T00:00:00.000Z",
    level: "INFO",
    requestId: "request-1",
    message: message as Readonly<Record<string, unknown>>,
  };
  assert.equal(
    lambdaEnvelope.message.action,
    "multipart_completion_reconciliation_job_terminally_failed",
  );
  assert.equal(
    lambdaEnvelope.message.failureEventId,
    "55555555-5555-4555-8555-555555555555",
  );
  assert.equal(lambdaEnvelope.message.attemptToken, "<redacted-secret>");
  assert.equal(lambdaEnvelope.message.workspaceId, "workspace-1");
  assert.equal(lambdaEnvelope.message.retryCount, 4);
  assert.equal(lambdaEnvelope.message.errorCode, "RETRY_EXHAUSTED");
  assert.equal(lambdaEnvelope.message.deliveryAttempt, 2);
  assert.equal("details" in lambdaEnvelope.message, false);
});

test("multipart completion worker attaches partial results to a batch failure", () => {
  const partialResult: MultipartCompletionReconciliationBatchResult = {
    claimed: 1,
    applied: 0,
    ambiguous: 0,
    failed: 1,
    interrupted: 0,
    leaseLost: 0,
    rescheduled: 0,
    results: [
      {
        attemptToken: "attempt-failed",
        workspaceId: "workspace-1",
        outcome: "failed",
        retryCount: 2,
        errorCode: "DURABLE_STATE_CONFLICT",
      },
    ],
  };

  assert.deepEqual(
    getMultipartCompletionReconciliationFailureDetails(
      new MultipartCompletionReconciliationBatchError(
        partialResult,
        new Error("unexpected second job failure"),
      ),
      null,
    ),
    {
      maximumJobs: multipartCompletionReconciliationMaximumJobs,
      claimed: 1,
      applied: 0,
      ambiguous: 0,
      failed: 1,
      interrupted: 0,
      leaseLost: 0,
      rescheduled: 0,
      results: [
        {
          attemptToken: "attempt-failed",
          outcome: "failed",
          retryCount: 2,
          errorCode: "DURABLE_STATE_CONFLICT",
        },
      ],
      failureReports: {
        maximumReports: multipartCompletionFailureReportMaximumJobs,
        claimed: 0,
        ambiguous: 0,
        leaseLost: 0,
        reported: 0,
        results: [],
      },
    },
  );
});

test("multipart completion worker attaches partial report delivery results to a batch failure", () => {
  const partialResult: MultipartCompletionFailureReportBatchResult = {
    claimed: 1,
    ambiguous: 0,
    leaseLost: 0,
    reported: 1,
    results: [{
      failureEventId: "55555555-5555-4555-8555-555555555555",
      outcome: "reported",
    }],
  };

  assert.deepEqual(
    getMultipartCompletionReconciliationFailureDetails(
      new MultipartCompletionFailureReportBatchError(
        partialResult,
        new Error("unexpected second report failure"),
      ),
      null,
    ),
    {
      maximumJobs: multipartCompletionReconciliationMaximumJobs,
      claimed: 0,
      applied: 0,
      ambiguous: 0,
      failed: 0,
      interrupted: 0,
      leaseLost: 0,
      rescheduled: 0,
      results: [],
      failureReports: {
        maximumReports: multipartCompletionFailureReportMaximumJobs,
        claimed: 1,
        ambiguous: 0,
        leaseLost: 0,
        reported: 1,
        results: [{
          failureEventId: "55555555-5555-4555-8555-555555555555",
          outcome: "reported",
        }],
      },
    },
  );
});

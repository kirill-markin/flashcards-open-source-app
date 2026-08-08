import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseDeadlineExceededError } from "../../../database";
import { DatabaseCommitOutcomeUnknownError } from "../../../database/transient";
import { createBackendObservationScope } from "../../../observability/sentry";
import { HttpError } from "../../../shared/errors";
import {
  MultipartCompletionReconciliationStorageTerminalError,
  MultipartCompletionReconciliationStorageTransientError,
} from "../../storage";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../../storageKeys";
import {
  MultipartCompletionFailureReportBatchError,
  MultipartCompletionFailureReportLeaseLostError,
  MultipartCompletionReconciliationAccessRevokedError,
  MultipartCompletionReconciliationBatchError,
  MultipartCompletionReconciliationLeaseLostError,
  processClaimedMultipartCompletionFailureReportWithDependencies,
  processClaimedMultipartCompletionReconciliationWithDependencies,
  runMultipartCompletionFailureReportBatchWithDependencies,
  runMultipartCompletionReconciliationBatchWithDependencies,
  type ClaimedMultipartCompletionFailureReport,
  type ClaimedMultipartCompletionReconciliation,
  type MultipartCompletionFailureReportBatchInput,
  type MultipartCompletionFailureReportProcessorDependencies,
  type MultipartCompletionReconciliationBatchInput,
  type MultipartCompletionReconciliationProcessorDependencies,
  type MultipartCompletionReconciliationSafeError,
} from "./completionReconciliation";

const workspaceId = "35274129-ef97-d366-954c-955b4bb0fbf0";
const sessionId = "22222222-2222-4222-8222-222222222222";
const mediaAssetId = "33333333-3333-4333-8333-333333333333";
const replicaId = "44444444-4444-4444-8444-444444444444";
const attemptToken = "55555555-5555-4555-8555-555555555555";
const reservationToken = "66666666-6666-4666-8666-666666666666";
const leaseToken = "77777777-7777-4777-8777-777777777777";
const failureEventId = "99999999-9999-4999-8999-999999999999";
const sha256 = "8".repeat(64);
const nowMs = Date.parse("2026-01-02T03:04:05.000Z");

function createJob(
  retryCount: number,
): ClaimedMultipartCompletionReconciliation {
  return {
    attemptToken,
    reservationToken,
    userId: "user-1",
    workspaceId,
    sessionId,
    mediaAssetId,
    replicaId,
    lastOperationId: "operation-1",
    sha256,
    stagingStorageKey: buildMediaMultipartUploadStagingStorageKey(
      workspaceId,
      mediaAssetId,
      sessionId,
    ),
    blobStorageKey: buildMediaBlobStorageKey(sha256),
    s3UploadId: "s3-upload-id",
    mimeType: "application/octet-stream",
    sizeBytes: 10,
    partSizeBytes: 5,
    partCount: 2,
    sourceUrl: null,
    assetCreatedAt: "2026-01-01T00:00:00.000Z",
    clientUpdatedAt: "2026-01-01T00:00:00.000Z",
    sessionExpiresAt: "2026-01-03T00:00:00.000Z",
    normalizationVersion: "passthrough-v1",
    completedPartsFingerprint: "9".repeat(64),
    retryCount,
    leaseToken,
    leaseOwner: "worker-1",
    leaseExpiresAt: "2026-01-02T03:07:05.000Z",
    handedOffAt: "2026-01-02T03:03:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
  };
}

function createBatchInput(
  signal: AbortSignal,
): MultipartCompletionReconciliationBatchInput {
  return {
    leaseOwner: "worker-1",
    leaseDurationMs: 180_000,
    maximumJobs: 5,
    deadlineAtMs: nowMs + 100_000,
    observationScope: createBackendObservationScope(
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
    signal,
  };
}

function createDependencies(
  reconcileStorageFn:
    MultipartCompletionReconciliationProcessorDependencies["reconcileStorageFn"],
  renewLeaseFn:
    MultipartCompletionReconciliationProcessorDependencies["renewLeaseFn"],
  applyJobFn:
    MultipartCompletionReconciliationProcessorDependencies["applyJobFn"],
  rescheduleJobFn:
    MultipartCompletionReconciliationProcessorDependencies["rescheduleJobFn"],
  failJobFn:
    MultipartCompletionReconciliationProcessorDependencies["failJobFn"],
): MultipartCompletionReconciliationProcessorDependencies {
  return {
    claimJobsFn: async () => [],
    reconcileStorageFn,
    renewLeaseFn,
    applyJobFn,
    rescheduleJobFn,
    failJobFn,
    readJobOutcomeFn: async () => ({
      status: "active",
      errorCode: null,
    }),
    nowFn: () => nowMs,
  };
}

function createFailureReport(
  deliveryAttempt: number,
): ClaimedMultipartCompletionFailureReport {
  return {
    failureEventId,
    attemptToken,
    workspaceId,
    retryCount: 4,
    errorCode: "RETRY_EXHAUSTED",
    deliveryAttempt,
    leaseToken,
    leaseOwner: "failure-reporter-1",
    leaseExpiresAt: "2026-01-02T03:07:05.000Z",
  };
}

function createFailureReportInput(
  signal: AbortSignal,
  reportTerminalFailure:
    MultipartCompletionFailureReportBatchInput["reportTerminalFailure"],
): MultipartCompletionFailureReportBatchInput {
  return {
    leaseOwner: "failure-reporter-1",
    leaseDurationMs: 180_000,
    maximumReports: 5,
    deadlineAtMs: nowMs + 100_000,
    reportTerminalFailure,
    signal,
  };
}

test("failure reports reject uppercase legacy workspace IDs", async () => {
  const dependencies: MultipartCompletionFailureReportProcessorDependencies = {
    claimReportsFn: async () => [],
    deliverReportFn: async () => {
      throw new Error("Uppercase workspace reports must fail before delivery.");
    },
    finishReportFn: async () => {
      throw new Error("Uppercase workspace reports must fail before acknowledgement.");
    },
    nowFn: () => nowMs,
  };

  await assert.rejects(
    processClaimedMultipartCompletionFailureReportWithDependencies(
      {
        ...createFailureReport(1),
        workspaceId: workspaceId.toUpperCase(),
      },
      createFailureReportInput(
        new AbortController().signal,
        () => {
          throw new Error("Uppercase workspace reports must fail before emission.");
        },
      ),
      dependencies,
    ),
    /workspaceId must be a lowercase UUID/,
  );
});

test("renews the exact lease during storage and applies one completion", async () => {
  const job = createJob(0);
  let renewed = 0;
  let applied = 0;
  const dependencies = createDependencies(
    async (input) => {
      await input.renewLease();
    },
    async (renewedJob) => {
      assert.equal(renewedJob.attemptToken, job.attemptToken);
      assert.equal(renewedJob.leaseToken, job.leaseToken);
      renewed += 1;
    },
    async () => {
      applied += 1;
      return "applied";
    },
    async () => {
      throw new Error("unexpected reschedule");
    },
    async () => {
      throw new Error("unexpected failure");
    },
  );

  const outcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      dependencies,
    );

  assert.equal(outcome.outcome, "applied");
  assert.equal(renewed, 1);
  assert.equal(applied, 1);
});

test("reschedules transient storage failure with bounded exponential delay", async () => {
  const job = createJob(1);
  const rescheduledAt: Array<Date> = [];
  const rescheduledErrors: Array<MultipartCompletionReconciliationSafeError> = [];
  const dependencies = createDependencies(
    async () => {
      throw new MultipartCompletionReconciliationStorageTransientError(
        "head_object",
        503,
        new Error("temporarily unavailable"),
      );
    },
    async () => undefined,
    async () => "applied",
    async (_job, _deadlineAtMs, nextAttemptAt, error) => {
      rescheduledAt.push(nextAttemptAt);
      rescheduledErrors.push(error);
    },
    async () => {
      throw new Error("unexpected failure");
    },
  );

  const outcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      dependencies,
    );

  assert.equal(outcome.outcome, "rescheduled");
  assert.equal(
    rescheduledAt[0]?.toISOString(),
    new Date(nowMs + 60_000).toISOString(),
  );
  assert.equal(
    rescheduledErrors[0]?.code,
    "MULTIPART_STORAGE_TRANSIENT",
  );
});

test("terminalizes retry exhaustion with a stable safe error", async () => {
  const job = createJob(4);
  const failedErrors: Array<MultipartCompletionReconciliationSafeError> = [];
  const dependencies = createDependencies(
    async () => {
      throw new MultipartCompletionReconciliationStorageTransientError(
        "copy_object",
        503,
        new Error("temporarily unavailable"),
      );
    },
    async () => undefined,
    async () => "applied",
    async () => {
      throw new Error("unexpected reschedule");
    },
    async (_job, _deadlineAtMs, error) => {
      failedErrors.push(error);
      return "failed";
    },
  );

  const outcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      dependencies,
    );

  assert.equal(outcome.outcome, "failed");
  assert.equal(failedErrors[0]?.code, "RETRY_EXHAUSTED");
});

test("terminalizes access revocation after storage succeeds", async () => {
  const job = createJob(0);
  const failedErrors: Array<MultipartCompletionReconciliationSafeError> = [];
  const dependencies = createDependencies(
    async () => undefined,
    async () => undefined,
    async () => {
      throw new MultipartCompletionReconciliationAccessRevokedError(
        job.attemptToken,
      );
    },
    async () => {
      throw new Error("unexpected reschedule");
    },
    async (_job, _deadlineAtMs, error) => {
      failedErrors.push(error);
      return "failed";
    },
  );

  const outcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      dependencies,
    );

  assert.equal(outcome.outcome, "failed");
  assert.equal(failedErrors[0]?.code, "WORKSPACE_ACCESS_REVOKED");
});

test("terminalizes only an explicit storage domain failure", async () => {
  const job = createJob(0);
  const failedErrors: Array<MultipartCompletionReconciliationSafeError> = [];
  const dependencies = createDependencies(
    async () => {
      throw new MultipartCompletionReconciliationStorageTerminalError(
        "MULTIPART_PARTS_INVALID",
        "Multipart upload parts are invalid.",
        null,
        null,
      );
    },
    async () => undefined,
    async () => "applied",
    async () => {
      throw new Error("unexpected reschedule");
    },
    async (_job, _deadlineAtMs, error) => {
      failedErrors.push(error);
      return "failed";
    },
  );

  const outcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      dependencies,
    );

  assert.equal(outcome.outcome, "failed");
  assert.equal(outcome.errorCode, "MULTIPART_PARTS_INVALID");
  assert.deepEqual(failedErrors, [{
    code: "MULTIPART_PARTS_INVALID",
    message: "Multipart upload parts are invalid.",
  }]);
});

test("propagates unrelated HTTP and programming errors without settling the job", async () => {
  const errors = [
    new HttpError(500, "unrelated HTTP failure"),
    new TypeError("local request construction failed"),
    new RangeError("local invariant failed"),
  ] as const;

  for (const expectedError of errors) {
    let settlementCalls = 0;
    const dependencies = createDependencies(
      async () => {
        throw expectedError;
      },
      async () => undefined,
      async () => "applied",
      async () => {
        settlementCalls += 1;
      },
      async () => {
        settlementCalls += 1;
        return "failed";
      },
    );

    await assert.rejects(
      processClaimedMultipartCompletionReconciliationWithDependencies(
        createJob(0),
        createBatchInput(new AbortController().signal),
        dependencies,
      ),
      (error: unknown) => error === expectedError,
    );
    assert.equal(settlementCalls, 0);
  }
});

test("resolves an unknown failure commit from durable state", async () => {
  const job = createJob(4);
  const baseDependencies = createDependencies(
    async () => {
      throw new MultipartCompletionReconciliationStorageTerminalError(
        "MULTIPART_UPLOAD_NOT_FOUND",
        "Multipart upload no longer exists.",
        null,
        null,
      );
    },
    async () => undefined,
    async () => "applied",
    async () => {
      throw new Error("unexpected reschedule");
    },
    async () => {
      throw new DatabaseCommitOutcomeUnknownError(
        new Error("commit response lost"),
      );
    },
  );

  const failedOutcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      {
        ...baseDependencies,
        readJobOutcomeFn: async () => ({
          status: "failed",
          errorCode: "MULTIPART_UPLOAD_NOT_FOUND",
        }),
      },
    );
  assert.equal(failedOutcome.outcome, "failed");
  assert.equal(failedOutcome.errorCode, "MULTIPART_UPLOAD_NOT_FOUND");

  const appliedOutcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      {
        ...baseDependencies,
        readJobOutcomeFn: async () => ({
          status: "applied",
          errorCode: null,
        }),
      },
    );
  assert.equal(appliedOutcome.outcome, "applied");

  const unavailableOutcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      {
        ...baseDependencies,
        readJobOutcomeFn: async () => {
          throw new DatabaseCommitOutcomeUnknownError(
            new Error("outcome read unavailable"),
          );
        },
      },
    );
  assert.equal(unavailableOutcome.outcome, "ambiguous");
});

test("leaves unknown database commit and lease loss for durable replay", async () => {
  const job = createJob(0);
  const unknownDependencies = createDependencies(
    async () => undefined,
    async () => undefined,
    async () => {
      throw new DatabaseCommitOutcomeUnknownError(
        new Error("commit response lost"),
      );
    },
    async () => {
      throw new Error("unexpected reschedule");
    },
    async () => {
      throw new Error("unexpected failure");
    },
  );
  const unknownOutcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      unknownDependencies,
    );
  assert.equal(unknownOutcome.outcome, "ambiguous");

  const leaseLostDependencies = createDependencies(
    async (input) => input.renewLease(),
    async () => {
      throw new MultipartCompletionReconciliationLeaseLostError(
        job.attemptToken,
      );
    },
    async () => "applied",
    async () => {
      throw new Error("unexpected reschedule");
    },
    async () => {
      throw new Error("unexpected failure");
    },
  );
  const leaseLostOutcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      leaseLostDependencies,
    );
  assert.equal(leaseLostOutcome.outcome, "lease_lost");
});

test("stops safely at a database deadline and bounds batch claims", async () => {
  const job = createJob(0);
  const deadlineDependencies = createDependencies(
    async () => undefined,
    async () => undefined,
    async () => {
      throw new DatabaseDeadlineExceededError(
        "before_commit",
        nowMs + 100,
        null,
      );
    },
    async () => {
      throw new Error("unexpected reschedule");
    },
    async () => {
      throw new Error("unexpected failure");
    },
  );
  const deadlineOutcome =
    await processClaimedMultipartCompletionReconciliationWithDependencies(
      job,
      createBatchInput(new AbortController().signal),
      deadlineDependencies,
    );
  assert.equal(deadlineOutcome.outcome, "interrupted");

  let claimCount = 0;
  const boundedDependencies: MultipartCompletionReconciliationProcessorDependencies = {
    ...createDependencies(
      async () => undefined,
      async () => undefined,
      async () => "applied",
      async () => undefined,
      async () => "failed",
    ),
    claimJobsFn: async () => {
      claimCount += 1;
      return [job];
    },
  };
  const batch = await runMultipartCompletionReconciliationBatchWithDependencies(
    { ...createBatchInput(new AbortController().signal), maximumJobs: 2 },
    boundedDependencies,
  );
  assert.equal(batch.claimed, 2);
  assert.equal(batch.applied, 2);
  assert.equal(claimCount, 2);
});

test("preserves completed results when a later batch job throws", async () => {
  const firstJob = createJob(0);
  const secondJob: ClaimedMultipartCompletionReconciliation = {
    ...createJob(0),
    attemptToken: "88888888-8888-4888-8888-888888888888",
  };
  const jobs = [firstJob, secondJob];
  let storageCalls = 0;
  const dependencies: MultipartCompletionReconciliationProcessorDependencies = {
    ...createDependencies(
      async () => {
        storageCalls += 1;
        if (storageCalls === 1) {
          throw new MultipartCompletionReconciliationStorageTerminalError(
            "MULTIPART_UPLOAD_NOT_FOUND",
            "Multipart upload no longer exists.",
            null,
            null,
          );
        }
        throw new Error("unexpected later job failure");
      },
      async () => undefined,
      async () => "applied",
      async () => {
        throw new Error("unexpected reschedule");
      },
      async () => "failed",
    ),
    claimJobsFn: async () => {
      const job = jobs.shift();
      return job === undefined ? [] : [job];
    },
  };
  const input: MultipartCompletionReconciliationBatchInput = {
    ...createBatchInput(new AbortController().signal),
    maximumJobs: 2,
  };

  await assert.rejects(
    runMultipartCompletionReconciliationBatchWithDependencies(
      input,
      dependencies,
    ),
    (error: unknown) => {
      assert.ok(error instanceof MultipartCompletionReconciliationBatchError);
      assert.deepEqual(error.partialResult, {
        claimed: 1,
        applied: 0,
        ambiguous: 0,
        failed: 1,
        interrupted: 0,
        leaseLost: 0,
        rescheduled: 0,
        results: [
          {
            attemptToken: firstJob.attemptToken,
            workspaceId: firstJob.workspaceId,
            outcome: "failed",
            retryCount: firstJob.retryCount,
            errorCode: "MULTIPART_UPLOAD_NOT_FOUND",
          },
        ],
      });
      assert.match(String(error.cause), /unexpected later job failure/);
      return true;
    },
  );
});

test("confirms an unknown failure-report acknowledgement without duplicate emission", async () => {
  const report = createFailureReport(1);
  const reportedDetails: Array<unknown> = [];
  let deliveryCalls = 0;
  let finishCalls = 0;
  const dependencies: MultipartCompletionFailureReportProcessorDependencies = {
    claimReportsFn: async () => [],
    deliverReportFn: async (claimedReport, _deadlineAtMs, reportFailure) => {
      deliveryCalls += 1;
      reportFailure({
        failureEventId: claimedReport.failureEventId,
        attemptToken: claimedReport.attemptToken,
        workspaceId: claimedReport.workspaceId,
        retryCount: claimedReport.retryCount,
        errorCode: claimedReport.errorCode,
        deliveryAttempt: claimedReport.deliveryAttempt,
      });
      throw new DatabaseCommitOutcomeUnknownError(
        new Error("commit response lost"),
      );
    },
    finishReportFn: async () => {
      finishCalls += 1;
    },
    nowFn: () => nowMs,
  };

  const reportResult =
    await processClaimedMultipartCompletionFailureReportWithDependencies(
      report,
      createFailureReportInput(
        new AbortController().signal,
        (details) => reportedDetails.push(details),
      ),
      dependencies,
    );

  assert.equal(reportResult.outcome, "reported");
  assert.equal(deliveryCalls, 1);
  assert.equal(finishCalls, 1);
  assert.deepEqual(reportedDetails, [
    {
      failureEventId: report.failureEventId,
      attemptToken: report.attemptToken,
      workspaceId: report.workspaceId,
      retryCount: report.retryCount,
      errorCode: report.errorCode,
      deliveryAttempt: 1,
    },
  ]);
});

test("retries reporter failure and lease loss with a stable event identity", async () => {
  const firstDelivery = createFailureReport(1);
  const secondDelivery: ClaimedMultipartCompletionFailureReport = {
    ...createFailureReport(2),
    leaseToken: "88888888-8888-4888-8888-888888888888",
  };
  let deliveryCalls = 0;
  const dependencies: MultipartCompletionFailureReportProcessorDependencies = {
    claimReportsFn: async () => [],
    deliverReportFn: async (report, _deadlineAtMs, reportFailure) => {
      deliveryCalls += 1;
      if (report.deliveryAttempt === 1) {
        throw new MultipartCompletionFailureReportLeaseLostError(
          report.failureEventId,
        );
      }
      reportFailure({
        failureEventId: report.failureEventId,
        attemptToken: report.attemptToken,
        workspaceId: report.workspaceId,
        retryCount: report.retryCount,
        errorCode: report.errorCode,
        deliveryAttempt: report.deliveryAttempt,
      });
    },
    finishReportFn: async () => undefined,
    nowFn: () => nowMs,
  };
  const emittedEventIds: Array<string> = [];
  const input = createFailureReportInput(
    new AbortController().signal,
    (details) => emittedEventIds.push(details.failureEventId),
  );

  const leaseLost =
    await processClaimedMultipartCompletionFailureReportWithDependencies(
      firstDelivery,
      input,
      dependencies,
    );
  const reported =
    await processClaimedMultipartCompletionFailureReportWithDependencies(
      secondDelivery,
      input,
      dependencies,
    );

  assert.equal(leaseLost.outcome, "lease_lost");
  assert.equal(reported.outcome, "reported");
  assert.equal(deliveryCalls, 2);
  assert.deepEqual(emittedEventIds, [failureEventId]);

  let claimed = false;
  const batch = await runMultipartCompletionFailureReportBatchWithDependencies(
    { ...input, maximumReports: 1 },
    {
      ...dependencies,
      claimReportsFn: async () => {
        if (claimed) return [];
        claimed = true;
        return [secondDelivery];
      },
    },
  );
  assert.equal(batch.claimed, 1);
  assert.equal(batch.reported, 1);
});

test("leaves an interrupted report unacknowledged for a later delivery", async () => {
  const firstDelivery = createFailureReport(1);
  const secondDelivery: ClaimedMultipartCompletionFailureReport = {
    ...createFailureReport(2),
    leaseToken: "88888888-8888-4888-8888-888888888888",
  };
  let deliveryCalls = 0;
  const dependencies: MultipartCompletionFailureReportProcessorDependencies = {
    claimReportsFn: async () => [],
    deliverReportFn: async (report, _deadlineAtMs, reportFailure) => {
      deliveryCalls += 1;
      reportFailure({
        failureEventId: report.failureEventId,
        attemptToken: report.attemptToken,
        workspaceId: report.workspaceId,
        retryCount: report.retryCount,
        errorCode: report.errorCode,
        deliveryAttempt: report.deliveryAttempt,
      });
    },
    finishReportFn: async () => undefined,
    nowFn: () => nowMs,
  };

  await assert.rejects(
    processClaimedMultipartCompletionFailureReportWithDependencies(
      firstDelivery,
      createFailureReportInput(
        new AbortController().signal,
        () => {
          throw new Error("log delivery interrupted");
        },
      ),
      dependencies,
    ),
    /log delivery interrupted/,
  );
  assert.equal(deliveryCalls, 1);

  const observedEventIds: Array<string> = [];
  const eventual =
    await processClaimedMultipartCompletionFailureReportWithDependencies(
      secondDelivery,
      createFailureReportInput(
        new AbortController().signal,
        (details) => observedEventIds.push(details.failureEventId),
      ),
      dependencies,
    );
  assert.equal(eventual.outcome, "reported");
  assert.equal(deliveryCalls, 2);
  assert.deepEqual(observedEventIds, [failureEventId]);
});

test("preserves delivered failure reports when a later report claim throws", async () => {
  const firstReport = createFailureReport(1);
  let claimCalls = 0;
  const dependencies: MultipartCompletionFailureReportProcessorDependencies = {
    claimReportsFn: async () => {
      claimCalls += 1;
      if (claimCalls === 1) return [firstReport];
      throw new Error("unexpected later failure-report claim");
    },
    deliverReportFn: async (report, _deadlineAtMs, reportFailure) => {
      reportFailure({
        failureEventId: report.failureEventId,
        attemptToken: report.attemptToken,
        workspaceId: report.workspaceId,
        retryCount: report.retryCount,
        errorCode: report.errorCode,
        deliveryAttempt: report.deliveryAttempt,
      });
    },
    finishReportFn: async () => undefined,
    nowFn: () => nowMs,
  };

  await assert.rejects(
    runMultipartCompletionFailureReportBatchWithDependencies(
      createFailureReportInput(
        new AbortController().signal,
        () => undefined,
      ),
      dependencies,
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof MultipartCompletionFailureReportBatchError);
      assert.deepEqual(error.partialResult, {
        claimed: 1,
        ambiguous: 0,
        leaseLost: 0,
        reported: 1,
        results: [{
          failureEventId,
          outcome: "reported",
        }],
      });
      assert.match(
        String(error.cause),
        /unexpected later failure-report claim/,
      );
      return true;
    },
  );
});

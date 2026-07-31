import assert from "node:assert/strict";
import test from "node:test";
import type {
  GeneratedMediaPromotionBatchResult,
} from "../../chat/cardImages/promotionProcessor";
import {
  MediaBlobCleanupBatchError,
  type MediaBlobCleanupBatchResult,
} from "../../mediaAssets/blobLifecycle/cleanupProcessor";
import { createBackendObservationScope } from "../../observability/sentry";
import {
  readMediaBlobCleanupEnabled,
  resolveMediaBlobCleanupFailureResult,
  runGeneratedMediaScheduledWorkloads,
  type GeneratedMediaScheduledWorkloadDependencies,
  type GeneratedMediaScheduledWorkloadInput,
} from "./lambda-generated-media-promotion";

const observationScope = createBackendObservationScope(
  "generated-media-promotion",
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
);

const promotionResult: GeneratedMediaPromotionBatchResult = {
  claimed: 1,
  applied: 1,
  ambiguous: 0,
  failed: 0,
  interrupted: 0,
  leaseLost: 0,
  rescheduled: 0,
  results: [],
};

const cleanupResult: MediaBlobCleanupBatchResult = {
  claimed: 1,
  deleted: 1,
  notFound: 0,
  blocked: 0,
  stale: 0,
  alreadyCompleted: 0,
  retryScheduled: 0,
  reconciliationRequired: 0,
  interrupted: 0,
  results: [],
};

function input(
  signal: AbortSignal,
  cleanupEnabled: boolean,
): GeneratedMediaScheduledWorkloadInput {
  return {
    leaseOwner: "generated-media-promotion:request-1",
    deadlineAtMs: 10_000,
    cleanupEnabled,
    observationScope,
    signal,
  };
}

test("cleanup runtime gate defaults off and accepts only explicit booleans", () => {
  assert.equal(readMediaBlobCleanupEnabled(undefined), false);
  assert.equal(readMediaBlobCleanupEnabled("false"), false);
  assert.equal(readMediaBlobCleanupEnabled("true"), true);
  assert.throws(
    () => readMediaBlobCleanupEnabled("TRUE"),
    /MEDIA_BLOB_CLEANUP_ENABLED must be true or false/u,
  );
});

test("disabled cleanup leaves generated-media promotion running", async () => {
  const calls: Array<string> = [];
  const dependencies: GeneratedMediaScheduledWorkloadDependencies = {
    runPromotionFn: async () => {
      calls.push("promotion");
      return promotionResult;
    },
    runCleanupFn: async () => {
      calls.push("cleanup");
      return cleanupResult;
    },
    nowFn: () => 0,
  };

  const result = await runGeneratedMediaScheduledWorkloads(
    input(new AbortController().signal, false),
    dependencies,
  );

  assert.deepEqual(calls, ["promotion"]);
  assert.equal(result.promotion, promotionResult);
  assert.deepEqual(result.cleanup, {
    claimed: 0,
    deleted: 0,
    notFound: 0,
    blocked: 0,
    stale: 0,
    alreadyCompleted: 0,
    retryScheduled: 0,
    reconciliationRequired: 0,
    interrupted: 1,
    results: [],
  });
});

test("scheduled work prioritizes promotion and reports cleanup interruption when its budget is exhausted", async () => {
  const calls: Array<string> = [];
  let nowMs = 0;
  const dependencies: GeneratedMediaScheduledWorkloadDependencies = {
    runPromotionFn: async () => {
      calls.push("promotion");
      nowMs = 9_500;
      return promotionResult;
    },
    runCleanupFn: async () => {
      calls.push("cleanup");
      return cleanupResult;
    },
    nowFn: () => nowMs,
  };

  const result = await runGeneratedMediaScheduledWorkloads(
    input(new AbortController().signal, true),
    dependencies,
  );

  assert.deepEqual(calls, ["promotion"]);
  assert.equal(result.promotion, promotionResult);
  assert.deepEqual(result.cleanup, {
    claimed: 0,
    deleted: 0,
    notFound: 0,
    blocked: 0,
    stale: 0,
    alreadyCompleted: 0,
    retryScheduled: 0,
    reconciliationRequired: 0,
    interrupted: 1,
    results: [],
  });
});

test("scheduled work aggregates successful promotion and cleanup results in priority order", async () => {
  const calls: Array<string> = [];
  const dependencies: GeneratedMediaScheduledWorkloadDependencies = {
    runPromotionFn: async () => {
      calls.push("promotion");
      return promotionResult;
    },
    runCleanupFn: async () => {
      calls.push("cleanup");
      return cleanupResult;
    },
    nowFn: () => 0,
  };

  const result = await runGeneratedMediaScheduledWorkloads(
    input(new AbortController().signal, true),
    dependencies,
  );

  assert.deepEqual(calls, ["promotion", "cleanup"]);
  assert.equal(result.promotion, promotionResult);
  assert.equal(result.cleanup, cleanupResult);
});

test("scheduled work surfaces cleanup failure after promotion and aggregates both failures", async () => {
  const promotionFailure = new Error("promotion failed");
  const cleanupFailure = new Error("cleanup failed");
  const calls: Array<string> = [];
  const cleanupFailureDependencies: GeneratedMediaScheduledWorkloadDependencies = {
    runPromotionFn: async () => {
      calls.push("promotion");
      return promotionResult;
    },
    runCleanupFn: async () => {
      calls.push("cleanup");
      throw cleanupFailure;
    },
    nowFn: () => 0,
  };

  await assert.rejects(
    runGeneratedMediaScheduledWorkloads(
      input(new AbortController().signal, true),
      cleanupFailureDependencies,
    ),
    (error: unknown) => error === cleanupFailure,
  );
  assert.deepEqual(calls, ["promotion", "cleanup"]);

  const bothFailureDependencies: GeneratedMediaScheduledWorkloadDependencies = {
    runPromotionFn: async () => {
      throw promotionFailure;
    },
    runCleanupFn: async () => {
      throw cleanupFailure;
    },
    nowFn: () => 0,
  };
  await assert.rejects(
    runGeneratedMediaScheduledWorkloads(
      input(new AbortController().signal, true),
      bothFailureDependencies,
    ),
    (error: unknown) => (
      error instanceof AggregateError
      && error.errors[0] === promotionFailure
      && error.errors[1] === cleanupFailure
    ),
  );
});

test("scheduled work preserves the exact partial cleanup batch for failure telemetry", async () => {
  const partialResult: MediaBlobCleanupBatchResult = {
    claimed: 2,
    deleted: 1,
    notFound: 0,
    blocked: 0,
    stale: 0,
    alreadyCompleted: 0,
    retryScheduled: 1,
    reconciliationRequired: 0,
    interrupted: 0,
    results: [{
      sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      cleanupGeneration: 9,
      outcome: "retry_scheduled",
    }],
  };
  const cleanupFailure = new MediaBlobCleanupBatchError(
    partialResult,
    [new Error("cleanup failed after partial progress")],
  );
  const dependencies: GeneratedMediaScheduledWorkloadDependencies = {
    runPromotionFn: async () => promotionResult,
    runCleanupFn: async () => {
      throw cleanupFailure;
    },
    nowFn: () => 0,
  };

  await assert.rejects(
    runGeneratedMediaScheduledWorkloads(
      input(new AbortController().signal, true),
      dependencies,
    ),
    (error: unknown) => (
      error === cleanupFailure
      && resolveMediaBlobCleanupFailureResult(error) === partialResult
    ),
  );
});

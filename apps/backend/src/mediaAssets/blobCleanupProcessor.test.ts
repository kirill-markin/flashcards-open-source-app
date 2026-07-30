import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseDeadlineExceededError } from "../database";
import { DatabaseCommitOutcomeUnknownError } from "../database/transient";
import { createBackendObservationScope } from "../observability/sentry";
import { buildMediaBlobStorageKey } from "./storageKeys";
import {
  MediaBlobCleanupBatchError,
  runMediaBlobCleanupBatchWithDependencies,
  type MediaBlobCleanupProcessorDependencies,
} from "./blobCleanupProcessor";
import type { MediaBlobCleanupClaim } from "./blobCleanupRepository";
import {
  MediaBlobCleanupStorageAmbiguousDeleteError,
  MediaBlobCleanupStorageTransientError,
} from "./storage";

const sha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
const cleanupToken = "77777777-7777-4777-8777-777777777777";
const leaseToken = "88888888-8888-4888-8888-888888888888";
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

function claim(generation: number): MediaBlobCleanupClaim {
  return {
    cleanupToken,
    leaseToken,
    sha256,
    storageKey: buildMediaBlobStorageKey(sha256),
    cleanupGeneration: generation,
    leaseExpiresAt: "2099-07-30T12:00:00.000Z",
    failureCount: 0,
    status: "claimed",
  };
}

function input(signal: AbortSignal) {
  return {
    leaseDurationMs: 60_000,
    maximumCandidates: 5,
    deadlineAtMs: 10_000,
    observationScope,
    signal,
  };
}

test("cleanup replays exact database operations across commit ambiguity before and after S3 deletion", async () => {
  const claimed = claim(9);
  const claimTokens: Array<string> = [];
  let claimCalls = 0;
  let authorizeCalls = 0;
  let renewCalls = 0;
  let deleteCalls = 0;
  let completeCalls = 0;
  const renewalTokens: Array<string> = [];
  const dependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async (token) => {
      claimTokens.push(token);
      claimCalls += 1;
      if (claimCalls === 1) {
        throw new DatabaseCommitOutcomeUnknownError(
          new Error("claim commit response lost"),
        );
      }
      return claimCalls === 2 ? claimed : null;
    },
    authorizeFn: async (exactClaim) => {
      assert.equal(exactClaim, claimed);
      authorizeCalls += 1;
      if (authorizeCalls === 1) {
        throw new DatabaseCommitOutcomeUnknownError(
          new Error("authorization commit response lost"),
        );
      }
      return {
        storageKey: exactClaim.storageKey,
        status: "authorized",
      };
    },
    renewFn: async (_exactClaim, renewalToken) => {
      renewalTokens.push(renewalToken);
      renewCalls += 1;
      if (renewCalls === 1) {
        throw new DatabaseCommitOutcomeUnknownError(
          new Error("renewal commit response lost"),
        );
      }
      return {
        leaseExpiresAt: "2099-07-30T12:01:00.000Z",
        status: "renewed",
      };
    },
    deleteFn: async (deleteInput) => {
      await deleteInput.renewLease("head_object");
      deleteCalls += 1;
      assert.equal(deleteInput.storageKey, claimed.storageKey);
      assert.equal(deleteInput.cleanupGeneration, claimed.cleanupGeneration);
      return "deleted";
    },
    recordFailureFn: async () => ({
      status: "retry_scheduled",
      nextAttemptAt: "2099-07-30T12:02:00.000Z",
      failureCount: 1,
    }),
    completeFn: async (exactClaim) => {
      assert.equal(exactClaim, claimed);
      completeCalls += 1;
      if (completeCalls === 1) {
        throw new DatabaseCommitOutcomeUnknownError(
          new Error("completion commit response lost"),
        );
      }
      return "completed";
    },
    createTokenFn: () => cleanupToken,
    nowFn: () => 0,
    waitFn: async () => {},
  };

  const result = await runMediaBlobCleanupBatchWithDependencies(
    input(new AbortController().signal),
    dependencies,
  );
  assert.deepEqual(claimTokens, [cleanupToken, cleanupToken, cleanupToken]);
  assert.equal(authorizeCalls, 2);
  assert.equal(renewCalls, 3);
  assert.equal(renewalTokens[0], renewalTokens[1]);
  assert.equal(deleteCalls, 1);
  assert.equal(completeCalls, 2);
  assert.deepEqual(result, {
    claimed: 1,
    deleted: 1,
    notFound: 0,
    blocked: 0,
    stale: 0,
    alreadyCompleted: 0,
    retryScheduled: 0,
    reconciliationRequired: 0,
    interrupted: 0,
    results: [{
      sha256,
      cleanupGeneration: 9,
      outcome: "deleted",
    }],
  });
});

test("cleanup never deletes after exact lease authorization becomes stale", async () => {
  let deleteCalls = 0;
  let claimCalls = 0;
  const dependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async () => {
      claimCalls += 1;
      return claimCalls === 1 ? claim(10) : null;
    },
    authorizeFn: async () => ({
      storageKey: buildMediaBlobStorageKey(sha256),
      status: "stale",
    }),
    renewFn: async () => ({
      leaseExpiresAt: null,
      status: "stale",
    }),
    deleteFn: async () => {
      deleteCalls += 1;
      return "deleted";
    },
    completeFn: async () => "stale",
    recordFailureFn: async () => ({
      status: "stale",
      nextAttemptAt: null,
      failureCount: 0,
    }),
    createTokenFn: () => leaseToken,
    nowFn: () => 0,
    waitFn: async () => {},
  };

  const result = await runMediaBlobCleanupBatchWithDependencies(
    input(new AbortController().signal),
    dependencies,
  );

  assert.equal(result.claimed, 1);
  assert.equal(result.stale, 1);
  assert.equal(deleteCalls, 0);
});

test("cleanup stops before S3 when exact lease renewal is stale", async () => {
  let claimCalls = 0;
  let storageOperations = 0;
  let completionCalls = 0;
  const dependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async () => {
      claimCalls += 1;
      return claimCalls === 1 ? claim(11) : null;
    },
    authorizeFn: async (exactClaim) => ({
      storageKey: exactClaim.storageKey,
      status: "authorized",
    }),
    renewFn: async () => ({
      leaseExpiresAt: null,
      status: "stale",
    }),
    deleteFn: async (deleteInput) => {
      await deleteInput.renewLease("head_object");
      storageOperations += 1;
      return "deleted";
    },
    completeFn: async () => {
      completionCalls += 1;
      return "completed";
    },
    recordFailureFn: async () => {
      throw new Error("stale renewal must not be recorded as owned failure");
    },
    createTokenFn: () => cleanupToken,
    nowFn: () => 0,
    waitFn: async () => {},
  };

  const result = await runMediaBlobCleanupBatchWithDependencies(
    input(new AbortController().signal),
    dependencies,
  );

  assert.equal(result.stale, 1);
  assert.equal(storageOperations, 0);
  assert.equal(completionCalls, 0);
});

test("cleanup reports reconciliation when abort follows the durable delete transition", async () => {
  const controller = new AbortController();
  const abortReason = new Error("Lambda finalization reserve reached.");
  let claimCalls = 0;
  let failureRecordCalls = 0;
  const dependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async () => {
      claimCalls += 1;
      return claimCalls === 1 ? claim(12) : null;
    },
    authorizeFn: async (exactClaim) => ({
      storageKey: exactClaim.storageKey,
      status: "authorized",
    }),
    renewFn: async () => ({
      leaseExpiresAt: "2099-07-30T12:01:00.000Z",
      status: "renewed",
    }),
    deleteFn: async (deleteInput) => {
      await deleteInput.renewLease("delete_object");
      controller.abort(abortReason);
      deleteInput.signal.throwIfAborted();
      return "deleted";
    },
    completeFn: async () => "completed",
    recordFailureFn: async () => {
      failureRecordCalls += 1;
      throw new Error("An aborted invocation must not start failure persistence.");
    },
    createTokenFn: () => cleanupToken,
    nowFn: () => 0,
    waitFn: async () => {},
  };

  await assert.rejects(
    runMediaBlobCleanupBatchWithDependencies(
      input(controller.signal),
      dependencies,
    ),
    (error: unknown) => (
      error instanceof MediaBlobCleanupBatchError
      && error.result.claimed === 1
      && error.result.reconciliationRequired === 1
      && error.failures.length === 2
      && error.failures[0]?.name
        === "MediaBlobCleanupReconciliationRequiredError"
      && error.failures[1]?.name
        === "MediaBlobCleanupFailurePersistenceError"
    ),
  );
  assert.equal(failureRecordCalls, 0);
});

test("cleanup persists terminal reconciliation when completion is interrupted after delete", async () => {
  let claimCalls = 0;
  const completionDeadlineError = new DatabaseDeadlineExceededError(
    "executor_operations",
    10_000,
    new Error("Completion deadline elapsed."),
  );
  const dependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async () => {
      claimCalls += 1;
      return claimCalls === 1 ? claim(13) : null;
    },
    authorizeFn: async (exactClaim) => ({
      storageKey: exactClaim.storageKey,
      status: "authorized",
    }),
    renewFn: async (
      _exactClaim,
      _renewalToken,
      phase,
    ) => {
      if (phase === "complete") throw completionDeadlineError;
      return {
        leaseExpiresAt: "2099-07-30T12:01:00.000Z",
        status: "renewed",
      };
    },
    deleteFn: async (deleteInput) => {
      await deleteInput.renewLease("delete_object");
      return "deleted";
    },
    completeFn: async () => "completed",
    recordFailureFn: async (_exactClaim, failureInput) => {
      assert.equal(failureInput.disposition, "terminal");
      assert.equal(failureInput.phase, "renew");
      return {
        status: "reconciliation_required",
        nextAttemptAt: null,
        failureCount: 1,
      };
    },
    createTokenFn: () => cleanupToken,
    nowFn: () => 0,
    waitFn: async () => {},
  };

  await assert.rejects(
    runMediaBlobCleanupBatchWithDependencies(
      input(new AbortController().signal),
      dependencies,
    ),
    (error: unknown) => (
      error instanceof MediaBlobCleanupBatchError
      && error.result.claimed === 1
      && error.result.reconciliationRequired === 1
      && error.failures.length === 1
      && error.failures[0]?.name
        === "MediaBlobCleanupReconciliationRequiredError"
    ),
  );
});

test("cleanup treats commit-unknown delete renewal as terminal reconciliation", async () => {
  let claimCalls = 0;
  let renewalCalls = 0;
  const commitUnknownError = new DatabaseCommitOutcomeUnknownError(
    new Error("Delete renewal commit response was lost."),
  );
  const dependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async () => {
      claimCalls += 1;
      return claimCalls === 1 ? claim(14) : null;
    },
    authorizeFn: async (exactClaim) => ({
      storageKey: exactClaim.storageKey,
      status: "authorized",
    }),
    renewFn: async () => {
      renewalCalls += 1;
      throw commitUnknownError;
    },
    deleteFn: async (deleteInput) => {
      await deleteInput.renewLease("delete_object");
      return "deleted";
    },
    completeFn: async () => "completed",
    recordFailureFn: async (_exactClaim, failureInput) => {
      assert.equal(failureInput.disposition, "terminal");
      assert.equal(failureInput.phase, "renew");
      return {
        status: "reconciliation_required",
        nextAttemptAt: null,
        failureCount: 1,
      };
    },
    createTokenFn: () => cleanupToken,
    nowFn: () => 0,
    waitFn: async () => {},
  };

  await assert.rejects(
    runMediaBlobCleanupBatchWithDependencies(
      input(new AbortController().signal),
      dependencies,
    ),
    (error: unknown) => (
      error instanceof MediaBlobCleanupBatchError
      && error.result.reconciliationRequired === 1
      && error.failures.length === 1
      && error.failures[0] === commitUnknownError
    ),
  );
  assert.equal(renewalCalls, 3);
});

test("cleanup preserves the original and persistence failures with prior progress", async () => {
  let claimCalls = 0;
  const originalError = new MediaBlobCleanupStorageTransientError(
    "head_object",
    503,
    new Error("SlowDown"),
  );
  const persistenceError = new Error("Failure transaction was rejected.");
  const dependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async () => {
      claimCalls += 1;
      if (claimCalls === 1) return claim(15);
      if (claimCalls === 2) return claim(16);
      return null;
    },
    authorizeFn: async (exactClaim) => ({
      storageKey: exactClaim.storageKey,
      status: "authorized",
    }),
    renewFn: async () => ({
      leaseExpiresAt: "2099-07-30T12:01:00.000Z",
      status: "renewed",
    }),
    deleteFn: async (deleteInput) => {
      if (deleteInput.cleanupGeneration === 16) throw originalError;
      return "not_found";
    },
    completeFn: async () => "completed",
    recordFailureFn: async () => {
      throw persistenceError;
    },
    createTokenFn: () => cleanupToken,
    nowFn: () => 0,
    waitFn: async () => {},
  };

  await assert.rejects(
    runMediaBlobCleanupBatchWithDependencies(
      input(new AbortController().signal),
      dependencies,
    ),
    (error: unknown) => (
      error instanceof MediaBlobCleanupBatchError
      && error.result.claimed === 2
      && error.result.notFound === 1
      && error.result.interrupted === 1
      && error.failures.length === 2
      && error.failures[0] === originalError
      && error.failures[1]?.name
        === "MediaBlobCleanupFailurePersistenceError"
      && error.failures[1]?.cause === persistenceError
    ),
  );
});

test("cleanup wraps claim and process failures with exact partial results", async () => {
  const priorFailure = new MediaBlobCleanupStorageTransientError(
    "head_object",
    503,
    new Error("SlowDown"),
  );
  const claimError = new Error("Global cleanup claim failed.");
  let claimCalls = 0;
  const claimFailureDependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async () => {
      claimCalls += 1;
      if (claimCalls === 1) return claim(17);
      throw claimError;
    },
    authorizeFn: async (exactClaim) => ({
      storageKey: exactClaim.storageKey,
      status: "authorized",
    }),
    renewFn: async () => ({
      leaseExpiresAt: "2099-07-30T12:01:00.000Z",
      status: "renewed",
    }),
    deleteFn: async () => {
      throw priorFailure;
    },
    completeFn: async () => "completed",
    recordFailureFn: async () => ({
      status: "retry_scheduled",
      nextAttemptAt: "2099-07-30T12:02:00.000Z",
      failureCount: 1,
    }),
    createTokenFn: () => cleanupToken,
    nowFn: () => 0,
    waitFn: async () => {},
  };

  await assert.rejects(
    runMediaBlobCleanupBatchWithDependencies(
      input(new AbortController().signal),
      claimFailureDependencies,
    ),
    (error: unknown) => (
      error instanceof MediaBlobCleanupBatchError
      && error.result.claimed === 1
      && error.result.retryScheduled === 1
      && error.failures.length === 2
      && error.failures[0] === priorFailure
      && error.failures[1] === claimError
    ),
  );

  const malformedClaim = {
    ...claim(18),
    leaseExpiresAt: "not-an-instant",
  };
  let malformedClaimCalls = 0;
  const processFailureDependencies: MediaBlobCleanupProcessorDependencies = {
    ...claimFailureDependencies,
    claimFn: async () => {
      malformedClaimCalls += 1;
      return malformedClaimCalls === 1 ? malformedClaim : null;
    },
  };
  await assert.rejects(
    runMediaBlobCleanupBatchWithDependencies(
      input(new AbortController().signal),
      processFailureDependencies,
    ),
    (error: unknown) => (
      error instanceof MediaBlobCleanupBatchError
      && error.result.claimed === 1
      && error.result.interrupted === 1
      && error.failures.length === 1
      && error.failures[0] instanceof TypeError
    ),
  );
});

test("cleanup schedules exhausted transient failure and continues unrelated claims before raising", async () => {
  let claimCalls = 0;
  let failureRecordCalls = 0;
  const completedGenerations: Array<number> = [];
  const transientError = new MediaBlobCleanupStorageTransientError(
    "head_object",
    503,
    new Error("SlowDown"),
  );
  const dependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async () => {
      claimCalls += 1;
      if (claimCalls === 1) return claim(20);
      if (claimCalls === 2) return claim(21);
      return null;
    },
    authorizeFn: async (exactClaim) => ({
      storageKey: exactClaim.storageKey,
      status: "authorized",
    }),
    renewFn: async () => ({
      leaseExpiresAt: "2099-07-30T12:01:00.000Z",
      status: "renewed",
    }),
    deleteFn: async (deleteInput) => {
      await deleteInput.renewLease("head_object");
      if (deleteInput.cleanupGeneration === 20) throw transientError;
      return "not_found";
    },
    completeFn: async (exactClaim) => {
      completedGenerations.push(exactClaim.cleanupGeneration);
      return "completed";
    },
    recordFailureFn: async (_exactClaim, failureInput) => {
      failureRecordCalls += 1;
      assert.equal(failureInput.disposition, "retry");
      assert.equal(failureInput.retryDelayMs, 60_000);
      assert.equal(failureInput.phase, "head_object");
      if (failureRecordCalls === 1) {
        throw new DatabaseCommitOutcomeUnknownError(
          new Error("failure decision commit response lost"),
        );
      }
      return {
        status: "retry_scheduled",
        nextAttemptAt: "2099-07-30T12:02:00.000Z",
        failureCount: 1,
      };
    },
    createTokenFn: () => cleanupToken,
    nowFn: () => 0,
    waitFn: async () => {},
  };

  await assert.rejects(
    runMediaBlobCleanupBatchWithDependencies(
      input(new AbortController().signal),
      dependencies,
    ),
    (error: unknown) => (
      error instanceof MediaBlobCleanupBatchError
      && error.failures.length === 1
      && error.failures[0] === transientError
      && error.result.claimed === 2
      && error.result.retryScheduled === 1
      && error.result.notFound === 1
    ),
  );
  assert.equal(failureRecordCalls, 2);
  assert.deepEqual(completedGenerations, [21]);
  assert.equal(claimCalls, 3);
});

test("cleanup records terminal reconciliation and does not starve another claim", async () => {
  let claimCalls = 0;
  const completedGenerations: Array<number> = [];
  const terminalError = new MediaBlobCleanupStorageAmbiguousDeleteError(
    503,
    buildMediaBlobStorageKey(sha256),
    new Error("conditional delete response was lost"),
  );
  const dependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async () => {
      claimCalls += 1;
      if (claimCalls === 1) return claim(30);
      if (claimCalls === 2) return claim(31);
      return null;
    },
    authorizeFn: async (exactClaim) => ({
      storageKey: exactClaim.storageKey,
      status: "authorized",
    }),
    renewFn: async () => ({
      leaseExpiresAt: "2099-07-30T12:01:00.000Z",
      status: "renewed",
    }),
    deleteFn: async (deleteInput) => {
      await deleteInput.renewLease("head_object");
      if (deleteInput.cleanupGeneration === 30) throw terminalError;
      return "deleted";
    },
    completeFn: async (exactClaim) => {
      completedGenerations.push(exactClaim.cleanupGeneration);
      return "completed";
    },
    recordFailureFn: async (_exactClaim, failureInput) => {
      assert.equal(failureInput.disposition, "terminal");
      assert.equal(failureInput.retryDelayMs, 0);
      assert.equal(failureInput.phase, "delete_object");
      return {
        status: "reconciliation_required",
        nextAttemptAt: null,
        failureCount: 1,
      };
    },
    createTokenFn: () => cleanupToken,
    nowFn: () => 0,
    waitFn: async () => {},
  };

  await assert.rejects(
    runMediaBlobCleanupBatchWithDependencies(
      input(new AbortController().signal),
      dependencies,
    ),
    (error: unknown) => (
      error instanceof MediaBlobCleanupBatchError
      && error.failures.length === 1
      && error.failures[0] === terminalError
      && error.result.claimed === 2
      && error.result.reconciliationRequired === 1
      && error.result.deleted === 1
    ),
  );
  assert.deepEqual(completedGenerations, [31]);
  assert.equal(claimCalls, 3);
});

test("cleanup respects its batch bound, deadline budget, and abort signal", async () => {
  let nowMs = 0;
  let claimCalls = 0;
  const dependencies: MediaBlobCleanupProcessorDependencies = {
    claimFn: async () => {
      claimCalls += 1;
      return claim(claimCalls);
    },
    authorizeFn: async (exactClaim) => ({
      storageKey: exactClaim.storageKey,
      status: "authorized",
    }),
    renewFn: async () => ({
      leaseExpiresAt: "2099-07-30T12:01:00.000Z",
      status: "renewed",
    }),
    deleteFn: async (deleteInput) => {
      await deleteInput.renewLease("head_object");
      nowMs = 9_500;
      return "not_found";
    },
    completeFn: async () => "completed",
    recordFailureFn: async () => ({
      status: "retry_scheduled",
      nextAttemptAt: "2099-07-30T12:02:00.000Z",
      failureCount: 1,
    }),
    createTokenFn: () => cleanupToken,
    nowFn: () => nowMs,
    waitFn: async () => {},
  };
  const deadlineResult = await runMediaBlobCleanupBatchWithDependencies(
    input(new AbortController().signal),
    dependencies,
  );
  assert.equal(deadlineResult.claimed, 1);
  assert.equal(deadlineResult.notFound, 1);
  assert.equal(deadlineResult.interrupted, 1);
  assert.equal(claimCalls, 1);

  const controller = new AbortController();
  controller.abort(new Error("Lambda finalization reserve reached."));
  claimCalls = 0;
  const abortedResult = await runMediaBlobCleanupBatchWithDependencies(
    input(controller.signal),
    dependencies,
  );
  assert.equal(abortedResult.claimed, 0);
  assert.equal(abortedResult.interrupted, 1);
  assert.equal(claimCalls, 0);

  nowMs = 0;
  const boundedDependencies: MediaBlobCleanupProcessorDependencies = {
    ...dependencies,
    deleteFn: async (deleteInput) => {
      await deleteInput.renewLease("head_object");
      return "not_found";
    },
  };
  const boundedResult = await runMediaBlobCleanupBatchWithDependencies(
    {
      ...input(new AbortController().signal),
      maximumCandidates: 2,
    },
    boundedDependencies,
  );
  assert.equal(boundedResult.claimed, 2);
  assert.equal(boundedResult.interrupted, 0);
  assert.equal(claimCalls, 2);
});

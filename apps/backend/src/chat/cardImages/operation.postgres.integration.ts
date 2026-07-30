import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  SessionAdvisoryLockAbortedError, SessionAdvisoryLockTimeoutError,
  withSessionAdvisoryLock, type SessionAdvisoryLockInput,
} from "../../database";
import {
  closeSessionAdvisoryLockPoolForTests, readSessionAdvisoryLockWaitingCountForTests,
  SessionAdvisoryLockCapacityError, toSessionAdvisoryLockConnectionBoundaryError,
} from "../../database/sessionAdvisoryLock";
import {
  DatabaseCommitOutcomeUnknownError, TransientDatabaseHttpError,
} from "../../database/transient";
import type { GeneratedMediaStagingObject } from "../../mediaAssets/storage";
import { imageJpegCardMediaBlobMimeType } from "../../mediaAssets/types";
import { createBackendObservationScope } from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import { claimChatRun, InactiveChatRunClaimError, prepareChatRun, type ClaimedChatRun } from "../runs";
import {
  bindGeneratedCardImageAttemptPayload,
  markGeneratedCardImageProviderStarted,
  reserveGeneratedCardImageAttempt,
} from "../openai/tools/generatedImageAttemptBudget";
import { deriveGeneratedCardImageOperationMetadata } from "./metadata";
import { createGeneratedCardImageOperationDependencies, generateCardImageWithDependencies } from "./operation";
import {
  GeneratedCardImageOperationLockAbortedError,
  withGeneratedCardImageOperationLock, type GeneratedCardImageOperationLockInput,
} from "./operationLock";
import { enqueueGeneratedMediaPromotionJob } from "./promotionJobs";
import {
  GeneratedCardImageProviderOutcomeUnknownError,
} from "./providerTypes";
import type { GeneratedCardImageInput } from "./types";
const normalizedBytes = Buffer.from("deterministic-local-normalized-image");
const normalizedSha256 = "8349792a6784cfdc5061b34e1184c85bcdb13719e86ac4be576e52e5e8c5f603";
const lockSessionApplicationName = "backend-session-advisory-lock";
type CountRow = Readonly<{ count: string }>;
type TransactionStateRow = Readonly<{ session_count: string; no_open_transaction: boolean }>;
type PersistedCardRow = Readonly<{ back_text: string }>;
type PromotionJobRow = Readonly<{
  user_id: string; operation_id: string; card_id: string; replica_id: string;
  sha256: string; state: string;
}>;
type AdvisoryLockRow = Readonly<{ acquired: boolean }>;
type AdvisoryUnlockRow = Readonly<{ unlocked: boolean }>;
type BackendPidRow = Readonly<{ pid: number }>;
type TerminateBackendRow = Readonly<{ terminated: boolean }>;
type Deferred = Readonly<{ promise: Promise<void>; resolve: () => void }>;
type HeldLock = Readonly<{ completion: Promise<void>; release: () => void }>;
type LockRunner<Input> = (input: Input, callback: (signal: AbortSignal) => Promise<void>) => Promise<void>;
function createDeferred(): Deferred {
  let resolvePromise = (): void => { throw new Error("Deferred resolver was not initialized."); };
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}
async function waitForValue<Value>(loadValue: () => Promise<Value | null>, failureMessage: string): Promise<Value> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await loadValue();
    if (value !== null) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(failureMessage);
}
async function holdLock<Input>(runner: LockRunner<Input>, input: Input): Promise<HeldLock> {
  const started = createDeferred();
  const release = createDeferred();
  const completion = runner(input, async (_signal) => {
    started.resolve();
    await release.promise;
  });
  await started.promise;
  return { completion, release: release.resolve };
}
function createInput(
  fixture: PostgresIntegrationFixture, run: ClaimedChatRun,
  targetSide: "front" | "back", signal: AbortSignal,
): GeneratedCardImageInput {
  return {
    runId: run.runId,
    operationKey: "generated-image:1",
    sessionId: run.sessionId,
    claimToken: run.claimToken,
    userId: fixture.userId, workspaceId: fixture.workspaceId,
    cardId: fixture.cardId, targetSide,
    imagePrompt: "Draw a deterministic integration diagram.",
    altText: "Generated integration diagram",
    replicaId: fixture.replicaId,
    observationContext: {
      scope: createBackendObservationScope(
        "chat-worker", "generated-image-postgres-integration", null, null, fixture.userId,
        fixture.workspaceId, "generated-image-postgres-chat-request", run.runId,
        run.sessionId, null, null,
      ),
      rootObservation: null,
    },
    signal, operationDeadlineMs: Date.now() + 120_000,
  };
}
async function createClaimedImageRun(fixture: PostgresIntegrationFixture): Promise<ClaimedChatRun> {
  const prepared = await prepareChatRun(
    fixture.userId, fixture.workspaceId, undefined,
    [{ type: "text", text: "Generate an image for this card." }],
    randomUUID(), "Europe/Madrid", null, true,
  );
  const claimed = await claimChatRun(fixture.userId, fixture.workspaceId, prepared.runId);
  if (claimed === null) {
    throw new Error(`Failed to claim generated image integration run. runId=${prepared.runId}`);
  }
  return claimed;
}
async function reserveAndBindGeneratedImageOperation(
  fixture: PostgresIntegrationFixture,
  run: ClaimedChatRun,
): Promise<void> {
  const params = {
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
    runId: run.runId,
    sessionId: run.sessionId,
    claimToken: run.claimToken,
    operationKey: "generated-image:1",
    databaseDeadlineAtMs: Date.now() + 120_000,
  };
  assert.deepEqual(await reserveGeneratedCardImageAttempt(params), {
    status: "reserved",
    attempt: 1,
    payload: null,
  });
  await bindGeneratedCardImageAttemptPayload({
    ...params,
    attempt: 1,
    payload: {
      cardId: fixture.cardId,
      targetSide: "back",
      imagePrompt: "Draw a deterministic integration diagram.",
      altText: "Generated integration diagram",
    },
  });
}
async function waitForLockAttemptCount(fixture: PostgresIntegrationFixture, expectedCount: number): Promise<void> {
  await waitForValue(async () => {
    const result = await fixture.ownerPool.query<CountRow>(
      `SELECT count(DISTINCT pid)::text AS count FROM pg_stat_activity
       WHERE application_name = $1 AND query LIKE 'SELECT pg_try_advisory_lock(%'`,
      [lockSessionApplicationName],
    );
    return Number.parseInt(result.rows[0]?.count ?? "0", 10) >= expectedCount ? true : null;
  }, `Expected ${expectedCount} sessions to execute pg_try_advisory_lock.`);
}
async function waitForSingleLockSessionPid(fixture: PostgresIntegrationFixture): Promise<number> {
  return waitForValue(async () => {
    const result = await fixture.ownerPool.query<BackendPidRow>(
      `SELECT pid FROM pg_stat_activity
       WHERE application_name = $1 AND query LIKE 'SELECT pg_try_advisory_lock(%'`,
      [lockSessionApplicationName],
    );
    return result.rows.length === 1 ? result.rows[0]?.pid ?? null : null;
  }, "Expected exactly one checked-out session advisory lock connection.");
}
async function waitForLockPoolWaitingCount(expectedCount: number): Promise<void> {
  await waitForValue(async () => readSessionAdvisoryLockWaitingCountForTests() === expectedCount ? true : null,
    `Expected the session advisory lock admission queue to have ${expectedCount} waiting requests.`);
}
async function waitForBackendExit(fixture: PostgresIntegrationFixture, backendPid: number): Promise<void> {
  await waitForValue(async () => {
    const result = await fixture.ownerPool.query<CountRow>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE pid = $1",
      [backendPid],
    );
    return result.rows[0]?.count === "0" ? true : null;
  }, `Terminated advisory lock backend remained active. backendPid=${backendPid}`);
}
async function assertAdvisoryLockReleased(fixture: PostgresIntegrationFixture, lockKey: string): Promise<void> {
  const client = await fixture.ownerPool.connect();
  let releaseError: Error | undefined;
  try {
    const acquired = await client.query<AdvisoryLockRow>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 3::bigint)) AS acquired", [lockKey],
    );
    assert.equal(acquired.rows[0]?.acquired, true);
    const unlocked = await client.query<AdvisoryUnlockRow>(
      "SELECT pg_advisory_unlock(hashtextextended($1, 3::bigint)) AS unlocked", [lockKey],
    );
    assert.equal(unlocked.rows[0]?.unlocked, true);
  } catch (error) {
    releaseError = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock_all()");
    } catch (error) {
      releaseError ??= error instanceof Error ? error : new Error(String(error));
    }
    client.release(releaseError);
  }
  if (releaseError !== undefined) throw releaseError;
}
async function countMediaAsset(fixture: PostgresIntegrationFixture, mediaAssetId: string): Promise<number> {
  const result = await fixture.ownerPool.query<CountRow>(
    "SELECT count(*)::text AS count FROM content.media_assets WHERE workspace_id = $1 AND media_asset_id = $2",
    [fixture.workspaceId, mediaAssetId],
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}
async function assertNoExternalWorkTransaction(fixture: PostgresIntegrationFixture): Promise<void> {
  const result = await fixture.ownerPool.query<TransactionStateRow>(
    `SELECT
       count(*)::text AS session_count,
       COALESCE(bool_and(xact_start IS NULL), false) AS no_open_transaction
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND usename = 'backend_app'
       AND application_name = ''`,
  );
  assert.notEqual(result.rows[0]?.session_count, "0");
  assert.equal(result.rows[0]?.no_open_transaction, true);
}
function operationLockInput(
  fixture: PostgresIntegrationFixture, mediaAssetId: string, signal: AbortSignal,
): GeneratedCardImageOperationLockInput {
  return { workspaceId: fixture.workspaceId, mediaAssetId, signal };
}
function sessionLockInput(lockKey: string, timeoutMs: number): SessionAdvisoryLockInput {
  return {
    lockName: "generated-image-timeout-integration", lockKey, timeoutMs, pollIntervalMs: 10,
    signal: new AbortController().signal,
  };
}
test("generated image operation reconciles ambiguous enqueue without early card visibility", async () => {
  try {
    await withPostgresIntegrationFixture(async (fixture) => {
      const run = await createClaimedImageRun(fixture);
      await reserveAndBindGeneratedImageOperation(fixture, run);
      const operationMetadata = deriveGeneratedCardImageOperationMetadata(
        run.runId,
        "generated-image:1",
      );
      const providerStarted = createDeferred();
      const releaseProvider = createDeferred();
      let providerCalls = 0;
      let storageCalls = 0;
      let enqueueCalls = 0;
      let stagedObject: GeneratedMediaStagingObject | null = null;
      const dependencies = createGeneratedCardImageOperationDependencies({
        markProviderStartedFn: markGeneratedCardImageProviderStarted,
        generateProviderImageFn: async () => {
          providerCalls += 1;
          providerStarted.resolve();
          await releaseProvider.promise;
          return {
            bytes: Buffer.from("deterministic-provider-image"),
            providerRequestId: null,
          };
        },
        normalizeImageBytesForCardFn: async () => ({
          bytes: normalizedBytes, mimeType: imageJpegCardMediaBlobMimeType,
          sizeBytes: normalizedBytes.byteLength,
        }),
        loadGeneratedMediaStagingObjectFn: async () => stagedObject,
        storeGeneratedMediaStagingObjectFn: async (input) => {
          storageCalls += 1;
          assert.equal(input.sha256, normalizedSha256);
          assert.match(input.stagingStorageKey, /^media\/uploads\//u);
          assert.equal(await countMediaAsset(fixture, input.mediaAssetId), 0);
          await assertNoExternalWorkTransaction(fixture);
          stagedObject = {
            stagingStorageKey: input.stagingStorageKey,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            sha256: input.sha256,
          };
          return stagedObject;
        },
        enqueueGeneratedMediaPromotionJobFn: async (input) => {
          enqueueCalls += 1;
          const result = await enqueueGeneratedMediaPromotionJob(input);
          if (enqueueCalls === 1) {
            throw new DatabaseCommitOutcomeUnknownError(
              new Error("Simulated lost COMMIT response after durable enqueue."),
            );
          }
          return result;
        },
      });
      const operations: Array<Promise<unknown>> = [];
      try {
        const first = generateCardImageWithDependencies(
          createInput(fixture, run, "back", new AbortController().signal), dependencies,
        );
        operations.push(first);
        void first.catch(() => undefined);
        await providerStarted.promise;
        await assertNoExternalWorkTransaction(fixture);
        const second = generateCardImageWithDependencies(
          createInput(fixture, run, "back", new AbortController().signal), dependencies,
        );
        operations.push(second);
        void second.catch(() => undefined);
        await waitForLockAttemptCount(fixture, 2);
        releaseProvider.resolve();
        const results = await Promise.all([first, second]);
        assert.equal(providerCalls, 1);
        assert.equal(storageCalls, 1);
        assert.deepEqual(results.map((result) => result.reused).sort(), [true, true]);
        assert.equal(results.every((result) => result.cardAppendApplied === false), true);
        assert.deepEqual(results.map((result) => result.status), ["already_queued", "already_queued"]);
        assert.equal(enqueueCalls, 3);
        assert.equal(await countMediaAsset(fixture, operationMetadata.mediaAssetId), 0);
        const card = await fixture.ownerPool.query<PersistedCardRow>(
          "SELECT back_text FROM content.cards WHERE workspace_id = $1 AND card_id = $2",
          [fixture.workspaceId, fixture.cardId],
        );
        assert.equal(card.rows[0]?.back_text, "Original answer");
        const job = await fixture.ownerPool.query<PromotionJobRow>(
          `SELECT user_id, operation_id, card_id, replica_id, sha256, state
           FROM content.generated_media_promotion_jobs
           WHERE operation_id = $1`,
          [operationMetadata.operationId],
        );
        assert.deepEqual(job.rows[0], {
          user_id: fixture.userId,
          operation_id: operationMetadata.operationId,
          card_id: fixture.cardId,
          replica_id: fixture.replicaId,
          sha256: normalizedSha256,
          state: "pending",
        });
        await closeSessionAdvisoryLockPoolForTests();
        const operationLockKey = `chat.generated_card_image:${fixture.workspaceId}:${operationMetadata.mediaAssetId}`;
        const holder = await holdLock(
          withGeneratedCardImageOperationLock,
          operationLockInput(fixture, operationMetadata.mediaAssetId, new AbortController().signal),
        );
        try {
          const abortController = new AbortController();
          const abortedRetry = withGeneratedCardImageOperationLock(
            operationLockInput(fixture, operationMetadata.mediaAssetId, abortController.signal),
            async (_signal) => { throw new Error("Aborted lock contender unexpectedly acquired the lock."); },
          );
          const abortedResult = assert.rejects(
            abortedRetry,
            (error: unknown) => error instanceof GeneratedCardImageOperationLockAbortedError,
          );
          await waitForLockAttemptCount(fixture, 2);
          abortController.abort(new Error("Stop generated image retry."));
          await abortedResult;
        } finally {
          holder.release();
          await holder.completion;
        }
        await assertAdvisoryLockReleased(fixture, operationLockKey);
        await closeSessionAdvisoryLockPoolForTests();
        const completedRetry = await generateCardImageWithDependencies(
          createInput(fixture, run, "back", new AbortController().signal), dependencies,
        );
        assert.equal(completedRetry.reused, true);
        assert.equal(completedRetry.cardAppendApplied, false);
        assert.equal(completedRetry.status, "already_queued");
        assert.equal(providerCalls, 1);
        await closeSessionAdvisoryLockPoolForTests();
        const timeoutKey = `generated-image-timeout:${randomUUID()}`;
        const timeoutHolder = await holdLock(withSessionAdvisoryLock, sessionLockInput(timeoutKey, 1_000));
        try {
          const timeoutResult = assert.rejects(
            withSessionAdvisoryLock(sessionLockInput(timeoutKey, 75), async (_signal) => "unexpected"),
            (error: unknown) => error instanceof SessionAdvisoryLockTimeoutError,
          );
          await waitForLockAttemptCount(fixture, 2);
          await timeoutResult;
        } finally {
          timeoutHolder.release();
          await timeoutHolder.completion;
        }
        await assertAdvisoryLockReleased(fixture, timeoutKey);
        await closeSessionAdvisoryLockPoolForTests();
        assert.equal(
          await withSessionAdvisoryLock(sessionLockInput(timeoutKey, 1_000), async (_signal) => "reacquired"),
          "reacquired",
        );
        await assert.rejects(
          generateCardImageWithDependencies(
            { ...createInput(fixture, run, "back", new AbortController().signal),
              claimToken: "stale-claim-token" },
            dependencies,
          ),
          (error: unknown) => error instanceof InactiveChatRunClaimError,
        );
        assert.equal(providerCalls, 1);
      } finally {
        releaseProvider.resolve();
        await Promise.allSettled(operations);
        await fixture.ownerPool.query(
          "DELETE FROM content.generated_media_promotion_jobs WHERE workspace_id = $1",
          [fixture.workspaceId],
        );
      }
    });
  } finally {
    await closeSessionAdvisoryLockPoolForTests();
  }
});
test("persisted provider start blocks replay without staging and permits staged reuse", async () => {
  try {
    await withPostgresIntegrationFixture(async (fixture) => {
      const run = await createClaimedImageRun(fixture);
      await reserveAndBindGeneratedImageOperation(fixture, run);
      const input = createInput(
        fixture,
        run,
        "back",
        new AbortController().signal,
      );
      const metadata = deriveGeneratedCardImageOperationMetadata(
        run.runId,
        input.operationKey,
      );
      assert.deepEqual(
        await markGeneratedCardImageProviderStarted({
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
          runId: run.runId,
          sessionId: run.sessionId,
          claimToken: run.claimToken,
          operationKey: input.operationKey,
          databaseDeadlineAtMs: input.operationDeadlineMs,
        }),
        { status: "first_started" },
      );

      let providerCalls = 0;
      let providerStartCalls = 0;
      let stagedObject: GeneratedMediaStagingObject | null = null;
      const dependencies = createGeneratedCardImageOperationDependencies({
        markProviderStartedFn: async (params) => {
          providerStartCalls += 1;
          return markGeneratedCardImageProviderStarted(params);
        },
        generateProviderImageFn: async () => {
          providerCalls += 1;
          throw new Error("Provider must not run after a durable provider start.");
        },
        normalizeImageBytesForCardFn: async () => {
          throw new Error("Normalization must not run after a durable provider start.");
        },
        loadGeneratedMediaStagingObjectFn: async () => stagedObject,
        storeGeneratedMediaStagingObjectFn: async () => {
          throw new Error("Storage must not run after a durable provider start.");
        },
        enqueueGeneratedMediaPromotionJobFn: async (job) => ({
          outcome: "created",
          jobId: job.jobId,
        }),
      });

      await assert.rejects(
        generateCardImageWithDependencies(input, dependencies),
        (error: unknown) =>
          error instanceof GeneratedCardImageProviderOutcomeUnknownError,
      );
      assert.equal(providerStartCalls, 1);
      assert.equal(providerCalls, 0);

      stagedObject = {
        stagingStorageKey: `media/uploads/${metadata.operationId}`,
        mimeType: imageJpegCardMediaBlobMimeType,
        sizeBytes: normalizedBytes.byteLength,
        sha256: normalizedSha256,
      };
      const replay = await generateCardImageWithDependencies(
        createInput(fixture, run, "back", new AbortController().signal),
        dependencies,
      );
      assert.equal(replay.status, "queued");
      assert.equal(replay.reused, true);
      assert.equal(providerStartCalls, 1);
      assert.equal(providerCalls, 0);
    });
  } finally {
    await closeSessionAdvisoryLockPoolForTests();
  }
});
test("session advisory lock cancels work when its PostgreSQL backend is terminated", async () => {
  try {
    await withPostgresIntegrationFixture(async (fixture) => {
      await closeSessionAdvisoryLockPoolForTests();
      const lockKey = `generated-image-lock-loss:${randomUUID()}`;
      const callerAbort = new AbortController();
      const callbackStarted = createDeferred();
      let callbackObservedAbort = false;
      const operation = withSessionAdvisoryLock(
        { ...sessionLockInput(lockKey, 1_000), signal: callerAbort.signal },
        async (signal) => {
          callbackStarted.resolve();
          await new Promise<void>((_resolve, reject) => {
            const onAbort = (): void => {
              callbackObservedAbort = true;
              reject(signal.reason);
            };
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
          });
        },
      );
      const failedOperation = assert.rejects(
        operation,
        (error: unknown) => error instanceof HttpError && error.code === "SERVICE_UNAVAILABLE",
      );
      try {
        await callbackStarted.promise;
        const terminatedPid = await waitForSingleLockSessionPid(fixture);
        const termination = await fixture.ownerPool.query<TerminateBackendRow>(
          "SELECT pg_terminate_backend($1) AS terminated", [terminatedPid],
        );
        assert.equal(termination.rows[0]?.terminated, true);
        await failedOperation;
        assert.equal(callbackObservedAbort, true);
        await waitForBackendExit(fixture, terminatedPid);
        const replacement = await holdLock(withSessionAdvisoryLock, sessionLockInput(lockKey, 1_000));
        try {
          const replacementPid = await waitForSingleLockSessionPid(fixture);
          assert.notEqual(replacementPid, terminatedPid);
        } finally {
          replacement.release();
          await replacement.completion;
        }
        await assertAdvisoryLockReleased(fixture, lockKey);
      } finally {
        callerAbort.abort(new Error("Clean up terminated advisory lock integration."));
        await Promise.allSettled([operation, failedOperation]);
      }
    });
  } finally {
    await closeSessionAdvisoryLockPoolForTests();
  }
});
test("session advisory lock bounds admission and promptly removes cancelled waiters", async () => {
  try {
    await withPostgresIntegrationFixture(async (fixture) => {
      await closeSessionAdvisoryLockPoolForTests();
      const firstKey = `generated-image-pool-first:${randomUUID()}`;
      const secondKey = `generated-image-pool-second:${randomUUID()}`;
      const timedOutKey = `generated-image-pool-timed-out:${randomUUID()}`;
      const abortedKey = `generated-image-pool-aborted:${randomUUID()}`;
      const thirdKey = `generated-image-pool-third:${randomUUID()}`;
      const first = await holdLock(withSessionAdvisoryLock, sessionLockInput(firstKey, 1_000));
      const second = await holdLock(withSessionAdvisoryLock, sessionLockInput(secondKey, 1_000));
      let firstReleased = false;
      let secondReleased = false;
      let thirdAcquired = false;
      let thirdError: unknown;
      const excessControllers: Array<AbortController> = [];
      const excessWaiters: Array<Promise<void>> = [];
      const timedOutWaiter = withSessionAdvisoryLock(
        sessionLockInput(timedOutKey, 75),
        async (_signal) => { throw new Error("Timed-out pool waiter unexpectedly acquired the lock."); },
      );
      const timedOutResult = assert.rejects(
        timedOutWaiter,
        (error: unknown) => error instanceof SessionAdvisoryLockTimeoutError,
      );
      const abortController = new AbortController();
      const abortedWaiter = withSessionAdvisoryLock(
        { ...sessionLockInput(abortedKey, 10_000), signal: abortController.signal },
        async (_signal) => { throw new Error("Aborted pool waiter unexpectedly acquired the lock."); },
      );
      const abortedResult = assert.rejects(
        abortedWaiter,
        (error: unknown) => error instanceof SessionAdvisoryLockAbortedError,
      );
      const thirdCompletion = withSessionAdvisoryLock(sessionLockInput(thirdKey, 10_000),
        async (_signal) => { thirdAcquired = true; }).catch((error: unknown) => { thirdError = error; });
      try {
        await waitForLockPoolWaitingCount(3);
        abortController.abort(new Error("Remove cancelled pool waiter."));
        await Promise.all([timedOutResult, abortedResult]);
        await waitForLockPoolWaitingCount(1);
        assert.equal(thirdAcquired, false);
        assert.equal(thirdError, undefined);
        for (let index = 0; index < 7; index += 1) {
          const controller = new AbortController();
          excessControllers.push(controller);
          const waiter = withSessionAdvisoryLock(
            { ...sessionLockInput(`generated-image-pool-excess-${index}:${randomUUID()}`, 10_000),
              signal: controller.signal },
            async (signal) => new Promise<void>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
          );
          excessWaiters.push(waiter);
          void waiter.catch(() => undefined);
        }
        await waitForLockPoolWaitingCount(8);
        const capacityKey = `generated-image-pool-capacity:${randomUUID()}`;
        await assert.rejects(
          withSessionAdvisoryLock(
            sessionLockInput(capacityKey, 10_000),
            async (_signal) => { throw new Error("Excess waiter unexpectedly acquired the lock."); },
          ),
          (error: unknown) => error instanceof SessionAdvisoryLockCapacityError
            && error.maximumPendingCount === 8,
        );
        first.release();
        firstReleased = true;
        await first.completion;
        await thirdCompletion;
        assert.equal(thirdError, undefined);
        assert.equal(thirdAcquired, true);
        excessControllers.forEach((controller) => controller.abort(new Error("Clean up excess waiter.")));
        const excessResults = await Promise.allSettled(excessWaiters);
        assert.equal(excessResults.every((result) => result.status === "rejected"), true);
        await waitForLockPoolWaitingCount(0);
      } finally {
        abortController.abort(new Error("Clean up cancelled pool waiter."));
        excessControllers.forEach((controller) => controller.abort(new Error("Clean up excess waiter.")));
        if (!firstReleased) {
          first.release();
          await first.completion;
        }
        if (!secondReleased) {
          second.release();
          secondReleased = true;
          await second.completion;
        }
        await Promise.allSettled([timedOutWaiter, abortedWaiter, thirdCompletion, ...excessWaiters]);
      }
      await Promise.all([firstKey, secondKey, timedOutKey, abortedKey, thirdKey]
        .map((lockKey) => assertAdvisoryLockReleased(fixture, lockKey)));
      const mappedError = toSessionAdvisoryLockConnectionBoundaryError(new Error("timeout expired"));
      assert.ok(mappedError instanceof TransientDatabaseHttpError);
      assert.equal(mappedError.code, "SERVICE_UNAVAILABLE");
      assert.equal(mappedError.errorCode, "ETIMEDOUT");
      assert.equal(mappedError.databaseErrorClass, "SessionAdvisoryLockConnectionTimeoutError");
      assert.equal(mappedError.databaseErrorMessage, "PostgreSQL session advisory lock connection timed out. timeoutMs=5000");
    });
  } finally {
    await closeSessionAdvisoryLockPoolForTests();
  }
});

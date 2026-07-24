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
import { TransientDatabaseHttpError } from "../../database/transient";
import { imageJpegCardMediaBlobMimeType } from "../../mediaAssets/types";
import { createBackendObservationScope } from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import { deriveGeneratedCardImageOperationMetadata } from "./metadata";
import { createGeneratedCardImageOperationDependencies, generateCardImageWithDependencies } from "./operation";
import {
  GeneratedCardImageOperationLockAbortedError,
  withGeneratedCardImageOperationLock, type GeneratedCardImageOperationLockInput,
} from "./operationLock";
import type { GeneratedCardImageInput } from "./types";
const normalizedBytes = Buffer.from("deterministic-local-normalized-image");
const normalizedSha256 = "8349792a6784cfdc5061b34e1184c85bcdb13719e86ac4be576e52e5e8c5f603";
const lockSessionApplicationName = "backend-session-advisory-lock";
type CountRow = Readonly<{ count: string }>;
type TransactionStateRow = Readonly<{ session_count: string; no_open_transaction: boolean }>;
type PersistedAssetRow = Readonly<{ source_url: string | null; sha256: string; normalization_version: string }>;
type PersistedCardRow = Readonly<{ back_text: string }>;
type HotChangeCountRow = Readonly<{ entity_type: string; count: string }>;
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
  fixture: PostgresIntegrationFixture, runId: string, targetSide: "front" | "back", signal: AbortSignal,
): GeneratedCardImageInput {
  return {
    runId, userId: fixture.userId, workspaceId: fixture.workspaceId,
    cardId: fixture.cardId, targetSide,
    imagePrompt: "Draw a deterministic integration diagram.",
    altText: "Generated integration diagram",
    replicaId: fixture.replicaId,
    observationContext: {
      scope: createBackendObservationScope(
        "chat-worker", "generated-image-postgres-integration", null, null, fixture.userId,
        fixture.workspaceId, "generated-image-postgres-chat-request", runId,
        "55555555-5555-4555-8555-555555555555", null, null,
      ),
      rootObservation: null,
    },
    signal,
  };
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
test("generated image operation coordinates real sessions and persists atomically", async () => {
  try {
    await withPostgresIntegrationFixture(async (fixture) => {
      const runId = randomUUID();
      const operationMetadata = deriveGeneratedCardImageOperationMetadata(runId, fixture.cardId, "back");
      const providerStarted = createDeferred();
      const releaseProvider = createDeferred();
      let providerCalls = 0;
      let storageCalls = 0;
      const dependencies = createGeneratedCardImageOperationDependencies({
        generateProviderImageFn: async () => {
          providerCalls += 1;
          providerStarted.resolve();
          await releaseProvider.promise;
          return { bytes: Buffer.from("deterministic-provider-image"), providerRequestId: null };
        },
        normalizeImageBytesForCardFn: async () => ({
          bytes: normalizedBytes, mimeType: imageJpegCardMediaBlobMimeType,
          sizeBytes: normalizedBytes.byteLength,
        }),
        storeMediaAssetBlobBytesIfAbsentFn: async (input) => {
          storageCalls += 1;
          assert.equal(input.sha256, normalizedSha256);
          assert.equal(await countMediaAsset(fixture, input.mediaAssetId), 0);
          await assertNoExternalWorkTransaction(fixture);
        },
        currentTimestampFn: () => fixture.createdAt,
      });
      const operations: Array<Promise<unknown>> = [];
      try {
        const first = generateCardImageWithDependencies(
          createInput(fixture, runId, "back", new AbortController().signal), dependencies,
        );
        operations.push(first);
        void first.catch(() => undefined);
        await providerStarted.promise;
        await assertNoExternalWorkTransaction(fixture);
        const second = generateCardImageWithDependencies(
          createInput(fixture, runId, "back", new AbortController().signal), dependencies,
        );
        operations.push(second);
        void second.catch(() => undefined);
        await waitForLockAttemptCount(fixture, 2);
        releaseProvider.resolve();
        const results = await Promise.all([first, second]);
        assert.equal(providerCalls, 1);
        assert.equal(storageCalls, 1);
        assert.deepEqual(results.map((result) => result.reused).sort(), [false, true]);
        assert.deepEqual(results.map((result) => result.cardAppendApplied).sort(), [false, true]);
        assert.equal(results.every((result) => result.sourceUrl === null), true);
        const asset = await fixture.ownerPool.query<PersistedAssetRow>(
          `SELECT media_assets.source_url, media_blobs.sha256, media_blobs.normalization_version
             FROM content.media_assets AS media_assets
             INNER JOIN content.media_blobs AS media_blobs
               ON media_blobs.media_blob_id = media_assets.media_blob_id
             WHERE media_assets.workspace_id = $1 AND media_assets.media_asset_id = $2`,
          [fixture.workspaceId, operationMetadata.mediaAssetId],
        );
        assert.deepEqual(asset.rows[0], {
          source_url: null, sha256: normalizedSha256, normalization_version: "image-jpeg-card-v1",
        });
        const card = await fixture.ownerPool.query<PersistedCardRow>(
          "SELECT back_text FROM content.cards WHERE workspace_id = $1 AND card_id = $2",
          [fixture.workspaceId, fixture.cardId],
        );
        const assetReference = new RegExp(`fcasset:${operationMetadata.mediaAssetId}`, "gu");
        assert.equal(card.rows[0]?.back_text.match(assetReference)?.length, 1);
        const hotChanges = await fixture.ownerPool.query<HotChangeCountRow>(
          [
            "SELECT entity_type, count(*)::text AS count FROM sync.hot_changes",
            "WHERE workspace_id = $1 GROUP BY entity_type ORDER BY entity_type",
          ].join(" "),
          [fixture.workspaceId],
        );
        assert.deepEqual(hotChanges.rows, [
          { entity_type: "card", count: "1" },
          { entity_type: "media_asset", count: "1" },
        ]);
        const failedRunId = randomUUID();
        const failedMetadata = deriveGeneratedCardImageOperationMetadata(failedRunId, fixture.cardId, "front");
        await fixture.ownerPool.query(
          "UPDATE content.cards SET front_text = $1 WHERE workspace_id = $2 AND card_id = $3",
          ["```markdown\nUnclosed", fixture.workspaceId, fixture.cardId],
        );
        await assert.rejects(
          generateCardImageWithDependencies(
            createInput(fixture, failedRunId, "front", new AbortController().signal),
            dependencies,
          ),
          (error: unknown) => error instanceof HttpError
            && error.code === "CARD_IMAGE_APPEND_MARKDOWN_BLOCK_UNCLOSED",
        );
        assert.equal(await countMediaAsset(fixture, failedMetadata.mediaAssetId), 0);
        const hotChangeCount = await fixture.ownerPool.query<CountRow>(
          "SELECT count(*)::text AS count FROM sync.hot_changes WHERE workspace_id = $1",
          [fixture.workspaceId],
        );
        assert.equal(hotChangeCount.rows[0]?.count, "2");
        await fixture.ownerPool.query(
          "UPDATE content.cards SET front_text = $1 WHERE workspace_id = $2 AND card_id = $3",
          ["Original question", fixture.workspaceId, fixture.cardId],
        );
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
          createInput(fixture, runId, "back", new AbortController().signal), dependencies,
        );
        assert.equal(completedRetry.reused, true);
        assert.equal(completedRetry.cardAppendApplied, false);
        assert.equal(providerCalls, 2);
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
      } finally {
        releaseProvider.resolve();
        await Promise.allSettled(operations);
        await fixture.ownerPool.query(
          "DELETE FROM content.media_assets WHERE workspace_id = $1", [fixture.workspaceId],
        );
        await fixture.ownerPool.query(
          "DELETE FROM content.media_blobs WHERE sha256 = $1", [normalizedSha256],
        );
      }
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

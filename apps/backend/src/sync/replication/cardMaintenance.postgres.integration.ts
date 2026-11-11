import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { updateCard } from "../../cards";
import { transactionWithWorkspaceScope } from "../../database";
import { createDeck } from "../../decks";
import { computeReviewSchedule, type ReviewRating } from "../../scheduling";
import { defaultWorkspaceSchedulerConfig } from "../../scheduling/workspaceConfig";
import {
  applyWorkspaceSchedulerSettingsSnapshotInExecutor,
  getWorkspaceSchedulerConfig,
} from "../../scheduling/workspaceSettings";
import {
  loadWorkspaceResetProgressPreviewForUser,
  resetWorkspaceProgressConfirmationText,
  resetWorkspaceProgressForUser,
} from "../../workspaces";
import {
  executeCardMaintenanceForUser,
  parseCardMaintenancePreviewFingerprint,
  previewCardMaintenanceForUser,
  type CardMaintenanceInput,
} from "../../workspaces/cardMaintenance";
import { createWorkspaceForUser } from "../../workspaces/create";
import {
  parseSyncBootstrapInput,
  parseSyncPullInput,
  parseSyncPushInput,
  parseSyncReviewHistoryImportInput,
  parseSyncReviewHistoryPullInput,
} from "../contracts/input";
import type { LegacySyncCardPayload, SyncBootstrapEntry } from "../contracts/types";
import { buildSystemWorkspaceReplicaId, ensureWorkspaceReplicaInExecutor } from "../identity/replica";
import { processSyncBootstrap } from "./bootstrap";
import { lockWorkspaceSyncMetadataForHotChangesInExecutor } from "./changes";
import { processSyncPull } from "./hotPull";
import { processSyncPush } from "./push";
import { processSyncReviewHistoryImport, processSyncReviewHistoryPull } from "./reviewHistory";

function cardFromEntries(entries: ReadonlyArray<SyncBootstrapEntry>, cardId: string): LegacySyncCardPayload {
  for (const entry of entries) {
    if (entry.entityType === "card" && entry.entityId === cardId) {
      return entry.payload;
    }
  }
  assert.fail(`Card ${cardId} missing from sync entries`);
}

function reviewOperation(cardId: string, reviewedAtClient: string, rating: ReviewRating) {
  const reviewEventId = randomUUID();
  return {
    entityType: "review_event",
    entityId: reviewEventId,
    action: "append",
    operationId: randomUUID(),
    clientUpdatedAt: reviewedAtClient,
    payload: { reviewEventId, cardId, clientEventId: randomUUID(), reviewedAtClient, rating },
  } as const;
}

function cardOperation(payload: LegacySyncCardPayload, clientUpdatedAt: string) {
  return {
    entityType: "card",
    entityId: payload.cardId,
    action: "upsert",
    operationId: randomUUID(),
    clientUpdatedAt,
    payload,
  } as const;
}

function makeNewCard(createdAt: string, tags: ReadonlyArray<string>): LegacySyncCardPayload {
  return {
    cardId: randomUUID(),
    frontText: "Original question?",
    backText: "Original answer",
    tags,
    cardType: "basic",
    metadata: { version: 1, source: null },
    effortLevel: "fast",
    createdAt,
    deletedAt: null,
    clientUpdatedAt: createdAt,
    lastModifiedByReplicaId: "",
    lastOperationId: "",
    updatedAt: createdAt,
    dueAt: null,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
  };
}

function withSchedule(card: LegacySyncCardPayload, reviewedAtClient: string, rating: ReviewRating): LegacySyncCardPayload {
  const schedule = computeReviewSchedule(
    {
      ...card,
      fsrsLastReviewedAt: card.fsrsLastReviewedAt === null ? null : new Date(card.fsrsLastReviewedAt),
    },
    defaultWorkspaceSchedulerConfig,
    rating,
    new Date(reviewedAtClient),
  );
  return {
    ...card,
    ...schedule,
    dueAt: schedule.dueAt.toISOString(),
    fsrsLastReviewedAt: schedule.fsrsLastReviewedAt.toISOString(),
  };
}

function assertSchedule(card: LegacySyncCardPayload, expected: LegacySyncCardPayload): void {
  for (const field of [
    "dueAt", "reps", "lapses", "fsrsCardState", "fsrsStepIndex", "fsrsStability", "fsrsDifficulty",
    "fsrsLastReviewedAt", "fsrsScheduledDays",
  ] as const) {
    assert.equal(card[field], expected[field], field);
  }
}

test("two replicas preserve maintenance through snapshot sync and append-only review history", async () => {
  assert.ok(process.env.TEST_DATABASE_ADMIN_URL, "Run with npm run test:postgres-integration");
  const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_ADMIN_URL });
  const userId = "local";
  const { workspaceId } = await createWorkspaceForUser(userId, "Maintenance sync integration");
  const replicaA = { installationId: randomUUID(), platform: "web" };
  const replicaB = { installationId: randomUUID(), platform: "web" };
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const newCard = makeNewCard(createdAt, [" CAFE\u0301 ", "Café", "Keep"]);
  const { cardId } = newCard;
  const push = (replica: typeof replicaA, operations: ReadonlyArray<object>) => processSyncPush(
    workspaceId, userId, parseSyncPushInput({ ...replica, operations }),
  );
  const pull = async (replica: typeof replicaA) => {
    const result = await processSyncPull(
      workspaceId, userId, parseSyncPullInput({ ...replica, afterHotChangeId: 0, limit: 30 }),
    );
    return { card: cardFromEntries(result.changes, cardId), cursor: result.nextHotChangeId };
  };
  const maintain = async (input: CardMaintenanceInput) => {
    const preview = await previewCardMaintenanceForUser(userId, workspaceId, input);
    assert.deepEqual(await executeCardMaintenanceForUser(userId, workspaceId, {
      ...input,
      confirmationText: preview.confirmationText,
      previewFingerprint: parseCardMaintenancePreviewFingerprint(preview.previewFingerprint),
    }), { affectedCardsCount: 1 });
  };

  try {
    const firstTime = new Date(Date.now() - 45_000).toISOString();
    const oldTime = new Date(Date.now() - 15_000).toISOString();
    const beforeReset = withSchedule(newCard, firstTime, 3);
    const oldReview = reviewOperation(cardId, oldTime, 3);
    const oldSchedule = withSchedule(beforeReset, oldTime, 3);
    await push(replicaA, [cardOperation(newCard, createdAt), reviewOperation(cardId, firstTime, 3),
      cardOperation(beforeReset, firstTime)]);
    const { card: original } = await pull(replicaA);
    assertSchedule(original, beforeReset);
    assert.equal(original.metadata.maintenanceRevision, undefined);

    await maintain({ kind: "resetCard", target: cardId });
    await maintain({ kind: "removeTag", target: "CAFÉ" });
    const { card: maintained } = await pull(replicaB);
    assertSchedule(maintained, newCard);
    assert.deepEqual(maintained.tags, ["Keep"]);
    assert.equal(maintained.metadata.maintenanceRevision, 2);

    const bootstrap = await processSyncBootstrap(workspaceId, userId, parseSyncBootstrapInput({
      ...replicaB, mode: "pull", cursor: null, limit: 30,
    }));
    assert.equal(bootstrap.mode, "pull");
    assert.equal(cardFromEntries(bootstrap.entries, cardId).metadata.maintenanceRevision, 2);

    const baseTime = Date.parse(maintained.clientUpdatedAt) + 5_000;
    const at = (offset: number) => new Date(baseTime + offset).toISOString();
    const edited = cardOperation({ ...oldSchedule, frontText: "Edited offline?", tags: [...oldSchedule.tags, "New"] }, at(0));
    const result = await push(replicaA, [oldReview, edited]);
    assert.deepEqual(result.operations.map((op) => op.status), ["applied", "applied"]);
    assert.equal(result.operations[0]?.resultingHotChangeId, null);
    const { card: corrected } = await pull(replicaA);
    assert.equal(corrected.frontText, "Edited offline?");
    assert.deepEqual(corrected.tags, ["Keep", "New"]);
    assertSchedule(corrected, newCard);
    assert.ok(corrected.clientUpdatedAt > edited.clientUpdatedAt);
    assert.equal(corrected.metadata.maintenanceRevision, 2);

    const readd = cardOperation({ ...corrected, tags: [...corrected.tags, "CAFÉ"] }, at(1));
    await push(replicaB, [readd]);
    const { card: readded } = await pull(replicaB);
    assert.ok(readded.tags.includes("CAFÉ"));
    assert.notEqual(readded.lastModifiedByReplicaId, corrected.lastModifiedByReplicaId);

    const stale = cardOperation({
      ...oldSchedule,
      frontText: "Another edit?",
      metadata: { ...oldSchedule.metadata, maintenanceRevision: 1 },
      tags: ["Cafe\u0301", "Keep", "Other"],
    }, at(2));
    await push(replicaA, [stale]);
    const { card: protectedTag } = await pull(replicaA);
    assert.deepEqual(protectedTag.tags, ["Keep", "Other", "CAFÉ"]);
    assert.equal(protectedTag.frontText, "Another edit?");

    // The review event can arrive first in a separate request and publish a newer pull stamp.
    // Its companion snapshot still wins authored LWW at the original device timestamp.
    const review = reviewOperation(cardId, at(3), 2);
    const fromOldBase = cardOperation({
      ...withSchedule(oldSchedule, at(3), 2), frontText: "Companion snapshot edit?",
    }, at(3));
    const eventResult = await push(replicaA, [review]);
    assert.ok(eventResult.operations[0]?.resultingHotChangeId);
    const { card: reviewed } = await pull(replicaB);
    const expectedFirstReview = withSchedule(newCard, at(3), 2);
    assertSchedule(reviewed, expectedFirstReview);
    assert.ok(reviewed.clientUpdatedAt > at(3));
    assert.equal((await push(replicaA, [fromOldBase])).operations[0]?.status, "applied");
    const { card: companion } = await pull(replicaA);
    assert.equal(companion.frontText, "Companion snapshot edit?");
    assertSchedule(companion, expectedFirstReview);
    assert.ok(companion.clientUpdatedAt > reviewed.clientUpdatedAt);
    assert.ok(companion.tags.includes("CAFÉ"));

    const secondReview = reviewOperation(cardId, at(4), 3);
    const secondSnapshot = cardOperation(withSchedule(companion, at(4), 3), at(4));
    assert.equal((await push(replicaB, [secondSnapshot])).operations[0]?.status, "applied");
    assertSchedule((await pull(replicaA)).card, expectedFirstReview);
    const secondResult = await push(replicaB, [secondReview]);
    const expectedSecondReview = withSchedule(expectedFirstReview, at(4), 3);
    const { card: twiceReviewed, cursor } = await pull(replicaB);
    assertSchedule(twiceReviewed, expectedSecondReview);
    assert.equal(twiceReviewed.reps, 2);

    assert.deepEqual((await push(replicaB, [secondSnapshot, secondReview])).operations.map((op) => op.status),
      ["duplicate", "duplicate"]);
    assert.equal((await push(replicaB, [secondReview])).operations[0]?.resultingHotChangeId,
      secondResult.operations[0]?.resultingHotChangeId);
    assert.equal((await push(replicaB, [{ ...secondReview, operationId: randomUUID() }])).operations[0]?.status,
      "ignored");

    const imported = reviewOperation(cardId, at(5), 0);
    await processSyncReviewHistoryImport(workspaceId, userId, parseSyncReviewHistoryImportInput({
      ...replicaA,
      reviewEvents: [{ ...imported.payload, workspaceId, reviewedAtServer: at(5) }],
    }));
    assert.equal((await pull(replicaA)).cursor, cursor);
    assertSchedule((await pull(replicaA)).card, expectedSecondReview);

    const legacyEdit = cardOperation({ ...oldSchedule, frontText: "Legacy edit after both reviews?" }, at(6));
    await push(replicaA, [legacyEdit]);
    const { card: latest } = await pull(replicaB);
    assert.equal(latest.frontText, "Legacy edit after both reviews?");
    assertSchedule(latest, expectedSecondReview);
    assert.ok(latest.tags.includes("CAFÉ"));

    await updateCard(userId, workspaceId, cardId, { tags: ["Café", "Explicit patch"] }, {
      clientUpdatedAt: at(7),
      lastModifiedByReplicaId: latest.lastModifiedByReplicaId,
      lastOperationId: randomUUID(),
    });
    const staleAfterPatch = cardOperation({ ...oldSchedule, tags: ["Unrelated"] }, at(10));
    await push(replicaA, [staleAfterPatch]);
    assert.deepEqual((await pull(replicaB)).card.tags, ["Unrelated", "Café"]);

    // SQL writers such as managed-media revocation can publish their own version directly.
    await owner.query(
      "UPDATE content.cards SET client_updated_at = $1, last_operation_id = $2 WHERE card_id = $3",
      [at(15), randomUUID(), cardId],
    );
    const olderThanServerWrite = cardOperation({ ...oldSchedule, frontText: "Stale after server write?" }, at(11));
    assert.equal((await push(replicaA, [olderThanServerWrite])).operations[0]?.status, "ignored");

    const legacyReset = await resetWorkspaceProgressForUser(userId, workspaceId, resetWorkspaceProgressConfirmationText);
    assert.equal(legacyReset.cardsResetCount, 1);
    const { card: resetAgain } = await pull(replicaA);
    assert.equal(resetAgain.metadata.maintenanceRevision, 3);
    assertSchedule(resetAgain, newCard);

    const { reviewEvents } = await processSyncReviewHistoryPull(workspaceId, userId, parseSyncReviewHistoryPullInput({
      ...replicaB, afterReviewSequenceId: 0, limit: 30,
    }));
    assert.equal(reviewEvents.filter((event) => event.cardId === cardId).length, 5);
    assert.ok(reviewEvents.some((event) => event.reviewEventId === oldReview.entityId));

    const copiedCardId = randomUUID();
    await push(replicaB, [cardOperation({ ...resetAgain, cardId: copiedCardId }, at(11))]);
    const copied = await processSyncPull(
      workspaceId, userId, parseSyncPullInput({ ...replicaB, afterHotChangeId: 0, limit: 30 }),
    );
    assert.equal(cardFromEntries(copied.changes, copiedCardId).metadata.maintenanceRevision, undefined);
    const storage = await owner.query(
      "SELECT card_id FROM content.cards WHERE workspace_id = $1 AND metadata ? 'maintenanceRevision'",
      [workspaceId],
    );
    assert.equal(storage.rowCount, 0);
  } finally {
    try {
      await owner.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [workspaceId]);
    } finally {
      await owner.end();
    }
  }
});

test("nonzero scoped resets fence late first reviews without publishing changes for New cards", async (t) => {
  assert.ok(process.env.TEST_DATABASE_ADMIN_URL, "Run with npm run test:postgres-integration");
  const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_ADMIN_URL });
  const userId = "local";

  try {
    for (const scope of ["tag", "filtered deck", "unfiltered deck", "legacy workspace"] as const) {
      await t.test(scope, async () => {
        const { workspaceId } = await createWorkspaceForUser(userId, "First review reset integration");
        try {
          const replicaA = { installationId: randomUUID(), platform: "web" };
          const replicaB = { installationId: randomUUID(), platform: "web" };
          const createdAt = new Date(Date.now() - 60_000).toISOString();
          const reviewedAt = new Date(Date.now() - 30_000).toISOString();
          const newCard = makeNewCard(createdAt, [" İSTANBUL "]);
          const reviewedCard = makeNewCard(createdAt, [scope === "filtered deck" ? "Alternate" : "İstanbul"]);
          const otherCard = makeNewCard(createdAt, ["istanbul"]);
          const tombstone = { ...makeNewCard(createdAt, ["İstanbul"]), deletedAt: createdAt };
          const push = (replica: typeof replicaA, operations: ReadonlyArray<object>) => processSyncPush(
            workspaceId, userId, parseSyncPushInput({ ...replica, operations }),
          );
          const pull = (afterHotChangeId: number) => processSyncPull(workspaceId, userId, parseSyncPullInput({
            ...replicaB, afterHotChangeId, limit: 30,
          }));
          const loadBoundaries = async () => (await owner.query<Readonly<{ card_id: string; maintenance_reset_at: Date }>>(
            "SELECT card_id, maintenance_reset_at FROM content.cards WHERE workspace_id = $1 AND maintenance_reset_at IS NOT NULL",
            [workspaceId],
          )).rows;

          let input: CardMaintenanceInput | null = null;
          if (scope === "tag") {
            input = { kind: "resetTag", target: "İstanbul" };
          } else if (scope === "filtered deck" || scope === "unfiltered deck") {
            const deck = await createDeck(userId, workspaceId, {
              name: "Reset deck",
              filterDefinition: { version: 2, tags: scope === "filtered deck" ? ["İstanbul", "Alternate"] : [] },
            }, {
              clientUpdatedAt: createdAt,
              lastModifiedByReplicaId: buildSystemWorkspaceReplicaId(workspaceId, "workspace_seed", "workspace-seed"),
              lastOperationId: randomUUID(),
            });
            input = { kind: "resetDeck", target: deck.deckId };
          }

          const reset = async (expectedCount: number) => {
            if (input === null) {
              assert.equal((await loadWorkspaceResetProgressPreviewForUser(userId, workspaceId)).cardsToResetCount, expectedCount);
              const result = await resetWorkspaceProgressForUser(userId, workspaceId, resetWorkspaceProgressConfirmationText);
              assert.equal(result.cardsResetCount, expectedCount);
            } else {
              const preview = await previewCardMaintenanceForUser(userId, workspaceId, input);
              assert.equal(preview.affectedCardsCount, expectedCount);
              const result = await executeCardMaintenanceForUser(userId, workspaceId, {
                ...input,
                confirmationText: preview.confirmationText,
                previewFingerprint: parseCardMaintenancePreviewFingerprint(preview.previewFingerprint),
              });
              assert.equal(result.affectedCardsCount, expectedCount);
            }
          };

          await push(replicaA, [newCard, reviewedCard, otherCard, tombstone].map((card) => cardOperation(card, createdAt)));
          await reset(0);
          assert.deepEqual(await loadBoundaries(), []);

          await push(replicaA, [
            reviewOperation(reviewedCard.cardId, reviewedAt, 3),
            cardOperation(withSchedule(reviewedCard, reviewedAt, 3), reviewedAt),
          ]);
          const before = await pull(0);
          await reset(1);
          const resetChanges = await pull(before.nextHotChangeId);
          assert.deepEqual(resetChanges.changes.map((change) => change.entityId), [reviewedCard.cardId]);
          const boundaries = await loadBoundaries();
          const expectedIds = [newCard.cardId, reviewedCard.cardId];
          if (scope === "unfiltered deck" || scope === "legacy workspace") {
            expectedIds.push(otherCard.cardId);
          }
          assert.deepEqual(boundaries.map((row) => row.card_id).sort(), expectedIds.sort());
          const resetAt = boundaries.find((row) => row.card_id === newCard.cardId)?.maintenance_reset_at;
          assert.ok(resetAt);
          assert.ok(boundaries.every((row) => row.maintenance_reset_at.getTime() === resetAt.getTime()));

          const staleReview = reviewOperation(newCard.cardId, reviewedAt, 3);
          const staleSnapshot = cardOperation({
            ...withSchedule(newCard, reviewedAt, 3), frontText: "Edited offline before reset?",
          }, reviewedAt);
          const staleResult = await push(replicaA, [staleSnapshot, staleReview]);
          assert.deepEqual(staleResult.operations.map((op) => op.status), ["applied", "applied"]);
          assert.equal(staleResult.operations[1]?.resultingHotChangeId, null);
          const afterStale = await pull(resetChanges.nextHotChangeId);
          const corrected = cardFromEntries(afterStale.changes, newCard.cardId);
          assert.equal(corrected.frontText, staleSnapshot.payload.frontText);
          assert.equal(corrected.metadata.maintenanceRevision, undefined);
          assert.ok(corrected.clientUpdatedAt > staleSnapshot.clientUpdatedAt);
          assertSchedule(corrected, newCard);

          const laterTime = new Date(resetAt.getTime() + 1_000).toISOString();
          const laterReview = reviewOperation(newCard.cardId, laterTime, 2);
          const laterResult = await push(replicaA, [laterReview]);
          assert.ok(laterResult.operations[0]?.resultingHotChangeId);
          const afterLater = await pull(afterStale.nextHotChangeId);
          const laterCard = cardFromEntries(afterLater.changes, newCard.cardId);
          assertSchedule(laterCard, withSchedule(newCard, laterTime, 2));
          assert.equal(laterCard.metadata.maintenanceRevision, undefined);

          const { reviewEvents } = await processSyncReviewHistoryPull(workspaceId, userId, parseSyncReviewHistoryPullInput({
            ...replicaB, afterReviewSequenceId: 0, limit: 30,
          }));
          assert.deepEqual(reviewEvents.filter((event) => event.cardId === newCard.cardId).map((event) => event.reviewEventId),
            [staleReview.entityId, laterReview.entityId]);
        } finally {
          await owner.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [workspaceId]);
        }
      });
    }
  } finally {
    await owner.end();
  }
});

test("scheduler reads and writes complete while a registered replica waits for the hot lock", async () => {
  assert.ok(process.env.TEST_DATABASE_ADMIN_URL, "Run with npm run test:postgres-integration");
  const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_ADMIN_URL });
  const userId = "local";
  const { workspaceId } = await createWorkspaceForUser(userId, "Scheduler locking integration");
  const scope = { workspaceId, userId };
  let reportRegisteredReplicaPid!: (pid: number) => void;
  const registeredReplicaPid = new Promise<number>((resolve) => { reportRegisteredReplicaPid = resolve; });
  let pendingSync: Promise<void> = Promise.resolve();

  try {
    await transactionWithWorkspaceScope(scope, async (executor) => {
      await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, workspaceId);
      const holder = await executor.query<Readonly<{ pid: number }>>("SELECT pg_backend_pid() AS pid", []);
      const holderPid = holder.rows[0]?.pid;
      assert.ok(holderPid);

      pendingSync = transactionWithWorkspaceScope(scope, async (syncExecutor) => {
        await syncExecutor.query("SET LOCAL lock_timeout = '5s'", []);
        await ensureWorkspaceReplicaInExecutor(syncExecutor, {
          ...scope,
          installationId: randomUUID(),
          platform: "web",
          appVersion: null,
          osName: null,
          deviceType: null,
          isAutomation: true,
          isTestDistribution: true,
        });
        const contender = await syncExecutor.query<Readonly<{ pid: number }>>("SELECT pg_backend_pid() AS pid", []);
        const contenderPid = contender.rows[0]?.pid;
        assert.ok(contenderPid);
        reportRegisteredReplicaPid(contenderPid);
        await lockWorkspaceSyncMetadataForHotChangesInExecutor(syncExecutor, workspaceId);
      });
      const contenderPid = await Promise.race([
        registeredReplicaPid,
        pendingSync.then(() => assert.fail("Sync transaction finished before the scheduler released its hot lock")),
      ]);

      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const result = await executor.query<Readonly<{ waiting: boolean }>>(
          "SELECT $1 = ANY(pg_blocking_pids($2)) AS waiting",
          [holderPid, contenderPid],
        );
        waiting = result.rows[0]?.waiting === true;
        if (!waiting) await delay(10);
      }
      assert.ok(waiting, "Registered replica should be waiting for the scheduler transaction's hot lock");

      await executor.query("SET LOCAL lock_timeout = '1s'", []);
      assert.deepEqual(await getWorkspaceSchedulerConfig(executor, workspaceId), defaultWorkspaceSchedulerConfig);
      const updated = await applyWorkspaceSchedulerSettingsSnapshotInExecutor(
        executor,
        workspaceId,
        { ...defaultWorkspaceSchedulerConfig, desiredRetention: 0.85 },
        {
          clientUpdatedAt: new Date(Date.now() + 1_000).toISOString(),
          lastModifiedByReplicaId: buildSystemWorkspaceReplicaId(workspaceId, "workspace_seed", "workspace-seed"),
          lastOperationId: randomUUID(),
        },
      );
      assert.ok(updated.applied);
      assert.equal(updated.settings.desiredRetention, 0.85);
    });
  } finally {
    try {
      await pendingSync;
    } finally {
      try {
        await owner.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [workspaceId]);
      } finally {
        await owner.end();
      }
    }
  }
});

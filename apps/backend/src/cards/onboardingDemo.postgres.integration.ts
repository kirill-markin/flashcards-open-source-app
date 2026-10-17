import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import { loadGuestCardsInExecutor } from "../guestAuth/store/cards";
import { parseSyncPushInput } from "../sync/contracts/input";
import { buildHotChangesFromRows } from "../sync/replication/hotPull";
import {
  withPostgresIntegrationFixture,
  type PostgresIntegrationFixture,
} from "../testSupport/postgresIntegration";
import { persistWorkspacePackageImportCards } from "../workspacePackages/import/apply/importCards";
import { planWorkspacePackageImport } from "../workspacePackages/import/planning/importPlan";
import { parseWorkspacePackageCardsJsonV1 } from "../workspacePackages/types";
import { createCardInExecutor, updateCardInExecutor, upsertCardSnapshotInExecutor } from "./mutations";
import type { CardMetadata, CardMutationMetadata, CardMutationResult, CardSnapshotInput } from "./types";

async function withRuntimeTransaction<Result>(
  fixture: PostgresIntegrationFixture,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const client = await fixture.runtimePool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)",
      [fixture.userId, fixture.workspaceId],
    );
    const executor: DatabaseExecutor = {
      query<Row extends pg.QueryResultRow>(text: string, params: ReadonlyArray<SqlValue>): Promise<pg.QueryResult<Row>> {
        return client.query<Row>(text, [...params]);
      },
    };
    const result = await callback(executor);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mutationMetadata(fixture: PostgresIntegrationFixture, sequence: number): CardMutationMetadata {
  return {
    clientUpdatedAt: new Date(Date.UTC(2099, 0, 1, 0, sequence)).toISOString(),
    lastModifiedByReplicaId: fixture.replicaId,
    lastOperationId: `onboarding-${randomUUID()}`,
  };
}

function seedSnapshot(fixture: PostgresIntegrationFixture, metadata: CardMetadata): CardSnapshotInput {
  return {
    cardId: randomUUID(),
    frontText: "  Demo question  ",
    backText: "  Demo answer  ",
    cardType: " basic ",
    metadata,
    tags: ["demo", "alpha", "demo"],
    dueAt: null,
    createdAt: fixture.createdAt,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    deletedAt: null,
  };
}

async function pushSnapshot(
  fixture: PostgresIntegrationFixture,
  snapshot: CardSnapshotInput,
  sequence: number,
): Promise<CardMutationResult> {
  const metadata = mutationMetadata(fixture, sequence);
  const parsed = parseSyncPushInput({
    installationId: randomUUID(),
    platform: "web",
    operations: [{
      operationId: metadata.lastOperationId,
      entityId: snapshot.cardId,
      clientUpdatedAt: metadata.clientUpdatedAt,
      entityType: "card",
      action: "upsert",
      payload: snapshot,
    }],
  });
  const operation = parsed.operations[0];
  assert.ok(operation?.entityType === "card");
  return withRuntimeTransaction(fixture, (executor) => upsertCardSnapshotInExecutor(
    executor, fixture.workspaceId, operation.payload, metadata,
  ));
}

test("onboarding provenance survives server round-trips, freezes its baseline and never disposes imported content", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const metadata: CardMetadata = {
      version: 1,
      source: null,
      onboardingDemo: {
        version: 1,
        frontText: " Demo question ",
        backText: " Demo answer ",
        tags: ["demo", "alpha", "demo"],
        cardType: " basic ",
      },
    };
    const snapshot = seedSnapshot(fixture, metadata);
    const inserted = await pushSnapshot(fixture, snapshot, 1);
    const baseline = {
      version: 1 as const,
      frontText: "Demo question",
      backText: "Demo answer",
      tags: ["alpha", "demo"],
      cardType: "basic",
      wasEdited: false,
    };
    assert.deepEqual(inserted.card.metadata.onboardingDemo, baseline);

    await withRuntimeTransaction(fixture, async (executor) => {
      assert.ok(inserted.changeId !== null);
      const changes = await buildHotChangesFromRows(executor, fixture.workspaceId, [{
        change_id: inserted.changeId,
        entity_type: "card",
        entity_id: snapshot.cardId,
      }]);
      assert.ok(changes[0]?.entityType === "card");
      assert.deepEqual(changes[0].payload.metadata.onboardingDemo, baseline);
      const guestCards = await loadGuestCardsInExecutor(executor, fixture.userId, fixture.workspaceId);
      assert.deepEqual(guestCards.find((card) => card.cardId === snapshot.cardId)?.metadata.onboardingDemo, baseline);
    });

    const oldClientSnapshot = { ...snapshot, metadata: { version: 1 as const, source: null }, tags: ["alpha", "demo"] };
    assert.deepEqual((await pushSnapshot(fixture, oldClientSnapshot, 2)).card.metadata.onboardingDemo, baseline);
    const { metadata: omittedMetadata, ...fieldAbsentSnapshot } = oldClientSnapshot;
    assert.ok(omittedMetadata !== undefined);
    assert.deepEqual((await pushSnapshot(fixture, fieldAbsentSnapshot, 3)).card.metadata.onboardingDemo, baseline);
    const rewrittenClaim = { ...metadata, onboardingDemo: { ...baseline, frontText: "Rewritten baseline" } };
    assert.deepEqual((await pushSnapshot(fixture, { ...snapshot, metadata: rewrittenClaim }, 4)).card.metadata.onboardingDemo, baseline);
    const loser = await pushSnapshot(fixture, { ...snapshot, backText: "Losing edit" }, 0);
    assert.equal(loser.applied, false);
    assert.deepEqual(loser.card.metadata.onboardingDemo, baseline);
    assert.equal((await pushSnapshot(fixture, { ...oldClientSnapshot, backText: "Authored answer" }, 5)).card.metadata.onboardingDemo?.wasEdited, true);
    assert.equal((await pushSnapshot(fixture, snapshot, 6)).card.metadata.onboardingDemo?.wasEdited, true);

    const retroactive = await pushSnapshot(fixture, { ...snapshot, cardId: fixture.cardId }, 7);
    assert.equal(retroactive.card.metadata.onboardingDemo, undefined);
    const initiallyEdited = await pushSnapshot(fixture, { ...snapshot, cardId: randomUUID(), backText: "Edited offline" }, 8);
    assert.equal(initiallyEdited.card.metadata.onboardingDemo?.wasEdited, true);
    for (const claim of [{ version: 2 }, { version: 1, frontText: 42 }]) {
      const parsed = parseSyncPushInput({
        installationId: randomUUID(), platform: "web",
        operations: [{
          operationId: randomUUID(), entityId: randomUUID(), clientUpdatedAt: fixture.createdAt,
          entityType: "card", action: "upsert",
          payload: { ...snapshot, cardId: randomUUID(), metadata: { version: 1, source: null, onboardingDemo: claim } },
        }],
      });
      const operation = parsed.operations[0];
      assert.ok(operation?.entityType === "card");
      const preserved = await pushSnapshot(fixture, operation.payload, 9);
      assert.equal(preserved.card.frontText, "Demo question");
      assert.equal(preserved.card.metadata.onboardingDemo, undefined);
    }

    await withRuntimeTransaction(fixture, async (executor) => {
      for (const edit of [
        { cardType: "cloze" },
        { tags: ["personal"] },
        { metadata: { version: 1 as const, source: { label: "Mine", author: null, comment: null, createdAt: null, importedAt: null, importId: null } } },
      ]) {
        const card = await createCardInExecutor(executor, fixture.workspaceId, snapshot, mutationMetadata(fixture, 10));
        const edited = await updateCardInExecutor(executor, fixture.workspaceId, card.cardId, edit, mutationMetadata(fixture, 11));
        assert.equal(edited.metadata.onboardingDemo?.wasEdited, true);
        const reverted = await updateCardInExecutor(executor, fixture.workspaceId, card.cardId, snapshot, mutationMetadata(fixture, 12));
        assert.equal(reverted.metadata.onboardingDemo?.wasEdited, true);
      }
    });

    const cardsJson = parseWorkspacePackageCardsJsonV1({ formatVersion: 1, cards: [snapshot] });
    assert.equal("onboardingDemo" in cardsJson.cards[0]!.metadata, false);
    const plan = planWorkspacePackageImport({
      cardsJson,
      options: { addImportTag: false, importTag: "import", removeTags: [], importedAt: fixture.createdAt, importId: randomUUID() },
      mediaAssetIdsByPortablePath: new Map(),
    });
    const imported = await persistWorkspacePackageImportCards({
      userId: fixture.userId,
      workspaceId: fixture.workspaceId,
      plannedCards: plan.cards.map((card) => ({ ...card, metadata: { ...card.metadata, onboardingDemo: baseline } })),
      ...mutationMetadata(fixture, 13),
      operationIdPrefix: `onboarding-import-${randomUUID()}`,
    });
    assert.equal(imported.cards[0]?.metadata.onboardingDemo, undefined);
    assert.equal(imported.cards[0]?.metadata.source?.importedAt, fixture.createdAt);
  });
});

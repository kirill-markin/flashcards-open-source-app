import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { ensureAgentSyncReplica } from "../../agent/syncIdentity";
import { deleteAccountConfirmationText, deleteAccountForAuthenticatedUser } from "../../auth/accountDeletion";
import { ensureCognitoUserProfile } from "../../auth/ensureUser";
import { createCards, upsertCardSnapshotInExecutor, type CardMetadata, type CardSnapshotInput } from "../../cards";
import { transactionWithWorkspaceScope } from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import { completeGuestUpgrade, createGuestSession } from "../../guestAuth";
import { parseSyncBootstrapInput, parseSyncPushInput } from "../../sync/contracts/input";
import { ensureSystemWorkspaceReplica, ensureWorkspaceReplica } from "../../sync/identity/replica";
import { processSyncBootstrap } from "../../sync/replication/bootstrap";
import { processSyncPush } from "../../sync/replication/push";
import { createWorkspaceForUser } from "../../workspaces";
import { persistWorkspacePackageImportCards } from "../../workspacePackages/import/apply/importCards";
import { planWorkspacePackageImport } from "../../workspacePackages/import/planning/importPlan";
import { parseWorkspacePackageCardsJsonV1 } from "../../workspacePackages/types";
import { transactionWithWorkspaceScopeReportingContentWrites } from "./contentWrites";

type ActorWorkspace = Readonly<{ userId: string; workspaceId: string }>;
type AdditionFact = Readonly<{
  user_id: string;
  subject_user_id: string;
  workspace_id: string | null;
  origin: string;
  trust_level: string;
  identity_state: string;
  platform: string | null;
  occurred_at: Date;
  server_received_at: Date;
  event_properties: Readonly<{ demo_status: string }>;
}>;

const offlineCreatedAt = "2026-01-01T10:00:00.000Z";
const legacyMetadata: CardMetadata = { version: 1, source: null };
const addedMetadata: CardMetadata = { ...legacyMetadata, creationKind: "user_added" };

function ownerPool(): pg.Pool {
  const connectionString = process.env.TEST_DATABASE_ADMIN_URL;
  assert.ok(connectionString, "Expected the disposable PostgreSQL integration database");
  return new pg.Pool({ connectionString });
}

function snapshot(metadata: CardMetadata): CardSnapshotInput {
  return {
    cardId: randomUUID(),
    frontText: "An offline question",
    backText: "An offline answer",
    cardType: "basic",
    tags: ["demo"],
    metadata,
    createdAt: offlineCreatedAt,
    dueAt: null,
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

function push(
  scope: ActorWorkspace,
  installationId: string,
  cards: ReadonlyArray<CardSnapshotInput>,
  marker: Readonly<{ isAutomation?: true; isTestDistribution?: true }>,
): ReturnType<typeof processSyncPush> {
  return processSyncPush(scope.workspaceId, scope.userId, parseSyncPushInput({
    installationId,
    platform: "ios",
    appVersion: "1.43.0",
    ...marker,
    operations: cards.map((card) => ({
      operationId: randomUUID(),
      entityId: card.cardId,
      clientUpdatedAt: new Date().toISOString(),
      entityType: "card",
      action: "upsert",
      payload: card,
    })),
  }));
}

async function facts(owner: pg.Pool, cardId: string): Promise<ReadonlyArray<AdditionFact>> {
  const result = await owner.query<AdditionFact>(
    `SELECT user_id, subject_user_id, workspace_id, origin, trust_level, identity_state, platform,
       occurred_at, server_received_at, event_properties
     FROM analytics.product_events
     WHERE event_name = 'card_addition_committed'
       AND event_id = analytics.derive_server_event_id('card_addition_committed', ARRAY[$1::text])`,
    [cardId],
  );
  return result.rows;
}

async function fact(owner: pg.Pool, cardId: string): Promise<AdditionFact> {
  const rows = await facts(owner, cardId);
  assert.equal(rows.length, 1);
  return rows[0]!;
}

test("committed card facts preserve offline time, origin and first-write provenance", async () => {
  const owner = ownerPool();
  try {
    const account = await ensureCognitoUserProfile(randomUUID(), null);
    assert.ok(account.selectedWorkspaceId);
    const scope = { userId: account.userId, workspaceId: account.selectedWorkspaceId };
    const installationId = randomUUID();
    const authored = snapshot(addedMetadata);
    const legacy = snapshot(legacyMetadata);
    const demo = {
      ...snapshot({
        ...addedMetadata,
        onboardingDemo: {
          version: 1, frontText: "The original prompt", backText: "The original answer",
          cardType: "basic", tags: ["demo"],
        },
      }),
      deletedAt: offlineCreatedAt,
    };
    const futureTombstone = {
      ...snapshot(addedMetadata),
      createdAt: "2099-01-01T10:00:00.000Z",
      deletedAt: "2099-01-01T10:01:00.000Z",
    };
    await push(scope, installationId, [authored, legacy, demo, futureTombstone], {});
    const authoredFact = await fact(owner, authored.cardId);
    assert.equal(authoredFact.user_id, scope.userId);
    assert.equal(authoredFact.subject_user_id, scope.userId);
    assert.equal(authoredFact.workspace_id, scope.workspaceId);
    assert.equal(authoredFact.origin, "server");
    assert.equal(authoredFact.trust_level, "server_derived");
    assert.equal(authoredFact.platform, "ios");
    assert.deepEqual(authoredFact.event_properties, { demo_status: "non_demo" });
    assert.equal(authoredFact.occurred_at.toISOString(), offlineCreatedAt);
    assert.ok(authoredFact.server_received_at > authoredFact.occurred_at);
    assert.deepEqual((await fact(owner, legacy.cardId)).event_properties, { demo_status: "unknown" });
    assert.deepEqual((await fact(owner, demo.cardId)).event_properties, { demo_status: "demo" });
    const futureFact = await fact(owner, futureTombstone.cardId);
    assert.equal(futureFact.occurred_at.getTime(), futureFact.server_received_at.getTime());
    assert.deepEqual(futureFact.event_properties, { demo_status: "non_demo" });

    await push(scope, installationId, [
      { ...authored, metadata: legacyMetadata, backText: "Edited", deletedAt: new Date().toISOString() },
      { ...legacy, metadata: addedMetadata, backText: "Edited legacy copy" },
    ], {});
    assert.deepEqual(await fact(owner, authored.cardId), authoredFact);
    const edited = await owner.query(
      "SELECT card_id, metadata->>'creationKind' AS kind FROM content.cards WHERE card_id = ANY($1::uuid[])",
      [[authored.cardId, legacy.cardId]],
    );
    assert.deepEqual(new Map(edited.rows.map((row) => [row.card_id, row.kind])), new Map([
      [authored.cardId, "user_added"], [legacy.cardId, null],
    ]));

    const automationCard = snapshot(addedMetadata);
    const testBuildCard = snapshot(addedMetadata);
    await push(scope, randomUUID(), [automationCard], { isAutomation: true });
    await push(scope, randomUUID(), [testBuildCard], { isTestDistribution: true });
    assert.deepEqual(await facts(owner, automationCard.cardId), []);
    assert.deepEqual(await facts(owner, testBuildCard.cardId), []);

    const replicaId = await ensureWorkspaceReplica({
      ...scope, installationId, platform: "ios", appVersion: "1.43.0",
      osName: null, deviceType: null, isAutomation: false, isTestDistribution: false,
    });
    const mutation = {
      clientUpdatedAt: offlineCreatedAt,
      lastModifiedByReplicaId: replicaId,
      lastOperationId: randomUUID(),
    };
    const oldWriterCard = snapshot(addedMetadata);
    await transactionWithWorkspaceScope(scope, async (executor) => {
      await upsertCardSnapshotInExecutor(executor, scope.workspaceId, oldWriterCard, mutation);
    });
    assert.equal((await owner.query("SELECT 1 FROM content.cards WHERE card_id = $1", [oldWriterCard.cardId])).rowCount, 1);
    assert.deepEqual(await facts(owner, oldWriterCard.cardId), []);

    const rolledBack = snapshot(addedMetadata);
    const rollback = new Error("Roll back the product save");
    await assert.rejects(transactionWithWorkspaceScopeReportingContentWrites(scope, async (executor) => {
      await upsertCardSnapshotInExecutor(executor, scope.workspaceId, rolledBack, mutation);
      const { rowCount } = await executor.query(
        "SELECT 1 FROM analytics.product_events WHERE event_id = analytics.derive_server_event_id('card_addition_committed', ARRAY[$1::text])",
        [rolledBack.cardId],
      );
      assert.equal(rowCount, 1);
      throw rollback;
    }), rollback);
    assert.deepEqual(await facts(owner, rolledBack.cardId), []);
    assert.equal((await owner.query("SELECT 1 FROM content.cards WHERE card_id = $1", [rolledBack.cardId])).rowCount, 0);

    const agentReplicaId = await ensureAgentSyncReplica(scope.workspaceId, scope.userId, randomUUID());
    const chatReplicaId = await ensureSystemWorkspaceReplica({
      ...scope, actorKind: "ai_chat", actorKey: randomUUID(), platform: "web", appVersion: null, signal: null,
    });
    for (const [serverReplicaId, device, platform] of [
      [agentReplicaId, null, "agent"],
      [chatReplicaId, null, null],
      [chatReplicaId, { platform: "android", osName: "android", deviceType: "phone" }, "android"],
    ] as const) {
      const [serverCard] = await createCards(scope.userId, scope.workspaceId, [{
        input: legacy,
        metadata: { ...mutation, lastModifiedByReplicaId: serverReplicaId, lastOperationId: randomUUID() },
      }], device);
      assert.ok(serverCard);
      const event = await fact(owner, serverCard.cardId);
      assert.deepEqual(event.event_properties, { demo_status: "non_demo" });
      assert.equal(event.occurred_at.getTime(), event.server_received_at.getTime());
      assert.equal(event.platform, platform);
    }

    const cardsJson = parseWorkspacePackageCardsJsonV1({ formatVersion: 1, cards: [demo] });
    const plan = planWorkspacePackageImport({
      cardsJson,
      options: { addImportTag: false, importTag: "import", removeTags: [], importedAt: offlineCreatedAt, importId: randomUUID() },
      mediaAssetIdsByPortablePath: new Map(),
    });
    const imported = await persistWorkspacePackageImportCards({
      ...scope, ...mutation, plannedCards: plan.cards, operationIdPrefix: randomUUID(),
    });
    assert.ok(imported.cards[0]);
    assert.equal(imported.cards[0].metadata.onboardingDemo, undefined);
    assert.equal(imported.cards[0].metadata.creationKind, undefined);
    const importedFact = await fact(owner, imported.cards[0].cardId);
    assert.deepEqual(importedFact.event_properties, { demo_status: "non_demo" });
    assert.equal(importedFact.occurred_at.getTime(), importedFact.server_received_at.getTime());

    const nextAccount = await ensureCognitoUserProfile(randomUUID(), null);
    assert.ok(nextAccount.selectedWorkspaceId);
    for (const markers of [
      { isAutomation: true, isTestDistribution: false },
      { isAutomation: false, isTestDistribution: true },
    ]) {
      const installation = {
        installationId: randomUUID(), platform: "ios", appVersion: "1.43.0", osName: null, deviceType: null,
      } as const;
      const previousReplicaId = await ensureWorkspaceReplica({ ...scope, ...installation, ...markers });
      await ensureWorkspaceReplica({
        userId: nextAccount.userId, workspaceId: nextAccount.selectedWorkspaceId, ...installation,
        isAutomation: false, isTestDistribution: false,
      });
      const beforeImport = await transactionWithWorkspaceScope(scope, async (executor) => executor.query(
        "SELECT 1 FROM sync.installations WHERE installation_id = $1", [installation.installationId],
      ));
      assert.equal(beforeImport.rowCount, 0);
      const excludedImport = await persistWorkspacePackageImportCards({
        ...scope, ...mutation, lastModifiedByReplicaId: previousReplicaId,
        plannedCards: plan.cards, operationIdPrefix: randomUUID(),
      });
      assert.ok(excludedImport.cards[0]);
      assert.deepEqual(await facts(owner, excludedImport.cards[0].cardId), []);
    }

    const remote = await createWorkspaceForUser(scope.userId, "First cloud link");
    const bootstrapCard = snapshot(addedMetadata);
    const bootstrap = await processSyncBootstrap(remote.workspaceId, scope.userId, parseSyncBootstrapInput({
      mode: "push", platform: "ios", installationId,
      entries: [{
        entityType: "card", entityId: bootstrapCard.cardId, action: "upsert",
        payload: {
          ...bootstrapCard, clientUpdatedAt: offlineCreatedAt, updatedAt: offlineCreatedAt, lastOperationId: randomUUID(),
        },
      }],
    }));
    assert.equal(bootstrap.mode, "push");
    const bootstrapFact = await fact(owner, bootstrapCard.cardId);
    assert.deepEqual(bootstrapFact.event_properties, { demo_status: "non_demo" });
    assert.equal(bootstrapFact.occurred_at.toISOString(), offlineCreatedAt);
  } finally {
    await owner.end();
  }
});

test("guest replay keeps the original save, and account erasure anonymizes it", async () => {
  const owner = ownerPool();
  try {
    const guest = await createGuestSession("ios", null);
    const subject = randomUUID();
    const account = await ensureCognitoUserProfile(subject, null);
    assert.ok(account.selectedWorkspaceId);
    const installationId = randomUUID();
    const saved = snapshot(addedMetadata);
    await push(guest, installationId, [saved], {});
    const guestFact = await fact(owner, saved.cardId);
    assert.equal(guestFact.user_id, guest.userId);
    assert.equal(guestFact.workspace_id, guest.workspaceId);

    const preMigrationCardId = randomUUID();
    await owner.query(
      `INSERT INTO content.cards (card_id, workspace_id, front_text, back_text, metadata, tags,
         created_at, client_updated_at, last_modified_by_replica_id, last_operation_id)
       SELECT $2, workspace_id, front_text, back_text, metadata, tags,
         created_at, client_updated_at, last_modified_by_replica_id, $3
       FROM content.cards WHERE card_id = $1`,
      [saved.cardId, preMigrationCardId, randomUUID()],
    );
    assert.deepEqual(await facts(owner, preMigrationCardId), []);

    const selection = { type: "existing", workspaceId: account.selectedWorkspaceId } as const;
    const capabilities = {
      guestWorkspaceSyncedAndOutboxDrained: true,
      requiresGuestWorkspaceSyncedAndOutboxDrained: true,
      supportsDroppedEntities: true,
    } as const;
    await completeGuestUpgrade(guest.guestToken, subject, selection, capabilities);
    const replay = await completeGuestUpgrade(guest.guestToken, subject, selection, capabilities);
    assert.equal(replay.outcome, "idempotent_replay");
    assert.equal((await owner.query(
      "SELECT card_id FROM content.cards WHERE workspace_id = $1 AND card_id = ANY($2::uuid[])",
      [account.selectedWorkspaceId, [saved.cardId, preMigrationCardId]],
    )).rowCount, 2);
    assert.deepEqual(await fact(owner, saved.cardId), guestFact);
    assert.deepEqual(await facts(owner, preMigrationCardId), []);

    await deleteAccountForAuthenticatedUser({
      authSubjectUserId: subject,
      cognitoUsername: subject,
      email: null,
      confirmationText: deleteAccountConfirmationText,
    }, {
      unsafeTransaction,
      deleteCognitoUser: async (deletedSubject) => assert.equal(deletedSubject, subject),
      isConfiguredDemoEmail: () => false,
    });
    const removed = await fact(owner, saved.cardId);
    assert.equal(removed.identity_state, "anonymized");
    assert.equal(removed.workspace_id, null);
    assert.notEqual(removed.user_id, guest.userId);
    assert.notEqual(removed.user_id, account.userId);
    assert.equal(removed.user_id, removed.subject_user_id);
    assert.deepEqual(removed.event_properties, { demo_status: "non_demo" });
  } finally {
    await owner.end();
  }
});

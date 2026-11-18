import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { before } from "node:test";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { deleteRealAccountDataInExecutor } from "../auth/accountDeletion";
import { createBackendRuntimeObservationScope, initializeBackendSentry } from "../observability/sentry";
import { reconcileCardAdditions } from "./cardAdditionRecovery";

type Fixture = Readonly<{
  userId: string;
  workspaceId: string;
  replicaId: string;
  otherReplicaId: string;
}>;
type CardProof = Readonly<{
  cardId: string;
  createdAt: string;
  metadata: object;
  eventName: "card_created" | "card_addition_committed";
  properties: object;
  eventUserId: string;
  eventSubjectId: string;
  eventWorkspaceId: string;
  eventId: string | null;
  replicaId: string;
  hotAt: string | null;
}>;

const seedAt = "2026-01-01T10:00:00.000Z";
const addedAt = "2026-01-01T10:01:00.000Z";
const receiptAt = "2026-01-02T10:00:00.000Z";
const markedDemo = {
  version: 1,
  source: null,
  onboardingDemo: { version: 1, frontText: "Seed", backText: "Answer", cardType: "basic", tags: [] },
};
initializeBackendSentry("backend-api");
const scope = createBackendRuntimeObservationScope();

function ownerPool(): pg.Pool {
  assert.ok(process.env.TEST_DATABASE_ADMIN_URL);
  return new pg.Pool({ connectionString: process.env.TEST_DATABASE_ADMIN_URL });
}

before(async () => {
  const owner = ownerPool();
  const client = await owner.connect();
  try {
    const password = randomUUID();
    await client.query("SELECT pg_catalog.set_config('recovery.reporting_password', $1, false)", [password]);
    await client.query("DO $$ BEGIN EXECUTE format('ALTER ROLE reporting_readonly PASSWORD %L',"
      + " current_setting('recovery.reporting_password')); END $$");
    const url = new URL(process.env.TEST_DATABASE_ADMIN_URL!);
    url.username = "reporting_readonly";
    url.password = password;
    process.env.REPORTING_DATABASE_URL = url.toString();
  } finally {
    client.release();
    await owner.end();
  }
});

async function fixture(owner: pg.Pool): Promise<Fixture> {
  const result = { userId: randomUUID(), workspaceId: randomUUID(), replicaId: randomUUID(), otherReplicaId: randomUUID() };
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [result.userId]);
    await client.query(
      "INSERT INTO org.workspaces(workspace_id,name,fsrs_client_updated_at,fsrs_last_modified_by_replica_id,fsrs_last_operation_id)"
      + " VALUES ($1,'Card recovery',$2,$3,$4)",
      [result.workspaceId, seedAt, result.replicaId, randomUUID()],
    );
    await client.query(
      "INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')",
      [result.workspaceId, result.userId],
    );
    for (const replicaId of [result.replicaId, result.otherReplicaId]) {
      const installationId = randomUUID();
      await client.query(
        "INSERT INTO sync.installations(installation_id,user_id,platform) VALUES ($1,$2,'ios')",
        [installationId, result.userId],
      );
      await client.query(
        "INSERT INTO sync.workspace_replicas(replica_id,workspace_id,user_id,actor_kind,installation_id,platform)"
        + " VALUES ($1,$2,$3,'client_installation',$4,'ios')",
        [replicaId, result.workspaceId, result.userId, installationId],
      );
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function legacyCard(actor: Fixture): CardProof {
  return {
    cardId: randomUUID(), createdAt: addedAt, metadata: { version: 1, source: null },
    eventName: "card_created", properties: { source: "app" },
    eventUserId: actor.userId, eventSubjectId: actor.userId, eventWorkspaceId: actor.workspaceId,
    eventId: null, replicaId: actor.replicaId, hotAt: receiptAt,
  };
}

async function insertHot(owner: pg.Pool, actor: Fixture, card: CardProof, recordedAt: string): Promise<void> {
  await owner.query(
    "INSERT INTO sync.hot_changes(workspace_id,entity_type,entity_id,action,replica_id,operation_id,client_updated_at,recorded_at)"
    + " VALUES ($1,'card',$2,'upsert',$3,$4,$5,$6)",
    [actor.workspaceId, card.cardId, card.replicaId, randomUUID(), card.createdAt, recordedAt],
  );
}

async function insertCard(owner: pg.Pool, actor: Fixture, card: CardProof): Promise<void> {
  await owner.query(
    "INSERT INTO content.cards(card_id,workspace_id,front_text,back_text,metadata,tags,created_at,"
    + "client_updated_at,last_modified_by_replica_id,last_operation_id)"
    + " VALUES ($1,$2,'Edited prompt','Edited answer',$3,'{}',$4,$4,$5,$6)",
    [card.cardId, actor.workspaceId, JSON.stringify(card.metadata), card.createdAt, actor.otherReplicaId, randomUUID()],
  );
  if (card.hotAt !== null) await insertHot(owner, actor, card, card.hotAt);
  await owner.query(
    "INSERT INTO analytics.product_events(event_id,schema_version,event_name,origin,trust_level,user_id,subject_user_id,"
    + "workspace_id,platform,occurred_at,server_received_at,event_properties)"
    + " VALUES (COALESCE($1::uuid,analytics.derive_server_event_id($2,ARRAY[$3::text])),1,$2,'server','server_derived',"
    + "$4,$5,$6,'ios',$7,$8,$9)",
    [card.eventId, card.eventName, card.cardId, card.eventUserId, card.eventSubjectId, card.eventWorkspaceId,
      card.createdAt, receiptAt, JSON.stringify(card.properties)],
  );
}

async function insertSeed(owner: pg.Pool, actor: Fixture): Promise<void> {
  await insertCard(owner, actor, { ...legacyCard(actor), createdAt: seedAt, metadata: markedDemo });
}

async function insertServerLink(owner: pg.Pool, source: Fixture, target: Fixture): Promise<void> {
  await owner.query(
    "INSERT INTO analytics.identity_links(link_id,anonymous_id,user_id,source) VALUES ($1,$2,$3,'server_derived')",
    [randomUUID(), source.userId, target.userId],
  );
}

async function insertUpgrade(owner: pg.Pool, source: Fixture, target: Fixture): Promise<void> {
  await owner.query(
    "INSERT INTO auth.guest_upgrade_history(upgrade_id,source_guest_user_id,source_guest_workspace_id,"
    + "source_guest_session_id,target_subject_user_id,target_user_id,target_workspace_id,selection_type,merged_at)"
    + " VALUES ($1,$2,$3,$4,$5,$5,$6,'existing','2026-01-03')",
    [randomUUID(), source.userId, source.workspaceId, randomUUID(), target.userId, target.workspaceId],
  );
}

async function recoveredCardIds(owner: pg.Pool, cards: ReadonlyArray<CardProof>): Promise<ReadonlyArray<string>> {
  const result = await owner.query<Readonly<{ card_id: string }>>(
    "SELECT card_id::text FROM unnest($1::uuid[]) AS card(card_id)"
    + " JOIN analytics.product_events AS event ON event.event_id = analytics.derive_server_event_id("
    + "'card_addition_recovered',ARRAY[card.card_id::text]) ORDER BY card_id",
    [cards.map((card) => card.cardId)],
  );
  return result.rows.map((row) => row.card_id);
}

test("recovery proves original cards and replicas, catches delayed history, and remains immutable", async () => {
  const owner = ownerPool();
  try {
    const actor = await fixture(owner);
    await insertSeed(owner, actor);
    const legacy = legacyCard(actor);
    const unknown = { ...legacyCard(actor), eventName: "card_addition_committed", properties: { demo_status: "unknown" } } as const;
    const missed = { ...legacyCard(actor), createdAt: "2025-12-31T10:01:00.000Z" };
    const olderActor = await fixture(owner);
    await insertCard(owner, olderActor, { ...legacyCard(olderActor), createdAt: "2025-12-30T10:00:00.000Z", metadata: markedDemo });
    await insertCard(owner, olderActor, { ...missed, eventUserId: olderActor.userId, eventSubjectId: olderActor.userId,
      eventWorkspaceId: olderActor.workspaceId, replicaId: olderActor.replicaId });
    const invalid = [
      { ...legacyCard(actor), metadata: markedDemo },
      { ...legacyCard(actor), replicaId: actor.otherReplicaId },
      { ...legacyCard(actor), eventId: randomUUID() },
      { ...legacyCard(actor), eventSubjectId: randomUUID() },
      { ...legacyCard(actor), eventWorkspaceId: randomUUID() },
      { ...legacyCard(actor), eventName: "card_addition_committed", properties: { demo_status: "demo" } },
      { ...legacyCard(actor), eventName: "card_addition_committed", properties: { demo_status: "non_demo" },
        metadata: { version: 1, source: null, creationKind: "user_added" } },
      { ...legacyCard(actor), properties: { source: "package_import" } },
      { ...legacyCard(actor), hotAt: "2026-01-03T10:00:00.000Z" },
    ] as const;
    for (const card of [legacy, unknown, ...invalid]) await insertCard(owner, actor, card);
    const first = await reconcileCardAdditions({ batchSize: 1, maxBatches: 1 }, scope);
    assert.equal(first.recoveredCount, 1);
    assert.equal(first.finished, false);
    const catchup = await reconcileCardAdditions({ batchSize: 1, maxBatches: 10 }, scope);
    assert.equal(catchup.recoveredCount, 2);
    assert.equal(catchup.finished, true);
    assert.deepEqual(await recoveredCardIds(owner, [legacy, unknown, missed, ...invalid]),
      [legacy.cardId, unknown.cardId, missed.cardId].sort());
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM content.review_events WHERE workspace_id=$1",
      [actor.workspaceId])).rows[0].count, 0);
    const stored = await owner.query(
      "SELECT origin,trust_level,backfill_id,occurred_at,server_received_at,event_properties,details"
      + " FROM analytics.product_events WHERE event_id=analytics.derive_server_event_id('card_addition_recovered',ARRAY[$1::text])",
      [legacy.cardId],
    );
    assert.equal(stored.rows[0].origin, "backfill");
    assert.equal(stored.rows[0].trust_level, "backfill_derived");
    assert.ok(stored.rows[0].backfill_id);
    assert.equal(stored.rows[0].occurred_at.toISOString(), addedAt);
    assert.equal(stored.rows[0].server_received_at.toISOString(), receiptAt);
    assert.deepEqual(stored.rows[0].event_properties, {});
    assert.deepEqual(stored.rows[0].details, { proof: "original_card_and_same_replica_demo", version: 1 });
    assert.deepEqual((await owner.query(
      "SELECT event_properties FROM analytics.product_events WHERE event_id=analytics.derive_server_event_id("
      + "'card_addition_committed',ARRAY[$1::text])", [unknown.cardId],
    )).rows[0].event_properties, { demo_status: "unknown" });

    const delayed = { ...legacyCard(actor), hotAt: null };
    await insertCard(owner, actor, delayed);
    assert.equal((await reconcileCardAdditions({ batchSize: 10, maxBatches: 1 }, scope)).recoveredCount, 0);
    await insertHot(owner, actor, delayed, receiptAt);
    const concurrent = await Promise.all([
      reconcileCardAdditions({ batchSize: 10, maxBatches: 1 }, scope),
      reconcileCardAdditions({ batchSize: 10, maxBatches: 1 }, scope),
    ]);
    assert.equal(concurrent.reduce((count, summary) => count + summary.recoveredCount, 0), 1);
    await owner.query("DELETE FROM sync.hot_changes WHERE workspace_id = $1", [actor.workspaceId]);
    assert.equal((await reconcileCardAdditions({ batchSize: 10, maxBatches: 1 }, scope)).recoveredCount, 0);
    assert.equal((await recoveredCardIds(owner, [legacy, unknown, delayed])).length, 3);
  } finally {
    await owner.end();
  }
});

test("transfer-only hot writes and an unproved seed cannot establish an addition", async () => {
  const owner = ownerPool();
  try {
    const actor = await fixture(owner);
    await insertSeed(owner, actor);
    const transferred = legacyCard(actor);
    await insertCard(owner, actor, transferred);
    await owner.query(
      "INSERT INTO auth.guest_upgrade_history(upgrade_id,source_guest_user_id,source_guest_workspace_id,"
      + "source_guest_session_id,target_subject_user_id,target_user_id,target_workspace_id,selection_type,merged_at)"
      + " VALUES ($1,$2,$3,$4,$5,$6,$7,'existing',$8)",
      [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), actor.userId, actor.workspaceId, receiptAt],
    );
    const missingSeed = await fixture(owner);
    await insertCard(owner, missingSeed, { ...legacyCard(missingSeed), createdAt: seedAt, metadata: markedDemo,
      hotAt: "2026-01-03T10:00:00.000Z" });
    const unproved = legacyCard(missingSeed);
    await insertCard(owner, missingSeed, unproved);
    assert.equal((await reconcileCardAdditions({ batchSize: 10, maxBatches: 1 }, scope)).recoveredCount, 0);
    assert.deepEqual(await recoveredCardIds(owner, [transferred, unproved]), []);
  } finally {
    await owner.end();
  }
});

async function waitForRecoveryAccountLock(owner: pg.Pool): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await owner.query(
      "SELECT 1 FROM pg_catalog.pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory'"
      + " AND query LIKE 'SELECT auth.lock_account_lifecycle%'",
    );
    if (waiting.rowCount !== 0) return;
    await setTimeout(20);
  }
  assert.fail("Recovery did not reach the account lifecycle lock within five seconds.");
}

test("account erasure wins against a stale scan for a linked guest whose shared content survives", async () => {
  const owner = ownerPool();
  const deletion = await owner.connect();
  try {
    const guest = await fixture(owner);
    const account = await fixture(owner);
    await insertSeed(owner, guest);
    const card = legacyCard(guest);
    await insertCard(owner, guest, card);
    await owner.query(
      "INSERT INTO analytics.identity_links(link_id,anonymous_id,user_id,source) VALUES ($1,$2,$3,'server_derived')",
      [randomUUID(), guest.userId, account.userId],
    );
    await deletion.query("BEGIN");
    await deletion.query("SELECT auth.lock_account_lifecycle($1)", [account.userId]);
    await deletion.query("SELECT set_config('app.user_id',$1,true)", [account.userId]);
    const recovery = reconcileCardAdditions({ batchSize: 10, maxBatches: 1 }, scope);
    await waitForRecoveryAccountLock(owner);
    await deletion.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES (encode(sha256(convert_to($1,\'UTF8\')),\'hex\'))", [account.userId]);
    await deleteRealAccountDataInExecutor(deletion, account.userId);
    await deletion.query("COMMIT");
    assert.equal((await recovery).recoveredCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM content.cards WHERE card_id=$1", [card.cardId])).rowCount, 1);
    assert.deepEqual(await recoveredCardIds(owner, [card]), []);
    assert.equal((await owner.query(
      "SELECT identity_state FROM analytics.product_events WHERE event_id=analytics.derive_server_event_id("
      + "'card_created',ARRAY[$1::text])", [card.cardId],
    )).rows[0].identity_state, "anonymized");
  } finally {
    await deletion.query("ROLLBACK");
    deletion.release();
    await owner.end();
  }
});

test("disappeared writer scope cannot abort recovery or starve later valid cards", async (context) => {
  for (const removed of ["account", "workspace", "membership"]) {
    await context.test(removed, async () => {
      const owner = ownerPool();
      const backend = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      const client = await backend.connect();
      const deletion = await owner.connect();
      try {
        const actor = await fixture(owner);
        const validActor = await fixture(owner);
        for (const person of [actor, validActor]) await insertSeed(owner, person);
        const stale = legacyCard(actor);
        const valid = { ...legacyCard(validActor), createdAt: "2026-01-01T10:02:00.000Z" };
        await insertCard(owner, actor, stale);
        await insertCard(owner, validActor, valid);
        await deletion.query("BEGIN");
        await deletion.query("SELECT auth.lock_account_lifecycle($1)", [actor.userId]);
        await deletion.query("SELECT set_config('app.user_id',$1,true)", [actor.userId]);
        const recovery = reconcileCardAdditions({ batchSize: 10, maxBatches: 1 }, scope);
        await waitForRecoveryAccountLock(owner);
        if (removed === "account") {
          await deletion.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES (encode(sha256(convert_to($1,'UTF8')),'hex'))", [actor.userId]);
          await deleteRealAccountDataInExecutor(deletion, actor.userId);
        } else if (removed === "workspace") {
          await deletion.query("DELETE FROM org.workspaces WHERE workspace_id=$1", [actor.workspaceId]);
        } else {
          await deletion.query("DELETE FROM org.workspace_memberships WHERE workspace_id=$1 AND user_id=$2",
            [actor.workspaceId, actor.userId]);
        }
        await deletion.query("COMMIT");
        assert.deepEqual(await recovery, { scannedCount: 2, recoveredCount: 1, batchCount: 1, finished: true });
        await assert.rejects(scopedCandidates(client, actor.userId, actor.workspaceId, actor.workspaceId), { code: "42501" });
        const later = { ...legacyCard(validActor), createdAt: "2026-01-01T10:03:00.000Z" };
        await insertCard(owner, validActor, later);
        assert.equal((await reconcileCardAdditions({ batchSize: 1, maxBatches: 1 }, scope)).recoveredCount, 1);
        assert.deepEqual(await recoveredCardIds(owner, [stale, valid, later]), [valid.cardId, later.cardId].sort());
      } finally {
        await deletion.query("ROLLBACK");
        deletion.release();
        client.release();
        await Promise.all([backend.end(), owner.end()]);
      }
    });
  }
});

test("erasure anonymizes recovered facts together with their original source", async () => {
  const owner = ownerPool();
  const deletion = await owner.connect();
  try {
    const actor = await fixture(owner);
    await insertSeed(owner, actor);
    const card = legacyCard(actor);
    await insertCard(owner, actor, card);
    assert.equal((await reconcileCardAdditions({ batchSize: 10, maxBatches: 1 }, scope)).recoveredCount, 1);
    await deletion.query("BEGIN");
    await deletion.query("SELECT auth.lock_account_lifecycle($1)", [actor.userId]);
    await deletion.query("SELECT set_config('app.user_id',$1,true)", [actor.userId]);
    await deletion.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES (encode(sha256(convert_to($1,\'UTF8\')),\'hex\'))", [actor.userId]);
    await deleteRealAccountDataInExecutor(deletion, actor.userId);
    await deletion.query("COMMIT");
    const result = await owner.query(
      "SELECT user_id,subject_user_id,workspace_id,identity_state,event_properties,details"
      + " FROM analytics.product_events WHERE event_id=analytics.derive_server_event_id('card_addition_recovered',ARRAY[$1::text])",
      [card.cardId],
    );
    assert.equal(result.rows[0].identity_state, "anonymized");
    assert.notEqual(result.rows[0].user_id, actor.userId);
    assert.equal(result.rows[0].user_id, result.rows[0].subject_user_id);
    assert.equal(result.rows[0].workspace_id, null);
    assert.deepEqual(result.rows[0].event_properties, {});
    assert.deepEqual(result.rows[0].details, { proof: "original_card_and_same_replica_demo", version: 1 });
    assert.equal((await reconcileCardAdditions({ batchSize: 10, maxBatches: 1 }, scope)).recoveredCount, 0);
  } finally {
    await deletion.query("ROLLBACK");
    deletion.release();
    await owner.end();
  }
});

test("secondary server-linked owner erasure cannot miss recovery or starve a later valid card", async () => {
  const owner = ownerPool();
  const deletion = await owner.connect();
  try {
    const guest = await fixture(owner);
    const firstAccount = await fixture(owner);
    const secondAccount = await fixture(owner);
    const validActor = await fixture(owner);
    await insertSeed(owner, guest);
    await insertSeed(owner, validActor);
    const ambiguous = legacyCard(guest);
    const valid = { ...legacyCard(validActor), createdAt: "2026-01-01T10:02:00.000Z" };
    await insertCard(owner, guest, ambiguous);
    await insertCard(owner, validActor, valid);
    await insertServerLink(owner, guest, firstAccount);
    await insertServerLink(owner, guest, secondAccount);
    await deletion.query("BEGIN");
    await deletion.query("SELECT auth.lock_account_lifecycle($1)", [secondAccount.userId]);
    await deletion.query("SELECT set_config('app.user_id',$1,true)", [secondAccount.userId]);
    await deletion.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES (encode(sha256(convert_to($1,'UTF8')),'hex'))", [secondAccount.userId]);
    await deleteRealAccountDataInExecutor(deletion, secondAccount.userId);
    const recovery = await reconcileCardAdditions({ batchSize: 1, maxBatches: 1 }, scope);
    await deletion.query("COMMIT");
    assert.equal(recovery.scannedCount, 1);
    assert.equal(recovery.recoveredCount, 1);
    assert.deepEqual(await recoveredCardIds(owner, [ambiguous, valid]), [valid.cardId]);
  } finally {
    await deletion.query("ROLLBACK");
    deletion.release();
    await owner.end();
  }
});

test("recovery rejects conflicting and indirect erasure edges while accepting one shared direct owner", async () => {
  const owner = ownerPool();
  try {
    const conflicting = await fixture(owner);
    const firstOwner = await fixture(owner);
    const secondOwner = await fixture(owner);
    await insertServerLink(owner, conflicting, firstOwner);
    await insertUpgrade(owner, conflicting, secondOwner);
    const indirect = await fixture(owner);
    const intermediate = await fixture(owner);
    await insertUpgrade(owner, indirect, intermediate);
    await insertServerLink(owner, intermediate, secondOwner);
    const retired = await fixture(owner);
    const alias = await fixture(owner);
    await insertServerLink(owner, retired, alias);
    await owner.query("INSERT INTO auth.account_retirements(retired_user_id,canonical_user_id,retirement_id) VALUES ($1,$2,$3)",
      [alias.userId, secondOwner.userId, randomUUID()]);
    const linked = await fixture(owner);
    const sibling = await fixture(owner);
    await insertServerLink(owner, linked, firstOwner);
    await insertUpgrade(owner, linked, firstOwner);
    await insertUpgrade(owner, sibling, firstOwner);
    const rejectedCards: Array<CardProof> = [];
    for (const actor of [conflicting, indirect, retired]) {
      await insertSeed(owner, actor);
      const card = legacyCard(actor);
      await insertCard(owner, actor, card);
      rejectedCards.push(card);
    }
    const acceptedCards: Array<CardProof> = [];
    for (const actor of [linked, sibling]) {
      await insertSeed(owner, actor);
      const card = { ...legacyCard(actor), createdAt: "2026-01-01T10:03:00.000Z" };
      await insertCard(owner, actor, card);
      acceptedCards.push(card);
    }
    assert.equal((await reconcileCardAdditions({ batchSize: 1, maxBatches: 3 }, scope)).recoveredCount, 2);
    assert.deepEqual(await recoveredCardIds(owner, [...rejectedCards, ...acceptedCards]), acceptedCards.map((card) => card.cardId).sort());
  } finally {
    await owner.end();
  }
});

async function scopedCandidates(
  client: pg.PoolClient, userId: string, scopeWorkspaceId: string, targetWorkspaceId: string | null,
): Promise<ReadonlyArray<Readonly<{ user_id: string; actor_id: string }>>> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
      [userId, scopeWorkspaceId]);
    const result = await client.query<Readonly<{ user_id: string; actor_id: string }>>(
      "SELECT user_id,actor_id FROM analytics.card_addition_recovery_candidates($1::uuid)", [targetWorkspaceId],
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

test("definer proof requires the backend user and workspace scope while reporting remains global", async () => {
  const owner = ownerPool();
  const backend = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const reporter = new pg.Pool({ connectionString: process.env.REPORTING_DATABASE_URL });
  const client = await backend.connect();
  try {
    const actor = await fixture(owner);
    const otherActor = await fixture(owner);
    for (const person of [actor, otherActor]) {
      await insertSeed(owner, person);
      await insertCard(owner, person, legacyCard(person));
    }
    const global = await reporter.query<Readonly<{ user_id: string }>>(
      "SELECT user_id FROM analytics.card_addition_recovery_candidates(NULL::uuid)",
    );
    assert.ok(global.rows.some((row) => row.user_id === actor.userId));
    assert.ok(global.rows.some((row) => row.user_id === otherActor.userId));
    await assert.rejects(scopedCandidates(client, "", "", actor.workspaceId), { code: "42501" });
    await assert.rejects(scopedCandidates(client, actor.userId, actor.workspaceId, null), { code: "42501" });
    await assert.rejects(scopedCandidates(client, actor.userId, actor.workspaceId, otherActor.workspaceId), { code: "42501" });
    await assert.rejects(scopedCandidates(client, otherActor.userId, actor.workspaceId, actor.workspaceId), { code: "42501" });
    await owner.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')",
      [actor.workspaceId, otherActor.userId]);
    assert.deepEqual(await scopedCandidates(client, otherActor.userId, actor.workspaceId, actor.workspaceId), []);
    assert.deepEqual(await scopedCandidates(client, actor.userId, actor.workspaceId, actor.workspaceId),
      [{ user_id: actor.userId, actor_id: actor.userId }]);
    const grants = await owner.query(
      "SELECT has_function_privilege('auth_app','analytics.card_addition_recovery_candidates(uuid)','EXECUTE') AS auth_allowed",
    );
    assert.equal(grants.rows[0].auth_allowed, false);
    await owner.query("DELETE FROM sync.hot_changes WHERE workspace_id=ANY($1::uuid[])",
      [[actor.workspaceId, otherActor.workspaceId]]);
  } finally {
    client.release();
    await Promise.all([backend.end(), reporter.end(), owner.end()]);
  }
});

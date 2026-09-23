import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createCard, updateCard, upsertCardSnapshotInExecutor } from "../../cards/mutations";
import type { CardMutationResult, CardSnapshotInput } from "../../cards/types";
import { createDeck, deleteDeck, updateDeck } from "../../decks";
import type { ProductAnalyticsEventName } from "../catalog";
import { transactionWithWorkspaceScopeReportingContentWrites } from "./contentWrites";

// `card_updated` and `deck_updated` are the only content facts whose producer has to decide what a
// write meant rather than only that it happened, and the decision is made in SQL on the card path:
// updateCardInExecutor captures the authored fields as they stood before its own UPDATE in the same
// statement, because that path serves the agent surfaces where one batch updates up to a hundred
// cards and a SELECT per card would be a hundred extra round trips. Nothing else in the repository
// executes that statement - the unit suites drive card updates through fakes, and the agent
// integration test only asserts that a raw `UPDATE cards` is refused - so an ambiguous column, a
// join that drops the row or a RETURNING list that stops matching CARD_COLUMNS would first be seen
// in production, where it would 500 every agent card edit.
//
// These tests are therefore about the boundary and not about the helpers: they run the real
// exported mutations against a real PostgreSQL, through the real post-commit drain and the real
// analytics writer, and read analytics.product_events back. That is also the only way to pin the
// property that matters most for an append-only table - that a write which changed nothing a person
// authored stores no row - because the catalog's strict parser, the drain and the SQL all have to
// agree for that to hold.
//
// Two collection points need covering and they are not variants of each other. updateCardInExecutor
// is the agent surface and holds the SQL described above. upsertCardSnapshotInExecutor is where
// every edit a person makes in a client arrives, because all three clients queue their writes
// offline and push whole card snapshots, and it is also the path of the sync bootstrap push and of
// the guest merge; it decides in TypeScript instead, over branches - tombstoning, already
// tombstoned, resurrecting, unchanged, last-write-wins loser - that the agent path cannot reach at
// all. The catalog entry makes an explicit claim about each of those branches, so each one is
// walked below.
//
// The acting user id is a UUID rather than the shared fixture's prefixed string on purpose:
// analytics.product_events.user_id is a uuid column, the writer reports a refused batch instead of
// raising it, and a non-UUID actor would make every assertion below fail as "no rows" with the real
// cause logged and discarded.

type ProductEventCountRow = Readonly<{ event_name: string; count: string }>;

type AuthoringUpdateFixture = Readonly<{
  ownerPool: pg.Pool;
  userId: string;
  workspaceId: string;
  replicaId: string;
  createdAt: string;
}>;

function requireDatabaseUrl(environmentVariable: "DATABASE_URL" | "TEST_DATABASE_ADMIN_URL"): string {
  const databaseUrl = process.env[environmentVariable]?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      `${environmentVariable} is required for the authoring-update product analytics integration test.`,
    );
  }

  return databaseUrl;
}

async function createFixtureRows(fixture: AuthoringUpdateFixture): Promise<void> {
  const ownerClient = await fixture.ownerPool.connect();
  try {
    await ownerClient.query("BEGIN");
    await ownerClient.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [fixture.userId]);
    await ownerClient.query(
      [
        "INSERT INTO org.workspaces (",
        "workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id",
        ") VALUES ($1, $2, $3, $4, $5)",
      ].join(" "),
      [
        fixture.workspaceId,
        "Authoring update analytics integration",
        fixture.createdAt,
        fixture.replicaId,
        `postgres-integration-workspace-${fixture.workspaceId}`,
      ],
    );
    await ownerClient.query(
      "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [fixture.workspaceId, fixture.userId],
    );
    await ownerClient.query(
      [
        "INSERT INTO sync.workspace_replicas (",
        "replica_id, workspace_id, user_id, actor_kind, installation_id, actor_key, platform, app_version",
        ") VALUES ($1, $2, $3, 'ai_chat', NULL, $4, 'system', $5)",
      ].join(" "),
      [
        fixture.replicaId,
        fixture.workspaceId,
        fixture.userId,
        `postgres-integration-${fixture.replicaId}`,
        "postgres-integration",
      ],
    );
    await ownerClient.query("COMMIT");
  } catch (error) {
    await ownerClient.query("ROLLBACK");
    throw error;
  } finally {
    ownerClient.release();
  }
}

async function deleteFixtureRows(fixture: AuthoringUpdateFixture): Promise<void> {
  const ownerClient = await fixture.ownerPool.connect();
  try {
    await ownerClient.query("BEGIN");
    await ownerClient.query(
      "DELETE FROM analytics.product_events WHERE workspace_id = $1",
      [fixture.workspaceId],
    );
    await ownerClient.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [fixture.workspaceId]);
    await ownerClient.query("DELETE FROM org.user_settings WHERE user_id = $1", [fixture.userId]);
    await ownerClient.query("COMMIT");
  } catch (error) {
    await ownerClient.query("ROLLBACK");
    throw error;
  } finally {
    ownerClient.release();
  }
}

async function countStoredEvents(
  fixture: AuthoringUpdateFixture,
): Promise<ReadonlyMap<string, number>> {
  const result = await fixture.ownerPool.query<ProductEventCountRow>(
    [
      "SELECT event_name, count(*)::text AS count",
      "FROM analytics.product_events",
      "WHERE workspace_id = $1",
      "GROUP BY event_name",
    ].join(" "),
    [fixture.workspaceId],
  );
  return new Map(result.rows.map((row) => [row.event_name, Number.parseInt(row.count, 10)]));
}

async function assertStoredEventCount(
  fixture: AuthoringUpdateFixture,
  eventName: ProductAnalyticsEventName,
  expectedCount: number,
  context: string,
): Promise<void> {
  const counts = await countStoredEvents(fixture);
  assert.equal(
    counts.get(eventName) ?? 0,
    expectedCount,
    `${context}: expected ${expectedCount} ${eventName} rows, stored ${JSON.stringify([...counts])}`,
  );
}

function buildMetadata(replicaId: string, clientUpdatedAt: string) {
  return {
    clientUpdatedAt,
    lastModifiedByReplicaId: replicaId,
    lastOperationId: `postgres-integration-authoring-${randomUUID()}`,
  };
}

/**
 * One disposable workspace, owner and replica per test, torn down with the analytics rows it wrote
 * whether the body passed or threw. Each test mints its own UUIDs, so the two below share nothing
 * but this shape.
 */
async function withAuthoringUpdateFixture(
  run: (fixture: AuthoringUpdateFixture) => Promise<void>,
): Promise<void> {
  const fixture: AuthoringUpdateFixture = {
    ownerPool: new pg.Pool({
      connectionString: requireDatabaseUrl("TEST_DATABASE_ADMIN_URL"),
      application_name: "authoring-update-analytics-integration-owner",
    }),
    userId: randomUUID(),
    workspaceId: randomUUID(),
    replicaId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  // Reads DATABASE_URL through the real database module, which is what the exported mutations and
  // the analytics writer both connect with.
  requireDatabaseUrl("DATABASE_URL");

  const errors: Array<unknown> = [];
  try {
    await createFixtureRows(fixture);
    await run(fixture);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await deleteFixtureRows(fixture);
    } catch (error) {
      errors.push(error);
    }
    try {
      await fixture.ownerPool.end();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Authoring update analytics integration or cleanup failed.");
  }
}

test("only writes that change authored fields store card_updated and deck_updated", async () => {
  await withAuthoringUpdateFixture(async (fixture) => {
    const card = await createCard(
      fixture.userId,
      fixture.workspaceId,
      { frontText: "What is a spaced repetition interval?", backText: "The gap until the next review.", tags: ["study"] },
      buildMetadata(fixture.replicaId, "2026-01-01T00:00:00.000Z"),
    );
    await assertStoredEventCount(fixture, "card_created", 1, "after creating one card");
    await assertStoredEventCount(fixture, "card_updated", 0, "a creation is not an edit");

    // A write that touches only a non-authored column. card_type is a real column of content.cards
    // that this path can set, and moving it is not authoring.
    await updateCard(
      fixture.userId,
      fixture.workspaceId,
      card.cardId,
      { cardType: "cloze" },
      buildMetadata(fixture.replicaId, "2026-01-01T00:01:00.000Z"),
    );
    await assertStoredEventCount(fixture, "card_updated", 0, "changing only card_type is not an edit");

    // A write that names an authored field and stores exactly what the row already held. This is the
    // case the SQL exists for: the request named front_text, so a producer keyed on the request
    // would count an edit, while the row did not change.
    await updateCard(
      fixture.userId,
      fixture.workspaceId,
      card.cardId,
      { frontText: "What is a spaced repetition interval?" },
      buildMetadata(fixture.replicaId, "2026-01-01T00:02:00.000Z"),
    );
    await assertStoredEventCount(
      fixture,
      "card_updated",
      0,
      "re-writing a field with the value it already had is not an edit",
    );

    await updateCard(
      fixture.userId,
      fixture.workspaceId,
      card.cardId,
      { frontText: "How long is a spaced repetition interval?" },
      buildMetadata(fixture.replicaId, "2026-01-01T00:03:00.000Z"),
    );
    await assertStoredEventCount(fixture, "card_updated", 1, "changing the front text is one edit");

    // Tags are the third authored field and the one compared as a set rather than by equality.
    await updateCard(
      fixture.userId,
      fixture.workspaceId,
      card.cardId,
      { tags: ["study", "fsrs"] },
      buildMetadata(fixture.replicaId, "2026-01-01T00:04:00.000Z"),
    );
    await assertStoredEventCount(fixture, "card_updated", 2, "adding a tag is a second edit");

    await updateCard(
      fixture.userId,
      fixture.workspaceId,
      card.cardId,
      { tags: ["fsrs", "study"] },
      buildMetadata(fixture.replicaId, "2026-01-01T00:05:00.000Z"),
    );
    await assertStoredEventCount(fixture, "card_updated", 2, "reordering tags is not an edit");

    // The other half of the tag rule, and the one the catalog rests an over-count disclosure on:
    // the comparison is over multisets, not sets. Every write path dedupes the tags it stores
    // today, so the duplicate has to be written the way production acquired it - a row stored
    // before that dedupe existed. Dropping it changes the stored list while leaving the set of
    // distinct tags identical, which is an edit by this producer's definition. A set-based
    // comparison would read no change here and leave the count at 2.
    await fixture.ownerPool.query(
      "UPDATE content.cards SET tags = $1 WHERE workspace_id = $2 AND card_id = $3",
      [["fsrs", "study", "study"], fixture.workspaceId, card.cardId],
    );
    await updateCard(
      fixture.userId,
      fixture.workspaceId,
      card.cardId,
      { tags: ["fsrs", "study"] },
      buildMetadata(fixture.replicaId, "2026-01-01T00:05:30.000Z"),
    );
    await assertStoredEventCount(
      fixture,
      "card_updated",
      3,
      "dropping a stored duplicate tag is an edit, so the comparison must be multiset-correct",
    );

    const deck = await createDeck(
      fixture.userId,
      fixture.workspaceId,
      { name: "Study", filterDefinition: { version: 2, tags: ["study"] } },
      buildMetadata(fixture.replicaId, "2026-01-01T00:06:00.000Z"),
    );
    await assertStoredEventCount(fixture, "deck_created", 1, "after creating one deck");
    await assertStoredEventCount(fixture, "deck_updated", 0, "a creation is not an edit");

    await updateDeck(
      fixture.userId,
      fixture.workspaceId,
      deck.deckId,
      { name: "Study", filterDefinition: { version: 2, tags: ["study"] } },
      buildMetadata(fixture.replicaId, "2026-01-01T00:07:00.000Z"),
    );
    await assertStoredEventCount(
      fixture,
      "deck_updated",
      0,
      "re-sending a deck's own stored name and filter is not an edit",
    );

    await updateDeck(
      fixture.userId,
      fixture.workspaceId,
      deck.deckId,
      { name: "Spaced repetition", filterDefinition: { version: 2, tags: ["study"] } },
      buildMetadata(fixture.replicaId, "2026-01-01T00:08:00.000Z"),
    );
    await assertStoredEventCount(fixture, "deck_updated", 1, "renaming a deck is one edit");

    // A deletion re-sends the deck's own name and filter through the same snapshot path, so it must
    // report the tombstone and nothing else.
    await deleteDeck(
      fixture.userId,
      fixture.workspaceId,
      deck.deckId,
      buildMetadata(fixture.replicaId, "2026-01-01T00:09:00.000Z"),
    );
    await assertStoredEventCount(fixture, "deck_deleted", 1, "after deleting the deck");
    await assertStoredEventCount(fixture, "deck_updated", 1, "a deletion is not an edit");
  });
});

// A card snapshot as a client pushes one: a whole card on every write, which is what makes the
// comparison in upsertCardSnapshotInExecutor a test of what changed rather than of what was named.
// Everything outside `authored` and `deletedAt` is held fixed across a scenario so that any stored
// card_updated row is attributable to the authored fields alone.
function buildCardSnapshot(
  cardId: string,
  authored: Readonly<{ frontText: string; backText: string; tags: ReadonlyArray<string> }>,
  deletedAt: string | null,
): CardSnapshotInput {
  return {
    cardId,
    frontText: authored.frontText,
    backText: authored.backText,
    tags: authored.tags,
    dueAt: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    deletedAt,
  };
}

// The sync push, the sync bootstrap push and the guest merge all write a card by calling
// upsertCardSnapshotInExecutor inside a transaction opened by the content-write reporting wrapper
// (sync/replication/push.ts, sync/replication/bootstrap.ts, and guestAuth/index.ts, which opens the
// unsafe sibling wrapper around the merge), so this is that call, with the real post-commit drain
// and the real analytics writer behind it. Each push mints its own operation id, as a distinct
// queued client operation does.
async function pushCardSnapshot(
  fixture: AuthoringUpdateFixture,
  input: CardSnapshotInput,
  clientUpdatedAt: string,
): Promise<CardMutationResult> {
  return transactionWithWorkspaceScopeReportingContentWrites(
    { userId: fixture.userId, workspaceId: fixture.workspaceId },
    async (executor) => upsertCardSnapshotInExecutor(
      executor,
      fixture.workspaceId,
      input,
      buildMetadata(fixture.replicaId, clientUpdatedAt),
    ),
  );
}

// The test above drives cards only through updateCard, which is the agent surface. This one drives
// the collection point that carries essentially all production volume instead: every edit a person
// makes on web, iOS or Android is queued offline and arrives here as a whole card snapshot, and so
// does every card of a bootstrap push and of a guest merge. Each step below is one branch of
// upsertCardSnapshotInExecutor that the catalog entry makes an explicit claim about, and the
// scenario walks a single card through all of them in the order a real card can meet them.
test("the client snapshot push stores card_updated only for a write that authored something", async () => {
  await withAuthoringUpdateFixture(async (fixture) => {
    const cardId = randomUUID();
    const authored = {
      frontText: "What does an outbox operation carry?",
      backText: "The whole entity, not a field diff.",
      tags: ["sync"],
    } as const;

    const created = await pushCardSnapshot(
      fixture,
      buildCardSnapshot(cardId, authored, null),
      "2026-02-01T00:00:00.000Z",
    );
    assert.equal(created.applied, true);
    await assertStoredEventCount(fixture, "card_created", 1, "the snapshot insert branch is a creation");
    await assertStoredEventCount(fixture, "card_updated", 0, "a creation is not an edit");

    // The case the whole comparison exists for, and the common one in production: a client
    // re-syncing a library it has not touched re-sends every field of every card. The write really
    // happens - client_updated_at and the sync bookkeeping move - and nothing was authored.
    await pushCardSnapshot(
      fixture,
      buildCardSnapshot(cardId, authored, null),
      "2026-02-01T00:01:00.000Z",
    );
    await assertStoredEventCount(
      fixture,
      "card_updated",
      0,
      "re-sending an untouched card's own stored snapshot is not an edit",
    );

    const edited = { ...authored, backText: "The whole entity, so a replay is idempotent." };
    await pushCardSnapshot(
      fixture,
      buildCardSnapshot(cardId, edited, null),
      "2026-02-01T00:02:00.000Z",
    );
    await assertStoredEventCount(fixture, "card_updated", 1, "changing the back text is one edit");

    // An edit that loses last-write-wins never reaches the collection point, because the upsert
    // returns before it writes anything. The catalog states this as an under-count: the server
    // never held that text, so there is nothing to report.
    const lost = await pushCardSnapshot(
      fixture,
      buildCardSnapshot(cardId, { ...authored, frontText: "Stale offline edit" }, null),
      "2026-02-01T00:01:30.000Z",
    );
    assert.equal(lost.applied, false, "the older snapshot must lose last-write-wins");
    await assertStoredEventCount(fixture, "card_updated", 1, "an edit that loses last-write-wins is not counted");

    // A tombstoning write that also carries changed text. Its meaning is the deletion, so it
    // reports card_deleted and nothing else even though the authored text did move.
    await pushCardSnapshot(
      fixture,
      buildCardSnapshot(
        cardId,
        { ...edited, frontText: "Edited in the same write that deleted the card" },
        "2026-02-01T00:03:00.000Z",
      ),
      "2026-02-01T00:03:00.000Z",
    );
    await assertStoredEventCount(fixture, "card_deleted", 1, "the tombstoning write is a deletion");
    await assertStoredEventCount(
      fixture,
      "card_updated",
      1,
      "a write that tombstones is a deletion and not also an edit",
    );

    // A write over a row the server already holds tombstoned. Editing a tombstone is not authoring,
    // and the deletion does not count a second time either.
    const tombstonedAndEdited = {
      ...edited,
      frontText: "Edited while the server already held the tombstone",
    };
    await pushCardSnapshot(
      fixture,
      buildCardSnapshot(cardId, tombstonedAndEdited, "2026-02-01T00:03:00.000Z"),
      "2026-02-01T00:04:00.000Z",
    );
    await assertStoredEventCount(fixture, "card_updated", 1, "editing a tombstoned card is not an edit");
    await assertStoredEventCount(fixture, "card_deleted", 1, "a re-sent tombstone is not a second deletion");

    // A resurrection carrying the text the server already holds. Nothing is stored, which is the
    // asymmetry the catalog entry discloses: card_deleted stands with no counter-signal, so
    // card_created minus card_deleted keeps counting this live card as gone.
    await pushCardSnapshot(
      fixture,
      buildCardSnapshot(cardId, tombstonedAndEdited, null),
      "2026-02-01T00:05:00.000Z",
    );
    await assertStoredEventCount(
      fixture,
      "card_updated",
      1,
      "a resurrection that authored nothing stores nothing",
    );

    await pushCardSnapshot(
      fixture,
      buildCardSnapshot(cardId, tombstonedAndEdited, "2026-02-01T00:06:00.000Z"),
      "2026-02-01T00:06:00.000Z",
    );
    await assertStoredEventCount(
      fixture,
      "card_deleted",
      1,
      "a second deletion of the same card derives the same event id and is dropped",
    );

    // A resurrection that does author something. This is the branch an offline edit outranking
    // another device's delete lands on, and the one an Android save on a card deleted elsewhere
    // lands on when the text also moved.
    await pushCardSnapshot(
      fixture,
      buildCardSnapshot(cardId, { ...tombstonedAndEdited, backText: "Rewritten on the way back" }, null),
      "2026-02-01T00:07:00.000Z",
    );
    await assertStoredEventCount(
      fixture,
      "card_updated",
      2,
      "a resurrection with changed text is one edit",
    );
  });
});

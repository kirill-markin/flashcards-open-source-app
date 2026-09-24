import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import { upsertCardSnapshotInExecutor } from "../mutations";
import type { CardSnapshotInput } from "../types";
import {
  appendManagedImageToCardSideInExecutor,
  appendPendingManagedImageToCardSideInExecutor,
  markPendingManagedImageReadyOnCardSideInExecutor,
} from "./managedImageSettlement";
import { createManagedImageRestoreLedger } from "./managedImageSnapshotMerge";

/**
 * The managed-image merge, against a real database.
 *
 * It belongs here rather than beside the pure function because the rule it implements is a rule
 * about a stored row: what it restores comes out of `content.cards.front_text`/`back_text` as the
 * database holds them, and who is allowed to drop a reference is decided from
 * `last_modified_by_replica_id` on that same row. Both sides of the statement in
 * `upsertCardSnapshotInExecutor` have to line up with the row the settlement in
 * ./managedImageSettlement.ts actually wrote, and nothing else in the repository runs those two
 * writers against each other.
 */

const staleReviewClientUpdatedAt = "2099-01-01T00:00:00.000Z";
const secondStaleReviewClientUpdatedAt = "2099-01-01T00:05:00.000Z";
const thirdStaleReviewClientUpdatedAt = "2099-01-01T00:10:00.000Z";
const originalBackText = "Original answer";
const generatedImageAltText = "A folded paper crane";

type PersistedCardTextRow = Readonly<{
  front_text: string;
  back_text: string;
  last_modified_by_replica_id: string;
  client_updated_at: Date;
}>;

function createClientExecutor(client: pg.PoolClient): DatabaseExecutor {
  return {
    query<Row extends pg.QueryResultRow>(text: string, params: ReadonlyArray<SqlValue>): Promise<pg.QueryResult<Row>> {
      return client.query<Row>(text, [...params]);
    },
  };
}

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
    const result = await callback(createClientExecutor(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A second replica standing in for the person's phone or laptop.
 *
 * The fixture's own replica is an `ai_chat` actor, which is exactly what the backend writes managed
 * images as, so the device pushing snapshots has to be a different row. `org.workspaces` is deleted
 * by the fixture teardown and cascades the `sync.workspace_replicas` row away with it. The
 * `sync.installations` row it hangs off is not cascaded and not deleted: that table has no
 * workspace and its `user_id` is plain `TEXT` with no foreign key
 * (db/migrations/0035_sync_installations_and_workspace_replicas.sql:9), so each run leaks one row
 * and the teardown's own verification does not look for it. Harmless in a throwaway container.
 */
async function createDeviceReplica(fixture: PostgresIntegrationFixture): Promise<string> {
  const installationId = randomUUID();
  const deviceReplicaId = randomUUID();
  await fixture.ownerPool.query(
    "INSERT INTO sync.installations (installation_id, user_id, platform, app_version) VALUES ($1, $2, 'android', $3)",
    [installationId, fixture.userId, "postgres-integration"],
  );
  await fixture.ownerPool.query(
    [
      "INSERT INTO sync.workspace_replicas (",
      "replica_id, workspace_id, user_id, actor_kind, installation_id, actor_key, platform, app_version",
      ") VALUES ($1, $2, $3, 'client_installation', $4, NULL, 'android', $5)",
    ].join(" "),
    [deviceReplicaId, fixture.workspaceId, fixture.userId, installationId, "postgres-integration"],
  );
  return deviceReplicaId;
}

async function loadPersistedCardText(fixture: PostgresIntegrationFixture): Promise<PersistedCardTextRow> {
  const result = await fixture.ownerPool.query<PersistedCardTextRow>(
    [
      "SELECT front_text, back_text, last_modified_by_replica_id, client_updated_at",
      "FROM content.cards WHERE workspace_id = $1 AND card_id = $2",
    ].join(" "),
    [fixture.workspaceId, fixture.cardId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Fixture card was not found. cardId=${fixture.cardId}`);
  }
  return row;
}

async function appendGeneratedImage(
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
): Promise<string> {
  return withRuntimeTransaction(fixture, async (executor) => {
    const result = await appendManagedImageToCardSideInExecutor(
      executor,
      fixture.workspaceId,
      {
        cardId: fixture.cardId,
        targetSide: "back",
        mediaAssetId,
        altText: generatedImageAltText,
      },
      {
        clientUpdatedAt: fixture.createdAt,
        lastModifiedByReplicaId: fixture.replicaId,
        lastOperationId: `managed-image-append-${mediaAssetId}`,
      },
    );
    assert.equal(result.applied, true);
    return result.card.backText;
  });
}

/**
 * The two texts a device can be holding for one generated image: the pending placeholder that is
 * published as a hot change while the image is still being produced, and the ready reference the
 * promotion job rewrites it to. A device that pulled inside that window holds the first one and
 * will push it back.
 */
async function appendPendingGeneratedImage(
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
): Promise<string> {
  return withRuntimeTransaction(fixture, async (executor) => {
    const result = await appendPendingManagedImageToCardSideInExecutor(
      executor,
      fixture.workspaceId,
      {
        cardId: fixture.cardId,
        targetSide: "back",
        mediaAssetId,
        altText: generatedImageAltText,
      },
      {
        clientUpdatedAt: fixture.createdAt,
        lastModifiedByReplicaId: fixture.replicaId,
        lastOperationId: `managed-image-pending-${mediaAssetId}`,
      },
    );
    assert.equal(result.placeholderApplied, true);
    return result.card.backText;
  });
}

async function settlePendingGeneratedImage(
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
): Promise<string> {
  return withRuntimeTransaction(fixture, async (executor) => {
    const result = await markPendingManagedImageReadyOnCardSideInExecutor(
      executor,
      fixture.workspaceId,
      {
        cardId: fixture.cardId,
        targetSide: "back",
        mediaAssetId,
        altText: generatedImageAltText,
      },
      {
        clientUpdatedAt: fixture.createdAt,
        lastModifiedByReplicaId: fixture.replicaId,
        lastOperationId: `managed-image-settle-${mediaAssetId}`,
      },
      async () => {},
    );
    assert.equal(result.applied, true);
    return result.card.backText;
  });
}

function buildStaleSnapshot(
  fixture: PostgresIntegrationFixture,
  backText: string,
): CardSnapshotInput {
  return {
    cardId: fixture.cardId,
    frontText: "Original question",
    backText,
    tags: [],
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

test(
  "a snapshot push that never saw a managed image keeps it, and the device that stored it may drop it",
  async () => {
    await withPostgresIntegrationFixture(async (fixture) => {
      const deviceReplicaId = await createDeviceReplica(fixture);
      const mediaAssetId = randomUUID();
      const settledBackText = await appendGeneratedImage(fixture, mediaAssetId);
      assert.match(settledBackText, /!\[A folded paper crane\]\(fcasset:/u);

      // The stale push. The device queued a review before it pulled the settlement, so it carries
      // the answer text as it was before the image landed, stamped with the review's own moment,
      // which outranks the settlement by last-write-wins.
      const staleResult = await withRuntimeTransaction(fixture, (executor) => upsertCardSnapshotInExecutor(
        executor,
        fixture.workspaceId,
        buildStaleSnapshot(fixture, originalBackText),
        {
          clientUpdatedAt: staleReviewClientUpdatedAt,
          lastModifiedByReplicaId: deviceReplicaId,
          lastOperationId: `stale-review-${randomUUID()}`,
        },
      ));
      assert.equal(staleResult.applied, true);

      const afterStalePush = await loadPersistedCardText(fixture);
      // Byte-identical to what the settlement stored: the image is back where the server put it,
      // and the rest of the answer is the text the device sent. Nothing about the write was
      // rejected - the push still won, and the row now belongs to the device.
      assert.equal(afterStalePush.back_text, settledBackText);
      assert.equal(afterStalePush.last_modified_by_replica_id, deviceReplicaId);
      // One millisecond past the snapshot that caused the restore. This is what makes the merged
      // card outrank the row the device still holds, so its next pull applies the card instead of
      // skipping it on a replica-id tie-break it would otherwise lose about half the time.
      assert.equal(afterStalePush.client_updated_at.toISOString(), "2099-01-01T00:00:00.001Z");

      // The deliberate deletion. The stored row is now this device's own text, so the reference it
      // is dropping is one it demonstrably had. The drop stands.
      await withRuntimeTransaction(fixture, (executor) => upsertCardSnapshotInExecutor(
        executor,
        fixture.workspaceId,
        buildStaleSnapshot(fixture, originalBackText),
        {
          clientUpdatedAt: secondStaleReviewClientUpdatedAt,
          lastModifiedByReplicaId: deviceReplicaId,
          lastOperationId: `deliberate-removal-${randomUUID()}`,
        },
      ));

      const afterDeliberateRemoval = await loadPersistedCardText(fixture);
      assert.equal(afterDeliberateRemoval.back_text, originalBackText);
      // Nothing was restored, so the stamp is exactly what the device sent.
      assert.equal(
        afterDeliberateRemoval.client_updated_at.toISOString(),
        secondStaleReviewClientUpdatedAt,
      );
    });
  },
);

test(
  "one push batch carrying two stale snapshots of the same card keeps the managed image",
  async () => {
    await withPostgresIntegrationFixture(async (fixture) => {
      const deviceReplicaId = await createDeviceReplica(fixture);
      const mediaAssetId = randomUUID();
      const settledBackText = await appendGeneratedImage(fixture, mediaAssetId);

      // Rating a card `Again` and then `Good` in one offline session queues two whole-card
      // snapshots, both frozen with the same stale text, and they arrive in one push. The ledger is
      // what stops the second one from reading the first one's merge as this device catching up.
      const managedImageRestoreLedger = createManagedImageRestoreLedger();
      await withRuntimeTransaction(fixture, async (executor) => {
        for (const clientUpdatedAt of [staleReviewClientUpdatedAt, secondStaleReviewClientUpdatedAt]) {
          await upsertCardSnapshotInExecutor(
            executor,
            fixture.workspaceId,
            buildStaleSnapshot(fixture, originalBackText),
            {
              clientUpdatedAt,
              lastModifiedByReplicaId: deviceReplicaId,
              lastOperationId: `offline-review-${randomUUID()}`,
            },
            { managedImageRestoreLedger },
          );
        }
      });

      assert.equal((await loadPersistedCardText(fixture)).back_text, settledBackText);

      // A third push in a later request is a new chance, and by then the device has had the merged
      // card available to pull. This one is read as a decision and the image goes.
      await withRuntimeTransaction(fixture, (executor) => upsertCardSnapshotInExecutor(
        executor,
        fixture.workspaceId,
        buildStaleSnapshot(fixture, originalBackText),
        {
          clientUpdatedAt: thirdStaleReviewClientUpdatedAt,
          lastModifiedByReplicaId: deviceReplicaId,
          lastOperationId: `later-request-${randomUUID()}`,
        },
        { managedImageRestoreLedger: createManagedImageRestoreLedger() },
      ));

      assert.equal((await loadPersistedCardText(fixture)).back_text, originalBackText);
    });
  },
);

test(
  "a snapshot still naming the asset outside an active Markdown destination gets no second copy",
  async () => {
    await withPostgresIntegrationFixture(async (fixture) => {
      const deviceReplicaId = await createDeviceReplica(fixture);
      const mediaAssetId = randomUUID();
      await appendGeneratedImage(fixture, mediaAssetId);

      // Nothing in the product writes this shape, but a person editing their own card can. The
      // Markdown extractor does not read an HTML `img` as a destination, so without the wider
      // mention check the merge would read the asset as dropped and append a second copy of an
      // image the person is plainly still holding.
      const handWrittenBackText = `Original answer\n\n<img src="fcasset:${mediaAssetId}" alt="pic">`;
      await withRuntimeTransaction(fixture, (executor) => upsertCardSnapshotInExecutor(
        executor,
        fixture.workspaceId,
        buildStaleSnapshot(fixture, handWrittenBackText),
        {
          clientUpdatedAt: staleReviewClientUpdatedAt,
          lastModifiedByReplicaId: deviceReplicaId,
          lastOperationId: `hand-written-html-${randomUUID()}`,
        },
      ));

      const stored = await loadPersistedCardText(fixture);
      assert.equal(stored.back_text, handWrittenBackText);
      assert.equal(stored.client_updated_at.toISOString(), staleReviewClientUpdatedAt);
    });
  },
);

test(
  "a stale push that also edited the prose keeps the edit and gets the image back after it",
  async () => {
    await withPostgresIntegrationFixture(async (fixture) => {
      const deviceReplicaId = await createDeviceReplica(fixture);
      const firstMediaAssetId = randomUUID();
      const secondMediaAssetId = randomUUID();
      await appendGeneratedImage(fixture, firstMediaAssetId);
      await appendGeneratedImage(fixture, secondMediaAssetId);

      const editedBackText = "Answer the person rewrote while offline";
      await withRuntimeTransaction(fixture, (executor) => upsertCardSnapshotInExecutor(
        executor,
        fixture.workspaceId,
        buildStaleSnapshot(fixture, editedBackText),
        {
          clientUpdatedAt: staleReviewClientUpdatedAt,
          lastModifiedByReplicaId: deviceReplicaId,
          lastOperationId: `offline-edit-${randomUUID()}`,
        },
      ));

      const merged = (await loadPersistedCardText(fixture)).back_text;
      assert.equal(
        merged,
        [
          editedBackText,
          `![${generatedImageAltText}](fcasset:${firstMediaAssetId})`,
          `![${generatedImageAltText}](fcasset:${secondMediaAssetId})`,
        ].join("\n\n"),
      );
    });
  },
);

test(
  "a snapshot pushing the pending placeholder back does not un-settle the ready image",
  async () => {
    await withPostgresIntegrationFixture(async (fixture) => {
      const deviceReplicaId = await createDeviceReplica(fixture);
      const mediaAssetId = randomUUID();
      const pendingBackText = await appendPendingGeneratedImage(fixture, mediaAssetId);
      const settledBackText = await settlePendingGeneratedImage(fixture, mediaAssetId);
      assert.match(pendingBackText, /!\[A folded paper crane\]\(fcasset:[^)]+\?state=pending\)/u);
      assert.notEqual(pendingBackText, settledBackText);

      // The device pulled the card inside the window between the two writes above, so its outbox
      // snapshot carries the placeholder for an image it has never had. The asset id is still in
      // the text, so nothing here is dropped and nothing is restored - only the lifecycle state
      // disagrees, and the stored one wins.
      const staleResult = await withRuntimeTransaction(fixture, (executor) => upsertCardSnapshotInExecutor(
        executor,
        fixture.workspaceId,
        buildStaleSnapshot(fixture, pendingBackText),
        {
          clientUpdatedAt: staleReviewClientUpdatedAt,
          lastModifiedByReplicaId: deviceReplicaId,
          lastOperationId: `stale-pending-${randomUUID()}`,
        },
      ));
      assert.equal(staleResult.applied, true);

      const afterStalePush = await loadPersistedCardText(fixture);
      assert.equal(afterStalePush.back_text, settledBackText);
      assert.equal(afterStalePush.last_modified_by_replica_id, deviceReplicaId);
      // The rewrite moves the row for the same reason a restore does, so the device applies the
      // corrected card on its next pull instead of skipping it on a replica-id tie-break.
      assert.equal(afterStalePush.client_updated_at.toISOString(), "2099-01-01T00:00:00.001Z");

      // Pushing it a second time from the same device is corrected again. The rule needs no ledger
      // and no replica check: no client exposes the lifecycle query string, so a state that
      // disagrees with the stored one is never a deliberate edit to honour.
      await withRuntimeTransaction(fixture, (executor) => upsertCardSnapshotInExecutor(
        executor,
        fixture.workspaceId,
        buildStaleSnapshot(fixture, pendingBackText),
        {
          clientUpdatedAt: secondStaleReviewClientUpdatedAt,
          lastModifiedByReplicaId: deviceReplicaId,
          lastOperationId: `stale-pending-again-${randomUUID()}`,
        },
      ));

      const afterSecondStalePush = await loadPersistedCardText(fixture);
      assert.equal(afterSecondStalePush.back_text, settledBackText);
      assert.equal(
        afterSecondStalePush.client_updated_at.toISOString(),
        "2099-01-01T00:05:00.001Z",
      );
    });
  },
);

test(
  "a snapshot carrying the same managed image in the same state is stored exactly as it arrived",
  async () => {
    await withPostgresIntegrationFixture(async (fixture) => {
      const deviceReplicaId = await createDeviceReplica(fixture);
      const mediaAssetId = randomUUID();
      const settledBackText = await appendGeneratedImage(fixture, mediaAssetId);

      // A device that did pull the settlement. Nothing is dropped and no state disagrees, so the
      // merge has to be a no-op down to the stamp: bumping it here would make the next snapshot
      // the same offline session already queued lose last-write-wins and silently drop its review.
      await withRuntimeTransaction(fixture, (executor) => upsertCardSnapshotInExecutor(
        executor,
        fixture.workspaceId,
        buildStaleSnapshot(fixture, settledBackText),
        {
          clientUpdatedAt: staleReviewClientUpdatedAt,
          lastModifiedByReplicaId: deviceReplicaId,
          lastOperationId: `caught-up-review-${randomUUID()}`,
        },
      ));

      const stored = await loadPersistedCardText(fixture);
      assert.equal(stored.back_text, settledBackText);
      assert.equal(stored.client_updated_at.toISOString(), staleReviewClientUpdatedAt);
    });
  },
);

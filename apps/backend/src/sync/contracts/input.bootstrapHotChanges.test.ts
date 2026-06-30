import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { CardSnapshotInput } from "../../cards";
import type { CardRow } from "../../cards/types";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { buildMediaBlobStorageKey } from "../../mediaAssets/storageKeys";
import {
  passthroughMediaBlobNormalizationVersion,
  type MediaAssetRow,
} from "../../mediaAssets/types";
import { parseBootstrapEntryRow } from "../replication/bootstrap";
import { buildHotChangesFromRows } from "../replication/hotPull";
import {
  createCardMetadata,
  createCardSnapshotPayload,
  createMediaAssetPayload,
  createQueryResult,
  mediaAssetId,
  type CardDueAtFixture,
} from "./inputTestSupport";
import type { LegacyEffortLevel } from "./legacyEffort";
import type { BootstrapProjectionRow } from "./types";

type CardBootstrapPayload = CardSnapshotInput & Readonly<{
  effortLevel: LegacyEffortLevel;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
}>;

function createCardBootstrapPayload(fixture: CardDueAtFixture): CardBootstrapPayload {
  return {
    ...createCardSnapshotPayload(fixture),
    effortLevel: "fast",
    clientUpdatedAt: "2026-02-28T09:30:00.000Z",
    lastModifiedByReplicaId: "replica-1",
    lastOperationId: "operation-card-1",
    updatedAt: "2026-02-28T09:30:00.000Z",
  };
}

function createCardBootstrapProjectionRow(fixture: CardDueAtFixture): BootstrapProjectionRow {
  return {
    entity_rank: 1,
    entity_type: "card",
    entity_id: "card-1",
    payload: createCardBootstrapPayload(fixture),
  };
}

function createMediaAssetBootstrapProjectionRow(deletedAt: string | null): BootstrapProjectionRow {
  return {
    entity_rank: 3,
    entity_type: "media_asset",
    entity_id: mediaAssetId,
    payload: createMediaAssetPayload(deletedAt),
  };
}

function createHotPullCardRow(effortLevel: LegacyEffortLevel): CardRow {
  return {
    card_id: "card-1",
    front_text: "Question",
    back_text: "Answer",
    card_type: "basic",
    metadata: createCardMetadata("2026-02-28T09:00:00.000Z"),
    tags: ["sync"],
    effort_level: effortLevel,
    due_at: null,
    created_at: "2026-02-28T09:00:00.000Z",
    reps: 0,
    lapses: 0,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
    client_updated_at: "2026-02-28T09:30:00.000Z",
    last_modified_by_replica_id: "replica-1",
    last_operation_id: "operation-card-1",
    updated_at: "2026-02-28T09:30:00.000Z",
    deleted_at: null,
  };
}

function createHotPullCardExecutor(effortLevel: LegacyEffortLevel): DatabaseExecutor {
  return {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      assert.match(text, /FROM content\.cards/);
      assert.deepEqual(params, ["workspace-1", ["card-1"]]);
      return createQueryResult([createHotPullCardRow(effortLevel) as unknown as Row]);
    },
  };
}

function createHotPullMediaAssetRow(deletedAt: string | null): MediaAssetRow {
  const payload = createMediaAssetPayload(deletedAt);
  return {
    media_asset_id: payload.mediaAssetId,
    workspace_id: payload.workspaceId,
    media_blob_id: "33333333-3333-4333-8333-333333333333",
    mime_type: payload.mimeType,
    size_bytes: payload.sizeBytes,
    sha256: payload.sha256,
    storage_key: buildMediaBlobStorageKey(payload.sha256),
    blob_normalization_version: passthroughMediaBlobNormalizationVersion,
    blob_created_at: payload.createdAt,
    blob_updated_at: payload.updatedAt,
    source_url: payload.sourceUrl,
    created_at: payload.createdAt,
    client_updated_at: payload.clientUpdatedAt,
    last_modified_by_replica_id: payload.lastModifiedByReplicaId,
    last_operation_id: payload.lastOperationId,
    updated_at: payload.updatedAt,
    deleted_at: payload.deletedAt,
  };
}

function createHotPullMediaAssetExecutor(deletedAt: string | null): DatabaseExecutor {
  return {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      assert.match(text, /FROM content\.media_assets/);
      assert.deepEqual(params, ["workspace-1", [mediaAssetId]]);
      return createQueryResult([createHotPullMediaAssetRow(deletedAt) as unknown as Row]);
    },
  };
}

test("parseBootstrapEntryRow keeps outbound card dueAt as a string or null without dueAtMillis", () => {
  const validDueAt = "2028-02-29T10:11:12.345Z";
  const entryWithDueAt = parseBootstrapEntryRow(createCardBootstrapProjectionRow({
    dueAt: validDueAt,
  }));
  if (entryWithDueAt.entityType !== "card") {
    assert.fail("Expected the bootstrap entry to remain a card");
  }

  assert.equal(entryWithDueAt.payload.dueAt, validDueAt);
  assert.equal(entryWithDueAt.payload.effortLevel, "fast");
  assert.equal(entryWithDueAt.payload.cardType, "basic");
  assert.deepEqual(entryWithDueAt.payload.metadata, createCardMetadata("2026-02-28T09:00:00.000Z"));
  assert.equal(Object.prototype.hasOwnProperty.call(entryWithDueAt.payload, "dueAtMillis"), false);

  const entryWithoutDueAt = parseBootstrapEntryRow(createCardBootstrapProjectionRow({
    dueAt: null,
  }));
  if (entryWithoutDueAt.entityType !== "card") {
    assert.fail("Expected the bootstrap entry to remain a card");
  }

  assert.equal(entryWithoutDueAt.payload.dueAt, null);
  assert.equal(entryWithoutDueAt.payload.effortLevel, "fast");
  assert.equal(entryWithoutDueAt.payload.cardType, "basic");
  assert.deepEqual(entryWithoutDueAt.payload.metadata, createCardMetadata("2026-02-28T09:00:00.000Z"));
  assert.equal(Object.prototype.hasOwnProperty.call(entryWithoutDueAt.payload, "dueAtMillis"), false);
});

test("parseBootstrapEntryRow accepts media_asset metadata tombstones", () => {
  const entry = parseBootstrapEntryRow(createMediaAssetBootstrapProjectionRow("2026-02-28T09:30:00.000Z"));
  if (entry.entityType !== "media_asset") {
    assert.fail("Expected the bootstrap entry to remain a media_asset");
  }

  assert.equal(entry.entityId, mediaAssetId);
  assert.equal(entry.payload.mediaAssetId, mediaAssetId);
  assert.equal(entry.payload.deletedAt, "2026-02-28T09:30:00.000Z");
  assert.equal(Object.prototype.hasOwnProperty.call(entry.payload, "bytes"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(entry.payload, "storageKey"), false);
});

test("buildHotChangesFromRows keeps outbound card effortLevel as fast", async () => {
  const changes = await buildHotChangesFromRows(
    createHotPullCardExecutor("long"),
    "workspace-1",
    [
      {
        change_id: 7,
        entity_type: "card",
        entity_id: "card-1",
      },
    ],
  );

  const change = changes[0];
  if (change?.entityType !== "card") {
    assert.fail("Expected the hot pull entry to remain a card");
  }

  assert.equal(change.payload.effortLevel, "fast");
  assert.equal(change.payload.cardType, "basic");
  assert.deepEqual(change.payload.metadata, createCardMetadata("2026-02-28T09:00:00.000Z"));
});

test("buildHotChangesFromRows emits media_asset metadata tombstones", async () => {
  const changes = await buildHotChangesFromRows(
    createHotPullMediaAssetExecutor("2026-02-28T09:30:00.000Z"),
    "workspace-1",
    [
      {
        change_id: 8,
        entity_type: "media_asset",
        entity_id: mediaAssetId,
      },
    ],
  );

  const change = changes[0];
  if (change?.entityType !== "media_asset") {
    assert.fail("Expected the hot pull entry to remain a media_asset");
  }

  assert.equal(change.changeId, 8);
  assert.equal(change.payload.mediaAssetId, mediaAssetId);
  assert.equal(change.payload.deletedAt, "2026-02-28T09:30:00.000Z");
  assert.equal(Object.prototype.hasOwnProperty.call(change.payload, "bytes"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(change.payload, "storageKey"), false);
});

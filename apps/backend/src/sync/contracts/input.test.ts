import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import {
  upsertCardSnapshotInExecutor,
  type CardMetadata,
  type CardSnapshotInput,
} from "../../cards";
import type { CardRow } from "../../cards/types";
import type { DatabaseExecutor, SqlValue } from "../../database";
import {
  parseDeckFilterDefinition,
  upsertDeckSnapshotInExecutor,
  type DeckSnapshotInput,
  type DeckRow,
} from "../../decks";
import { buildMediaBlobStorageKey } from "../../mediaAssets/storageKeys";
import type { MediaAssetRow } from "../../mediaAssets/types";
import { HttpError } from "../../shared/errors";
import { parseBootstrapEntryRow } from "../replication/bootstrap";
import { buildHotChangesFromRows } from "../replication/hotPull";
import {
  parseSyncBootstrapInput,
  parseSyncPullInput,
  parseSyncPushInput,
} from "./input";
import {
  toCardSnapshotInput,
  toDeckSnapshotInput,
} from "./snapshots";
import type { LegacyEffortLevel } from "./legacyEffort";
import type { BootstrapProjectionRow } from "./types";
import { passthroughMediaBlobNormalizationVersion } from "../../mediaAssets/types";

type ReviewEventTimestampFixture = Readonly<{
  clientUpdatedAt: string;
  reviewedAtClient: string;
  reviewedTimeZone?: string | null;
}>;

type CardDueAtFixture = Readonly<{
  dueAt: string | null;
}>;

type CardSyncPushPayload = Omit<CardSnapshotInput, "cardType" | "metadata"> & Readonly<{
  cardType?: string;
  metadata?: CardMetadata;
  effortLevel?: LegacyEffortLevel;
}>;

type CardSyncPushOperation = Readonly<{
  operationId: string;
  entityType: "card";
  action: "upsert";
  entityId: string;
  clientUpdatedAt: string;
  payload: CardSyncPushPayload;
}>;

type CardSyncPushInput = Readonly<{
  installationId: string;
  platform: "ios";
  operations: ReadonlyArray<CardSyncPushOperation>;
}>;

type DeckSyncFilterDefinition = Readonly<{
  version: 2;
  effortLevels?: ReadonlyArray<LegacyEffortLevel>;
  tags: ReadonlyArray<string>;
}>;

type DeckSyncPushPayload = Omit<DeckSnapshotInput, "filterDefinition"> & Readonly<{
  filterDefinition: DeckSyncFilterDefinition;
}>;

type DeckSyncPushOperation = Readonly<{
  operationId: string;
  entityType: "deck";
  action: "upsert";
  entityId: string;
  clientUpdatedAt: string;
  payload: DeckSyncPushPayload;
}>;

type DeckSyncPushInput = Readonly<{
  installationId: string;
  platform: "ios";
  operations: ReadonlyArray<DeckSyncPushOperation>;
}>;

type CardBootstrapPayload = CardSnapshotInput & Readonly<{
  effortLevel: LegacyEffortLevel;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
}>;

type MediaAssetPayload = Readonly<{
  mediaAssetId: string;
  workspaceId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string | null;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

const mediaAssetId = "22222222-2222-4222-8222-222222222222";
const mediaAssetSha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";

function createSyncPushInput(
  fixture: ReviewEventTimestampFixture,
): Readonly<{
  installationId: string;
  platform: "ios";
  operations: ReadonlyArray<Readonly<{
    operationId: string;
    entityType: "review_event";
    action: "append";
    entityId: string;
    clientUpdatedAt: string;
    payload: Readonly<{
      reviewEventId: string;
      cardId: string;
      clientEventId: string;
      rating: 2;
      reviewedAtClient: string;
      reviewedTimeZone?: string | null;
    }>;
  }>>;
}> {
  return {
    installationId: "installation-1",
    platform: "ios",
    operations: [
      {
        operationId: "operation-1",
        entityType: "review_event",
        action: "append",
        entityId: "review-event-1",
        clientUpdatedAt: fixture.clientUpdatedAt,
        payload: {
          reviewEventId: "review-event-1",
          cardId: "card-1",
          clientEventId: "client-event-1",
          rating: 2,
          reviewedAtClient: fixture.reviewedAtClient,
          reviewedTimeZone: fixture.reviewedTimeZone,
        },
      },
    ],
  };
}

function createCardSnapshotPayload(fixture: CardDueAtFixture): CardSnapshotInput {
  const hasDueAt = fixture.dueAt !== null;

  return {
    cardId: "card-1",
    frontText: "Question",
    backText: "Answer",
    cardType: "basic",
    metadata: createCardMetadata("2026-02-28T09:00:00.000Z"),
    tags: ["sync"],
    dueAt: fixture.dueAt,
    createdAt: "2026-02-28T09:00:00.000Z",
    reps: hasDueAt ? 1 : 0,
    lapses: 0,
    fsrsCardState: hasDueAt ? "review" : "new",
    fsrsStepIndex: null,
    fsrsStability: hasDueAt ? 2.5 : null,
    fsrsDifficulty: hasDueAt ? 4.5 : null,
    fsrsLastReviewedAt: hasDueAt ? "2026-02-28T09:00:00.000Z" : null,
    fsrsScheduledDays: hasDueAt ? 1 : null,
    deletedAt: null,
  };
}

function createCardMetadata(createdAt: string): CardMetadata {
  return {
    version: 1,
    source: {
      label: null,
      author: null,
      comment: null,
      createdAt,
      importedAt: null,
      importId: null,
    },
  };
}

function createImportedCardMetadata(): CardMetadata {
  return {
    version: 1,
    source: {
      label: "Imported deck",
      author: "Author",
      comment: "Original import metadata",
      createdAt: "2026-02-27T08:00:00.000Z",
      importedAt: "2026-02-28T08:00:00.000Z",
      importId: "import-1",
    },
  };
}

function createCardSyncPushInput(fixture: CardDueAtFixture): CardSyncPushInput {
  return createCardSyncPushInputWithPayload(createCardSnapshotPayload(fixture));
}

function createCardSyncPushInputWithPayload(payload: CardSyncPushPayload): CardSyncPushInput {
  return {
    installationId: "installation-1",
    platform: "ios",
    operations: [
      {
        operationId: "operation-card-1",
        entityType: "card",
        action: "upsert",
        entityId: "card-1",
        clientUpdatedAt: "2026-02-28T09:30:00.000Z",
        payload,
      },
    ],
  };
}

function createDeckSnapshotPayload(filterDefinition: DeckSyncFilterDefinition): DeckSyncPushPayload {
  return {
    deckId: "deck-1",
    name: "Study deck",
    filterDefinition,
    createdAt: "2026-02-28T09:00:00.000Z",
    deletedAt: null,
  };
}

function createDeckSyncPushInputWithPayload(payload: DeckSyncPushPayload): DeckSyncPushInput {
  return {
    installationId: "installation-1",
    platform: "ios",
    operations: [
      {
        operationId: "operation-deck-1",
        entityType: "deck",
        action: "upsert",
        entityId: "deck-1",
        clientUpdatedAt: "2026-02-28T09:30:00.000Z",
        payload,
      },
    ],
  };
}

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

function createMediaAssetPayload(deletedAt: string | null): MediaAssetPayload {
  return {
    mediaAssetId,
    workspaceId: "workspace-1",
    mimeType: "image/png",
    sizeBytes: 42,
    sha256: mediaAssetSha256,
    sourceUrl: "https://example.com/source.png",
    createdAt: "2026-02-28T09:00:00.000Z",
    clientUpdatedAt: "2026-02-28T09:30:00.000Z",
    lastModifiedByReplicaId: "replica-1",
    lastOperationId: "operation-media-1",
    updatedAt: "2026-02-28T09:30:00.000Z",
    deletedAt,
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

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
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

function createLegacyCardUpdateExecutor(
  existingMetadata: CardMetadata,
): DatabaseExecutor {
  const existingRow: CardRow = {
    card_id: "card-1",
    front_text: "Original question",
    back_text: "Original answer",
    card_type: "cloze",
    metadata: existingMetadata,
    tags: ["original"],
    effort_level: "fast",
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
    client_updated_at: "2026-02-28T09:00:00.000Z",
    last_modified_by_replica_id: "replica-old",
    last_operation_id: "operation-old",
    updated_at: "2026-02-28T09:00:00.000Z",
    deleted_at: null,
  };

  return {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      if (text.includes("FROM content.cards") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, ["workspace-1", "card-1"]);
        return createQueryResult([existingRow as unknown as Row]);
      }

      if (text.startsWith("UPDATE content.cards")) {
        assert.equal(params[2], "cloze");
        assert.deepEqual(JSON.parse(String(params[3])), existingMetadata);
        assert.equal(params[18], "workspace-1");
        assert.equal(params[19], "card-1");
        return createQueryResult([{
          ...existingRow,
          front_text: params[0],
          back_text: params[1],
          card_type: params[2],
          metadata: JSON.parse(String(params[3])),
          tags: params[4],
          client_updated_at: params[15],
          last_modified_by_replica_id: params[16],
          last_operation_id: params[17],
          updated_at: "2026-02-28T10:00:00.000Z",
        } as CardRow as unknown as Row]);
      }

      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        return createQueryResult<Row>([]);
      }

      if (
        text
          === "SELECT workspace_id FROM sync.workspace_sync_metadata WHERE workspace_id = $1 FOR UPDATE"
      ) {
        return createQueryResult<Row>([{ workspace_id: String(params[0]) } as unknown as Row]);
      }

      if (text.includes("INSERT INTO sync.hot_changes")) {
        return createQueryResult<Row>([{
          change_id: 9,
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

function createDeckSnapshotExecutor(): DatabaseExecutor {
  return {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      if (
        text.includes("FROM content.decks")
        && text.includes("WHERE workspace_id = $1 AND deck_id = $2")
      ) {
        return createQueryResult<Row>([]);
      }

      if (
        text.includes("INSERT INTO content.decks")
        && text.includes("ON CONFLICT DO NOTHING")
      ) {
        const filterDefinition = JSON.parse(String(params[3])) as unknown;
        return createQueryResult<Row>([{
          deck_id: params[0],
          workspace_id: params[1],
          name: params[2],
          filter_definition: filterDefinition,
          created_at: params[4],
          client_updated_at: params[5],
          last_modified_by_replica_id: params[6],
          last_operation_id: params[7],
          updated_at: "2026-02-28T09:30:00.000Z",
          deleted_at: params[8],
        } as DeckRow as unknown as Row]);
      }

      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        return createQueryResult<Row>([]);
      }

      if (
        text
          === "SELECT workspace_id FROM sync.workspace_sync_metadata WHERE workspace_id = $1 FOR UPDATE"
      ) {
        return createQueryResult<Row>([{ workspace_id: String(params[0]) } as unknown as Row]);
      }

      if (text.includes("INSERT INTO sync.hot_changes")) {
        return createQueryResult<Row>([{
          change_id: 1,
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

test("parseSyncPushInput accepts backdated review_event timestamps through the normal sync push contract", () => {
  const input = createSyncPushInput({
    clientUpdatedAt: "2018-02-03T04:05:06.000Z",
    reviewedAtClient: "2018-02-03T04:05:06.000Z",
  });

  const parsedInput = parseSyncPushInput(input);

  assert.equal(parsedInput.operations[0]?.entityType, "review_event");
  if (parsedInput.operations[0]?.entityType !== "review_event") {
    assert.fail("Expected the parsed sync operation to remain a review_event");
  }
  assert.equal(parsedInput.operations[0].clientUpdatedAt, "2018-02-03T04:05:06.000Z");
  assert.equal(parsedInput.operations[0].payload.reviewedAtClient, "2018-02-03T04:05:06.000Z");
});

test("parseSyncPushInput accepts optional reviewedTimeZone on review_event operations", () => {
  const input = createSyncPushInput({
    clientUpdatedAt: "2018-02-03T04:05:06.000Z",
    reviewedAtClient: "2018-02-03T04:05:06.000Z",
    reviewedTimeZone: "Europe/Madrid",
  });

  const parsedInput = parseSyncPushInput(input);

  assert.equal(parsedInput.operations[0]?.entityType, "review_event");
  if (parsedInput.operations[0]?.entityType !== "review_event") {
    assert.fail("Expected the parsed sync operation to remain a review_event");
  }
  assert.equal(parsedInput.operations[0].payload.reviewedTimeZone, "Europe/Madrid");
});

test("parseSyncPushInput accepts null reviewedTimeZone on review_event operations", () => {
  const input = createSyncPushInput({
    clientUpdatedAt: "2018-02-03T04:05:06.000Z",
    reviewedAtClient: "2018-02-03T04:05:06.000Z",
    reviewedTimeZone: null,
  });

  const parsedInput = parseSyncPushInput(input);

  assert.equal(parsedInput.operations[0]?.entityType, "review_event");
  if (parsedInput.operations[0]?.entityType !== "review_event") {
    assert.fail("Expected the parsed sync operation to remain a review_event");
  }
  assert.equal(parsedInput.operations[0].payload.reviewedTimeZone, undefined);
});

test("parseSyncPushInput rejects malformed reviewedTimeZone on review_event operations", () => {
  const input = createSyncPushInput({
    clientUpdatedAt: "2018-02-03T04:05:06.000Z",
    reviewedAtClient: "2018-02-03T04:05:06.000Z",
    reviewedTimeZone: "Not/A_Timezone",
  });

  assert.throws(
    () => parseSyncPushInput(input),
    (error: unknown) => {
      if (!(error instanceof HttpError)) {
        assert.fail("Expected parseSyncPushInput to throw HttpError");
      }

      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "SYNC_INVALID_INPUT");
      assert.deepEqual(error.details?.validationIssues, [
        {
          path: "operations.0.payload.reviewedTimeZone",
          code: "custom",
          message: "reviewedTimeZone must be a valid IANA timezone",
        },
      ]);

      return true;
    },
  );
});

test("parseSyncPushInput rejects review_event operations when clientUpdatedAt diverges from reviewedAtClient", () => {
  const input = createSyncPushInput({
    clientUpdatedAt: "2018-02-03T04:05:06.000Z",
    reviewedAtClient: "2018-02-02T04:05:06.000Z",
  });

  assert.throws(
    () => parseSyncPushInput(input),
    (error: unknown) => {
      if (!(error instanceof HttpError)) {
        assert.fail("Expected parseSyncPushInput to throw HttpError");
      }

      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "SYNC_INVALID_INPUT");
      assert.deepEqual(error.details?.validationIssues, [
        {
          path: "operations.0.clientUpdatedAt",
          code: "custom",
          message: "review_event clientUpdatedAt must match payload.reviewedAtClient",
        },
      ]);

      return true;
    },
  );
});

test("parseSyncPushInput accepts dueAt as a string or null without numeric public fields", () => {
  const validDueAt = "2028-02-29T10:11:12.345Z";
  const parsedInputWithDueAt = parseSyncPushInput(createCardSyncPushInput({
    dueAt: validDueAt,
  }));
  const operationWithDueAt = parsedInputWithDueAt.operations[0];
  if (operationWithDueAt?.entityType !== "card") {
    assert.fail("Expected the parsed sync operation to remain a card");
  }

  assert.equal(operationWithDueAt.payload.dueAt, validDueAt);
  assert.equal(Object.prototype.hasOwnProperty.call(operationWithDueAt.payload, "dueAtMillis"), false);

  const parsedInputWithoutDueAt = parseSyncPushInput(createCardSyncPushInput({
    dueAt: null,
  }));
  const operationWithoutDueAt = parsedInputWithoutDueAt.operations[0];
  if (operationWithoutDueAt?.entityType !== "card") {
    assert.fail("Expected the parsed sync operation to remain a card");
  }

  assert.equal(operationWithoutDueAt.payload.dueAt, null);
  assert.equal(Object.prototype.hasOwnProperty.call(operationWithoutDueAt.payload, "dueAtMillis"), false);
});

test("parseSyncPushInput accepts card operations without legacy effortLevel", () => {
  const payload = createCardSnapshotPayload({
    dueAt: null,
  });
  const parsedInput = parseSyncPushInput(createCardSyncPushInputWithPayload(payload));
  const operation = parsedInput.operations[0];
  if (operation?.entityType !== "card") {
    assert.fail("Expected the parsed sync operation to remain a card");
  }

  assert.equal(Object.prototype.hasOwnProperty.call(operation.payload, "effortLevel"), false);
});

test("parseSyncPushInput accepts card operations without cardType and metadata", () => {
  const payload = createCardSnapshotPayload({
    dueAt: null,
  });
  const legacyPayload: CardSyncPushPayload = {
    cardId: payload.cardId,
    frontText: payload.frontText,
    backText: payload.backText,
    tags: payload.tags,
    dueAt: payload.dueAt,
    createdAt: payload.createdAt,
    reps: payload.reps,
    lapses: payload.lapses,
    fsrsCardState: payload.fsrsCardState,
    fsrsStepIndex: payload.fsrsStepIndex,
    fsrsStability: payload.fsrsStability,
    fsrsDifficulty: payload.fsrsDifficulty,
    fsrsLastReviewedAt: payload.fsrsLastReviewedAt,
    fsrsScheduledDays: payload.fsrsScheduledDays,
    deletedAt: payload.deletedAt,
  };
  const parsedInput = parseSyncPushInput(createCardSyncPushInputWithPayload(legacyPayload));
  const operation = parsedInput.operations[0];
  if (operation?.entityType !== "card") {
    assert.fail("Expected the parsed sync operation to remain a card");
  }

  assert.equal(Object.prototype.hasOwnProperty.call(operation.payload, "cardType"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(operation.payload, "metadata"), false);
  const snapshotInput = toCardSnapshotInput(operation.payload);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshotInput, "cardType"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshotInput, "metadata"), false);
  assert.deepEqual(snapshotInput, legacyPayload);
});

test("legacy sync card update preserves existing cardType and metadata", async () => {
  const existingMetadata = createImportedCardMetadata();
  const payload = createCardSnapshotPayload({
    dueAt: null,
  });
  const legacyPayload: CardSyncPushPayload = {
    cardId: payload.cardId,
    frontText: "Updated question",
    backText: "Updated answer",
    tags: ["sync", "legacy"],
    dueAt: payload.dueAt,
    createdAt: payload.createdAt,
    reps: payload.reps,
    lapses: payload.lapses,
    fsrsCardState: payload.fsrsCardState,
    fsrsStepIndex: payload.fsrsStepIndex,
    fsrsStability: payload.fsrsStability,
    fsrsDifficulty: payload.fsrsDifficulty,
    fsrsLastReviewedAt: payload.fsrsLastReviewedAt,
    fsrsScheduledDays: payload.fsrsScheduledDays,
    deletedAt: payload.deletedAt,
  };

  const result = await upsertCardSnapshotInExecutor(
    createLegacyCardUpdateExecutor(existingMetadata),
    "workspace-1",
    toCardSnapshotInput(legacyPayload),
    {
      clientUpdatedAt: "2026-02-28T10:00:00.000Z",
      lastModifiedByReplicaId: "replica-new",
      lastOperationId: "operation-new",
    },
  );

  assert.equal(result.applied, true);
  assert.equal(result.changeId, 9);
  assert.equal(result.card.frontText, "Updated question");
  assert.equal(result.card.backText, "Updated answer");
  assert.deepEqual(result.card.tags, ["sync", "legacy"]);
  assert.equal(result.card.cardType, "cloze");
  assert.deepEqual(result.card.metadata, existingMetadata);
});

test("parseSyncPushInput accepts deck operations without legacy effortLevels", () => {
  const payload = createDeckSnapshotPayload({
    version: 2,
    tags: ["Study"],
  });

  const parsedInput = parseSyncPushInput(createDeckSyncPushInputWithPayload(payload));
  const operation = parsedInput.operations[0];
  if (operation?.entityType !== "deck") {
    assert.fail("Expected the parsed sync operation to remain a deck");
  }

  assert.deepEqual(operation.payload.filterDefinition, {
    version: 2,
    tags: ["Study"],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(operation.payload.filterDefinition, "effortLevels"), false);
  assert.deepEqual(toDeckSnapshotInput(operation.payload), {
    deckId: "deck-1",
    name: "Study deck",
    filterDefinition: {
      version: 2,
      tags: ["Study"],
    },
    createdAt: "2026-02-28T09:00:00.000Z",
    deletedAt: null,
  });
});

test("parseSyncPushInput accepts media_asset metadata operations", () => {
  const parsedInput = parseSyncPushInput({
    installationId: "installation-1",
    platform: "ios",
    operations: [
      {
        operationId: "operation-media-1",
        entityType: "media_asset",
        action: "upsert",
        entityId: mediaAssetId,
        clientUpdatedAt: "2026-02-28T09:30:00.000Z",
        payload: {
          mediaAssetId,
          workspaceId: "workspace-1",
          mimeType: "image/png",
          sizeBytes: 42,
          sha256: mediaAssetSha256,
          sourceUrl: " https://example.com/source image.png ",
          createdAt: "2026-02-28T09:00:00.000Z",
          deletedAt: "2026-02-28T09:30:00.000Z",
        },
      },
    ],
  });

  const operation = parsedInput.operations[0];
  if (operation?.entityType !== "media_asset") {
    assert.fail("Expected the parsed sync operation to remain a media_asset");
  }

  assert.equal(operation.payload.mediaAssetId, mediaAssetId);
  assert.equal(operation.payload.sourceUrl, "https://example.com/source%20image.png");
  assert.equal(operation.payload.deletedAt, "2026-02-28T09:30:00.000Z");
  assert.equal(Object.prototype.hasOwnProperty.call(operation.payload, "bytes"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(operation.payload, "storageKey"), false);
});

test("parseSyncPushInput rejects non-http media_asset source URLs", () => {
  assert.throws(
    () => parseSyncPushInput({
      installationId: "installation-1",
      platform: "ios",
      operations: [
        {
          operationId: "operation-media-1",
          entityType: "media_asset",
          action: "upsert",
          entityId: mediaAssetId,
          clientUpdatedAt: "2026-02-28T09:30:00.000Z",
          payload: {
            mediaAssetId,
            workspaceId: "workspace-1",
            mimeType: "image/png",
            sizeBytes: 42,
            sha256: mediaAssetSha256,
            sourceUrl: "file:///tmp/source.png",
            createdAt: "2026-02-28T09:00:00.000Z",
            deletedAt: null,
          },
        },
      ],
    }),
    (error: unknown) => {
      if (!(error instanceof HttpError)) {
        assert.fail("Expected parseSyncPushInput to throw HttpError");
      }

      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "SYNC_INVALID_INPUT");
      assert.deepEqual(error.details?.validationIssues, [
        {
          path: "operations.0.payload.sourceUrl",
          code: "custom",
          message: "sourceUrl must be an absolute HTTP or HTTPS URL",
        },
      ]);

      return true;
    },
  );
});

test("parseSyncPullInput accepts media asset opt-in without requiring it", () => {
  const legacyInput = parseSyncPullInput({
    installationId: "installation-1",
    platform: "ios",
    afterHotChangeId: 0,
    limit: 100,
  });
  const mediaInput = parseSyncPullInput({
    installationId: "installation-1",
    platform: "ios",
    afterHotChangeId: 0,
    limit: 100,
    includeMediaAssets: true,
  });

  assert.equal(legacyInput.includeMediaAssets, undefined);
  assert.equal(mediaInput.includeMediaAssets, true);
});

test("parseSyncBootstrapInput accepts media asset opt-in for pull", () => {
  const input = parseSyncBootstrapInput({
    mode: "pull",
    installationId: "installation-1",
    platform: "ios",
    cursor: null,
    limit: 100,
    includeMediaAssets: true,
  });

  if (input.mode !== "pull") {
    assert.fail("Expected parsed bootstrap input to remain pull mode");
  }

  assert.equal(input.includeMediaAssets, true);
});

test("parseSyncBootstrapInput accepts media asset opt-in for push with empty entries", () => {
  const input = parseSyncBootstrapInput({
    mode: "push",
    installationId: "installation-1",
    platform: "ios",
    includeMediaAssets: true,
    entries: [],
  });

  if (input.mode !== "push") {
    assert.fail("Expected parsed bootstrap input to remain push mode");
  }

  assert.equal(input.includeMediaAssets, true);
  assert.deepEqual(input.entries, []);
});

test("parseSyncBootstrapInput accepts media_asset metadata entries for push", () => {
  const input = parseSyncBootstrapInput({
    mode: "push",
    installationId: "installation-1",
    platform: "ios",
    entries: [
      {
        entityType: "media_asset",
        entityId: mediaAssetId,
        action: "upsert",
        payload: {
          ...createMediaAssetPayload(null),
          lastModifiedByReplicaId: undefined,
        },
      },
    ],
  });

  if (input.mode !== "push") {
    assert.fail("Expected parsed bootstrap input to remain push mode");
  }

  const entry = input.entries[0];
  if (entry?.entityType !== "media_asset") {
    assert.fail("Expected parsed bootstrap entry to remain a media_asset");
  }

  assert.equal(Object.prototype.hasOwnProperty.call(entry.payload, "lastModifiedByReplicaId"), false);
  assert.equal(entry.payload.mediaAssetId, mediaAssetId);
});

test("toCardSnapshotInput converts legacy medium and long effort into tags", () => {
  const mediumSnapshot = toCardSnapshotInput({
    ...createCardSnapshotPayload({ dueAt: null }),
    effortLevel: "medium",
  });
  const longSnapshot = toCardSnapshotInput({
    ...createCardSnapshotPayload({ dueAt: null }),
    tags: ["Long"],
    effortLevel: "long",
  });

  assert.deepEqual(mediumSnapshot.tags, ["sync", "medium"]);
  assert.equal(Object.prototype.hasOwnProperty.call(mediumSnapshot, "effortLevel"), false);
  assert.deepEqual(longSnapshot.tags, ["Long", "long"]);
  assert.equal(Object.prototype.hasOwnProperty.call(longSnapshot, "effortLevel"), false);
});

test("parseDeckFilterDefinition converts legacy effortLevels into canonical tags", () => {
  const filterDefinition = parseDeckFilterDefinition({
    version: 2,
    effortLevels: ["medium", "long", "fast", "medium"],
    tags: ["Study", "Long"],
  });

  assert.deepEqual(filterDefinition, {
    version: 2,
    tags: ["Study", "Long", "medium", "long"],
  });
});

test("upsertDeckSnapshotInExecutor normalizes legacy sync effortLevels before persistence", async () => {
  const result = await upsertDeckSnapshotInExecutor(
    createDeckSnapshotExecutor(),
    "workspace-1",
    toDeckSnapshotInput({
      deckId: "deck-1",
      name: "Legacy deck",
      filterDefinition: {
        version: 2,
        effortLevels: ["long"],
        tags: ["Long"],
      },
      createdAt: "2026-02-28T09:00:00.000Z",
      deletedAt: null,
    }),
    {
      clientUpdatedAt: "2026-02-28T09:30:00.000Z",
      lastModifiedByReplicaId: "replica-1",
      lastOperationId: "operation-deck-1",
    },
  );

  assert.equal(result.applied, true);
  assert.deepEqual(result.deck.filterDefinition, {
    version: 2,
    tags: ["Long", "long"],
  });
});

test("parseSyncPushInput rejects malformed non-null dueAt timestamps before ingest", () => {
  const malformedDueAtValues: ReadonlyArray<string> = [
    "2026-02-31T00:00:00.000Z",
    "2026-02-29T00:00:00.000Z",
    "1000",
    "2026-13-01T00:00:00.000Z",
    "2026-12-01T00:60:00.000Z",
    "2026-12-01T00:00:60.000Z",
  ];

  for (const dueAt of malformedDueAtValues) {
    assert.throws(
      () => parseSyncPushInput(createCardSyncPushInput({ dueAt })),
      (error: unknown) => {
        if (!(error instanceof HttpError)) {
          assert.fail("Expected parseSyncPushInput to throw HttpError");
        }

        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "SYNC_INVALID_INPUT");
        const dueAtIssue = error.details?.validationIssues?.find(
          (issue) => issue.path === "operations.0.payload.dueAt",
        );
        assert.notEqual(dueAtIssue, undefined);
        assert.match(dueAtIssue?.message ?? "", /dueAt/);

        return true;
      },
      `Expected dueAt ${dueAt} to be rejected`,
    );
  }
});

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

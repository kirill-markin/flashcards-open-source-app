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
  type DeckRow,
  type DeckSnapshotInput,
} from "../../decks";
import { HttpError } from "../../shared/errors";
import { parseSyncPushInput } from "./input";
import {
  createCardMetadata,
  createCardSnapshotPayload,
  createQueryResult,
  type CardDueAtFixture,
} from "./inputTestSupport";
import type { LegacyEffortLevel } from "./legacyEffort";
import {
  toCardSnapshotInput,
  toDeckSnapshotInput,
} from "./snapshots";

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

import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { CardSnapshotInput, EffortLevel } from "../../cards";
import type { CardRow } from "../../cards/types";
import type { DatabaseExecutor, SqlValue } from "../../database";
import {
  parseDeckFilterDefinition,
  upsertDeckSnapshotInExecutor,
  type DeckRow,
} from "../../decks";
import { HttpError } from "../../shared/errors";
import { parseBootstrapEntryRow } from "../replication/bootstrap";
import { buildHotChangesFromRows } from "../replication/hotPull";
import { parseSyncPushInput } from "./input";
import { toCardSnapshotInput } from "./snapshots";
import type { BootstrapProjectionRow } from "./types";

type ReviewEventTimestampFixture = Readonly<{
  clientUpdatedAt: string;
  reviewedAtClient: string;
  reviewedTimeZone?: string;
}>;

type CardDueAtFixture = Readonly<{
  dueAt: string | null;
}>;

type CardSyncPushPayload = Omit<CardSnapshotInput, "effortLevel"> & Readonly<{
  effortLevel?: EffortLevel;
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

type CardBootstrapPayload = CardSnapshotInput & Readonly<{
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
}>;

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
      reviewedTimeZone?: string;
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
    tags: ["sync"],
    effortLevel: "fast",
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

function omitLegacyEffortLevel(payload: CardSnapshotInput): CardSyncPushPayload {
  const { effortLevel, ...payloadWithoutEffortLevel } = payload;
  assert.equal(effortLevel, "fast");
  return payloadWithoutEffortLevel;
}

function createCardBootstrapPayload(fixture: CardDueAtFixture): CardBootstrapPayload {
  return {
    ...createCardSnapshotPayload(fixture),
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

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createHotPullCardRow(effortLevel: EffortLevel): CardRow {
  return {
    card_id: "card-1",
    front_text: "Question",
    back_text: "Answer",
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

function createHotPullCardExecutor(effortLevel: EffortLevel): DatabaseExecutor {
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
  const payload = omitLegacyEffortLevel(createCardSnapshotPayload({
    dueAt: null,
  }));
  const parsedInput = parseSyncPushInput(createCardSyncPushInputWithPayload(payload));
  const operation = parsedInput.operations[0];
  if (operation?.entityType !== "card") {
    assert.fail("Expected the parsed sync operation to remain a card");
  }

  assert.equal(Object.prototype.hasOwnProperty.call(operation.payload, "effortLevel"), false);
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
  assert.equal(mediumSnapshot.effortLevel, "fast");
  assert.deepEqual(longSnapshot.tags, ["Long", "long"]);
  assert.equal(longSnapshot.effortLevel, "fast");
});

test("parseDeckFilterDefinition converts legacy effortLevels into canonical tags", () => {
  const filterDefinition = parseDeckFilterDefinition({
    version: 2,
    effortLevels: ["medium", "long", "fast", "medium"],
    tags: ["Study", "Long"],
  });

  assert.deepEqual(filterDefinition, {
    version: 2,
    effortLevels: [],
    tags: ["Study", "Long", "medium", "long"],
  });
});

test("upsertDeckSnapshotInExecutor normalizes legacy sync effortLevels before persistence", async () => {
  const result = await upsertDeckSnapshotInExecutor(
    createDeckSnapshotExecutor(),
    "workspace-1",
    {
      deckId: "deck-1",
      name: "Legacy deck",
      filterDefinition: {
        version: 2,
        effortLevels: ["long"],
        tags: ["Long"],
      },
      createdAt: "2026-02-28T09:00:00.000Z",
      deletedAt: null,
    },
    {
      clientUpdatedAt: "2026-02-28T09:30:00.000Z",
      lastModifiedByReplicaId: "replica-1",
      lastOperationId: "operation-deck-1",
    },
  );

  assert.equal(result.applied, true);
  assert.deepEqual(result.deck.filterDefinition, {
    version: 2,
    effortLevels: [],
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
  assert.equal(Object.prototype.hasOwnProperty.call(entryWithDueAt.payload, "dueAtMillis"), false);

  const entryWithoutDueAt = parseBootstrapEntryRow(createCardBootstrapProjectionRow({
    dueAt: null,
  }));
  if (entryWithoutDueAt.entityType !== "card") {
    assert.fail("Expected the bootstrap entry to remain a card");
  }

  assert.equal(entryWithoutDueAt.payload.dueAt, null);
  assert.equal(entryWithoutDueAt.payload.effortLevel, "fast");
  assert.equal(Object.prototype.hasOwnProperty.call(entryWithoutDueAt.payload, "dueAtMillis"), false);
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
});

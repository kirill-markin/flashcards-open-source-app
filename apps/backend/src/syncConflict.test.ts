import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type pg from "pg";
import { createPublicHttpErrorBody } from "./app";
import { upsertCardSnapshotInExecutor } from "./cards";
import type { DatabaseExecutor } from "./db";
import { upsertDeckSnapshotInExecutor } from "./decks";
import { HttpError } from "./errors";
import {
  annotateSyncConflictHttpError,
  createSyncConflictHttpError,
  findSyncConflictWorkspaceIdInExecutor,
  SYNC_WORKSPACE_FORK_REQUIRED,
} from "./sync/fork";
import { processSyncReviewHistoryImportInExecutor } from "./sync/reviewHistory";

type EntityType = "card" | "deck" | "review_event";

type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>;
}>;

type ConflictExecutorOptions = Readonly<{
  currentUserId: string;
  currentWorkspaceId: string;
  conflictingWorkspaceId: string;
  entityType: EntityType;
}>;

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createConflictExecutor(
  options: ConflictExecutorOptions,
): Readonly<{
  executor: DatabaseExecutor;
  recordedQueries: Array<RecordedQuery>;
}> {
  const recordedQueries: Array<RecordedQuery> = [];
  let currentUserId = options.currentUserId;
  let currentWorkspaceId = options.currentWorkspaceId;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });

      if (text.includes("set_config('app.user_id'")) {
        currentUserId = typeof params[0] === "string" ? params[0] : currentUserId;
        currentWorkspaceId = typeof params[1] === "string" && params[1] !== ""
          ? params[1]
          : currentWorkspaceId;
        return createQueryResult<Row>([]);
      }

      if (text === "SELECT security.current_user_id() AS user_id") {
        return createQueryResult<Row>([{
          user_id: currentUserId,
        } as unknown as Row]);
      }

      if (text === "SELECT workspace_id FROM sync.find_conflicting_workspace_id($1, $2) LIMIT 1") {
        return createQueryResult<Row>([{
          workspace_id: options.conflictingWorkspaceId,
        } as unknown as Row]);
      }

      if (
        options.entityType === "card"
        && text.includes("FROM content.cards")
        && text.includes("WHERE workspace_id = $1 AND card_id = $2")
      ) {
        return createQueryResult<Row>([]);
      }

      if (
        options.entityType === "card"
        && text.includes("INSERT INTO content.cards")
        && text.includes("ON CONFLICT DO NOTHING")
      ) {
        return createQueryResult<Row>([]);
      }

      if (
        options.entityType === "deck"
        && text.includes("FROM content.decks")
        && text.includes("WHERE workspace_id = $1 AND deck_id = $2")
      ) {
        return createQueryResult<Row>([]);
      }

      if (
        options.entityType === "deck"
        && text.includes("INSERT INTO content.decks")
        && text.includes("ON CONFLICT DO NOTHING")
      ) {
        return createQueryResult<Row>([]);
      }

      if (
        options.entityType === "review_event"
        && text.includes("INSERT INTO content.review_events")
        && text.includes("ON CONFLICT DO NOTHING")
      ) {
        return createQueryResult<Row>([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  return {
    executor,
    recordedQueries,
  };
}

test("findSyncConflictWorkspaceIdInExecutor resolves conflicts without membership probing", async () => {
  const { executor, recordedQueries } = createConflictExecutor({
    currentUserId: "user-1",
    currentWorkspaceId: "workspace-current",
    conflictingWorkspaceId: "workspace-hidden",
    entityType: "card",
  });

  const conflictingWorkspaceId = await findSyncConflictWorkspaceIdInExecutor(executor, {
    entityType: "card",
    entityId: "card-conflict-hidden",
  });

  assert.equal(conflictingWorkspaceId, "workspace-hidden");
  assert.equal(
    recordedQueries.some((query) => query.text.includes("FROM org.workspace_memberships")),
    false,
  );
});

test("0048 sync conflict lookup casts target ids once and compares UUID columns directly", () => {
  const migration = readFileSync(
    join(__dirname, "../../../db/migrations/0048_sync_conflict_lookup.sql"),
    "utf8",
  );

  assert.match(migration, /target_entity_uuid UUID/);
  assert.match(migration, /target_entity_uuid := target_entity_id::UUID/);
  assert.doesNotMatch(migration, /::text\s*=\s*target_entity_id/);
  assert.match(migration, /cards\.card_id = target_entity_uuid/);
  assert.match(migration, /decks\.deck_id = target_entity_uuid/);
  assert.match(migration, /review_events\.review_event_id = target_entity_uuid/);
});

test("upsertCardSnapshotInExecutor returns a typed cross-workspace fork error", async () => {
  const cardId = "card-conflict-1";
  const { executor, recordedQueries } = createConflictExecutor({
    currentUserId: "user-1",
    currentWorkspaceId: "workspace-current",
    conflictingWorkspaceId: "workspace-other",
    entityType: "card",
  });

  await assert.rejects(
    upsertCardSnapshotInExecutor(
      executor,
      "workspace-current",
      {
        cardId,
        frontText: "Front",
        backText: "Back",
        tags: ["tag"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2026-04-24T10:00:00.000Z",
        reps: 0,
        lapses: 0,
        fsrsCardState: "new",
        fsrsStepIndex: null,
        fsrsStability: null,
        fsrsDifficulty: null,
        fsrsLastReviewedAt: null,
        fsrsScheduledDays: null,
        deletedAt: null,
      },
      {
        clientUpdatedAt: "2026-04-24T10:00:00.000Z",
        lastModifiedByReplicaId: "replica-1",
        lastOperationId: "op-1",
      },
    ),
    (error: unknown): boolean => {
      if (!(error instanceof HttpError)) {
        return false;
      }
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, SYNC_WORKSPACE_FORK_REQUIRED);
      assert.deepEqual(error.details?.syncConflict, {
        phase: "sync_write",
        entityType: "card",
        entityId: cardId,
        conflictingWorkspaceId: "workspace-other",
        constraint: "cards_pkey",
        sqlState: "23505",
        table: "cards",
        recoverable: true,
      });
      return true;
    },
  );

  assert.ok(recordedQueries.some((query) => query.text.includes("INSERT INTO content.cards")));
});

test("upsertDeckSnapshotInExecutor returns a typed cross-workspace fork error", async () => {
  const deckId = "deck-conflict-1";
  const { executor } = createConflictExecutor({
    currentUserId: "user-1",
    currentWorkspaceId: "workspace-current",
    conflictingWorkspaceId: "workspace-other",
    entityType: "deck",
  });

  await assert.rejects(
    upsertDeckSnapshotInExecutor(
      executor,
      "workspace-current",
      {
        deckId,
        name: "Deck",
        filterDefinition: {
          version: 2,
          effortLevels: ["fast"],
          tags: ["tag"],
        },
        createdAt: "2026-04-24T10:00:00.000Z",
        deletedAt: null,
      },
      {
        clientUpdatedAt: "2026-04-24T10:00:00.000Z",
        lastModifiedByReplicaId: "replica-1",
        lastOperationId: "op-1",
      },
    ),
    (error: unknown): boolean => {
      if (!(error instanceof HttpError)) {
        return false;
      }
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, SYNC_WORKSPACE_FORK_REQUIRED);
      assert.deepEqual(error.details?.syncConflict, {
        phase: "sync_write",
        entityType: "deck",
        entityId: deckId,
        conflictingWorkspaceId: "workspace-other",
        constraint: "decks_pkey",
        sqlState: "23505",
        table: "decks",
        recoverable: true,
      });
      return true;
    },
  );
});

test("processSyncReviewHistoryImportInExecutor annotates fork errors with the review event index", async () => {
  const reviewEventId = "review-event-conflict-1";
  const { executor } = createConflictExecutor({
    currentUserId: "user-1",
    currentWorkspaceId: "workspace-current",
    conflictingWorkspaceId: "workspace-other",
    entityType: "review_event",
  });

  await assert.rejects(
    processSyncReviewHistoryImportInExecutor(
      executor,
      "workspace-current",
      "replica-current",
      {
        installationId: "installation-1",
        platform: "ios",
        appVersion: "1.2.3",
        reviewEvents: [{
          reviewEventId,
          workspaceId: "workspace-current",
          cardId: "card-1",
          clientEventId: "client-event-1",
          rating: 3,
          reviewedAtClient: "2026-04-24T10:00:00.000Z",
          reviewedAtServer: "2026-04-24T10:00:00.000Z",
        }],
      },
    ),
    (error: unknown): boolean => {
      if (!(error instanceof HttpError)) {
        return false;
      }
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, SYNC_WORKSPACE_FORK_REQUIRED);
      assert.deepEqual(error.details?.syncConflict, {
        phase: "review_history_import",
        entityType: "review_event",
        entityId: reviewEventId,
        conflictingWorkspaceId: "workspace-other",
        constraint: "review_events_pkey",
        sqlState: "23505",
        table: "review_events",
        reviewEventIndex: 0,
        recoverable: true,
      });
      return true;
    },
  );
});

test("annotateSyncConflictHttpError adds bootstrap entry metadata", () => {
  const error = createSyncConflictHttpError({
    phase: "sync_write",
    entityType: "card",
    entityId: "card-1",
    conflictingWorkspaceId: "workspace-other",
    constraint: "cards_pkey",
    sqlState: "23505",
    table: "cards",
  });

  const annotatedError = annotateSyncConflictHttpError(error, {
    phase: "bootstrap",
    entryIndex: 3,
  });

  assert.notEqual(annotatedError, null);
  if (annotatedError === null) {
    throw new Error("Expected sync conflict annotation to preserve the HttpError");
  }
  assert.deepEqual(annotatedError.details?.syncConflict, {
    phase: "bootstrap",
    entityType: "card",
    entityId: "card-1",
    conflictingWorkspaceId: "workspace-other",
    constraint: "cards_pkey",
    sqlState: "23505",
    table: "cards",
    entryIndex: 3,
    recoverable: true,
  });
});

test("createPublicHttpErrorBody includes safe sync conflict details", () => {
  const error = createSyncConflictHttpError({
    phase: "bootstrap",
    entityType: "deck",
    entityId: "deck-1",
    conflictingWorkspaceId: "workspace-other",
    constraint: "decks_pkey",
    sqlState: "23505",
    table: "decks",
  });

  assert.equal(error.details?.syncConflict?.conflictingWorkspaceId, "workspace-other");

  const body = createPublicHttpErrorBody(error, "request-1");

  assert.deepEqual(body, {
    error: "Sync detected content copied from another workspace. Retry after forking ids.",
    requestId: "request-1",
    code: SYNC_WORKSPACE_FORK_REQUIRED,
    details: {
      syncConflict: {
        phase: "bootstrap",
        entityType: "deck",
        entityId: "deck-1",
        recoverable: true,
      },
    },
  });
  assert.equal(JSON.stringify(body).includes("workspace-other"), false);
  assert.equal(JSON.stringify(body).includes("conflictingWorkspaceId"), false);
  assert.equal(JSON.stringify(body).includes("decks_pkey"), false);
  assert.equal(JSON.stringify(body).includes("23505"), false);
});

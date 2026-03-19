import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "../db";
import {
  processOperationInExecutor,
  processSyncPushOperationsInExecutor,
} from "./push";

function makeQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function makeExecutor(
  handler: (text: string, params: ReadonlyArray<unknown>) => pg.QueryResult<pg.QueryResultRow>,
): DatabaseExecutor {
  return {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      return handler(text, params) as pg.QueryResult<Row>;
    },
  };
}

test("processSyncPushOperationsInExecutor returns duplicate results from the applied-operations ledger", async () => {
  const executor = makeExecutor((text) => {
    if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
      return makeQueryResult([]);
    }

    if (text.includes("FROM sync.applied_operations_current")) {
      return makeQueryResult([{
        operation_id: "operation-1",
        resulting_hot_change_id: 19,
      }]);
    }

    throw new Error(`Unexpected query: ${text}`);
  });

  const results = await processSyncPushOperationsInExecutor(
    executor,
    "workspace-1",
    "device-1",
    [{
      operationId: "operation-1",
      entityType: "card",
      entityId: "card-1",
      action: "upsert",
      clientUpdatedAt: "2026-03-09T10:00:00.000Z",
      payload: {
        cardId: "card-1",
        frontText: "Front",
        backText: "",
        tags: [],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2026-03-09T10:00:00.000Z",
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
    }],
  );

  assert.deepEqual(results, [{
    operationId: "operation-1",
    entityType: "card",
    entityId: "card-1",
    status: "duplicate",
    resultingHotChangeId: 19,
    error: null,
  }]);
});

test("processOperationInExecutor rejects card operations whose entityId does not match payload.cardId", async () => {
  const executor = makeExecutor(() => {
    throw new Error("No query expected");
  });

  const result = await processOperationInExecutor(
    executor,
    "workspace-1",
    "device-1",
    {
      operationId: "operation-1",
      entityType: "card",
      entityId: "card-2",
      action: "upsert",
      clientUpdatedAt: "2026-03-09T10:00:00.000Z",
      payload: {
        cardId: "card-1",
        frontText: "Front",
        backText: "",
        tags: [],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2026-03-09T10:00:00.000Z",
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
    },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.error, "card entityId must match payload.cardId");
});

test("processOperationInExecutor rejects review events from another device before writing", async () => {
  const executor = makeExecutor(() => {
    throw new Error("No query expected");
  });

  const result = await processOperationInExecutor(
    executor,
    "workspace-1",
    "device-1",
    {
      operationId: "operation-1",
      entityType: "review_event",
      entityId: "review-1",
      action: "append",
      clientUpdatedAt: "2026-03-09T10:00:00.000Z",
      payload: {
        reviewEventId: "review-1",
        cardId: "card-1",
        deviceId: "device-2",
        clientEventId: "client-event-1",
        rating: 2,
        reviewedAtClient: "2026-03-09T10:00:00.000Z",
      },
    },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.error, "review_event payload.deviceId must match the authenticated sync deviceId");
});

test("processOperationInExecutor rejects review events whose reviewedAtClient differs from clientUpdatedAt", async () => {
  const executor = makeExecutor(() => {
    throw new Error("No query expected");
  });

  const result = await processOperationInExecutor(
    executor,
    "workspace-1",
    "device-1",
    {
      operationId: "operation-1",
      entityType: "review_event",
      entityId: "review-1",
      action: "append",
      clientUpdatedAt: "2026-03-09T10:00:00.000Z",
      payload: {
        reviewEventId: "review-1",
        cardId: "card-1",
        deviceId: "device-1",
        clientEventId: "client-event-1",
        rating: 2,
        reviewedAtClient: "2026-03-09T10:00:01.000Z",
      },
    },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.error, "review_event clientUpdatedAt must match reviewedAtClient");
});

test("processOperationInExecutor rejects review events whose card does not exist", async () => {
  const executor = makeExecutor((text) => {
    if (text.includes("FROM content.cards")) {
      return makeQueryResult([]);
    }

    throw new Error(`Unexpected query: ${text}`);
  });

  const result = await processOperationInExecutor(
    executor,
    "workspace-1",
    "device-1",
    {
      operationId: "operation-1",
      entityType: "review_event",
      entityId: "review-1",
      action: "append",
      clientUpdatedAt: "2026-03-09T10:00:00.000Z",
      payload: {
        reviewEventId: "review-1",
        cardId: "card-1",
        deviceId: "device-1",
        clientEventId: "client-event-1",
        rating: 2,
        reviewedAtClient: "2026-03-09T10:00:00.000Z",
      },
    },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.error, "review_event payload.cardId must reference an existing card");
});

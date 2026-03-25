import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { DatabaseExecutor, SqlValue, WorkspaceDatabaseScope } from "../db";
import {
  ChatSessionNotFoundError,
  createFreshChatSessionWithExecutor,
  getChatSessionSnapshotWithExecutor,
  touchChatSessionHeartbeatWithExecutor,
} from "./store";

function makeQueryResult<Row extends QueryResultRow>(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
): QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows] as Array<Row>,
  };
}

function createScope(): WorkspaceDatabaseScope {
  return {
    userId: "user-1",
    workspaceId: "00000000-0000-4000-8000-000000000001",
  };
}

test("getChatSessionSnapshotWithExecutor creates the first session when none exists", async () => {
  const executedQueries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<QueryResult<Row>> {
      executedQueries.push(text);

      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["user-1", "00000000-0000-4000-8000-000000000001"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("FROM ai.chat_sessions") && text.includes("ORDER BY created_at DESC")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO ai.chat_sessions")) {
        return makeQueryResult<Row>([{
          session_id: "00000000-0000-4000-8000-0000000000aa",
          status: "idle",
          active_run_heartbeat_at: null,
          main_content_invalidation_version: "0",
          updated_at: "2026-03-25T10:00:00.000Z",
        }]);
      }

      if (text.includes("FROM ai.chat_items") && text.includes("ORDER BY item_order ASC")) {
        assert.deepEqual(params, ["00000000-0000-4000-8000-0000000000aa"]);
        return makeQueryResult<Row>([]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const snapshot = await getChatSessionSnapshotWithExecutor(executor, createScope());

  assert.equal(snapshot.sessionId, "00000000-0000-4000-8000-0000000000aa");
  assert.equal(snapshot.runState, "idle");
  assert.equal(snapshot.mainContentInvalidationVersion, 0);
  assert.deepEqual(snapshot.messages, []);
  assert.equal(executedQueries.length, 4);
});

test("getChatSessionSnapshotWithExecutor rejects missing requested sessions", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["user-1", "00000000-0000-4000-8000-000000000001"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("FROM ai.chat_sessions") && text.includes("session_id = $3")) {
        return makeQueryResult<Row>([]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await assert.rejects(
    () => getChatSessionSnapshotWithExecutor(
      executor,
      createScope(),
      "00000000-0000-4000-8000-0000000000ff",
    ),
    (error: unknown) => error instanceof ChatSessionNotFoundError
      && error.message === "Chat session not found: 00000000-0000-4000-8000-0000000000ff",
  );
});

test("createFreshChatSessionWithExecutor returns the inserted session id", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["user-1", "00000000-0000-4000-8000-000000000001"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO ai.chat_sessions")) {
        return makeQueryResult<Row>([{
          session_id: "00000000-0000-4000-8000-0000000000bb",
          status: "idle",
          active_run_heartbeat_at: null,
          main_content_invalidation_version: "0",
          updated_at: "2026-03-25T10:00:00.000Z",
        }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const sessionId = await createFreshChatSessionWithExecutor(executor, createScope());

  assert.equal(sessionId, "00000000-0000-4000-8000-0000000000bb");
});

test("touchChatSessionHeartbeatWithExecutor updates heartbeat on an existing session", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["user-1", "00000000-0000-4000-8000-000000000001"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("UPDATE ai.chat_sessions")) {
        assert.equal(params[0], "00000000-0000-4000-8000-0000000000cc");
        assert.equal(params[1], "2026-03-25T11:00:00.000Z");
        return makeQueryResult<Row>([{
          session_id: "00000000-0000-4000-8000-0000000000cc",
          status: "running",
          active_run_heartbeat_at: "2026-03-25T11:00:00.000Z",
          main_content_invalidation_version: "0",
          updated_at: "2026-03-25T11:00:00.000Z",
        }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await assert.doesNotReject(() =>
    touchChatSessionHeartbeatWithExecutor(
      executor,
      createScope(),
      "00000000-0000-4000-8000-0000000000cc",
      new Date("2026-03-25T11:00:00.000Z"),
    ));
});

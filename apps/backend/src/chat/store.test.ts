import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { DatabaseExecutor, SqlValue, WorkspaceDatabaseScope } from "../db";
import {
  buildUserStoppedAssistantContent,
  buildUserStoppedChatRunUpdatePlan,
  cancelActiveChatRunByUserWithExecutor,
  ChatSessionNotFoundError,
  ChatSessionConflictError,
  createFreshChatSessionWithExecutor,
  getChatSessionSnapshotWithExecutor,
  prepareChatRunWithExecutor,
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
  assert.equal(executedQueries.length, 6);
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
        assert.equal(params[1], "running");
        assert.equal(params[2], "2026-03-25T11:00:00.000Z");
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

test("prepareChatRunWithExecutor rejects a second concurrent run on the same session", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("FROM ai.chat_sessions") && text.includes("session_id = $3")) {
        return makeQueryResult<Row>([{
          session_id: "session-1",
          status: "running",
          active_run_heartbeat_at: "2026-03-25T10:00:00.000Z",
          main_content_invalidation_version: "0",
          updated_at: "2026-03-25T10:00:00.000Z",
        }]);
      }

      if (text.includes("FOR UPDATE")) {
        assert.deepEqual(params, ["session-1"]);
        return makeQueryResult<Row>([{
          session_id: "session-1",
          status: "running",
          active_run_heartbeat_at: "2026-03-25T10:00:00.000Z",
          main_content_invalidation_version: "0",
          updated_at: "2026-03-25T10:00:00.000Z",
        }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await assert.rejects(
    () => prepareChatRunWithExecutor(
      executor,
      createScope(),
      "session-1",
      [{ type: "text", text: "hi" }],
    ),
    (error: unknown) => error instanceof ChatSessionConflictError
      && error.message === "Chat session already has an active run: session-1",
  );
});

test("buildUserStoppedChatRunUpdatePlan finalizes pending tool calls", () => {
  const plan = buildUserStoppedChatRunUpdatePlan([{
    itemId: "assistant-1",
    sessionId: "session-1",
    role: "assistant",
    content: [{
      type: "tool_call",
      id: "call-1",
      name: "sql",
      status: "started",
      providerStatus: "running",
      input: "{\"sql\":\"SELECT 1\"}",
      output: null,
      streamPosition: {
        itemId: "tool-item-1",
        outputIndex: 0,
        contentIndex: null,
        sequenceNumber: 1,
      },
    }],
    state: "in_progress",
    isError: false,
    isStopped: false,
    timestamp: 1,
    updatedAt: 1,
  }]);

  assert.equal(plan.sessionState, "idle");
  assert.deepEqual(plan.assistantContent, buildUserStoppedAssistantContent([{
    type: "tool_call",
    id: "call-1",
    name: "sql",
    status: "started",
    providerStatus: "running",
    input: "{\"sql\":\"SELECT 1\"}",
    output: null,
    streamPosition: {
      itemId: "tool-item-1",
      outputIndex: 0,
      contentIndex: null,
      sequenceNumber: 1,
    },
  }]));
});

test("cancelActiveChatRunByUserWithExecutor cancels a running session and finalizes pending tool calls", async () => {
  const updatedSessions: Array<Readonly<Record<string, unknown>>> = [];

  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("FROM ai.chat_sessions") && text.includes("session_id = $3")) {
        return makeQueryResult<Row>([{
          session_id: "session-1",
          status: "running",
          active_run_heartbeat_at: "2026-03-25T10:00:00.000Z",
          main_content_invalidation_version: "0",
          updated_at: "2026-03-25T10:00:00.000Z",
        }]);
      }

      if (text.includes("FOR UPDATE")) {
        return makeQueryResult<Row>([{
          session_id: "session-1",
          status: "running",
          active_run_heartbeat_at: "2026-03-25T10:00:00.000Z",
          main_content_invalidation_version: "0",
          updated_at: "2026-03-25T10:00:00.000Z",
        }]);
      }

      if (text.includes("FROM ai.chat_items") && text.includes("ORDER BY item_order ASC")) {
        return makeQueryResult<Row>([{
          item_id: "assistant-1",
          session_id: "session-1",
          state: "in_progress",
          payload: {
            role: "assistant",
            content: [{
              type: "tool_call",
              id: "call-1",
              name: "sql",
              status: "started",
              providerStatus: "running",
              input: "{\"sql\":\"SELECT 1\"}",
              output: null,
              streamPosition: {
                itemId: "tool-item-1",
                outputIndex: 0,
                contentIndex: null,
                sequenceNumber: 1,
              },
            }],
          },
          created_at: "2026-03-25T10:00:00.000Z",
          updated_at: "2026-03-25T10:00:00.000Z",
        }]);
      }

      if (text.includes("UPDATE ai.chat_items")) {
        return makeQueryResult<Row>([{
          item_id: "assistant-1",
          session_id: "session-1",
          state: "cancelled",
          payload: JSON.parse(String(params[1])),
          created_at: "2026-03-25T10:00:00.000Z",
          updated_at: "2026-03-25T10:00:01.000Z",
        }]);
      }

      if (text.includes("UPDATE ai.chat_sessions")) {
        updatedSessions.push({
          sessionId: String(params[0]),
          status: String(params[1]),
          heartbeatAt: params[2],
        });
        return makeQueryResult<Row>([{
          session_id: "session-1",
          status: "idle",
          active_run_heartbeat_at: null,
          main_content_invalidation_version: "0",
          updated_at: "2026-03-25T10:00:01.000Z",
        }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const cancelled = await cancelActiveChatRunByUserWithExecutor(
    executor,
    createScope(),
    "session-1",
  );

  assert.equal(cancelled, true);
  assert.deepEqual(updatedSessions, [{
    sessionId: "session-1",
    status: "idle",
    heartbeatAt: null,
  }]);
});

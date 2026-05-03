import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue, WorkspaceDatabaseScope } from "../../db";
import { ChatRunRowNotFoundError } from "../errors";
import type { ChatSessionRow } from "../store/repository";
import { finalizeInterruptedRunWithExecutor } from "./finalization";
import { assertClaimedRunStillActive, requestChatRunCancellationWithExecutor } from "./lifecycleService";
import type { ChatRunRow } from "./repository";

type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

const scope: WorkspaceDatabaseScope = {
  userId: "user-1",
  workspaceId: "workspace-1",
};

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    rows: [...rows],
    fields: [],
  };
}

function createRunRow(
  overrides: Partial<ChatRunRow> = {},
): ChatRunRow {
  return {
    run_id: "run-1",
    session_id: "session-1",
    assistant_item_id: "assistant-1",
    status: "running",
    request_id: "request-1",
    model_id: "gpt-5.4",
    reasoning_effort: "medium",
    timezone: "Europe/Madrid",
    ui_locale: "es",
    turn_input: [],
    worker_claimed_at: null,
    worker_heartbeat_at: null,
    cancel_requested_at: null,
    started_at: null,
    finished_at: null,
    last_error_message: null,
    ...overrides,
  };
}

function createSessionRow(
  overrides: Partial<ChatSessionRow> = {},
): ChatSessionRow {
  return {
    session_id: "session-1",
    status: "running",
    active_run_id: "run-1",
    active_run_heartbeat_at: null,
    composer_suggestions: [],
    active_composer_suggestion_generation_id: null,
    active_generation_suggestions: null,
    main_content_invalidation_version: 0,
    updated_at: "2026-04-16T00:00:00.000Z",
    ...overrides,
  };
}

test("assertClaimedRunStillActive accepts the active running owner", () => {
  assert.doesNotThrow(() => {
    assertClaimedRunStillActive(
      createRunRow(),
      createSessionRow(),
      "complete",
    );
  });
});

test("assertClaimedRunStillActive rejects a session that no longer owns the run", () => {
  assert.throws(() => {
    assertClaimedRunStillActive(
      createRunRow(),
      createSessionRow({
        active_run_id: "run-2",
      }),
      "complete",
    );
  }, ChatRunRowNotFoundError);
});

test("assertClaimedRunStillActive rejects non-running terminal state", () => {
  assert.throws(() => {
    assertClaimedRunStillActive(
      createRunRow({
        status: "completed",
      }),
      createSessionRow({
        status: "idle",
      }),
      "fail",
    );
  }, ChatRunRowNotFoundError);
});

test("requestChatRunCancellationWithExecutor no-ops when the expected run is no longer active", async () => {
  const recordedQueries: Array<RecordedQuery> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });

      if (text.includes("set_config('app.user_id'")) {
        return createQueryResult<pg.QueryResultRow>([]) as pg.QueryResult<Row>;
      }

      if (text.includes("FROM ai.chat_sessions") && text.includes("FOR UPDATE OF chat_sessions")) {
        return createQueryResult<ChatSessionRow>([
          createSessionRow({
            active_run_id: "run-2",
          }),
        ]) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const stopState = await requestChatRunCancellationWithExecutor(
    executor,
    scope,
    "session-1",
    "run-1",
  );

  assert.deepEqual(stopState, {
    sessionId: "session-1",
    stopped: false,
    stillRunning: true,
    runId: "run-2",
  });
  assert.equal(recordedQueries.some((query) => query.text.includes("FROM ai.chat_runs")), false);
  assert.equal(recordedQueries.some((query) => query.text.includes("UPDATE ai.chat_runs")), false);
});

test("finalizeInterruptedRunWithExecutor does not clear a session that no longer owns the run", async () => {
  let guardedSessionUpdateCount = 0;
  const run = createRunRow({
    status: "queued",
  });
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        return createQueryResult<pg.QueryResultRow>([]) as pg.QueryResult<Row>;
      }

      if (text.includes("FROM ai.chat_items")) {
        return createQueryResult<pg.QueryResultRow>([]) as pg.QueryResult<Row>;
      }

      if (text.includes("UPDATE ai.chat_runs")) {
        return createQueryResult<ChatRunRow>([
          createRunRow({
            status: "interrupted",
            finished_at: "2026-04-16T00:00:00.000Z",
            last_error_message: "worker dispatch failed",
          }),
        ]) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("UPDATE ai.chat_sessions") && text.includes("AND active_run_id = $5")) {
        guardedSessionUpdateCount += 1;
        assert.deepEqual(params, [
          "session-1",
          "interrupted",
          null,
          null,
          "run-1",
        ]);
        return createQueryResult<ChatSessionRow>([]) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("UPDATE ai.chat_sessions")) {
        throw new Error("Unexpected unguarded chat session update");
      }

      if (text.includes("UPDATE ai.chat_composer_suggestion_generations")) {
        throw new Error("Unexpected composer suggestion invalidation");
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await finalizeInterruptedRunWithExecutor(
    executor,
    scope,
    run,
    "worker dispatch failed",
  );

  assert.equal(guardedSessionUpdateCount, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue, WorkspaceDatabaseScope } from "../../database";
import { ChatRunRowNotFoundError } from "../errors";
import type { ChatSessionRow } from "../store/repository";
import {
  assertActiveChatRunClaimWithExecutor,
  InactiveChatRunClaimError,
} from "./claimFence";
import { finalizeInterruptedRunWithExecutor } from "./finalization";
import {
  assertClaimedRunStillActive,
  requestChatRunCancellationWithExecutor,
} from "./lifecycleService";
import {
  claimChatRunWithExecutor,
  createChatRunStatusUpdateFromRow,
  updateClaimedChatRunStatusWithExecutor,
  type ChatRunRow,
} from "./repository";

type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

const scope: WorkspaceDatabaseScope = {
  userId: "user-1",
  workspaceId: "workspace-1",
};
const firstClaimToken = "2026-07-24 10:11:12.123456+00";
const secondClaimToken = "2026-07-24 10:12:13.654321+00";

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
    model_id: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
    ai_cost_mode: "normal",
    chat_turns_last_7d: 1,
    good_review_days_last_7d: 0,
    timezone: "Europe/Madrid",
    ui_locale: "es",
    turn_input: [],
    worker_claimed_at: firstClaimToken,
    worker_heartbeat_at: null,
    cancel_requested_at: null,
    started_at: null,
    finished_at: null,
    last_error_message: null,
    initiating_auth_is_signed_in: false,
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
      firstClaimToken,
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
      firstClaimToken,
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
      firstClaimToken,
      "fail",
    );
  }, ChatRunRowNotFoundError);
});

test("assertClaimedRunStillActive rejects a reclaimed run for the first claim token", () => {
  assert.throws(() => {
    assertClaimedRunStillActive(
      createRunRow({
        worker_claimed_at: secondClaimToken,
      }),
      createSessionRow(),
      firstClaimToken,
      "complete",
    );
  }, ChatRunRowNotFoundError);
});

test("claimChatRunWithExecutor returns the exact persisted worker claim token", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        return createQueryResult<Row>([]);
      }
      if (text.includes("UPDATE ai.chat_runs")) {
        assert.match(text, /worker_claimed_at = statement_timestamp\(\)/);
        assert.deepEqual(params, ["run-1"]);
        return createQueryResult<Row>([
          createRunRow({
            worker_claimed_at: firstClaimToken,
            worker_heartbeat_at: firstClaimToken,
          }) as unknown as Row,
        ]);
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const claimedRun = await claimChatRunWithExecutor(executor, scope, "run-1");
  assert.equal(claimedRun?.worker_claimed_at, firstClaimToken);
});

test("claimed heartbeat and terminal updates reject stale ownership in the update predicate", async () => {
  const run = createRunRow();
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        return createQueryResult<Row>([]);
      }
      if (text.includes("UPDATE ai.chat_runs")) {
        assert.match(text, /status = 'running'/);
        assert.match(text, /worker_claimed_at = \$2::timestamptz/);
        assert.doesNotMatch(
          text.slice(text.indexOf("SET"), text.indexOf("WHERE")),
          /worker_claimed_at/,
        );
        return createQueryResult<Row>(
          params[1] === firstClaimToken
            ? [createRunRow({
              status: params[2] === "running" ? "running" : "completed",
              worker_heartbeat_at: typeof params[3] === "string" ? params[3] : null,
            }) as unknown as Row]
            : [],
        );
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  const heartbeatAt = new Date("2026-07-24T10:13:14.000Z");
  const heartbeatUpdate = createChatRunStatusUpdateFromRow(run, {
    status: "running",
    workerHeartbeatAt: heartbeatAt,
    finishedAt: null,
    lastErrorMessage: null,
  });
  const terminalUpdate = createChatRunStatusUpdateFromRow(run, {
    status: "completed",
    finishedAt: new Date("2026-07-24T10:14:15.000Z"),
    lastErrorMessage: null,
  });

  const currentHeartbeat = await updateClaimedChatRunStatusWithExecutor(
    executor,
    scope,
    firstClaimToken,
    heartbeatUpdate,
  );
  const staleHeartbeat = await updateClaimedChatRunStatusWithExecutor(
    executor,
    scope,
    secondClaimToken,
    heartbeatUpdate,
  );
  const currentResult = await updateClaimedChatRunStatusWithExecutor(
    executor,
    scope,
    firstClaimToken,
    terminalUpdate,
  );
  const staleResult = await updateClaimedChatRunStatusWithExecutor(
    executor,
    scope,
    secondClaimToken,
    terminalUpdate,
  );

  assert.equal(currentHeartbeat?.worker_heartbeat_at, heartbeatAt.toISOString());
  assert.equal(staleHeartbeat, null);
  assert.equal(currentResult?.status, "completed");
  assert.equal(staleResult, null);
});

test("assertActiveChatRunClaimWithExecutor locks run then session and accepts the active claim", async () => {
  const lockOrder: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        return createQueryResult<Row>([]);
      }
      if (text.includes("FROM ai.chat_runs") && text.includes("FOR UPDATE")) {
        lockOrder.push("run");
        return createQueryResult<Row>([createRunRow() as unknown as Row]);
      }
      if (text.includes("FROM ai.chat_sessions") && text.includes("FOR UPDATE")) {
        lockOrder.push("session");
        return createQueryResult<Row>([createSessionRow() as unknown as Row]);
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assertActiveChatRunClaimWithExecutor(executor, {
    ...scope,
    runId: "run-1",
    sessionId: "session-1",
    claimToken: firstClaimToken,
  });

  assert.deepEqual(lockOrder, ["run", "session"]);
});

test("assertActiveChatRunClaimWithExecutor rejects every inactive claim state", async () => {
  const cases: ReadonlyArray<Readonly<{
    name: string;
    run: ChatRunRow;
    session: ChatSessionRow;
  }>> = [
    {
      name: "claim token mismatch",
      run: createRunRow({ worker_claimed_at: secondClaimToken }),
      session: createSessionRow(),
    },
    {
      name: "cancel requested",
      run: createRunRow({ cancel_requested_at: "2026-07-24T10:12:00.000Z" }),
      session: createSessionRow(),
    },
    {
      name: "non-running run",
      run: createRunRow({ status: "completed" }),
      session: createSessionRow(),
    },
    {
      name: "inactive session",
      run: createRunRow(),
      session: createSessionRow({ status: "idle" }),
    },
    {
      name: "mismatched active run",
      run: createRunRow(),
      session: createSessionRow({ active_run_id: "run-2" }),
    },
  ];

  for (const testCase of cases) {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        text: string,
      ): Promise<pg.QueryResult<Row>> {
        if (text.includes("set_config('app.user_id'")) {
          return createQueryResult<Row>([]);
        }
        if (text.includes("FROM ai.chat_runs") && text.includes("FOR UPDATE")) {
          return createQueryResult<Row>([testCase.run as unknown as Row]);
        }
        if (text.includes("FROM ai.chat_sessions") && text.includes("FOR UPDATE")) {
          return createQueryResult<Row>([testCase.session as unknown as Row]);
        }
        throw new Error(`Unexpected query: ${text}`);
      },
    };

    await assert.rejects(
      assertActiveChatRunClaimWithExecutor(executor, {
        ...scope,
        runId: "run-1",
        sessionId: "session-1",
        claimToken: firstClaimToken,
      }),
      InactiveChatRunClaimError,
      testCase.name,
    );
  }
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

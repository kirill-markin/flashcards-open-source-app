import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue, WorkspaceDatabaseScope } from "../database";
import {
  CHAT_COST_POLICY_CHAT_TURNS_7D_THRESHOLD,
  CHAT_COST_POLICY_GOOD_REVIEW_DAYS_7D_THRESHOLD,
  CHAT_COST_POLICY_MIN_REVIEWS_PER_GOOD_DAY,
  CHAT_COST_POLICY_WINDOW_DAYS,
  decideChatCostPolicy,
  selectChatCostPolicySignalsWithExecutor,
} from "./costPolicy";

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

test("decideChatCostPolicy routes 20 chat turns with 0 good review days to low-cost", () => {
  const decision = decideChatCostPolicy({
    chatTurnsLast7d: 20,
    goodReviewDaysLast7d: 0,
  });

  assert.equal(decision.mode, "low_cost");
  assert.equal(decision.modelId, "gpt-5.4-nano");
  assert.equal(decision.reasoningEffort, "low");
});

test("decideChatCostPolicy keeps 20 chat turns with one good review day in low-cost", () => {
  const decision = decideChatCostPolicy({
    chatTurnsLast7d: 20,
    goodReviewDaysLast7d: 1,
  });

  assert.equal(decision.mode, "low_cost");
});

test("decideChatCostPolicy trusts two good review days", () => {
  const decision = decideChatCostPolicy({
    chatTurnsLast7d: 20,
    goodReviewDaysLast7d: 2,
  });

  assert.equal(decision.mode, "normal");
  assert.equal(decision.modelId, "gpt-5.4");
  assert.equal(decision.reasoningEffort, "medium");
});

test("decideChatCostPolicy keeps 19 chat turns in normal mode without reviews", () => {
  const decision = decideChatCostPolicy({
    chatTurnsLast7d: 19,
    goodReviewDaysLast7d: 0,
  });

  assert.equal(decision.mode, "normal");
});

test("selectChatCostPolicySignalsWithExecutor counts only current user client-installation reviews", async () => {
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

      if (text.includes("FROM ai.chat_sessions AS chat_sessions")) {
        assert.match(text, /replicas\.user_id = \$1/);
        assert.match(text, /replicas\.actor_kind = 'client_installation'/);
        assert.match(text, /review_events\.reviewed_at_server >= now\(\) - \(\$4::integer \* INTERVAL '1 day'\)/);
        assert.match(text, /review_events_count >= \$5/);
        return createQueryResult([
          {
            chat_turns_last_7d: 20,
            good_review_days_last_7d: 1,
          },
        ]) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const signals = await selectChatCostPolicySignalsWithExecutor(executor, scope, "Europe/Madrid");

  assert.deepEqual(signals, {
    chatTurnsLast7d: 20,
    goodReviewDaysLast7d: 1,
  });
  assert.deepEqual(recordedQueries[1]?.params, [
    "user-1",
    "workspace-1",
    "Europe/Madrid",
    CHAT_COST_POLICY_WINDOW_DAYS,
    CHAT_COST_POLICY_MIN_REVIEWS_PER_GOOD_DAY,
  ]);
  assert.equal(CHAT_COST_POLICY_CHAT_TURNS_7D_THRESHOLD, 20);
  assert.equal(CHAT_COST_POLICY_GOOD_REVIEW_DAYS_7D_THRESHOLD, 2);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type pg from "pg";
import { loadOpenApiDocument } from "./openapi";
import { loadUserProgressSeriesInExecutor } from "./progress";
import type { DatabaseExecutor, SqlValue } from "./db";

type QueryResultRow = pg.QueryResultRow;

type DailyReviewCountRow = Readonly<{
  review_date: string;
  review_count: string | number;
}>;

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
}>;

type ProgressExecutorFixture = Readonly<{
  workspaceIdsByUser: Readonly<Record<string, ReadonlyArray<string>>>;
  reviewRowsByRequest: Readonly<Record<string, ReadonlyArray<DailyReviewCountRow>>>;
}>;

type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

type ScopeState = Readonly<{
  userId: string | null;
  workspaceId: string | null;
}>;

function createQueryResult<Row extends QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    rows: [...rows],
    fields: [],
  };
}

function createProgressExecutor(
  fixture: ProgressExecutorFixture,
): Readonly<{
  executor: DatabaseExecutor;
  recordedQueries: ReadonlyArray<RecordedQuery>;
}> {
  const recordedQueries: Array<RecordedQuery> = [];
  let scope: ScopeState = {
    userId: null,
    workspaceId: null,
  };

  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });

      if (text.includes("set_config('app.user_id', $1, true)")) {
        const userId = typeof params[0] === "string" ? params[0] : String(params[0]);
        const workspaceIdValue = typeof params[1] === "string" ? params[1] : String(params[1]);
        scope = {
          userId,
          workspaceId: workspaceIdValue === "" ? null : workspaceIdValue,
        };
        return createQueryResult<QueryResultRow>([]) as pg.QueryResult<Row>;
      }

      if (
        text.includes("SELECT memberships.workspace_id")
        && text.includes("FROM org.workspace_memberships memberships")
      ) {
        const userId = typeof params[0] === "string" ? params[0] : String(params[0]);
        if (scope.userId !== userId || scope.workspaceId !== null) {
          throw new Error("Workspace membership query requires user scope without a workspace");
        }

        return createQueryResult<WorkspaceMembershipRow>(
          (fixture.workspaceIdsByUser[userId] ?? []).map((workspaceId) => ({ workspace_id: workspaceId })),
        ) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("FROM content.review_events AS review_events")) {
        const workspaceId = typeof params[0] === "string" ? params[0] : String(params[0]);
        const timeZone = typeof params[1] === "string" ? params[1] : String(params[1]);
        const from = typeof params[2] === "string" ? params[2] : String(params[2]);
        const to = typeof params[3] === "string" ? params[3] : String(params[3]);
        if (scope.userId === null || scope.workspaceId !== workspaceId) {
          throw new Error("Review history query requires matching workspace scope");
        }

        const key = `${workspaceId}|${timeZone}|${from}|${to}`;
        return createQueryResult<DailyReviewCountRow>(
          fixture.reviewRowsByRequest[key] ?? [],
        ) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected progress query: ${text}`);
    },
  };

  return {
    executor,
    recordedQueries,
  };
}

test("loadUserProgressSeriesInExecutor returns a zero-filled series for an empty history", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-13",
  });

  assert.deepEqual(progress, {
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-13",
    dailyReviews: [
      { date: "2026-04-11", reviewCount: 0 },
      { date: "2026-04-12", reviewCount: 0 },
      { date: "2026-04-13", reviewCount: 0 },
    ],
  });
});

test("loadUserProgressSeriesInExecutor fills gaps and merges review counts across multiple workspaces", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {
      "workspace-1|Europe/Madrid|2026-04-11|2026-04-14": [
        { review_date: "2026-04-11", review_count: 1 },
        { review_date: "2026-04-13", review_count: "4" },
      ],
      "workspace-2|Europe/Madrid|2026-04-11|2026-04-14": [
        { review_date: "2026-04-11", review_count: 2 },
        { review_date: "2026-04-14", review_count: 3 },
      ],
    },
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-14",
  });

  assert.deepEqual(progress.dailyReviews, [
    { date: "2026-04-11", reviewCount: 3 },
    { date: "2026-04-12", reviewCount: 0 },
    { date: "2026-04-13", reviewCount: 4 },
    { date: "2026-04-14", reviewCount: 3 },
  ]);
});

test("loadUserProgressSeriesInExecutor queries review events with requested timezone day bucketing", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {
      "workspace-1|America/Los_Angeles|2026-04-11|2026-04-12": [
        { review_date: "2026-04-11", review_count: 1 },
      ],
    },
  });

  await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "America/Los_Angeles",
    from: "2026-04-11",
    to: "2026-04-12",
  });

  const reviewQuery = recordedQueries.find((query) => query.text.includes("FROM content.review_events"));
  if (reviewQuery === undefined) {
    assert.fail("Expected a review_events query to be recorded");
  }
  assert.match(reviewQuery.text, /timezone\(\$2, review_events\.reviewed_at_client\)::date/);
  assert.match(reviewQuery.text, /review_events\.reviewed_at_client >= \(\(\$3::date\)::timestamp AT TIME ZONE \$2\)/);
  assert.match(reviewQuery.text, /review_events\.reviewed_at_client < \(\(\(\(\$4::date\) \+ 1\)::timestamp\) AT TIME ZONE \$2\)/);
  assert.deepEqual(reviewQuery.params, [
    "workspace-1",
    "America/Los_Angeles",
    "2026-04-11",
    "2026-04-12",
  ]);
});

test("loadUserProgressSeriesInExecutor applies user scope for memberships and workspace scope for each review query", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {
      "workspace-1|Europe/Madrid|2026-04-11|2026-04-14": [
        { review_date: "2026-04-11", review_count: 3 },
      ],
      "workspace-2|Europe/Madrid|2026-04-11|2026-04-14": [
        { review_date: "2026-04-14", review_count: 1 },
      ],
    },
  });

  await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-14",
  });

  const reviewQueries = recordedQueries.filter((query) => query.text.includes("FROM content.review_events AS review_events"));
  assert.equal(reviewQueries.length, 2);
  assert.match(reviewQueries[0]?.text ?? "", /WHERE review_events\.workspace_id = \$1/);

  const scopeQueries = recordedQueries.filter((query) => query.text.includes("set_config('app.user_id', $1, true)"));
  assert.deepEqual(scopeQueries.map((query) => query.params), [
    ["user-1", ""],
    ["user-1", "workspace-1"],
    ["user-1", "workspace-2"],
  ]);
});

test("loadUserProgressSeriesInExecutor keeps progress visible after a bound guest upgrade because the canonical user id stays the same", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "guest-user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {
      "workspace-1|Europe/Madrid|2026-04-11|2026-04-13": [
        { review_date: "2026-04-12", review_count: 5 },
      ],
    },
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "guest-user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-13",
  });

  assert.deepEqual(progress.dailyReviews, [
    { date: "2026-04-11", reviewCount: 0 },
    { date: "2026-04-12", reviewCount: 5 },
    { date: "2026-04-13", reviewCount: 0 },
  ]);
});

test("loadUserProgressSeriesInExecutor keeps progress visible after a merge_required guest upgrade once merged reviews exist in the target account context", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "target-user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {
      "workspace-1|Europe/Madrid|2026-04-11|2026-04-13": [
        { review_date: "2026-04-11", review_count: 2 },
        { review_date: "2026-04-12", review_count: 4 },
      ],
      "workspace-2|Europe/Madrid|2026-04-11|2026-04-13": [
        { review_date: "2026-04-12", review_count: 1 },
      ],
    },
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "target-user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-13",
  });

  assert.deepEqual(progress.dailyReviews, [
    { date: "2026-04-11", reviewCount: 2 },
    { date: "2026-04-12", reviewCount: 5 },
    { date: "2026-04-13", reviewCount: 0 },
  ]);
});

test("published contract excludes /me/progress while the API Gateway resource tree still predeclares the path", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    info?: Readonly<{ title?: string; description?: string }>;
    paths?: Readonly<Record<string, unknown>>;
  }>;
  assert.equal(openApiDocument.info?.title, "Flashcards Open Source App External AI-Agent API");
  assert.match(openApiDocument.info?.description ?? "", /external ai agents/i);
  assert.equal(openApiDocument.paths?.["/me/progress"], undefined);

  const apiGatewayPath = path.resolve(process.cwd(), "../../infra/aws/lib/api-gateway.ts");
  const apiGatewaySource = fs.readFileSync(apiGatewayPath, "utf8");
  assert.match(apiGatewaySource, /me\.addResource\("progress"\)\.addMethod\("GET", integration\);/);
});

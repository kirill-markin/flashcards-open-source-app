import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { generateGlobalMetricsSnapshotWithDependencies } from "./reporting";

type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<unknown>;
}>;

type QueryResultRow = pg.QueryResultRow;

function createQueryResult<Row extends QueryResultRow>(
  rows: ReadonlyArray<Row>,
): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    rows: [...rows],
    fields: [],
  };
}

test("generateGlobalMetricsSnapshotWithDependencies uses all-time totals before asOfUtc and 90-day rows for the day series", async () => {
  const recordedQueries: Array<RecordedQuery> = [];
  const client = {
    query: async <Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<unknown>,
    ): Promise<pg.QueryResult<Row>> => {
      recordedQueries.push({ text, params });

      if (text.includes("to_char((review_events.reviewed_at_server AT TIME ZONE 'UTC')::date")) {
        return createQueryResult([
          {
            review_date: "2026-01-23",
            unique_reviewing_users: 2,
            total_review_events: 3,
            web_review_events: 1,
            android_review_events: 1,
            ios_review_events: 1,
          },
          {
            review_date: "2026-04-22",
            unique_reviewing_users: 2,
            total_review_events: 2,
            web_review_events: 1,
            android_review_events: 1,
            ios_review_events: 0,
          },
        ]) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("COUNT(DISTINCT workspace_replicas.user_id)::int AS unique_reviewing_users")) {
        return createQueryResult([
          {
            unique_reviewing_users: 8,
            total_review_events: 12,
            web_review_events: 4,
            android_review_events: 5,
            ios_review_events: 3,
          },
        ]) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected global metrics reporting query: ${text}`);
    },
  } as unknown as pg.PoolClient;

  const snapshot = await generateGlobalMetricsSnapshotWithDependencies({
    withReportingReadOnlyTransactionFn: async <Result>(
      run: (transactionClient: pg.PoolClient) => Promise<Result>,
    ): Promise<Result> => run(client),
    now: () => new Date("2026-04-23T09:30:00.000Z"),
  });

  assert.equal(recordedQueries.length, 2);

  const totalsQuery = recordedQueries[0];
  const daySeriesQuery = recordedQueries[1];
  assert.match(totalsQuery?.text ?? "", /WHERE review_events\.reviewed_at_server < \$1::timestamptz/);
  assert.doesNotMatch(totalsQuery?.text ?? "", /review_events\.reviewed_at_server >= \$1::timestamptz/);
  assert.deepEqual(totalsQuery?.params, ["2026-04-23T00:00:00.000Z"]);

  assert.match(daySeriesQuery?.text ?? "", /WHERE review_events\.reviewed_at_server >= \$1::timestamptz/);
  assert.match(daySeriesQuery?.text ?? "", /AND review_events\.reviewed_at_server < \$2::timestamptz/);
  assert.deepEqual(daySeriesQuery?.params, [
    "2026-01-23T00:00:00.000Z",
    "2026-04-23T00:00:00.000Z",
  ]);

  assert.equal(snapshot.totals.uniqueReviewingUsers, 8);
  assert.equal(snapshot.totals.reviewEvents.total, 12);
  assert.equal(snapshot.days[0]?.reviewEvents.total, 3);
  assert.equal(snapshot.days[89]?.reviewEvents.total, 2);
  assert.equal(snapshot.days.reduce((sum, day) => sum + day.reviewEvents.total, 0), 5);
});

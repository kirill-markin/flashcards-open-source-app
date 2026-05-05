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

test("generateGlobalMetricsSnapshotWithDependencies uses all-time totals before asOfUtc and all-time rows from the historical start date", async () => {
  const recordedQueries: Array<RecordedQuery> = [];
  const client = {
    query: async <Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<unknown>,
    ): Promise<pg.QueryResult<Row>> => {
      recordedQueries.push({ text, params });

      if (text.includes("AS historical_start_date")) {
        return createQueryResult([
          {
            historical_start_date: "2026-03-07",
          },
        ]) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("to_char(daily_user_activity.review_date")) {
        return createQueryResult([
          {
            review_date: "2026-03-07",
            unique_reviewing_users: 2,
            new_reviewing_users: 2,
            returning_reviewing_users: 0,
            total_review_events: 3,
            web_review_events: 1,
            android_review_events: 1,
            ios_review_events: 1,
          },
          {
            review_date: "2026-04-22",
            unique_reviewing_users: 2,
            new_reviewing_users: 1,
            returning_reviewing_users: 1,
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
            total_review_events: 5,
            web_review_events: 2,
            android_review_events: 2,
            ios_review_events: 1,
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

  assert.equal(recordedQueries.length, 3);

  const historicalStartDateQuery = recordedQueries[0];
  const totalsQuery = recordedQueries[1];
  const daySeriesQuery = recordedQueries[2];
  assert.match(historicalStartDateQuery?.text ?? "", /AS historical_start_date/);
  assert.deepEqual(historicalStartDateQuery?.params, ["2026-04-23T00:00:00.000Z"]);
  assert.match(totalsQuery?.text ?? "", /WHERE review_events\.reviewed_at_server < \$1::timestamptz/);
  assert.doesNotMatch(totalsQuery?.text ?? "", /review_events\.reviewed_at_server >= \$1::timestamptz/);
  assert.deepEqual(totalsQuery?.params, ["2026-04-23T00:00:00.000Z"]);

  assert.match(daySeriesQuery?.text ?? "", /WHERE review_events\.reviewed_at_server >= \$1::timestamptz/);
  assert.match(daySeriesQuery?.text ?? "", /AND review_events\.reviewed_at_server < \$2::timestamptz/);
  assert.match(daySeriesQuery?.text ?? "", /WITH user_first_review_date AS/);
  assert.deepEqual(daySeriesQuery?.params, [
    "2026-03-07T00:00:00.000Z",
    "2026-04-23T00:00:00.000Z",
  ]);

  assert.equal(snapshot.totals.uniqueReviewingUsers, 8);
  assert.equal(snapshot.totals.reviewEvents.total, 5);
  assert.equal(snapshot.days[0]?.reviewEvents.total, 3);
  assert.equal(snapshot.days[46]?.reviewEvents.total, 2);
  assert.equal(snapshot.days.reduce((sum, day) => sum + day.reviewEvents.total, 0), 5);
});

test("generateGlobalMetricsSnapshotWithDependencies emits a single zero day when no historical review date exists", async () => {
  const recordedQueries: Array<RecordedQuery> = [];
  const client = {
    query: async <Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<unknown>,
    ): Promise<pg.QueryResult<Row>> => {
      recordedQueries.push({ text, params });

      if (text.includes("AS historical_start_date")) {
        return createQueryResult([
          {
            historical_start_date: null,
          },
        ]) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("to_char(daily_user_activity.review_date")) {
        return createQueryResult([]) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("COUNT(DISTINCT workspace_replicas.user_id)::int AS unique_reviewing_users")) {
        return createQueryResult([
          {
            unique_reviewing_users: 0,
            total_review_events: 0,
            web_review_events: 0,
            android_review_events: 0,
            ios_review_events: 0,
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

  assert.equal(recordedQueries.length, 3);
  assert.deepEqual(recordedQueries[2]?.params, [
    "2026-04-22T00:00:00.000Z",
    "2026-04-23T00:00:00.000Z",
  ]);
  assert.equal(snapshot.from, "2026-04-22");
  assert.equal(snapshot.to, "2026-04-22");
  assert.equal(snapshot.totals.reviewEvents.total, 0);
  assert.deepEqual(snapshot.days, [
    {
      date: "2026-04-22",
      uniqueReviewingUsers: 0,
      newReviewingUsers: 0,
      returningReviewingUsers: 0,
      reviewEvents: {
        total: 0,
        byPlatform: {
          web: 0,
          android: 0,
          ios: 0,
        },
      },
    },
  ]);
});

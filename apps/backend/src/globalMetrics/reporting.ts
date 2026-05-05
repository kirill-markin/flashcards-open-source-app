import type pg from "pg";
import { withReportingReadOnlyTransaction } from "../admin/reportingDb";
import {
  buildGlobalMetricsSnapshot,
  createGlobalMetricsSnapshotWindow,
  type GlobalMetricsSnapshot,
  type GlobalMetricsSnapshotDayRow,
  type GlobalMetricsSnapshotHistoricalStartDate,
  type GlobalMetricsSnapshotTotalsRow,
} from "./snapshot";

// The three SQL builders below back the public anonymized endpoint
// (`apps/backend/src/routes/globalSnapshot.ts`) and the scheduled snapshot Lambda
// (`apps/backend/src/lambda-global-metrics-snapshot.ts`).
//
// The two fragment constants below are the canonical encoding of the user-identity
// filters shared by those three queries. The same rules are restated in the admin
// per-user query at `apps/admin/src/reports/reviewEventsByDate/query.ts`
// (`buildReviewEventsByDateSql`), which lives in a separate package. If any rule
// changes, update both files.

// WHERE-fragment that restricts review activity to real client-app installations on
// supported user-facing platforms (excludes system actors and the 'system' platform).
const clientInstallationActivityWhereSqlFragments = [
  "  AND workspace_replicas.actor_kind = 'client_installation'",
  "  AND workspace_replicas.platform IN ('web', 'android', 'ios')",
] as const;

// SQL fragments that exclude users whose known email ends with `@example.com`.
// `joinFragments` and `whereFragments` MUST be spread together into the same query:
// the WHERE fragment references `user_settings.email`, which is only in scope after
// the JOIN fragment brings `org.user_settings` in.
const exampleComEmailExclusionSqlFragments = {
  joinFragments: [
    "LEFT JOIN org.user_settings AS user_settings",
    "  ON user_settings.user_id = workspace_replicas.user_id",
  ],
  whereFragments: [
    "  AND (",
    "    user_settings.email IS NULL",
    "    OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "  )",
  ],
} as const;

type GlobalMetricsSnapshotHistoricalStartDateRow = Readonly<{
  historical_start_date: string | null;
}>;

function buildGlobalMetricsSnapshotHistoricalStartDateSql(): string {
  return [
    "SELECT",
    "  to_char(MIN((review_events.reviewed_at_server AT TIME ZONE 'UTC')::date), 'YYYY-MM-DD') AS historical_start_date",
    "FROM content.review_events AS review_events",
    "INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "  ON workspace_replicas.replica_id = review_events.replica_id",
    ...exampleComEmailExclusionSqlFragments.joinFragments,
    "WHERE review_events.reviewed_at_server < $1::timestamptz",
    ...clientInstallationActivityWhereSqlFragments,
    ...exampleComEmailExclusionSqlFragments.whereFragments,
  ].join(" ");
}

function buildGlobalMetricsSnapshotTotalsSql(): string {
  return [
    "SELECT",
    "  COUNT(DISTINCT workspace_replicas.user_id)::int AS unique_reviewing_users,",
    "  COUNT(*)::int AS total_review_events,",
    "  COUNT(*) FILTER (WHERE workspace_replicas.platform = 'web')::int AS web_review_events,",
    "  COUNT(*) FILTER (WHERE workspace_replicas.platform = 'android')::int AS android_review_events,",
    "  COUNT(*) FILTER (WHERE workspace_replicas.platform = 'ios')::int AS ios_review_events",
    "FROM content.review_events AS review_events",
    "INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "  ON workspace_replicas.replica_id = review_events.replica_id",
    ...exampleComEmailExclusionSqlFragments.joinFragments,
    "WHERE review_events.reviewed_at_server < $1::timestamptz",
    ...clientInstallationActivityWhereSqlFragments,
    ...exampleComEmailExclusionSqlFragments.whereFragments,
  ].join(" ");
}

function buildGlobalMetricsSnapshotDaysSql(): string {
  return [
    "WITH user_first_review_date AS (",
    "  SELECT",
    "    workspace_replicas.user_id,",
    "    MIN((review_events.reviewed_at_server AT TIME ZONE 'UTC')::date) AS first_review_date",
    "  FROM content.review_events AS review_events",
    "  INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "    ON workspace_replicas.replica_id = review_events.replica_id",
    ...exampleComEmailExclusionSqlFragments.joinFragments,
    "  WHERE review_events.reviewed_at_server < $2::timestamptz",
    ...clientInstallationActivityWhereSqlFragments,
    ...exampleComEmailExclusionSqlFragments.whereFragments,
    "  GROUP BY workspace_replicas.user_id",
    "), daily_user_activity AS (",
    "  SELECT",
    "    (review_events.reviewed_at_server AT TIME ZONE 'UTC')::date AS review_date,",
    "    workspace_replicas.user_id,",
    "    user_first_review_date.first_review_date,",
    "    COUNT(*)::int AS review_event_count,",
    "    COUNT(*) FILTER (WHERE workspace_replicas.platform = 'web')::int AS web_review_events,",
    "    COUNT(*) FILTER (WHERE workspace_replicas.platform = 'android')::int AS android_review_events,",
    "    COUNT(*) FILTER (WHERE workspace_replicas.platform = 'ios')::int AS ios_review_events",
    "  FROM content.review_events AS review_events",
    "  INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "    ON workspace_replicas.replica_id = review_events.replica_id",
    ...exampleComEmailExclusionSqlFragments.joinFragments,
    "  INNER JOIN user_first_review_date",
    "    ON user_first_review_date.user_id = workspace_replicas.user_id",
    "  WHERE review_events.reviewed_at_server >= $1::timestamptz",
    "    AND review_events.reviewed_at_server < $2::timestamptz",
    ...clientInstallationActivityWhereSqlFragments,
    ...exampleComEmailExclusionSqlFragments.whereFragments,
    "  GROUP BY (review_events.reviewed_at_server AT TIME ZONE 'UTC')::date, workspace_replicas.user_id, user_first_review_date.first_review_date",
    ")",
    "SELECT",
    "  to_char(daily_user_activity.review_date, 'YYYY-MM-DD') AS review_date,",
    "  COUNT(*)::int AS unique_reviewing_users,",
    "  COUNT(*) FILTER (WHERE daily_user_activity.first_review_date = daily_user_activity.review_date)::int AS new_reviewing_users,",
    "  COUNT(*) FILTER (WHERE daily_user_activity.first_review_date < daily_user_activity.review_date)::int AS returning_reviewing_users,",
    "  SUM(daily_user_activity.review_event_count)::int AS total_review_events,",
    "  SUM(daily_user_activity.web_review_events)::int AS web_review_events,",
    "  SUM(daily_user_activity.android_review_events)::int AS android_review_events,",
    "  SUM(daily_user_activity.ios_review_events)::int AS ios_review_events",
    "FROM daily_user_activity",
    "GROUP BY daily_user_activity.review_date",
    "ORDER BY review_date ASC",
  ].join(" ");
}

async function loadGlobalMetricsSnapshotTotalsRowInExecutor(
  executor: pg.PoolClient,
  asOfUtc: string,
): Promise<GlobalMetricsSnapshotTotalsRow> {
  const result = await executor.query<GlobalMetricsSnapshotTotalsRow>(
    buildGlobalMetricsSnapshotTotalsSql(),
    [asOfUtc],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Global metrics totals query returned no rows.");
  }

  return row;
}

async function loadGlobalMetricsSnapshotHistoricalStartDateInExecutor(
  executor: pg.PoolClient,
  asOfUtc: string,
): Promise<GlobalMetricsSnapshotHistoricalStartDate> {
  const result = await executor.query<GlobalMetricsSnapshotHistoricalStartDateRow>(
    buildGlobalMetricsSnapshotHistoricalStartDateSql(),
    [asOfUtc],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Global metrics historical start date query returned no rows.");
  }

  return row.historical_start_date;
}

async function loadGlobalMetricsSnapshotDayRowsInExecutor(
  executor: pg.PoolClient,
  rangeStartUtc: string,
  rangeEndUtc: string,
): Promise<ReadonlyArray<GlobalMetricsSnapshotDayRow>> {
  const result = await executor.query<GlobalMetricsSnapshotDayRow>(
    buildGlobalMetricsSnapshotDaysSql(),
    [rangeStartUtc, rangeEndUtc],
  );

  return result.rows;
}

type GenerateGlobalMetricsSnapshotDependencies = Readonly<{
  withReportingReadOnlyTransactionFn: typeof withReportingReadOnlyTransaction;
  now: () => Date;
}>;

export async function generateGlobalMetricsSnapshotWithDependencies(
  dependencies: GenerateGlobalMetricsSnapshotDependencies,
): Promise<GlobalMetricsSnapshot> {
  const now = dependencies.now();
  const provisionalWindow = createGlobalMetricsSnapshotWindow({
    now,
    historicalStartDate: null,
  });

  return dependencies.withReportingReadOnlyTransactionFn(async (client) => {
    const historicalStartDate = await loadGlobalMetricsSnapshotHistoricalStartDateInExecutor(
      client,
      provisionalWindow.asOfUtc,
    );
    const window = createGlobalMetricsSnapshotWindow({
      now,
      historicalStartDate,
    });
    const totalsRow = await loadGlobalMetricsSnapshotTotalsRowInExecutor(
      client,
      window.asOfUtc,
    );
    const dayRows = await loadGlobalMetricsSnapshotDayRowsInExecutor(
      client,
      window.rangeStartUtc,
      window.rangeEndUtc,
    );

    return buildGlobalMetricsSnapshot({
      window,
      totalsRow,
      dayRows,
    });
  });
}

export async function generateGlobalMetricsSnapshot(): Promise<GlobalMetricsSnapshot> {
  return generateGlobalMetricsSnapshotWithDependencies({
    withReportingReadOnlyTransactionFn: withReportingReadOnlyTransaction,
    now: () => new Date(),
  });
}

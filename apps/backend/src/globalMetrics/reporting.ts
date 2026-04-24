import type pg from "pg";
import { withReportingReadOnlyTransaction } from "../admin/reportingDb";
import {
  buildGlobalMetricsSnapshot,
  createGlobalMetricsSnapshotWindow,
  type GlobalMetricsSnapshot,
  type GlobalMetricsSnapshotDayRow,
  type GlobalMetricsSnapshotTotalsRow,
} from "./snapshot";

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
    "WHERE review_events.reviewed_at_server < $1::timestamptz",
    "  AND workspace_replicas.actor_kind = 'client_installation'",
    "  AND workspace_replicas.platform IN ('web', 'android', 'ios')",
  ].join(" ");
}

function buildGlobalMetricsSnapshotDaysSql(): string {
  return [
    "SELECT",
    "  to_char((review_events.reviewed_at_server AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS review_date,",
    "  COUNT(DISTINCT workspace_replicas.user_id)::int AS unique_reviewing_users,",
    "  COUNT(*)::int AS total_review_events,",
    "  COUNT(*) FILTER (WHERE workspace_replicas.platform = 'web')::int AS web_review_events,",
    "  COUNT(*) FILTER (WHERE workspace_replicas.platform = 'android')::int AS android_review_events,",
    "  COUNT(*) FILTER (WHERE workspace_replicas.platform = 'ios')::int AS ios_review_events",
    "FROM content.review_events AS review_events",
    "INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "  ON workspace_replicas.replica_id = review_events.replica_id",
    "WHERE review_events.reviewed_at_server >= $1::timestamptz",
    "  AND review_events.reviewed_at_server < $2::timestamptz",
    "  AND workspace_replicas.actor_kind = 'client_installation'",
    "  AND workspace_replicas.platform IN ('web', 'android', 'ios')",
    "GROUP BY (review_events.reviewed_at_server AT TIME ZONE 'UTC')::date",
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
  const window = createGlobalMetricsSnapshotWindow(dependencies.now());

  return dependencies.withReportingReadOnlyTransactionFn(async (client) => {
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

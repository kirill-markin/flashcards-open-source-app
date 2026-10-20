import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import {
  buildReportBucketColumnsSql,
  buildReportBucketSql,
  buildReportBucketsCteSql,
  parseReportBucket,
  type ReportBucket,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange, parseActivityCount, parseActivityDate } from "../reportValues";

/**
 * The CTEs one new/returning chart counts, by name. `activityCte` holds one `(actor_id, activity_date)` row
 * per resolved person and UTC day after the shared exclusions, `firstUseCte` each person's
 * `first_use_date` over all retained history, and `coverageCte` one `history_from` row: the
 * source's first retained day, before which no day is measured.
 */
export type DailyActivitySource = Readonly<{
  ctesSql: string;
  activityCte: string;
  firstUseCte: string;
  coverageCte: string;
}>;

export type NewReturningBucket = Readonly<{
  bucket: ReportBucket;
  newUsers: number | null;
  returningUsers: number | null;
}>;

export type DailyNewReturningReport = Readonly<{
  generatedAtUtc: string;
  period: ReportPeriod;
  today: string;
  buckets: ReadonlyArray<NewReturningBucket>;
}>;

// Unique people per bucket, counted in SQL rather than summed over days: new when the person's
// first-ever activity day is one of the bucket's selected days, returning when it is earlier, so each
// person active in a bucket is in exactly one part of its bar. A bucket is measured only when retained
// history covers all of its selected days.
export function buildDailyNewReturningSql(
  source: DailyActivitySource,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return `WITH ${source.ctesSql}, ${buildReportBucketsCteSql(period, range)}, bucket_activity AS (
  SELECT ${buildReportBucketSql(period, "activity.activity_date")} AS bucket_date, activity.actor_id
  FROM ${source.activityCte} AS activity
  WHERE activity.activity_date BETWEEN ${escapeSqlStringLiteral(range.from)}::date AND ${escapeSqlStringLiteral(range.to)}::date
), bucket_users AS (
  SELECT buckets.bucket_date, buckets.selected_from, buckets.selected_to,
    COUNT(DISTINCT activity.actor_id) FILTER (WHERE first_use.first_use_date >= buckets.selected_from) AS new_users,
    COUNT(DISTINCT activity.actor_id) FILTER (WHERE first_use.first_use_date < buckets.selected_from) AS returning_users
  FROM report_buckets AS buckets
  LEFT JOIN bucket_activity AS activity USING (bucket_date)
  LEFT JOIN ${source.firstUseCte} AS first_use USING (actor_id)
  GROUP BY buckets.bucket_date, buckets.selected_from, buckets.selected_to
)
SELECT ${buildReportBucketColumnsSql("bucket_users")},
  to_char(coverage.history_from, 'YYYY-MM-DD') AS history_from,
  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,
  CASE WHEN bucket_users.selected_from >= coverage.history_from THEN bucket_users.new_users END AS new_users,
  CASE WHEN bucket_users.selected_from >= coverage.history_from THEN bucket_users.returning_users END AS returning_users
FROM bucket_users
CROSS JOIN ${source.coverageCte} AS coverage
ORDER BY bucket_users.bucket_date`;
}

export async function loadDailyNewReturningReport(
  config: AdminAppConfig,
  source: DailyActivitySource,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
  signal: AbortSignal,
): Promise<DailyNewReturningReport> {
  const response = await runAdminQuery(config, buildDailyNewReturningSql(source, dateRange, period, reportLabel), signal);
  const result = response.resultSets[0];
  const firstRow = result?.rows[0];
  if (response.resultSets.length !== 1 || result === undefined || firstRow === undefined) {
    throw new Error(`${reportLabel} must return one result set with at least one bucket.`);
  }
  return {
    generatedAtUtc: response.executedAtUtc,
    period,
    today: parseActivityDate(firstRow.today ?? null, reportLabel, "today"),
    buckets: result.rows.map((row) => {
      const newUsers = parseActivityCount(row.new_users ?? null, reportLabel, "new_users");
      const returningUsers = parseActivityCount(row.returning_users ?? null, reportLabel, "returning_users");
      if ((newUsers === null) !== (returningUsers === null)) {
        throw new Error(`${reportLabel} must report new and returning people together.`);
      }
      return { bucket: parseReportBucket(row, reportLabel), newUsers, returningUsers };
    }),
  };
}

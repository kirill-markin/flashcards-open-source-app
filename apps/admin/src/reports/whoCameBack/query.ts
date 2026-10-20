import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import { buildMeaningfulActivityCtesSql } from "../levelOneMetrics/meaningfulActivitySql";
import {
  buildReportBucketColumnsSql,
  buildReportBucketSql,
  buildReportBucketsCteSql,
  parseReportBucket,
  type ReportBucket,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import {
  assertValidDateRange,
  formatCalendarDate,
  parseActivityCount,
  parseActivityDate,
  parseCalendarDate,
} from "../reportValues";

const reportLabel = "Who came back report";

export type RetentionCounts = Readonly<{ returned: number; base: number }>;
export type WhoCameBackCohort = Readonly<{
  bucket: ReportBucket;
  cohortUsers: number | null;
  w1: RetentionCounts | null;
  w4: RetentionCounts | null;
}>;
export type WhoCameBackReport = Readonly<{
  generatedAtUtc: string;
  period: ReportPeriod;
  historyFrom: string | null;
  latestCompleteDate: string;
  cohorts: ReadonlyArray<WhoCameBackCohort>;
}>;

/** Days after the bucket's last selected first-use day that W1 and W4 need complete before a rate shows. */
export const retentionMaturityDays = { w1: 13, w4: 34 } as const;

export type RetentionWindow = keyof typeof retentionMaturityDays;

/**
 * Why a cohort has no rate in `window`, by the same rule as `buildRetentionMatureSql`; a mature,
 * covered cohort without one has nobody in it.
 */
export function describeUnavailableRetention(
  bucket: ReportBucket,
  historyFrom: string | null,
  latestCompleteDate: string,
  window: RetentionWindow,
): string {
  if (historyFrom === null || bucket.from < historyFrom) return "Unavailable: cohort predates retained source history.";
  const matureDate = parseCalendarDate(bucket.to, reportLabel);
  matureDate.setUTCDate(matureDate.getUTCDate() + retentionMaturityDays[window]);
  const matureOn = formatCalendarDate(matureDate);
  if (matureOn > latestCompleteDate) return `Unavailable: needs complete UTC days through ${matureOn}.`;
  return "Unavailable: no users in this cohort.";
}

/**
 * Every CTE through `member_returns`, one row per person whose first use falls on a bucket's selected
 * days, with whether they returned in W1 and in W4. The period changes only the cohort size, while W1
 * and W4 stay measured from each person's own first day.
 */
export function buildWhoCameBackMemberCtesSql(range: AnalyticsDateRange, period: ReportPeriod): string {
  const fromSql = `${escapeSqlStringLiteral(range.from)}::date`;
  const toSql = `${escapeSqlStringLiteral(range.to)}::date`;
  return `${buildMeaningfulActivityCtesSql()}, ${buildReportBucketsCteSql(period, range)}, cohort_members AS MATERIALIZED (
  SELECT actor_id, first_use_date, ${buildReportBucketSql(period, "first_use_date")} AS bucket_date
  FROM actor_first_use
  WHERE first_use_date BETWEEN ${fromSql} AND ${toSql}
    AND first_use_date <= (SELECT latest_complete_date FROM activity_clock)
), member_returns AS (
  SELECT members.actor_id, members.bucket_date,
    COALESCE(bool_or(activity.activity_date BETWEEN members.first_use_date + 7 AND members.first_use_date + 13), false) AS w1_returned,
    COALESCE(bool_or(activity.activity_date BETWEEN members.first_use_date + 28 AND members.first_use_date + 34), false) AS w4_returned
  FROM cohort_members AS members
  LEFT JOIN meaningful_activity AS activity
    ON activity.actor_id = members.actor_id
    AND activity.activity_date BETWEEN members.first_use_date + 7 AND members.first_use_date + 34
  GROUP BY members.actor_id, members.bucket_date
)`;
}

/**
 * Whether the cohort of the `report_buckets` row `alias` names is covered and has its full `window`,
 * over `activity_coverage AS coverage` and `activity_clock AS clock`.
 */
export function buildRetentionMatureSql(alias: string, window: RetentionWindow): string {
  return `${alias}.selected_from >= coverage.history_from
    AND ${alias}.selected_to + ${retentionMaturityDays[window]} <= clock.latest_complete_date`;
}

export function buildWhoCameBackSql(dateRange: AnalyticsDateRange, period: ReportPeriod): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return `WITH ${buildWhoCameBackMemberCtesSql(range, period)}, cohort_counts AS (
  SELECT buckets.bucket_date, buckets.selected_from, buckets.selected_to, COUNT(returns.actor_id) AS cohort_users,
    COUNT(returns.actor_id) FILTER (WHERE returns.w1_returned) AS w1_returned,
    COUNT(returns.actor_id) FILTER (WHERE returns.w4_returned) AS w4_returned
  FROM report_buckets AS buckets
  LEFT JOIN member_returns AS returns USING (bucket_date)
  GROUP BY buckets.bucket_date, buckets.selected_from, buckets.selected_to
)
SELECT ${buildReportBucketColumnsSql("counts")},
  to_char(coverage.history_from, 'YYYY-MM-DD') AS history_from,
  to_char(clock.latest_complete_date, 'YYYY-MM-DD') AS latest_complete_date,
  CASE WHEN counts.selected_from >= coverage.history_from
    AND counts.selected_from <= clock.latest_complete_date
    THEN counts.cohort_users END AS cohort_users,
  CASE WHEN ${buildRetentionMatureSql("counts", "w1")}
    AND counts.cohort_users > 0 THEN counts.w1_returned END AS w1_returned,
  CASE WHEN ${buildRetentionMatureSql("counts", "w4")}
    AND counts.cohort_users > 0 THEN counts.w4_returned END AS w4_returned
FROM cohort_counts AS counts
CROSS JOIN activity_coverage AS coverage
CROSS JOIN activity_clock AS clock
ORDER BY counts.bucket_date`;
}

export async function loadWhoCameBackReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  signal: AbortSignal,
): Promise<WhoCameBackReport> {
  const response = await runAdminQuery(config, buildWhoCameBackSql(dateRange, period), signal);
  const result = response.resultSets[0];
  const firstRow = result?.rows[0];
  if (response.resultSets.length !== 1 || result === undefined || firstRow === undefined) {
    throw new Error(`${reportLabel} must return one result set with at least one cohort.`);
  }
  return {
    generatedAtUtc: response.executedAtUtc,
    period,
    historyFrom: firstRow.history_from === null ? null : parseActivityDate(firstRow.history_from ?? null, reportLabel, "history_from"),
    latestCompleteDate: parseActivityDate(firstRow.latest_complete_date ?? null, reportLabel, "latest_complete_date"),
    cohorts: result.rows.map((row) => {
      const base = parseActivityCount(row.cohort_users ?? null, reportLabel, "cohort_users");
      const w1Returned = parseActivityCount(row.w1_returned ?? null, reportLabel, "w1_returned");
      const w4Returned = parseActivityCount(row.w4_returned ?? null, reportLabel, "w4_returned");
      if ((w1Returned !== null && (base === null || base === 0 || w1Returned > base))
        || (w4Returned !== null && (base === null || base === 0 || w4Returned > base))) {
        throw new Error(`${reportLabel} returned users cannot exceed the cohort size.`);
      }
      return {
        bucket: parseReportBucket(row, reportLabel),
        cohortUsers: base,
        w1: w1Returned === null || base === null ? null : { returned: w1Returned, base },
        w4: w4Returned === null || base === null ? null : { returned: w4Returned, base },
      };
    }),
  };
}

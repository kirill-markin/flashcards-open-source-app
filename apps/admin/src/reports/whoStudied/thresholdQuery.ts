import { runAdminQuery, type ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { parseDailyNewReturningReport, type DailyNewReturningReport } from "../dailyNewReturning/query";
import { buildMeaningfulActivityCtesSql, buildMeaningfulRangeReviewsCteSql } from "../levelOneMetrics/meaningfulActivitySql";
import { buildReportBucketColumnsSql, buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange } from "../reportValues";
import { buildLastAppOpenVersionPeopleCtesSql } from "../whoOpenedTheApp/appOpenActivitySql";

export const studyReviewThresholds = [1, 2, 9] as const;
export type StudyReviewThreshold = (typeof studyReviewThresholds)[number];

const thresholdColumns = studyReviewThresholds.map((threshold) => ({
  threshold,
  newUsers: `new_users_${threshold}`,
  returningUsers: `returning_users_${threshold}`,
}));

export function buildWhoStudiedThresholdsSql(
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  appVersions: ReadonlyArray<string>,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const isVersionNarrowed = appVersions.length > 0;
  const appVersionPeopleCtesSql = isVersionNarrowed
    ? `, ${buildLastAppOpenVersionPeopleCtesSql(period, range, eventPlatforms, appVersions)}`
    : "";
  const appVersionPeopleJoinSql = isVersionNarrowed ? "\n  JOIN app_version_people USING (bucket_date, actor_id)" : "";
  const thresholdCountsSql = thresholdColumns.map(({ threshold, newUsers, returningUsers }) => `CASE WHEN buckets.selected_from >= coverage.history_from THEN
    COUNT(*) FILTER (WHERE first_use.first_use_date >= buckets.selected_from AND people.max_daily_reviews >= ${threshold}) END AS ${newUsers},
  CASE WHEN buckets.selected_from >= coverage.history_from THEN
    COUNT(*) FILTER (WHERE first_use.first_use_date < buckets.selected_from AND people.max_daily_reviews >= ${threshold}) END AS ${returningUsers}`).join(",\n  ");
  return `WITH ${buildMeaningfulActivityCtesSql()}, ${buildReportBucketsCteSql(period, range)}, ${buildMeaningfulRangeReviewsCteSql(period, range, eventPlatforms)}${appVersionPeopleCtesSql}, daily_review_counts AS (
  SELECT bucket_date, actor_id, COUNT(*) AS review_count
  FROM meaningful_range_reviews
  GROUP BY bucket_date, actor_id, activity_date
), bucket_people AS (
  SELECT bucket_date, actor_id, MAX(review_count) AS max_daily_reviews
  FROM daily_review_counts${appVersionPeopleJoinSql}
  GROUP BY bucket_date, actor_id
)
SELECT ${buildReportBucketColumnsSql("buckets")},
  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,
  ${thresholdCountsSql}
FROM report_buckets AS buckets
CROSS JOIN activity_coverage AS coverage
LEFT JOIN bucket_people AS people USING (bucket_date)
LEFT JOIN actor_first_use AS first_use USING (actor_id)
GROUP BY buckets.bucket_date, buckets.selected_from, buckets.selected_to, coverage.history_from
ORDER BY buckets.bucket_date`;
}

export async function loadWhoStudiedThresholdReports(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  appVersions: ReadonlyArray<string>,
  reportLabel: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<Readonly<{ threshold: StudyReviewThreshold; report: DailyNewReturningReport }>>> {
  const sql = buildWhoStudiedThresholdsSql(dateRange, period, eventPlatforms, appVersions, reportLabel);
  const response = await runAdminQuery(config, sql, signal);
  return thresholdColumns.map(({ threshold, ...countColumns }) => ({
    threshold,
    report: parseDailyNewReturningReport(response, period, `${reportLabel} (${threshold}+ reviews per day)`, countColumns),
  }));
}

import type { ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildAppVersionsFilterSql } from "../../filters/filterSql";
import { loadBreakdownReport } from "../levelOneMetrics/breakdownQuery";
import { liveSourceBarFreshness, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildMeaningfulActivityCtesSql, buildMeaningfulLastReviewsCteSql } from "../levelOneMetrics/meaningfulActivitySql";
import { buildPeopleBreakdownSql, type PeopleBreakdownDimension } from "../levelOneMetrics/peopleBreakdownQuery";
import { buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange } from "../reportValues";
import { buildAppOpenActivityCtesSql, buildAppOpenLastOpensCteSql } from "../whoOpenedTheApp/appOpenActivitySql";

// Each person under the platform of their last answered review on a selected platform in the bar.
// `review_answered` is server-derived and stores no interface language, client trust level or app
// version, so those come from the person's last app open on a selected platform in the same bar, NULL
// when they opened none there. An app version selection keeps only the people whose last app open
// there is on a selected version, as Who studied counts them.
export function buildWhoStudiedBreakdownSql(
  dimension: PeopleBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  appVersions: ReadonlyArray<string>,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const lastOpenJoinSql = appVersions.length === 0
    ? "LEFT JOIN app_open_last_opens AS last_open USING (bucket_date, actor_id)"
    : `JOIN app_open_last_opens AS last_open USING (bucket_date, actor_id)
  WHERE ${buildAppVersionsFilterSql("last_open.app_version", appVersions)}`;
  return buildPeopleBreakdownSql({
    ctesSql: `${buildMeaningfulActivityCtesSql()}, ${buildAppOpenActivityCtesSql()}, ${buildReportBucketsCteSql(period, range)}, ${buildMeaningfulLastReviewsCteSql(period, range, eventPlatforms)}, ${buildAppOpenLastOpensCteSql(period, range, eventPlatforms, [])}, studied_placements AS (
  SELECT last_review.bucket_date, last_review.actor_id, last_review.platform,
    last_open.ui_locale, last_open.trust_level, last_open.app_version
  FROM meaningful_last_reviews AS last_review
  ${lastOpenJoinSql}
)`,
    placementsCte: "studied_placements",
    coverageCte: "activity_coverage",
  }, dimension, range);
}

export function loadWhoStudiedBreakdownReport(
  config: AdminAppConfig,
  dimension: PeopleBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  appVersions: ReadonlyArray<string>,
  reportLabel: string,
  signal: AbortSignal,
): Promise<BreakdownReport> {
  return loadBreakdownReport(config, buildWhoStudiedBreakdownSql(dimension, dateRange, period, eventPlatforms, appVersions, reportLabel), period, reportLabel, liveSourceBarFreshness, signal);
}

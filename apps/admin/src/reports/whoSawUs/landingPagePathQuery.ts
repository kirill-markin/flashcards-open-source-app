import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange, SiteVisitorFilterState } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import { buildBreakdownSql, buildBreakdownValueSql, loadBreakdownReport } from "../levelOneMetrics/breakdownQuery";
import { liveSourceBarFreshness, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertIsString, assertValidDateRange } from "../reportValues";
import { buildSitePageKindSql, loadTopMeasuredValues, type ValueVisitors } from "./breakdownQuery";
import { buildSiteFirstViewsCtesSql, buildSiteMeasuredBucketsCteSql } from "./engagedVisitorsQuery";

export const topLandingPageKindCount = 3;

/**
 * `landing_views(bucket_date, page_kind, page_path)`: exactly the first page views the landing page
 * type breakdown counts, each keeping its own path. A kind is filtered only after the
 * first view is picked, so its rows here are that chart's segment.
 */
function buildLandingViewsCtesSql(
  range: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
): string {
  return `${buildSiteFirstViewsCtesSql((rowAlias) => `${buildSitePageKindSql(rowAlias)} AS page_kind,
      ${rowAlias}.event_properties ->> 'page_path' AS page_path`, range, period, siteFilters)}, landing_views AS (
  SELECT bucket_date, page_kind, page_path FROM identified_first_views
  UNION ALL
  SELECT bucket_date, page_kind, page_path FROM hashed_first_views
)`;
}

/**
 * The landing page kinds with the most visitors over the selection, most first, among kinds whose
 * landing views name more than one page: a single-page kind has nothing to split.
 */
export async function loadTopLandingPageKinds(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
  reportLabel: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<string>> {
  const range = assertValidDateRange(dateRange, reportLabel);
  const response = await runAdminQuery(config, `WITH ${buildLandingViewsCtesSql(range, period, siteFilters)}
SELECT page_kind
FROM landing_views
GROUP BY page_kind
HAVING COUNT(DISTINCT page_path) > 1
ORDER BY COUNT(*) DESC, page_kind
LIMIT ${topLandingPageKindCount}`, signal);
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }
  return result.rows.map((row) => assertIsString(row.page_kind ?? null, reportLabel, "page_kind"));
}

/**
 * `measured_values` of the `pageKind` by-page chart: its visitors, each under the `page_path` of
 * their first view, so a page's weight there is what that chart ranks it by.
 */
function buildLandingPagePathValuesCtesSql(
  pageKind: string,
  range: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
): string {
  return `${buildLandingViewsCtesSql(range, period, siteFilters)}, measured_values AS (
  SELECT bucket_date, ${buildBreakdownValueSql("page_path")} AS dimension_value, 1 AS value_count
  FROM landing_views
  WHERE page_kind = ${escapeSqlStringLiteral(pageKind)}
)`;
}

/** The visitors who landed on a page of `pageKind`, each under that page's `page_path`. */
export async function loadLandingPagePathReport(
  config: AdminAppConfig,
  pageKind: string,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
  reportLabel: string,
  signal: AbortSignal,
): Promise<BreakdownReport> {
  const range = assertValidDateRange(dateRange, reportLabel);
  // Bars are available as on the landing page type chart, so both agree.
  const sql = buildBreakdownSql(`${buildReportBucketsCteSql(period, range)}, ${buildLandingPagePathValuesCtesSql(pageKind, range, period, siteFilters)}, ${buildSiteMeasuredBucketsCteSql(period)}`);
  return loadBreakdownReport(config, sql, period, reportLabel, liveSourceBarFreshness, signal);
}

/** The pages of the `pageKind` by-page chart with the most visitors over the selection, in that chart's order. */
export async function loadTopLandingPages(
  config: AdminAppConfig,
  pageKind: string,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
  reportLabel: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<ValueVisitors>> {
  const range = assertValidDateRange(dateRange, reportLabel);
  return loadTopMeasuredValues(config, buildLandingPagePathValuesCtesSql(pageKind, range, period, siteFilters), reportLabel, signal);
}

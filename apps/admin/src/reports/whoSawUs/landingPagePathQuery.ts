import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import { buildBreakdownSql, buildBreakdownValueSql, loadBreakdownReport } from "../levelOneMetrics/breakdownQuery";
import { liveSourceBarFreshness, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertIsString, assertValidDateRange } from "../reportValues";
import { buildSiteFirstViewsCtesSql, buildSitePageKindSql } from "./breakdownQuery";

const topLandingPageKindCount = 3;

/**
 * `landing_views(bucket_date, page_kind, page_path)`: exactly the first page views the
 * `web-landing-page-type` breakdown counts, each keeping its own path. A kind is filtered only after
 * the first view is picked, so its rows here are that chart's segment.
 */
function buildLandingViewsCtesSql(range: AnalyticsDateRange, period: ReportPeriod): string {
  return `${buildSiteFirstViewsCtesSql((rowAlias) => `${buildSitePageKindSql(rowAlias)} AS page_kind,
    ${rowAlias}.event_properties ->> 'page_path' AS page_path`, range, period)}, landing_views AS (
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
  reportLabel: string,
): Promise<ReadonlyArray<string>> {
  const range = assertValidDateRange(dateRange, reportLabel);
  const response = await runAdminQuery(config, `WITH ${buildLandingViewsCtesSql(range, period)}
SELECT page_kind
FROM landing_views
GROUP BY page_kind
HAVING COUNT(DISTINCT page_path) > 1
ORDER BY COUNT(*) DESC, page_kind
LIMIT ${topLandingPageKindCount}`);
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }
  return result.rows.map((row) => assertIsString(row.page_kind ?? null, reportLabel, "page_kind"));
}

/** The visitors who landed on a page of `pageKind`, each under that page's `page_path`. */
export async function loadLandingPagePathReport(
  config: AdminAppConfig,
  pageKind: string,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): Promise<BreakdownReport> {
  const range = assertValidDateRange(dateRange, reportLabel);
  // Bars are available over every landing view, as on the landing page type chart, so both agree.
  const sql = buildBreakdownSql(`${buildReportBucketsCteSql(period, range)}, ${buildLandingViewsCtesSql(range, period)}, measured_values AS (
  SELECT bucket_date, ${buildBreakdownValueSql("page_path")} AS dimension_value, 1 AS value_count
  FROM landing_views
  WHERE page_kind = ${escapeSqlStringLiteral(pageKind)}
), measured_buckets AS (
  SELECT DISTINCT bucket_date FROM landing_views
)`);
  return loadBreakdownReport(config, sql, period, reportLabel, liveSourceBarFreshness);
}

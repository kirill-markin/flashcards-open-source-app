import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange, SiteVisitorFilterState } from "../../filters/analyticsFilters";
import {
  buildBreakdownSql,
  buildBreakdownValueSql,
  loadBreakdownReport,
  parseBreakdownReport,
} from "../levelOneMetrics/breakdownQuery";
import { liveSourceBarFreshness, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildReportBucketSql, buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertIsString, assertValidDateRange, toInteger } from "../reportValues";
import { buildSiteFirstViewsCtesSql, buildSiteMeasuredBucketsCteSql } from "./engagedVisitorsQuery";
import { buildAppleProductPageViewRowSqlLines, buildStoreReportDateRangeSqlLines, loadStoreDelivery } from "./query";
import { buildSiteDeviceCategorySql, buildSiteSourceSql } from "./siteFactSql";
import { getStoreBarFreshness } from "./storeDataFreshness";

export const whoSawUsBreakdownDimensions = [
  "web-engaged-country",
  "web-engaged-landing-page-type",
  "web-engaged-device",
  "web-engaged-source",
  "web-engaged-browser-language",
  "web-engaged-browser-locale",
  "web-engaged-referrer",
  "web-engaged-utm-campaign",
  "app-store-source-type",
  "app-store-territory",
] as const;

export type WhoSawUsBreakdownDimension = (typeof whoSawUsBreakdownDimensions)[number];

// Shared so the landing page path charts split exactly the segments of `web-engaged-landing-page-type`.
export function buildSitePageKindSql(rowAlias: string): string {
  return `${rowAlias}.event_properties ->> 'page_kind'`;
}

// The language subtag of the browser locale, so `en-US`, `en_GB` and `en` are all `en`.
function buildSiteBrowserLanguageSql(rowAlias: string): string {
  return `lower(split_part(translate(${rowAlias}.device_locale, '_', '-'), '-', 1))`;
}

// Tokens hold no spaces or parentheses, so neither the separator nor `(none)` can be read as part of one.
function buildSiteUtmCampaignSql(rowAlias: string): string {
  const tokenSqls = ["utm_source", "utm_medium", "utm_campaign"].map((key) => `${rowAlias}.event_properties ->> '${key}'`);
  return `CASE WHEN COALESCE(${tokenSqls.join(", ")}) IS NOT NULL
    THEN concat_ws(' / ', ${tokenSqls.map((tokenSql) => `COALESCE(${tokenSql}, '(none)')`).join(", ")}) END`;
}

/**
 * The `web` series' visitors, each under the value `valueSqlOf` reads off their first page view, so
 * a bar sums to the series' bar.
 */
function buildSiteMeasuredCtesSql(
  valueSqlOf: (rowAlias: string) => string,
  range: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
): string {
  return `${buildSiteFirstViewsCtesSql((rowAlias) => `${buildBreakdownValueSql(valueSqlOf(rowAlias))} AS dimension_value`, range, period, siteFilters)}, measured_values AS (
  SELECT bucket_date, dimension_value, 1 AS value_count FROM identified_first_views
  UNION ALL
  SELECT bucket_date, dimension_value, 1 AS value_count FROM hashed_first_views
), ${buildSiteMeasuredBucketsCteSql(period)}`;
}

/** The `app-store` series' rows, each summed under its own `column`. */
function buildAppleMeasuredCtesSql(
  column: "source_type" | "territory",
  range: AnalyticsDateRange,
  period: ReportPeriod,
): string {
  return `measured_values AS (
  SELECT ${buildReportBucketSql(period, "engagement.report_date")} AS bucket_date,
    ${buildBreakdownValueSql(`engagement.${column}`)} AS dimension_value,
    engagement.unique_counts AS value_count
  FROM store_analytics.apple_discovery_engagement AS engagement
  WHERE ${[...buildAppleProductPageViewRowSqlLines("engagement", "unique_counts"), ...buildStoreReportDateRangeSqlLines("engagement", range)].join("\n    AND ")}
  UNION ALL
  SELECT ${buildReportBucketSql(period, "preview.report_date")} AS bucket_date,
    ${buildBreakdownValueSql(`preview.${column}`)} AS dimension_value,
    preview.counts AS value_count
  FROM store_analytics.apple_web_preview_engagement AS preview
  WHERE ${[...buildAppleProductPageViewRowSqlLines("preview", "counts"), ...buildStoreReportDateRangeSqlLines("preview", range)].join("\n    AND ")}
), measured_buckets AS (
  SELECT DISTINCT bucket_date FROM measured_values
)`;
}

// A bar is available when its source has a row on any of its days, as in the Who saw us chart.
// `siteFilters` narrows the website's visitors; the App Store rows carry nothing it could narrow.
function buildMeasuredCtesSql(
  dimension: WhoSawUsBreakdownDimension,
  range: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
): string {
  switch (dimension) {
    case "web-engaged-country":
      return buildSiteMeasuredCtesSql((rowAlias) => `${rowAlias}.country`, range, period, siteFilters);
    case "web-engaged-landing-page-type":
      return buildSiteMeasuredCtesSql(buildSitePageKindSql, range, period, siteFilters);
    case "web-engaged-device":
      return buildSiteMeasuredCtesSql(buildSiteDeviceCategorySql, range, period, siteFilters);
    case "web-engaged-source":
      return buildSiteMeasuredCtesSql(buildSiteSourceSql, range, period, siteFilters);
    case "web-engaged-browser-language":
      return buildSiteMeasuredCtesSql(buildSiteBrowserLanguageSql, range, period, siteFilters);
    case "web-engaged-browser-locale":
      return buildSiteMeasuredCtesSql((rowAlias) => `${rowAlias}.device_locale`, range, period, siteFilters);
    case "web-engaged-referrer":
      return buildSiteMeasuredCtesSql((rowAlias) => `${rowAlias}.event_properties ->> 'referrer_host'`, range, period, siteFilters);
    case "web-engaged-utm-campaign":
      return buildSiteMeasuredCtesSql(buildSiteUtmCampaignSql, range, period, siteFilters);
    case "app-store-source-type":
      return buildAppleMeasuredCtesSql("source_type", range, period);
    case "app-store-territory":
      return buildAppleMeasuredCtesSql("territory", range, period);
  }
}

export function buildWhoSawUsBreakdownSql(
  dimension: WhoSawUsBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return buildBreakdownSql(`${buildReportBucketsCteSql(period, range)}, ${buildMeasuredCtesSql(dimension, range, period, siteFilters)}`);
}

/** App Store bars carry the App Store's freshness; the website is recorded live. */
export async function loadWhoSawUsBreakdownReport(
  config: AdminAppConfig,
  dimension: WhoSawUsBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
  reportLabel: string,
  signal: AbortSignal,
): Promise<BreakdownReport> {
  const sql = buildWhoSawUsBreakdownSql(dimension, dateRange, period, siteFilters, reportLabel);
  switch (dimension) {
    case "web-engaged-country":
    case "web-engaged-landing-page-type":
    case "web-engaged-device":
    case "web-engaged-source":
    case "web-engaged-browser-language":
    case "web-engaged-browser-locale":
    case "web-engaged-referrer":
    case "web-engaged-utm-campaign":
      return loadBreakdownReport(config, sql, period, reportLabel, liveSourceBarFreshness, signal);
    case "app-store-source-type":
    case "app-store-territory": {
      const [response, storeDelivery] = await Promise.all([runAdminQuery(config, sql, signal), loadStoreDelivery(config, signal)]);
      return parseBreakdownReport(response, period, reportLabel, (bucket) => getStoreBarFreshness("app-store", storeDelivery, bucket));
    }
  }
}

export const topValueCount = 20;

export type ValueVisitors = Readonly<{ value: string; visitors: number }>;

/**
 * Over `measuredValuesCtesSql`, CTEs ending in a breakdown's `measured_values`, its values with the
 * most visitors summed over its bars, in the order `buildSeriesRankCtesSql` ranks that chart's
 * values, so the first five are its coloured ones.
 */
export async function loadTopMeasuredValues(
  config: AdminAppConfig,
  measuredValuesCtesSql: string,
  reportLabel: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<ValueVisitors>> {
  const response = await runAdminQuery(config, `WITH ${measuredValuesCtesSql}
SELECT dimension_value, SUM(value_count) AS visitors
FROM measured_values
GROUP BY dimension_value
HAVING SUM(value_count) > 0
ORDER BY SUM(value_count) DESC, dimension_value
LIMIT ${topValueCount}`, signal);
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }
  return result.rows.map((row) => ({
    value: assertIsString(row.dimension_value ?? null, reportLabel, "dimension_value"),
    visitors: toInteger(row.visitors ?? null, reportLabel, "visitors"),
  }));
}

/** The values of the `dimension` breakdown with the most visitors over the selection, in that chart's order. */
export async function loadWhoSawUsTopValues(
  config: AdminAppConfig,
  dimension: WhoSawUsBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
  reportLabel: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<ValueVisitors>> {
  const range = assertValidDateRange(dateRange, reportLabel);
  return loadTopMeasuredValues(config, buildMeasuredCtesSql(dimension, range, period, siteFilters), reportLabel, signal);
}

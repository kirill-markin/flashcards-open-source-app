import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildHashedVisitorDaySql } from "../funnels/funnelAudienceSql";
import {
  buildBreakdownSql,
  buildBreakdownValueSql,
  loadBreakdownReport,
  parseBreakdownReport,
} from "../levelOneMetrics/breakdownQuery";
import { liveSourceBarFreshness, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildReportBucketSql, buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange } from "../reportValues";
import {
  buildAppleProductPageViewRowSqlLines,
  buildHashedSiteViewFilterSql,
  buildIdentifiedSiteViewFilterSql,
  buildStoreReportDateRangeSqlLines,
  loadStoreDelivery,
} from "./query";
import { getStoreBarFreshness } from "./storeDataFreshness";

export const whoSawUsBreakdownDimensions = [
  "web-country",
  "web-landing-page-type",
  "app-store-source-type",
  "app-store-territory",
] as const;

export type WhoSawUsBreakdownDimension = (typeof whoSawUsBreakdownDimensions)[number];

/**
 * The first page view of each `web` series visitor in the unit the series counts them once in: the
 * bucket for an identified visitor, the hash day for a cookieless one. Two CTEs,
 * `identified_first_views` and `hashed_first_views`, each a `bucket_date` plus the columns
 * `columnsSqlOf` selects off the view.
 */
export function buildSiteFirstViewsCtesSql(
  columnsSqlOf: (rowAlias: string) => string,
  range: AnalyticsDateRange,
  period: ReportPeriod,
): string {
  const identifiedBucketSql = buildReportBucketSql(period, "(site_view.occurred_at AT TIME ZONE 'UTC')::date");
  const hashedVisitorDaySql = buildHashedVisitorDaySql("hashed_view");
  return `identified_first_views AS (
  SELECT DISTINCT ON (${identifiedBucketSql}, site_view.actor_id)
    ${identifiedBucketSql} AS bucket_date,
    ${columnsSqlOf("site_view")}
  FROM analytics.product_events_resolved AS site_view
  WHERE ${buildIdentifiedSiteViewFilterSql("site_view", range)}
  ORDER BY ${identifiedBucketSql}, site_view.actor_id, site_view.occurred_at, site_view.event_id
), hashed_first_views AS (
  SELECT DISTINCT ON (${hashedVisitorDaySql}, hashed_view.daily_visitor_hash)
    ${buildReportBucketSql(period, hashedVisitorDaySql)} AS bucket_date,
    ${columnsSqlOf("hashed_view")}
  FROM analytics.product_events_resolved AS hashed_view
  WHERE ${buildHashedSiteViewFilterSql("hashed_view", range)}
  ORDER BY ${hashedVisitorDaySql}, hashed_view.daily_visitor_hash, hashed_view.occurred_at, hashed_view.event_id
)`;
}

// Shared so the landing page path charts split exactly the segments of `web-landing-page-type`.
export function buildSitePageKindSql(rowAlias: string): string {
  return `${rowAlias}.event_properties ->> 'page_kind'`;
}

/**
 * The `web` series' visitors, each under the value `valueSqlOf` reads off their first page view, so
 * a bar sums to the series' bar.
 */
function buildSiteMeasuredValuesSql(
  valueSqlOf: (rowAlias: string) => string,
  range: AnalyticsDateRange,
  period: ReportPeriod,
): string {
  return `${buildSiteFirstViewsCtesSql((rowAlias) => `${buildBreakdownValueSql(valueSqlOf(rowAlias))} AS dimension_value`, range, period)}, measured_values AS (
  SELECT bucket_date, dimension_value, 1 AS value_count FROM identified_first_views
  UNION ALL
  SELECT bucket_date, dimension_value, 1 AS value_count FROM hashed_first_views
)`;
}

/** The `app-store` series' rows, each summed under its own `column`. */
function buildAppleMeasuredValuesSql(
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
)`;
}

function buildMeasuredValuesSql(
  dimension: WhoSawUsBreakdownDimension,
  range: AnalyticsDateRange,
  period: ReportPeriod,
): string {
  switch (dimension) {
    case "web-country":
      return buildSiteMeasuredValuesSql((rowAlias) => `${rowAlias}.country`, range, period);
    case "web-landing-page-type":
      return buildSiteMeasuredValuesSql(buildSitePageKindSql, range, period);
    case "app-store-source-type":
      return buildAppleMeasuredValuesSql("source_type", range, period);
    case "app-store-territory":
      return buildAppleMeasuredValuesSql("territory", range, period);
  }
}

// A bar is available when its source has a row on any of its days, as in the Who saw us chart.
export function buildWhoSawUsBreakdownSql(
  dimension: WhoSawUsBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return buildBreakdownSql(`${buildReportBucketsCteSql(period, range)}, ${buildMeasuredValuesSql(dimension, range, period)}, measured_buckets AS (
  SELECT DISTINCT bucket_date FROM measured_values
)`);
}

/** App Store bars carry the App Store's freshness; the website is recorded live. */
export async function loadWhoSawUsBreakdownReport(
  config: AdminAppConfig,
  dimension: WhoSawUsBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
  signal: AbortSignal,
): Promise<BreakdownReport> {
  const sql = buildWhoSawUsBreakdownSql(dimension, dateRange, period, reportLabel);
  switch (dimension) {
    case "web-country":
    case "web-landing-page-type":
      return loadBreakdownReport(config, sql, period, reportLabel, liveSourceBarFreshness, signal);
    case "app-store-source-type":
    case "app-store-territory": {
      const [response, storeDelivery] = await Promise.all([runAdminQuery(config, sql, signal), loadStoreDelivery(config, signal)]);
      return parseBreakdownReport(response, period, reportLabel, (bucket) => getStoreBarFreshness("app-store", storeDelivery, bucket));
    }
  }
}

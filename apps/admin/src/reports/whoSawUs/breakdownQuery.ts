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
import { buildSiteVisitorDaysCtesSql } from "./engagedVisitorsQuery";
import { buildAppleProductPageViewRowSqlLines, buildStoreReportDateRangeSqlLines, loadStoreDelivery } from "./query";
import { buildHashedSiteViewFilterSql, buildIdentifiedSiteViewFilterSql } from "./siteFactSql";
import { getStoreBarFreshness } from "./storeDataFreshness";

export const whoSawUsBreakdownDimensions = [
  "web-engaged-country",
  "web-engaged-landing-page-type",
  "app-store-source-type",
  "app-store-territory",
] as const;

export type WhoSawUsBreakdownDimension = (typeof whoSawUsBreakdownDimensions)[number];

/**
 * Over `buildSiteVisitorDaysCtesSql`'s CTEs, the visitors the `web` series counts, keyed
 * as `buildSiteFirstViewsCtesSql` counts a visitor once: `engaged_identified_visitors(bucket_date,
 * actor_id)`, engaged on a day of that bucket, and `engaged_hashed_visitors(daily_visitor_hash,
 * visit_date)`, engaged on that hash day.
 */
export function buildSiteEngagedVisitorKeysCtesSql(range: AnalyticsDateRange, period: ReportPeriod): string {
  return `${buildSiteVisitorDaysCtesSql(range)}, engaged_identified_visitors AS MATERIALIZED (
  SELECT DISTINCT ${buildReportBucketSql(period, "visit_date")} AS bucket_date, actor_id
  FROM identified_visitor_days
  WHERE is_engaged
), engaged_hashed_visitors AS MATERIALIZED (
  SELECT daily_visitor_hash, visit_date
  FROM hashed_visitor_days
  WHERE is_engaged
)`;
}

/**
 * The first page view of each `web` series visitor in the unit the series counts them once in: the
 * bucket for an identified visitor, the hash day for a cookieless one. Two CTEs,
 * `identified_first_views` and `hashed_first_views`, each a `bucket_date` plus the columns
 * `columnsSqlOf` selects off the view. Engagement keeps or drops a visitor's views whole, by
 * `buildSiteEngagedVisitorKeysCtesSql`, so their first view is their first page view of that unit.
 */
export function buildSiteFirstViewsCtesSql(
  columnsSqlOf: (rowAlias: string) => string,
  range: AnalyticsDateRange,
  period: ReportPeriod,
): string {
  const identifiedBucketSql = buildReportBucketSql(period, "(site_view.occurred_at AT TIME ZONE 'UTC')::date");
  const hashedVisitorDaySql = buildHashedVisitorDaySql("hashed_view");
  return `${buildSiteEngagedVisitorKeysCtesSql(range, period)}, identified_first_views AS (
  SELECT DISTINCT ON (${identifiedBucketSql}, site_view.actor_id)
    ${identifiedBucketSql} AS bucket_date,
    ${columnsSqlOf("site_view")}
  FROM analytics.product_events_resolved AS site_view
  WHERE ${buildIdentifiedSiteViewFilterSql("site_view", range)}
  AND (${identifiedBucketSql}, site_view.actor_id) IN (SELECT bucket_date, actor_id FROM engaged_identified_visitors)
  ORDER BY ${identifiedBucketSql}, site_view.actor_id, site_view.occurred_at, site_view.event_id
), hashed_first_views AS (
  SELECT DISTINCT ON (${hashedVisitorDaySql}, hashed_view.daily_visitor_hash)
    ${buildReportBucketSql(period, hashedVisitorDaySql)} AS bucket_date,
    ${columnsSqlOf("hashed_view")}
  FROM analytics.product_events_resolved AS hashed_view
  WHERE ${buildHashedSiteViewFilterSql("hashed_view", range)}
  AND (hashed_view.daily_visitor_hash, ${hashedVisitorDaySql}) IN (SELECT daily_visitor_hash, visit_date FROM engaged_hashed_visitors)
  ORDER BY ${hashedVisitorDaySql}, hashed_view.daily_visitor_hash, hashed_view.occurred_at, hashed_view.event_id
)`;
}

/**
 * `measured_buckets` over `buildSiteVisitorDaysCtesSql`'s CTEs: the bars with a site visitor-day,
 * engaged or not, so a bar without an engaged visitor counts zero, as on the `web` series.
 */
export function buildSiteMeasuredBucketsCteSql(period: ReportPeriod): string {
  return `measured_buckets AS (
  SELECT ${buildReportBucketSql(period, "visit_date")} AS bucket_date FROM identified_visitor_days
  UNION
  SELECT ${buildReportBucketSql(period, "visit_date")} AS bucket_date FROM hashed_visitor_days
)`;
}

// Shared so the landing page path charts split exactly the segments of `web-engaged-landing-page-type`.
export function buildSitePageKindSql(rowAlias: string): string {
  return `${rowAlias}.event_properties ->> 'page_kind'`;
}

/**
 * The `web` series' visitors, each under the value `valueSqlOf` reads off their first page view, so
 * a bar sums to the series' bar.
 */
function buildSiteMeasuredCtesSql(
  valueSqlOf: (rowAlias: string) => string,
  range: AnalyticsDateRange,
  period: ReportPeriod,
): string {
  return `${buildSiteFirstViewsCtesSql((rowAlias) => `${buildBreakdownValueSql(valueSqlOf(rowAlias))} AS dimension_value`, range, period)}, measured_values AS (
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
function buildMeasuredCtesSql(
  dimension: WhoSawUsBreakdownDimension,
  range: AnalyticsDateRange,
  period: ReportPeriod,
): string {
  switch (dimension) {
    case "web-engaged-country":
      return buildSiteMeasuredCtesSql((rowAlias) => `${rowAlias}.country`, range, period);
    case "web-engaged-landing-page-type":
      return buildSiteMeasuredCtesSql(buildSitePageKindSql, range, period);
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
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return buildBreakdownSql(`${buildReportBucketsCteSql(period, range)}, ${buildMeasuredCtesSql(dimension, range, period)}`);
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
    case "web-engaged-country":
    case "web-engaged-landing-page-type":
      return loadBreakdownReport(config, sql, period, reportLabel, liveSourceBarFreshness, signal);
    case "app-store-source-type":
    case "app-store-territory": {
      const [response, storeDelivery] = await Promise.all([runAdminQuery(config, sql, signal), loadStoreDelivery(config, signal)]);
      return parseBreakdownReport(response, period, reportLabel, (bucket) => getStoreBarFreshness("app-store", storeDelivery, bucket));
    }
  }
}

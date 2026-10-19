import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildHashedVisitorDaySql } from "../funnels/funnelAudienceSql";
import { buildBreakdownSql, buildBreakdownValueSql, loadBreakdownReport } from "../levelOneMetrics/breakdownQuery";
import type { BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildReportBucketSql, buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange } from "../reportValues";
import {
  buildAppleProductPageViewRowSqlLines,
  buildHashedSiteViewFilterSql,
  buildIdentifiedSiteViewFilterSql,
  buildStoreReportDateRangeSqlLines,
} from "./query";

export const whoSawUsBreakdownDimensions = [
  "web-country",
  "web-landing-page-type",
  "app-store-source-type",
  "app-store-territory",
] as const;

export type WhoSawUsBreakdownDimension = (typeof whoSawUsBreakdownDimensions)[number];

/**
 * The `web` series' visitors, each under the value `valueSqlOf` reads off their first page view in the
 * unit the series counts them once in: the bucket for an identified visitor, the hash day for a
 * cookieless one. So a bar sums to the series' bar.
 */
function buildSiteMeasuredValuesSql(
  valueSqlOf: (rowAlias: string) => string,
  range: AnalyticsDateRange,
  period: ReportPeriod,
): string {
  const identifiedBucketSql = buildReportBucketSql(period, "(site_view.occurred_at AT TIME ZONE 'UTC')::date");
  const hashedVisitorDaySql = buildHashedVisitorDaySql("hashed_view");
  return `identified_first_views AS (
  SELECT DISTINCT ON (${identifiedBucketSql}, site_view.actor_id)
    ${identifiedBucketSql} AS bucket_date,
    ${buildBreakdownValueSql(valueSqlOf("site_view"))} AS dimension_value
  FROM analytics.product_events_resolved AS site_view
  WHERE ${buildIdentifiedSiteViewFilterSql("site_view", range)}
  ORDER BY ${identifiedBucketSql}, site_view.actor_id, site_view.occurred_at, site_view.event_id
), hashed_first_views AS (
  SELECT DISTINCT ON (${hashedVisitorDaySql}, hashed_view.daily_visitor_hash)
    ${buildReportBucketSql(period, hashedVisitorDaySql)} AS bucket_date,
    ${buildBreakdownValueSql(valueSqlOf("hashed_view"))} AS dimension_value
  FROM analytics.product_events_resolved AS hashed_view
  WHERE ${buildHashedSiteViewFilterSql("hashed_view", range)}
  ORDER BY ${hashedVisitorDaySql}, hashed_view.daily_visitor_hash, hashed_view.occurred_at, hashed_view.event_id
), measured_values AS (
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
      return buildSiteMeasuredValuesSql((rowAlias) => `${rowAlias}.event_properties ->> 'page_kind'`, range, period);
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

export function loadWhoSawUsBreakdownReport(
  config: AdminAppConfig,
  dimension: WhoSawUsBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): Promise<BreakdownReport> {
  return loadBreakdownReport(config, buildWhoSawUsBreakdownSql(dimension, dateRange, period, reportLabel), period, reportLabel);
}

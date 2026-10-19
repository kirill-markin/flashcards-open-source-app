import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildActorConnectionCountrySql } from "../../filters/filterSql";
import { buildBreakdownSql, buildBreakdownValueSql, loadBreakdownReport } from "../levelOneMetrics/breakdownQuery";
import type { BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange } from "../reportValues";
import { buildAppOpenActivityCtesSql, buildAppOpenLastOpensCteSql } from "./appOpenActivitySql";

export const appOpenBreakdownDimensions = ["platform", "country", "app-ui-language", "sign-in-state", "app-version"] as const;

export type AppOpenBreakdownDimension = (typeof appOpenBreakdownDimensions)[number];

/**
 * The dimension's value over `last_open`, a row of `app_open_last_opens`, NULL or empty when unknown.
 * Country is the exception to the last-open rule: the event's own `country` is never written, so it
 * is the one country `buildActorConnectionCountrySql` places the person in over the whole range.
 */
function buildDimensionSql(
  dimension: AppOpenBreakdownDimension,
  range: AnalyticsDateRange,
): Readonly<{ valueSql: string; joinSql: string }> {
  switch (dimension) {
    case "platform":
      return { valueSql: "last_open.platform", joinSql: "" };
    case "country":
      return {
        valueSql: "actor_country.country",
        joinSql: `LEFT JOIN (
${buildActorConnectionCountrySql(range)}
  ) AS actor_country ON actor_country.actor_id::text = last_open.actor_id`,
      };
    case "app-ui-language":
      return { valueSql: "last_open.ui_locale", joinSql: "" };
    case "sign-in-state":
      return {
        valueSql: `CASE last_open.trust_level WHEN 'guest_client' THEN 'Guest'
      WHEN 'authenticated_client' THEN 'Signed in' ELSE last_open.trust_level END`,
        joinSql: "",
      };
    case "app-version":
      return { valueSql: "last_open.app_version", joinSql: "" };
  }
}

// The people of each Who opened the app bar, each under one value, so a measured bar sums to that
// chart's new plus returning bar.
export function buildAppOpenBreakdownSql(
  dimension: AppOpenBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const dimensionSql = buildDimensionSql(dimension, range);
  return buildBreakdownSql(`${buildAppOpenActivityCtesSql()}, ${buildReportBucketsCteSql(period, range)}, ${buildAppOpenLastOpensCteSql(period, range)}, measured_buckets AS (
  SELECT buckets.bucket_date
  FROM report_buckets AS buckets
  CROSS JOIN app_open_coverage AS coverage
  WHERE buckets.selected_from >= coverage.history_from
), measured_values AS (
  SELECT last_open.bucket_date,
    ${buildBreakdownValueSql(dimensionSql.valueSql)} AS dimension_value,
    1 AS value_count
  FROM app_open_last_opens AS last_open
  JOIN measured_buckets USING (bucket_date)
  ${dimensionSql.joinSql}
)`);
}

export function loadAppOpenBreakdownReport(
  config: AdminAppConfig,
  dimension: AppOpenBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): Promise<BreakdownReport> {
  return loadBreakdownReport(config, buildAppOpenBreakdownSql(dimension, dateRange, period, reportLabel), period, reportLabel);
}

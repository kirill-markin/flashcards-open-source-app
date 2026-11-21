import type { ProductEventDeviceType, ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { loadBreakdownReport } from "../levelOneMetrics/breakdownQuery";
import { liveSourceBarFreshness, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildDeviceBreakdownSql } from "../levelOneMetrics/deviceBreakdownQuery";
import { buildPeopleBreakdownSql, type PeopleBreakdownDimension } from "../levelOneMetrics/peopleBreakdownQuery";
import { buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange } from "../reportValues";
import { buildAppOpenActivityCtesSql, buildAppOpenLastOpensCteSql, buildAppOpenRangeDevicesCteSql } from "./appOpenActivitySql";

// Each person under the values of their last app open on a selected platform, device class and version
// in the bar.
export function buildAppOpenBreakdownSql(
  dimension: PeopleBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  eventDeviceTypes: ReadonlyArray<ProductEventDeviceType>,
  appVersions: ReadonlyArray<string>,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return buildPeopleBreakdownSql({
    ctesSql: `${buildAppOpenActivityCtesSql()}, ${buildReportBucketsCteSql(period, range)}, ${buildAppOpenLastOpensCteSql(period, range, eventPlatforms, eventDeviceTypes, appVersions)}`,
    placementsCte: "app_open_last_opens",
    coverageCte: "app_open_coverage",
  }, dimension, range);
}

export function loadAppOpenBreakdownReport(
  config: AdminAppConfig,
  dimension: PeopleBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  eventDeviceTypes: ReadonlyArray<ProductEventDeviceType>,
  appVersions: ReadonlyArray<string>,
  reportLabel: string,
  signal: AbortSignal,
): Promise<BreakdownReport> {
  return loadBreakdownReport(config, buildAppOpenBreakdownSql(dimension, dateRange, period, eventPlatforms, eventDeviceTypes, appVersions, reportLabel), period, reportLabel, liveSourceBarFreshness, signal);
}

const deviceReportLabel = "Who opened the app by device report";

export function buildAppOpenDeviceBreakdownSql(
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  eventDeviceTypes: ReadonlyArray<ProductEventDeviceType>,
  appVersions: ReadonlyArray<string>,
): string {
  const range = assertValidDateRange(dateRange, deviceReportLabel);
  return buildDeviceBreakdownSql(`${buildAppOpenActivityCtesSql()},
${buildReportBucketsCteSql(period, range)},
${buildAppOpenRangeDevicesCteSql(period, range, eventPlatforms, eventDeviceTypes, appVersions)},
measured_buckets AS (
  SELECT buckets.bucket_date
  FROM report_buckets AS buckets
  CROSS JOIN app_open_coverage AS coverage
  WHERE buckets.selected_from >= coverage.history_from
), measured_values AS (
  SELECT opens.bucket_date, opens.device AS dimension_value,
    COUNT(DISTINCT opens.actor_id) AS value_count
  FROM app_open_range_devices AS opens
  JOIN measured_buckets USING (bucket_date)
  GROUP BY opens.bucket_date, opens.device
)`);
}

export function loadAppOpenDeviceBreakdownReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  eventDeviceTypes: ReadonlyArray<ProductEventDeviceType>,
  appVersions: ReadonlyArray<string>,
  signal: AbortSignal,
): Promise<BreakdownReport> {
  return loadBreakdownReport(
    config,
    buildAppOpenDeviceBreakdownSql(dateRange, period, eventPlatforms, eventDeviceTypes, appVersions),
    period,
    deviceReportLabel,
    liveSourceBarFreshness,
    signal,
  );
}

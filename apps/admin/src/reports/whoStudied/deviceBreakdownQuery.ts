import type { ProductEventDeviceType, ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { loadBreakdownReport } from "../levelOneMetrics/breakdownQuery";
import { liveSourceBarFreshness, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildDeviceBreakdownSql, buildEventDeviceSql } from "../levelOneMetrics/deviceBreakdownQuery";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange } from "../reportValues";
import { buildMeasuredReviewsCtesSql } from "./reviewEventsBreakdownQuery";

function buildReviewDeviceBreakdownLoader(
  countSql: string,
  reportLabel: string,
) {
  return function load(
    config: AdminAppConfig,
    dateRange: AnalyticsDateRange,
    period: ReportPeriod,
    eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
    eventDeviceTypes: ReadonlyArray<ProductEventDeviceType>,
    appVersions: ReadonlyArray<string>,
    signal: AbortSignal,
  ): Promise<BreakdownReport> {
    const range = assertValidDateRange(dateRange, reportLabel);
    const sql = buildDeviceBreakdownSql(`${buildMeasuredReviewsCtesSql(range, period, eventPlatforms, eventDeviceTypes, appVersions)}, review_devices AS (
  SELECT review.bucket_date, review.actor_id, ${buildEventDeviceSql("review", "NULL")} AS device
  FROM measured_reviews AS review
), measured_values AS (
  SELECT bucket_date, device AS dimension_value, ${countSql} AS value_count
  FROM review_devices
  WHERE device IS NOT NULL
  GROUP BY bucket_date, device
)`);
    return loadBreakdownReport(
      config,
      sql,
      period,
      reportLabel,
      liveSourceBarFreshness,
      signal,
    );
  };
}

export const loadWhoStudiedByDeviceReport = buildReviewDeviceBreakdownLoader("COUNT(DISTINCT actor_id)", "Who studied by device report");
export const loadReviewEventsByDeviceReport = buildReviewDeviceBreakdownLoader("COUNT(*)", "Review events by device report");

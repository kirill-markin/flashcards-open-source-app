import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { loadBreakdownReport } from "../levelOneMetrics/breakdownQuery";
import { liveSourceBarFreshness, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildPeopleBreakdownSql, type PeopleBreakdownDimension } from "../levelOneMetrics/peopleBreakdownQuery";
import { buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange } from "../reportValues";
import { buildAppOpenActivityCtesSql, buildAppOpenLastOpensCteSql } from "./appOpenActivitySql";

// Each person under the values of their last app open in the bar.
export function buildAppOpenBreakdownSql(
  dimension: PeopleBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return buildPeopleBreakdownSql({
    ctesSql: `${buildAppOpenActivityCtesSql()}, ${buildReportBucketsCteSql(period, range)}, ${buildAppOpenLastOpensCteSql(period, range)}`,
    placementsCte: "app_open_last_opens",
    coverageCte: "app_open_coverage",
  }, dimension, range);
}

export function loadAppOpenBreakdownReport(
  config: AdminAppConfig,
  dimension: PeopleBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): Promise<BreakdownReport> {
  return loadBreakdownReport(config, buildAppOpenBreakdownSql(dimension, dateRange, period, reportLabel), period, reportLabel, liveSourceBarFreshness);
}

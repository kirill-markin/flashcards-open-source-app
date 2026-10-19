import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { parseDateRange, readSingleParam, setDateRangeParams } from "../../filters/analyticsFiltersUrl";
import { findReportPeriod, type ReportPeriod } from "./reportPeriod";

// The Level 1 main and Details pages carry their selection in the same query string, so a shared
// link or a move between them keeps it. Like the shared filter codec, writing omits a default and
// reading falls back to it for a missing or malformed parameter.

export type LevelOneMetricsSelection = Readonly<{ dateRange: AnalyticsDateRange; period: ReportPeriod }>;

const periodParamName = "period";

const defaultLevelOneMetricsPeriod: ReportPeriod = "day";

export function parseLevelOneMetricsSelection(
  searchParams: URLSearchParams,
  availableRange: AnalyticsDateRange,
  defaultRange: AnalyticsDateRange,
): LevelOneMetricsSelection {
  const periodParam = readSingleParam(searchParams, periodParamName);
  const period = periodParam === undefined ? undefined : findReportPeriod(periodParam);
  return {
    dateRange: parseDateRange(searchParams, availableRange, defaultRange),
    period: period ?? defaultLevelOneMetricsPeriod,
  };
}

/** The query string of a selection, `""` for the default one. */
export function buildLevelOneMetricsSearch(
  selection: LevelOneMetricsSelection,
  defaultRange: AnalyticsDateRange,
): string {
  const searchParams = new URLSearchParams();
  setDateRangeParams(searchParams, selection.dateRange, defaultRange);
  if (selection.period !== defaultLevelOneMetricsPeriod) {
    searchParams.set(periodParamName, selection.period);
  }
  const serializedParams = searchParams.toString();
  return serializedParams === "" ? "" : `?${serializedParams}`;
}

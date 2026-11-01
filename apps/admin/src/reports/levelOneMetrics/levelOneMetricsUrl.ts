import type { ReviewEventPlatform } from "../../adminApi";
import type { AnalyticsDateRange, SiteVisitorFilterState } from "../../filters/analyticsFilters";
import {
  parseAppVersions,
  parseDateRange,
  parseEventPlatforms,
  parseProvisionalDateRange,
  parseSiteVisitorFilterState,
  readSingleParam,
  setAppVersionsParam,
  setDateRangeParams,
  setEventPlatformsParam,
  setSiteVisitorFilterParams,
} from "../../filters/analyticsFiltersUrl";
import { findReportPeriod, type ReportPeriod } from "./reportPeriod";

// The Level 1 main and Details pages carry their selection in the same query string, so a shared
// link or a move between them keeps it. Like the shared filter codec, writing omits a default and
// reading falls back to it for a missing or malformed parameter.

export type LevelOneMetricsSelection = Readonly<{
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  /** Applied on the main page and the charted Details pages, and carried by the Who saw us dataset pages. */
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>;
  /** Exact versions, `[]` for every version; carried and applied like `eventPlatforms`. */
  appVersions: ReadonlyArray<string>;
  /** Applied on the Web engaged page only, and carried by every Level 1 page so a move keeps them. */
  siteFilters: SiteVisitorFilterState;
}>;

const periodParamName = "period";

const defaultLevelOneMetricsPeriod: ReportPeriod = "day";

function parsePeriod(searchParams: URLSearchParams): ReportPeriod {
  const periodParam = readSingleParam(searchParams, periodParamName);
  const period = periodParam === undefined ? undefined : findReportPeriod(periodParam);
  return period ?? defaultLevelOneMetricsPeriod;
}

export function parseLevelOneMetricsSelection(
  searchParams: URLSearchParams,
  availableRange: AnalyticsDateRange,
  defaultRange: AnalyticsDateRange,
): LevelOneMetricsSelection {
  return {
    dateRange: parseDateRange(searchParams, availableRange, defaultRange),
    period: parsePeriod(searchParams),
    eventPlatforms: parseEventPlatforms(searchParams),
    appVersions: parseAppVersions(searchParams),
    siteFilters: parseSiteVisitorFilterState(searchParams),
  };
}

/** The selection the charts start on before the available range is known; see `parseProvisionalDateRange`. */
export function parseProvisionalLevelOneMetricsSelection(
  searchParams: URLSearchParams,
  todayUtc: string,
  provisionalDefaultRange: AnalyticsDateRange,
): LevelOneMetricsSelection {
  return {
    dateRange: parseProvisionalDateRange(searchParams, todayUtc) ?? provisionalDefaultRange,
    period: parsePeriod(searchParams),
    eventPlatforms: parseEventPlatforms(searchParams),
    appVersions: parseAppVersions(searchParams),
    siteFilters: parseSiteVisitorFilterState(searchParams),
  };
}

/** The query string of a selection, `""` for the default one. */
export function buildLevelOneMetricsSearch(
  selection: LevelOneMetricsSelection,
  defaultRange: AnalyticsDateRange,
): string {
  const searchParams = new URLSearchParams();
  setDateRangeParams(searchParams, selection.dateRange, defaultRange);
  setEventPlatformsParam(searchParams, selection.eventPlatforms);
  setAppVersionsParam(searchParams, selection.appVersions);
  setSiteVisitorFilterParams(searchParams, selection.siteFilters);
  if (selection.period !== defaultLevelOneMetricsPeriod) {
    searchParams.set(periodParamName, selection.period);
  }
  const serializedParams = searchParams.toString();
  return serializedParams === "" ? "" : `?${serializedParams}`;
}

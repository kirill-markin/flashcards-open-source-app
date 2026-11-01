// The URL codec for the Retention Details page's own Group by, following `../studyDepth/studyDepthUrl.ts`:
// the parameter belongs to that page, so `App.tsx` carries it over on that route only. The default
// writes no parameter, and an unknown, repeated or malformed value opens on the default. It shares
// the Level 1 `period` name, so a link to the former Level 1 retention Details page keeps an explicit
// Weeks or Months; Level 1 wrote no parameter for its default Days, so such a link opens on Weeks.

import { readSingleParam } from "../../filters/analyticsFiltersUrl";
import { findReportPeriod, type ReportPeriod } from "../levelOneMetrics/reportPeriod";

const retentionDetailsPeriodParamName = "period";

const defaultRetentionDetailsPeriod: ReportPeriod = "week";

export function parseRetentionDetailsPeriod(searchParams: URLSearchParams): ReportPeriod {
  const periodParam = readSingleParam(searchParams, retentionDetailsPeriodParamName);
  return (periodParam === undefined ? undefined : findReportPeriod(periodParam)) ?? defaultRetentionDetailsPeriod;
}

/** A copy of `searchParams` carrying the period, left out when it is the default. */
export function withRetentionDetailsPeriodSearchParams(
  searchParams: URLSearchParams,
  period: ReportPeriod,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete(retentionDetailsPeriodParamName);
  if (period !== defaultRetentionDetailsPeriod) {
    nextSearchParams.set(retentionDetailsPeriodParamName, period);
  }

  return nextSearchParams;
}

/** Replaces the current history entry, as the filter selection does, keeping every other parameter. */
export function writeRetentionDetailsPeriodToUrl(period: ReportPeriod): void {
  const serializedParams = withRetentionDetailsPeriodSearchParams(
    new URLSearchParams(window.location.search),
    period,
  ).toString();
  const nextSearch = serializedParams === "" ? "" : `?${serializedParams}`;
  if (nextSearch === window.location.search) {
    return;
  }

  window.history.replaceState(null, "", `${window.location.pathname}${nextSearch}${window.location.hash}`);
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange, AnalyticsFilterState } from "../../filters/analyticsFilters";
import { normalizeEventPlatforms, normalizeSiteVisitorFilterState } from "../../filters/analyticsFiltersUrl";
import {
  buildLookbackReportRangeEndingOn,
  buildPresetReportRange,
  lastSixtyDaysReportRangePreset,
  todayUtcCalendarDate,
} from "../reportValues";
import {
  buildLevelOneMetricsSearch,
  parseLevelOneMetricsSelection,
  parseProvisionalLevelOneMetricsSelection,
  type LevelOneMetricsSelection,
} from "./levelOneMetricsUrl";
import { loadLevelOneMetricsAvailableRange } from "./query";
import type { ReportPeriod } from "./reportPeriod";

const levelOneMetricsReportLabel = "Level 1 metrics";

type LevelOneMetricsRangeLookup =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; availableRange: AnalyticsDateRange; defaultRange: AnalyticsDateRange }>;

export type LevelOneMetricsSelectionState = Readonly<{
  /** Provisional until the range lookup returns; the charts start on it at once. */
  selection: LevelOneMetricsSelection;
  rangeLookup: LevelOneMetricsRangeLookup;
  /** The lookup's default once it returns, the browser-computed one until then. */
  defaultRange: AnalyticsDateRange;
  /** The query string the selection is carried in, for links between the Level 1 pages. */
  search: string;
  dateRangeError: string;
  applyFilters: (nextFilters: AnalyticsFilterState) => boolean;
  setPeriod: (period: ReportPeriod) => void;
  retryRangeLoad: () => void;
}>;

type ProvisionalLevelOneMetricsSelection = Readonly<{
  defaultRange: AnalyticsDateRange;
  selection: LevelOneMetricsSelection;
}>;

// The lookup's default is the same lookback anchored on the available range's last day, which is
// always today's UTC date, so it matches this one unless the data starts later than the lookback.
function buildProvisionalSelection(): ProvisionalLevelOneMetricsSelection {
  const todayUtc = todayUtcCalendarDate(new Date());
  const defaultRange = buildLookbackReportRangeEndingOn(
    todayUtc,
    lastSixtyDaysReportRangePreset.lookbackDays,
    levelOneMetricsReportLabel,
  );
  return {
    defaultRange,
    selection: parseProvisionalLevelOneMetricsSelection(
      new URLSearchParams(window.location.search),
      todayUtc,
      defaultRange,
    ),
  };
}

function isSameDateRange(left: AnalyticsDateRange, right: AnalyticsDateRange): boolean {
  return left.from === right.from && left.to === right.to;
}

function validateRequestedRange(
  range: AnalyticsDateRange,
  availableRange: AnalyticsDateRange,
): string | null {
  if (range.from > range.to) {
    return "From date must be on or before To date.";
  }

  if (range.from < availableRange.from) {
    return `From date must be on or after ${availableRange.from}.`;
  }

  if (range.to > availableRange.to) {
    return `To date must be on or before ${availableRange.to}.`;
  }

  return null;
}

/**
 * The date range, platforms, site filters and Group by every Level 1 page shares. It is read from the URL at once, reconciled
 * with the available range when the lookup returns, and from then on written back with
 * `replaceState`, so Back leaves the page instead of stepping through every change.
 */
export function useLevelOneMetricsSelection(
  config: AdminAppConfig,
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean,
): LevelOneMetricsSelectionState {
  const [provisional] = useState<ProvisionalLevelOneMetricsSelection>(buildProvisionalSelection);
  const [selection, setSelection] = useState<LevelOneMetricsSelection>(provisional.selection);
  const [rangeLookup, setRangeLookup] = useState<LevelOneMetricsRangeLookup>({ status: "loading" });
  const [rangeLoadRevision, setRangeLoadRevision] = useState<number>(0);
  const [dateRangeError, setDateRangeError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setRangeLookup({ status: "loading" });
    const abortController = new AbortController();
    void loadLevelOneMetricsAvailableRange(config, abortController.signal).then((availableRange) => {
      if (cancelled) return;
      const defaultRange = buildPresetReportRange(
        lastSixtyDaysReportRangePreset,
        availableRange,
        levelOneMetricsReportLabel,
      );
      // Only the range is reconciled: a period picked meanwhile is not in the URL yet.
      const reconciledRange = parseLevelOneMetricsSelection(
        new URLSearchParams(window.location.search),
        availableRange,
        defaultRange,
      ).dateRange;
      setRangeLookup({ status: "ready", availableRange, defaultRange });
      // An unchanged range keeps its object, so the charts do not reload.
      setSelection((currentSelection) => (isSameDateRange(currentSelection.dateRange, reconciledRange)
        ? currentSelection
        : { ...currentSelection, dateRange: reconciledRange }));
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setRangeLookup({
        status: "error",
        message: error instanceof Error ? error.message : "Unexpected Level 1 metrics range error.",
      });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [config, onTerminalAdminError, rangeLoadRevision]);

  const defaultRange = rangeLookup.status === "ready" ? rangeLookup.defaultRange : provisional.defaultRange;
  const search = useMemo(
    () => buildLevelOneMetricsSearch(selection, defaultRange),
    [selection, defaultRange],
  );
  const isRangeLookupReady = rangeLookup.status === "ready";

  useEffect(() => {
    if (isRangeLookupReady === false || search === window.location.search) {
      return;
    }

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search}${window.location.hash}`,
    );
  }, [isRangeLookupReady, search]);

  const availableRange = rangeLookup.status === "ready" ? rangeLookup.availableRange : null;

  const selectedDateRange = selection.dateRange;

  // Only a new range is judged against the available range, so a platform or site filter applies
  // before the lookup returns too.
  const applyFilters = useCallback((nextFilters: AnalyticsFilterState): boolean => {
    if (isSameDateRange(nextFilters.dateRange, selectedDateRange) === false) {
      if (availableRange === null) {
        return false;
      }

      const validationError = validateRequestedRange(nextFilters.dateRange, availableRange);
      if (validationError !== null) {
        setDateRangeError(validationError);
        return false;
      }
    }

    setDateRangeError("");
    setSelection((currentSelection) => ({
      ...currentSelection,
      dateRange: nextFilters.dateRange,
      eventPlatforms: normalizeEventPlatforms(nextFilters.eventPlatforms),
      siteFilters: normalizeSiteVisitorFilterState(nextFilters),
    }));
    return true;
  }, [availableRange, selectedDateRange]);

  const setPeriod = useCallback((period: ReportPeriod): void => {
    setSelection((currentSelection) => ({ ...currentSelection, period }));
  }, []);

  const retryRangeLoad = useCallback((): void => {
    setRangeLoadRevision((revision) => revision + 1);
  }, []);

  return {
    selection,
    rangeLookup,
    defaultRange,
    search,
    dateRangeError,
    applyFilters,
    setPeriod,
    retryRangeLoad,
  };
}

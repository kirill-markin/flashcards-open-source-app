import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange, AnalyticsFilterState } from "../../filters/analyticsFilters";
import { buildPresetReportRange, lastSixtyDaysReportRangePreset } from "../reportValues";
import {
  buildLevelOneMetricsSearch,
  parseLevelOneMetricsSelection,
  type LevelOneMetricsSelection,
} from "./levelOneMetricsUrl";
import { loadLevelOneMetricsAvailableRange } from "./query";
import type { ReportPeriod } from "./reportPeriod";

const levelOneMetricsReportLabel = "Level 1 metrics";

type LevelOneMetricsRangeState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
      status: "ready";
      availableRange: AnalyticsDateRange;
      defaultRange: AnalyticsDateRange;
      selection: LevelOneMetricsSelection;
    }>;

export type LevelOneMetricsSelectionState = Readonly<{
  rangeState: LevelOneMetricsRangeState;
  /** The query string the selection is carried in, for links between the Level 1 pages. */
  search: string;
  dateRangeError: string;
  applyFilters: (nextFilters: AnalyticsFilterState) => boolean;
  setPeriod: (period: ReportPeriod) => void;
  retryRangeLoad: () => void;
}>;

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
 * The date range and Group by every Level 1 page shares, read from the URL once the available range
 * is known and written back with `replaceState`, so Back leaves the page instead of stepping through
 * every change.
 */
export function useLevelOneMetricsSelection(
  config: AdminAppConfig,
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean,
): LevelOneMetricsSelectionState {
  const [rangeState, setRangeState] = useState<LevelOneMetricsRangeState>({ status: "loading" });
  const [rangeLoadRevision, setRangeLoadRevision] = useState<number>(0);
  const [dateRangeError, setDateRangeError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setRangeState({ status: "loading" });
    void loadLevelOneMetricsAvailableRange(config).then((availableRange) => {
      if (cancelled) return;
      const defaultRange = buildPresetReportRange(
        lastSixtyDaysReportRangePreset,
        availableRange,
        levelOneMetricsReportLabel,
      );
      setRangeState({
        status: "ready",
        availableRange,
        defaultRange,
        selection: parseLevelOneMetricsSelection(
          new URLSearchParams(window.location.search),
          availableRange,
          defaultRange,
        ),
      });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setRangeState({
        status: "error",
        message: error instanceof Error ? error.message : "Unexpected Level 1 metrics range error.",
      });
    });
    return () => { cancelled = true; };
  }, [config, onTerminalAdminError, rangeLoadRevision]);

  const readySearch = useMemo(
    () => (rangeState.status === "ready"
      ? buildLevelOneMetricsSearch(rangeState.selection, rangeState.defaultRange)
      : null),
    [rangeState],
  );

  useEffect(() => {
    if (readySearch === null || readySearch === window.location.search) {
      return;
    }

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${readySearch}${window.location.hash}`,
    );
  }, [readySearch]);

  const availableRange = rangeState.status === "ready" ? rangeState.availableRange : null;

  const applyFilters = useCallback((nextFilters: AnalyticsFilterState): boolean => {
    if (availableRange === null) {
      return false;
    }

    const validationError = validateRequestedRange(nextFilters.dateRange, availableRange);
    if (validationError !== null) {
      setDateRangeError(validationError);
      return false;
    }

    setDateRangeError("");
    setRangeState((currentState) => (currentState.status === "ready"
      ? { ...currentState, selection: { ...currentState.selection, dateRange: nextFilters.dateRange } }
      : currentState));
    return true;
  }, [availableRange]);

  const setPeriod = useCallback((period: ReportPeriod): void => {
    setRangeState((currentState) => (currentState.status === "ready"
      ? { ...currentState, selection: { ...currentState.selection, period } }
      : currentState));
  }, []);

  const retryRangeLoad = useCallback((): void => {
    setRangeLoadRevision((revision) => revision + 1);
  }, []);

  return {
    rangeState,
    // Until the range loads nothing is written, so the URL still holds what the page opened with.
    search: readySearch ?? window.location.search,
    dateRangeError,
    applyFilters,
    setPeriod,
    retryRangeLoad,
  };
}

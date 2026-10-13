import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { getUserColorScale } from "../../dashboard/userColors";
import { AnalyticsFilterBar } from "../../filters/AnalyticsFilterBar";
import {
  analyticsFilterFieldsByArea,
  buildDefaultAnalyticsFilterState,
  type AnalyticsDateRange,
  type AnalyticsFilterState,
} from "../../filters/analyticsFilters";
import { buildPresetReportRange, lastSixtyDaysReportRangePreset } from "../reportValues";
import { loadWhoSawUsAvailableRange } from "../whoSawUs/query";
import { WhoSawUsSection } from "../whoSawUs/WhoSawUsSection";

const levelOneMetricsReportLabel = "Level 1 metrics";

// The bar offers the date range alone here, so the option lists of the fields it does not render are
// empty and no chart colours a person.
const noOptions: ReadonlyArray<never> = [];
const noUserColorScale = getUserColorScale([]);

type RangeLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
      status: "ready";
      availableRange: AnalyticsDateRange;
      defaultRange: AnalyticsDateRange;
    }>;

/** Both ends are `YYYY-MM-DD`, so comparing them as text compares them as dates. */
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
 * The Level 1 metrics area: its own date range over its own available range, and the charts of the
 * area in a two-column grid. The range lives here rather than in the shared selection and is not
 * written to the URL, so every entry opens on the last 60 days.
 */
export function LevelOneMetricsArea(
  props: Readonly<{
    config: AdminAppConfig;
    onNavigate: (path: string) => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  const [rangeLoadState, setRangeLoadState] = useState<RangeLoadState>({ status: "loading" });
  const [rangeLoadRevision, setRangeLoadRevision] = useState<number>(0);
  const [dateRange, setDateRange] = useState<AnalyticsDateRange | null>(null);
  const [dateRangeError, setDateRangeError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setRangeLoadState({ status: "loading" });
    void loadWhoSawUsAvailableRange(props.config).then((availableRange) => {
      if (cancelled) return;
      const defaultRange = buildPresetReportRange(
        lastSixtyDaysReportRangePreset,
        availableRange,
        levelOneMetricsReportLabel,
      );
      setRangeLoadState({ status: "ready", availableRange, defaultRange });
      setDateRange(defaultRange);
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setRangeLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Unexpected Level 1 metrics range error.",
      });
    });
    return () => { cancelled = true; };
  }, [props.config, props.onTerminalAdminError, rangeLoadRevision]);

  // The bar edits a whole selection, of which only the date range is offered and read here.
  const filters = useMemo(
    () => (dateRange === null ? null : buildDefaultAnalyticsFilterState(dateRange)),
    [dateRange],
  );

  const applyFilters = useCallback((nextFilters: AnalyticsFilterState): boolean => {
    if (rangeLoadState.status !== "ready") {
      return false;
    }

    const validationError = validateRequestedRange(nextFilters.dateRange, rangeLoadState.availableRange);
    if (validationError !== null) {
      setDateRangeError(validationError);
      return false;
    }

    setDateRangeError("");
    setDateRange(nextFilters.dateRange);
    return true;
  }, [rangeLoadState]);

  if (rangeLoadState.status === "error") {
    return (
      <div className="report-state report-state-error">
        <strong>Level 1 metrics failed to load.</strong>
        <span>{rangeLoadState.message}</span>
        <button
          className="filter-button"
          type="button"
          onClick={() => setRangeLoadRevision((revision) => revision + 1)}
        >Retry</button>
      </div>
    );
  }

  if (rangeLoadState.status === "loading" || filters === null || dateRange === null) {
    return <p className="report-state" aria-live="polite">Loading Level 1 metrics…</p>;
  }

  return (
    <>
      <AnalyticsFilterBar
        area="level-1-metrics"
        fields={analyticsFilterFieldsByArea["level-1-metrics"]}
        title="Date range"
        headingLevel={2}
        headingId="level-1-metrics-filters-title"
        resetAllLabel="Reset the Level 1 metrics date range"
        availableRange={rangeLoadState.availableRange}
        defaultRange={rangeLoadState.defaultRange}
        filters={filters}
        userOptions={noOptions}
        connectionCountryOptions={noOptions}
        appUiLanguageOptions={noOptions}
        catalogDeckOptions={noOptions}
        catalogPlacementOptions={noOptions}
        catalogSourceOptions={noOptions}
        catalogDeviceCategoryOptions={noOptions}
        catalogClickBrowserLanguageOptions={noOptions}
        isReportLoading={false}
        dateRangeError={dateRangeError}
        userColorScale={noUserColorScale}
        onFiltersChange={applyFilters}
        onNavigate={props.onNavigate}
      />

      <div className="level-1-metrics-grid">
        <WhoSawUsSection
          config={props.config}
          dateRange={dateRange}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      </div>
    </>
  );
}

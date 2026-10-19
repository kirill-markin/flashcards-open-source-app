import { useMemo, type JSX, type ReactNode } from "react";
import { getUserColorScale } from "../../dashboard/userColors";
import { AnalyticsFilterBar } from "../../filters/AnalyticsFilterBar";
import { analyticsFilterFieldsByArea, buildDefaultAnalyticsFilterState } from "../../filters/analyticsFilters";
import type { LevelOneMetricsSelection } from "./levelOneMetricsUrl";
import { parseReportPeriod, reportPeriodLabels, reportPeriods } from "./reportPeriod";
import type { LevelOneMetricsSelectionState } from "./useLevelOneMetricsSelection";

const levelOneMetricsGroupByFieldId = "level-1-metrics-group-by";

const noOptions: ReadonlyArray<never> = [];
const noUserColorScale = getUserColorScale([]);

/** The range loading, date range bar and Group by every Level 1 page shares, above that page's charts. */
export function LevelOneMetricsFrame(
  props: Readonly<{
    selectionState: LevelOneMetricsSelectionState;
    onNavigate: (path: string) => void;
    renderCharts: (selection: LevelOneMetricsSelection, search: string) => ReactNode;
  }>,
): JSX.Element {
  const rangeState = props.selectionState.rangeState;
  const dateRange = rangeState.status === "ready" ? rangeState.selection.dateRange : null;
  const filters = useMemo(
    () => (dateRange === null ? null : buildDefaultAnalyticsFilterState(dateRange)),
    [dateRange],
  );

  if (rangeState.status === "error") {
    return (
      <div className="report-state report-state-error">
        <strong>Level 1 metrics failed to load.</strong>
        <span>{rangeState.message}</span>
        <button
          className="filter-button"
          type="button"
          onClick={props.selectionState.retryRangeLoad}
        >Retry</button>
      </div>
    );
  }

  if (rangeState.status === "loading" || filters === null) {
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
        availableRange={rangeState.availableRange}
        defaultRange={rangeState.defaultRange}
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
        dateRangeError={props.selectionState.dateRangeError}
        userColorScale={noUserColorScale}
        onFiltersChange={props.selectionState.applyFilters}
        onNavigate={props.onNavigate}
      />

      <div className="funnel-group-by-row">
        <div className="funnel-group-by">
          <label htmlFor={levelOneMetricsGroupByFieldId}>Group by</label>
          <select
            id={levelOneMetricsGroupByFieldId}
            className="funnel-group-by-select"
            data-testid={levelOneMetricsGroupByFieldId}
            value={rangeState.selection.period}
            onChange={(event) => props.selectionState.setPeriod(parseReportPeriod(event.target.value))}
          >
            {reportPeriods.map((option) => (
              <option key={option} value={option}>{reportPeriodLabels[option]}</option>
            ))}
          </select>
        </div>
      </div>

      {props.renderCharts(rangeState.selection, props.selectionState.search)}
    </>
  );
}

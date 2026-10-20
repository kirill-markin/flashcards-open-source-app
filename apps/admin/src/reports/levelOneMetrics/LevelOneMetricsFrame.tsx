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

/**
 * The date range bar and Group by every Level 1 page shares, above that page's charts. Everything
 * renders at once on the provisional selection; the range lookup only enables the date field.
 */
export function LevelOneMetricsFrame(
  props: Readonly<{
    selectionState: LevelOneMetricsSelectionState;
    onNavigate: (path: string) => void;
    renderCharts: (selection: LevelOneMetricsSelection, search: string) => ReactNode;
  }>,
): JSX.Element {
  const selectionState = props.selectionState;
  const rangeLookup = selectionState.rangeLookup;
  const dateRange = selectionState.selection.dateRange;
  const filters = useMemo(() => buildDefaultAnalyticsFilterState(dateRange), [dateRange]);

  return (
    <>
      <AnalyticsFilterBar
        area="level-1-metrics"
        fields={analyticsFilterFieldsByArea["level-1-metrics"]}
        title="Date range"
        headingLevel={2}
        headingId="level-1-metrics-filters-title"
        resetAllLabel="Reset the Level 1 metrics date range"
        availableRange={rangeLookup.status === "ready" ? rangeLookup.availableRange : null}
        defaultRange={selectionState.defaultRange}
        filters={filters}
        userOptions={noOptions}
        connectionCountryOptions={noOptions}
        appUiLanguageOptions={noOptions}
        catalogDeckOptions={noOptions}
        catalogPlacementOptions={noOptions}
        catalogSourceOptions={noOptions}
        catalogDeviceCategoryOptions={noOptions}
        catalogClickBrowserLanguageOptions={noOptions}
        areOptionListsLoading={false}
        isReportLoading={false}
        dateRangeError={selectionState.dateRangeError}
        userColorScale={noUserColorScale}
        onFiltersChange={selectionState.applyFilters}
        onNavigate={props.onNavigate}
      />

      {rangeLookup.status === "error" ? (
        <div className="report-state report-state-error" role="alert">
          <strong>The Level 1 date range failed to load.</strong>
          <span>{rangeLookup.message}</span>
          <button
            className="filter-button"
            type="button"
            onClick={selectionState.retryRangeLoad}
          >Retry</button>
        </div>
      ) : null}

      <div className="funnel-group-by-row">
        <div className="funnel-group-by">
          <label htmlFor={levelOneMetricsGroupByFieldId}>Group by</label>
          <select
            id={levelOneMetricsGroupByFieldId}
            className="funnel-group-by-select"
            data-testid={levelOneMetricsGroupByFieldId}
            value={selectionState.selection.period}
            onChange={(event) => selectionState.setPeriod(parseReportPeriod(event.target.value))}
          >
            {reportPeriods.map((option) => (
              <option key={option} value={option}>{reportPeriodLabels[option]}</option>
            ))}
          </select>
        </div>
      </div>

      {props.renderCharts(selectionState.selection, selectionState.search)}
    </>
  );
}

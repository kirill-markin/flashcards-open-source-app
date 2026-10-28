import { useMemo, type JSX, type ReactNode } from "react";
import { getUserColorScale } from "../../dashboard/userColors";
import { AnalyticsFilterBar } from "../../filters/AnalyticsFilterBar";
import {
  analyticsFilterFieldsByArea,
  buildDefaultAnalyticsFilterState,
  type AnalyticsFilterField,
} from "../../filters/analyticsFilters";
import { noSiteVisitorFilterOptions, type SiteVisitorFilterOptions } from "../../filters/optionsQuery";
import type { LevelOneMetricsSelection } from "./levelOneMetricsUrl";
import { parseReportPeriod, reportPeriodLabels, reportPeriods } from "./reportPeriod";
import type { LevelOneMetricsSelectionState } from "./useLevelOneMetricsSelection";

const levelOneMetricsGroupByFieldId = "level-1-metrics-group-by";

const noOptions: ReadonlyArray<never> = [];
const noUserColorScale = getUserColorScale([]);

export type SiteVisitorFilterOptionsLookup =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string; retry: () => void }>
  | Readonly<{ status: "ready"; options: SiteVisitorFilterOptions }>;

/**
 * The fields one Level 1 page's bar offers, what its site fields offer, and how the bar names itself
 * and its `Reset all`.
 */
export type LevelOneMetricsFilterBar = Readonly<{
  fields: ReadonlyArray<AnalyticsFilterField>;
  siteOptions: SiteVisitorFilterOptionsLookup;
  title: string;
  resetAllLabel: string;
}>;

export const levelOneMetricsDateRangeFilterBar: LevelOneMetricsFilterBar = {
  fields: analyticsFilterFieldsByArea["level-1-metrics"],
  siteOptions: { status: "ready", options: noSiteVisitorFilterOptions },
  title: "Date range",
  resetAllLabel: "Reset the Level 1 metrics date range",
};

/**
 * The filter bar and Group by every Level 1 page shares, above that page's charts. Everything
 * renders at once on the provisional selection; the range lookup only enables the date field.
 */
export function LevelOneMetricsFrame(
  props: Readonly<{
    selectionState: LevelOneMetricsSelectionState;
    filterBar: LevelOneMetricsFilterBar;
    onNavigate: (path: string) => void;
    renderCharts: (selection: LevelOneMetricsSelection, search: string) => ReactNode;
  }>,
): JSX.Element {
  const selectionState = props.selectionState;
  const rangeLookup = selectionState.rangeLookup;
  const dateRange = selectionState.selection.dateRange;
  const siteFilters = selectionState.selection.siteFilters;
  const siteOptions = props.filterBar.siteOptions;
  // The site filters ride along on every page, so a page that does not offer them keeps them.
  const filters = useMemo(
    () => ({ ...buildDefaultAnalyticsFilterState(dateRange), ...siteFilters }),
    [dateRange, siteFilters],
  );

  return (
    <>
      <AnalyticsFilterBar
        area="level-1-metrics"
        fields={props.filterBar.fields}
        title={props.filterBar.title}
        headingLevel={2}
        headingId="level-1-metrics-filters-title"
        resetAllLabel={props.filterBar.resetAllLabel}
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
        siteVisitorOptions={siteOptions.status === "ready" ? siteOptions.options : noSiteVisitorFilterOptions}
        areOptionListsLoading={siteOptions.status !== "ready"}
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

      {siteOptions.status === "error" ? (
        <div className="report-state report-state-error" role="alert">
          <strong>The filter options failed to load.</strong>
          <span>{siteOptions.message}</span>
          <button className="filter-button" type="button" onClick={siteOptions.retry}>Retry</button>
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

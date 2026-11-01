import { useMemo, type JSX, type ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import { getUserColorScale } from "../../dashboard/userColors";
import { AnalyticsFilterBar } from "../../filters/AnalyticsFilterBar";
import {
  analyticsFilterFieldsByArea,
  buildDefaultAnalyticsFilterState,
  whoSawUsDatasetAnalyticsFilterFields,
  type AnalyticsDateRange,
  type AnalyticsFilterField,
} from "../../filters/analyticsFilters";
import {
  loadAppVersionFilterOptions,
  noSiteVisitorFilterOptions,
  type SiteVisitorFilterOptions,
} from "../../filters/optionsQuery";
import type { LevelOneMetricsSelection } from "./levelOneMetricsUrl";
import { parseReportPeriod, reportPeriodLabels, reportPeriods } from "./reportPeriod";
import { useFilterOptionsLookup, type FilterOptionsLookup } from "./useFilterOptionsLookup";
import type { LevelOneMetricsSelectionState } from "./useLevelOneMetricsSelection";

const levelOneMetricsGroupByFieldId = "level-1-metrics-group-by";

const noOptions: ReadonlyArray<never> = [];
const noUserColorScale = getUserColorScale([]);

/**
 * The fields one Level 1 page's bar offers, what its site and app version fields offer, and how the
 * bar names itself and its `Reset all`.
 */
export type LevelOneMetricsFilterBar = Readonly<{
  fields: ReadonlyArray<AnalyticsFilterField>;
  siteOptions: FilterOptionsLookup<SiteVisitorFilterOptions>;
  appVersionOptions: FilterOptionsLookup<ReadonlyArray<string>>;
  title: string;
  resetAllLabel: string;
}>;

const noSiteOptions: FilterOptionsLookup<SiteVisitorFilterOptions> = { status: "ready", options: noSiteVisitorFilterOptions };

/** For every bar that does not offer the app version field. */
export const noAppVersionOptions: FilterOptionsLookup<ReadonlyArray<string>> = { status: "ready", options: noOptions };

/** The bar of the main page and the charted Details pages, with the app versions of the selected range. */
export function useLevelOneMetricsFilterBar(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean,
): LevelOneMetricsFilterBar {
  const appVersionOptions = useFilterOptionsLookup(
    config,
    dateRange,
    loadAppVersionFilterOptions,
    "Unexpected app version filter options error.",
    onTerminalAdminError,
  );
  return useMemo(() => ({
    fields: analyticsFilterFieldsByArea["level-1-metrics"],
    siteOptions: noSiteOptions,
    appVersionOptions,
    title: "Filters",
    resetAllLabel: "Reset the Level 1 metrics filters",
  }), [appVersionOptions]);
}

export const levelOneMetricsDateRangeFilterBar: LevelOneMetricsFilterBar = {
  fields: whoSawUsDatasetAnalyticsFilterFields,
  siteOptions: noSiteOptions,
  appVersionOptions: noAppVersionOptions,
  title: "Date range",
  resetAllLabel: "Reset the Level 1 metrics date range",
};

/** A failed option list, which disables only the fields that pick from it. */
function FilterOptionsError<Options>(props: Readonly<{ lookup: FilterOptionsLookup<Options> }>): JSX.Element | null {
  if (props.lookup.status !== "error") return null;
  return (
    <div className="report-state report-state-error" role="alert">
      <strong>The filter options failed to load.</strong>
      <span>{props.lookup.message}</span>
      <button className="filter-button" type="button" onClick={props.lookup.retry}>Retry</button>
    </div>
  );
}

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
  const eventPlatforms = selectionState.selection.eventPlatforms;
  const appVersions = selectionState.selection.appVersions;
  const siteFilters = selectionState.selection.siteFilters;
  const siteOptions = props.filterBar.siteOptions;
  const appVersionOptions = props.filterBar.appVersionOptions;
  // The platform, version and site filters ride along on every page, so a page that does not offer
  // them keeps them.
  const filters = useMemo(
    () => ({ ...buildDefaultAnalyticsFilterState(dateRange), eventPlatforms, appVersions, ...siteFilters }),
    [dateRange, eventPlatforms, appVersions, siteFilters],
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
        appVersionOptions={appVersionOptions.status === "ready" ? appVersionOptions.options : noOptions}
        catalogDeckOptions={noOptions}
        catalogPlacementOptions={noOptions}
        catalogSourceOptions={noOptions}
        catalogDeviceCategoryOptions={noOptions}
        catalogClickBrowserLanguageOptions={noOptions}
        siteVisitorOptions={siteOptions.status === "ready" ? siteOptions.options : noSiteVisitorFilterOptions}
        areOptionListsLoading={siteOptions.status !== "ready" || appVersionOptions.status !== "ready"}
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

      <FilterOptionsError lookup={siteOptions} />
      <FilterOptionsError lookup={appVersionOptions} />

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

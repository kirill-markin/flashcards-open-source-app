import { useEffect, useState, type JSX, type ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import {
  defaultSiteVisitorFilterState,
  webEngagedAnalyticsFilterFields,
  type AnalyticsDateRange,
} from "../../filters/analyticsFilters";
import { loadSiteVisitorFilterOptions } from "../../filters/optionsQuery";
import { getLevelOneMetricDetailsPath, type WhoSawUsDataset } from "../../routing";
import { LevelOneMetricDetailsHeader } from "../levelOneMetrics/LevelOneMetricDetailsHeader";
import {
  LevelOneMetricsFrame,
  levelOneMetricsDateRangeFilterBar,
  type LevelOneMetricsFilterBar,
  type SiteVisitorFilterOptionsLookup,
} from "../levelOneMetrics/LevelOneMetricsFrame";
import type { LevelOneMetricsSelection } from "../levelOneMetrics/levelOneMetricsUrl";
import {
  useLevelOneMetricsSelection,
  type LevelOneMetricsSelectionState,
} from "../levelOneMetrics/useLevelOneMetricsSelection";
import { WebEngagedShareSection } from "./WebEngagedShareSection";
import { WebLandingPagePathSections } from "./WebLandingPagePathSections";
import { WebTrafficCategoriesSection } from "./WebTrafficCategoriesSection";
import { WhoSawUsBreakdownSections } from "./WhoSawUsBreakdownSections";
import { whoSawUsSeriesLabels, WhoSawUsSection } from "./WhoSawUsSection";

const webEngagedFilterBar: Omit<LevelOneMetricsFilterBar, "siteOptions"> = {
  fields: webEngagedAnalyticsFilterFields,
  title: "Filters",
  resetAllLabel: "Reset the Web engaged filters",
};

/** The Web engaged page's site filter options over the selected range. */
function useSiteVisitorFilterOptions(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean,
): SiteVisitorFilterOptionsLookup {
  const [lookup, setLookup] = useState<SiteVisitorFilterOptionsLookup>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    setLookup({ status: "loading" });
    const abortController = new AbortController();
    void loadSiteVisitorFilterOptions(config, dateRange, abortController.signal).then((options) => {
      if (!cancelled) setLookup({ status: "ready", options });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setLookup({
        status: "error",
        message: error instanceof Error ? error.message : "Unexpected Web engaged filter options error.",
        retry: () => setRevision((value) => value + 1),
      });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [config, dateRange, onTerminalAdminError, revision]);
  return lookup;
}

function WebEngagedFrame(
  props: Readonly<{
    selectionState: LevelOneMetricsSelectionState;
    config: AdminAppConfig;
    onNavigate: (path: string) => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
    renderCharts: (selection: LevelOneMetricsSelection) => ReactNode;
  }>,
): JSX.Element {
  const siteOptions = useSiteVisitorFilterOptions(
    props.config,
    props.selectionState.selection.dateRange,
    props.onTerminalAdminError,
  );
  return (
    <LevelOneMetricsFrame
      selectionState={props.selectionState}
      filterBar={{ ...webEngagedFilterBar, siteOptions }}
      onNavigate={props.onNavigate}
      renderCharts={props.renderCharts}
    />
  );
}

/**
 * One Who saw us series alone, on the Level 1 selection, followed by its own breakdowns. Only the
 * Web engaged page offers and applies the site filters, to every chart and table on it.
 */
export function WhoSawUsDatasetPage(
  props: Readonly<{
    dataset: WhoSawUsDataset;
    config: AdminAppConfig;
    onNavigate: (path: string) => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
    /** The admin tab row, given the query string that carries this page's selection. */
    renderNavigation: (levelOneMetricsSearch: string) => ReactNode;
  }>,
): JSX.Element {
  const selectionState = useLevelOneMetricsSelection(props.config, props.onTerminalAdminError);
  const renderCharts = (selection: LevelOneMetricsSelection): ReactNode => {
    const siteFilters = props.dataset === "web" ? selection.siteFilters : defaultSiteVisitorFilterState;
    return (
      <div className="level-1-metrics-grid" data-testid={`who-saw-us-dataset-${props.dataset}-page`}>
        <WhoSawUsSection
          config={props.config}
          dateRange={selection.dateRange}
          period={selection.period}
          series={props.dataset}
          siteFilters={siteFilters}
          detailsLink={null}
          onTerminalAdminError={props.onTerminalAdminError}
        />
        <WhoSawUsBreakdownSections
          group={props.dataset}
          config={props.config}
          dateRange={selection.dateRange}
          period={selection.period}
          siteFilters={siteFilters}
          onTerminalAdminError={props.onTerminalAdminError}
        />
        {props.dataset === "google-play" ? (
          <p className="report-state" data-testid="who-saw-us-google-play-no-breakdowns-note">
            No breakdowns: at our volume Google Play reports every country, traffic source and search term as Other, so a split would show one Other bar. Verified 2026-10-19 over all imported days.
          </p>
        ) : null}
        {props.dataset === "web" ? (
          <>
            <WebLandingPagePathSections
              config={props.config}
              dateRange={selection.dateRange}
              period={selection.period}
              siteFilters={siteFilters}
              onTerminalAdminError={props.onTerminalAdminError}
            />
            <header className="level-1-metrics-group-heading" data-testid="who-saw-us-web-traffic-categories-heading">
              <h2>Engaged vs all web traffic</h2>
            </header>
            <WebTrafficCategoriesSection
              config={props.config}
              dateRange={selection.dateRange}
              period={selection.period}
              siteFilters={siteFilters}
              onTerminalAdminError={props.onTerminalAdminError}
            />
            <WebEngagedShareSection
              config={props.config}
              dateRange={selection.dateRange}
              period={selection.period}
              siteFilters={siteFilters}
              onTerminalAdminError={props.onTerminalAdminError}
            />
          </>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {props.renderNavigation(selectionState.search)}

      <LevelOneMetricDetailsHeader
        backPath={`${getLevelOneMetricDetailsPath("who-saw-us")}${selectionState.search}`}
        backLabel="Who saw us details"
        title={`Who saw us · ${whoSawUsSeriesLabels[props.dataset]} details`}
        onNavigate={props.onNavigate}
      />

      {props.dataset === "web" ? (
        <WebEngagedFrame
          selectionState={selectionState}
          config={props.config}
          onNavigate={props.onNavigate}
          onTerminalAdminError={props.onTerminalAdminError}
          renderCharts={renderCharts}
        />
      ) : (
        <LevelOneMetricsFrame
          selectionState={selectionState}
          filterBar={levelOneMetricsDateRangeFilterBar}
          onNavigate={props.onNavigate}
          renderCharts={renderCharts}
        />
      )}
    </>
  );
}

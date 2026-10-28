import type { JSX, ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import { defaultSiteVisitorFilterState, webEngagedAnalyticsFilterFields } from "../../filters/analyticsFilters";
import { getLevelOneMetricDetailsPath, type WhoSawUsDataset } from "../../routing";
import { LevelOneMetricDetailsHeader } from "../levelOneMetrics/LevelOneMetricDetailsHeader";
import {
  LevelOneMetricsFrame,
  levelOneMetricsDateRangeFilterBar,
  type LevelOneMetricsFilterBar,
} from "../levelOneMetrics/LevelOneMetricsFrame";
import { useLevelOneMetricsSelection } from "../levelOneMetrics/useLevelOneMetricsSelection";
import { WebEngagedShareSection } from "./WebEngagedShareSection";
import { WebLandingPagePathSections } from "./WebLandingPagePathSections";
import { WebTrafficCategoriesSection } from "./WebTrafficCategoriesSection";
import { WhoSawUsBreakdownSections } from "./WhoSawUsBreakdownSections";
import { whoSawUsSeriesLabels, WhoSawUsSection } from "./WhoSawUsSection";

const webEngagedFilterBar: LevelOneMetricsFilterBar = {
  fields: webEngagedAnalyticsFilterFields,
  title: "Filters",
  resetAllLabel: "Reset the Web engaged filters",
};

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

  return (
    <>
      {props.renderNavigation(selectionState.search)}

      <LevelOneMetricDetailsHeader
        backPath={`${getLevelOneMetricDetailsPath("who-saw-us")}${selectionState.search}`}
        backLabel="Who saw us details"
        title={`Who saw us · ${whoSawUsSeriesLabels[props.dataset]} details`}
        onNavigate={props.onNavigate}
      />

      <LevelOneMetricsFrame
        selectionState={selectionState}
        filterBar={props.dataset === "web" ? webEngagedFilterBar : levelOneMetricsDateRangeFilterBar}
        onNavigate={props.onNavigate}
        renderCharts={(selection) => {
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
        }}
      />
    </>
  );
}

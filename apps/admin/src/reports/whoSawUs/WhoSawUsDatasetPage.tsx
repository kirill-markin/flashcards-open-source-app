import type { JSX, ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import { getLevelOneMetricDetailsPath, type WhoSawUsDataset } from "../../routing";
import { LevelOneMetricDetailsHeader } from "../levelOneMetrics/LevelOneMetricDetailsHeader";
import { LevelOneMetricsFrame } from "../levelOneMetrics/LevelOneMetricsFrame";
import { useLevelOneMetricsSelection } from "../levelOneMetrics/useLevelOneMetricsSelection";
import { WebLandingPagePathSections } from "./WebLandingPagePathSections";
import { WhoSawUsBreakdownSections } from "./WhoSawUsBreakdownSections";
import { whoSawUsSeriesLabels, WhoSawUsSection } from "./WhoSawUsSection";

/** One Who saw us series alone, on the Level 1 selection, followed by its own breakdowns. */
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
        onNavigate={props.onNavigate}
        renderCharts={(selection) => (
          <div className="level-1-metrics-grid" data-testid={`who-saw-us-dataset-${props.dataset}-page`}>
            <WhoSawUsSection
              config={props.config}
              dateRange={selection.dateRange}
              period={selection.period}
              series={props.dataset}
              detailsLink={null}
              onTerminalAdminError={props.onTerminalAdminError}
            />
            <WhoSawUsBreakdownSections
              seriesKey={props.dataset}
              config={props.config}
              dateRange={selection.dateRange}
              period={selection.period}
              onTerminalAdminError={props.onTerminalAdminError}
            />
            {props.dataset === "google-play" ? (
              <p className="report-state" data-testid="who-saw-us-google-play-no-breakdowns-note">
                No breakdowns: at our volume Google Play reports every country, traffic source and search term as Other, so a split would show one Other bar. Verified 2026-10-19 over all imported days.
              </p>
            ) : null}
            {props.dataset === "web" ? (
              <WebLandingPagePathSections
                config={props.config}
                dateRange={selection.dateRange}
                period={selection.period}
                onTerminalAdminError={props.onTerminalAdminError}
              />
            ) : null}
          </div>
        )}
      />
    </>
  );
}

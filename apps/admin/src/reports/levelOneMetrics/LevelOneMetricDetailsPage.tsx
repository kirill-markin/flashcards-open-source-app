import type { JSX, ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import { AdminLink } from "../../navigation/AdminLink";
import { getAnalyticsAreaPath, type LevelOneMetricDetail } from "../../routing";
import { WhoOpenedTheAppBreakdownSections } from "../whoOpenedTheApp/WhoOpenedTheAppBreakdownSections";
import { WhoOpenedTheAppSection } from "../whoOpenedTheApp/WhoOpenedTheAppSection";
import { WhoSawUsBreakdownSections } from "../whoSawUs/WhoSawUsBreakdownSections";
import { WhoSawUsSection } from "../whoSawUs/WhoSawUsSection";
import { WhoStudiedBreakdownSections } from "../whoStudied/WhoStudiedBreakdownSections";
import { WhoStudiedSection } from "../whoStudied/WhoStudiedSection";
import { LevelOneMetricsFrame } from "./LevelOneMetricsFrame";
import type { LevelOneMetricsSelection } from "./levelOneMetricsUrl";
import { useLevelOneMetricsSelection } from "./useLevelOneMetricsSelection";

const levelOneMetricDetailLabels: Readonly<Record<LevelOneMetricDetail, string>> = {
  "who-saw-us": "Who saw us",
  "who-opened-the-app": "Who opened the app",
  "who-studied": "Who studied",
};

type LevelOneMetricDetailsPageProps = Readonly<{
  metric: LevelOneMetricDetail;
  config: AdminAppConfig;
  onNavigate: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  /** The admin tab row, given the query string that carries this page's selection. */
  renderNavigation: (levelOneMetricsSearch: string) => ReactNode;
}>;

/** The metric's own chart, without a Details button since this is its Details page, then its breakdowns. */
function renderMetricSections(
  props: LevelOneMetricDetailsPageProps,
  selection: LevelOneMetricsSelection,
): JSX.Element {
  switch (props.metric) {
    case "who-saw-us":
      return (
        <>
          <WhoSawUsSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            detailsLink={null}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoSawUsBreakdownSections
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            onTerminalAdminError={props.onTerminalAdminError}
          />
        </>
      );
    case "who-opened-the-app":
      return (
        <>
          <WhoOpenedTheAppSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            detailsLink={null}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoOpenedTheAppBreakdownSections
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            onTerminalAdminError={props.onTerminalAdminError}
          />
        </>
      );
    case "who-studied":
      return (
        <>
          <WhoStudiedSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            detailsLink={null}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoStudiedBreakdownSections
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            onTerminalAdminError={props.onTerminalAdminError}
          />
        </>
      );
  }
}

/** One Level 1 chart in the top-left cell of the main page's grid, on the main page's selection, followed by its breakdowns. */
export function LevelOneMetricDetailsPage(props: LevelOneMetricDetailsPageProps): JSX.Element {
  const selectionState = useLevelOneMetricsSelection(props.config, props.onTerminalAdminError);

  return (
    <>
      {props.renderNavigation(selectionState.search)}

      <header className="level-1-metric-details-header">
        <AdminLink
          className="state-link"
          path={`${getAnalyticsAreaPath("level-1-metrics")}${selectionState.search}`}
          testId="level-1-metric-details-back"
          onNavigate={props.onNavigate}
        >← Level 1 metrics</AdminLink>
        <h2 data-testid="level-1-metric-details-title">{levelOneMetricDetailLabels[props.metric]} details</h2>
      </header>

      <LevelOneMetricsFrame
        selectionState={selectionState}
        onNavigate={props.onNavigate}
        renderCharts={(selection) => (
          <div className="level-1-metrics-grid">{renderMetricSections(props, selection)}</div>
        )}
      />
    </>
  );
}

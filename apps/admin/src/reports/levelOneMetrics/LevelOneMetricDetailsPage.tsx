import type { JSX, ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import { getAnalyticsAreaPath, type LevelOneMetricDetail } from "../../routing";
import { WhoCameBackBreakdownSections } from "../whoCameBack/WhoCameBackBreakdownSections";
import { WhoCameBackSection } from "../whoCameBack/WhoCameBackSection";
import { WhoOpenedTheAppBreakdownSections } from "../whoOpenedTheApp/WhoOpenedTheAppBreakdownSections";
import { WhoOpenedTheAppSection } from "../whoOpenedTheApp/WhoOpenedTheAppSection";
import { WhoPaidUsBreakdownSections } from "../whoPaidUs/WhoPaidUsBreakdownSections";
import { WhoPaidUsSection } from "../whoPaidUs/WhoPaidUsSection";
import { WhoSawUsDatasetPicker } from "../whoSawUs/WhoSawUsDatasetPicker";
import { WhoStudiedBreakdownSections } from "../whoStudied/WhoStudiedBreakdownSections";
import { WhoStudiedReviewEventSections } from "../whoStudied/WhoStudiedReviewEventSections";
import { WhoStudiedSection } from "../whoStudied/WhoStudiedSection";
import { LevelOneMetricDetailsHeader } from "./LevelOneMetricDetailsHeader";
import { LevelOneMetricsFrame } from "./LevelOneMetricsFrame";
import type { LevelOneMetricsSelection } from "./levelOneMetricsUrl";
import { useLevelOneMetricsSelection } from "./useLevelOneMetricsSelection";

/** Who saw us has a dataset picker instead, because its series come from unrelated sources. */
type ChartedLevelOneMetricDetail = Exclude<LevelOneMetricDetail, "who-saw-us">;

const levelOneMetricDetailLabels: Readonly<Record<ChartedLevelOneMetricDetail, string>> = {
  "who-opened-the-app": "Who opened the app",
  "who-studied": "Who studied",
  "who-came-back": "Who came back",
  "who-paid-us": "Who paid us",
};

type LevelOneMetricDetailsPageProps<Metric extends LevelOneMetricDetail> = Readonly<{
  metric: Metric;
  config: AdminAppConfig;
  onNavigate: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  /** The admin tab row, given the query string that carries this page's selection. */
  renderNavigation: (levelOneMetricsSearch: string) => ReactNode;
}>;

/** The metric's own chart, without a Details button since this is its Details page, then its breakdowns. */
function renderMetricSections(
  props: LevelOneMetricDetailsPageProps<ChartedLevelOneMetricDetail>,
  selection: LevelOneMetricsSelection,
): JSX.Element {
  switch (props.metric) {
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
          <WhoStudiedReviewEventSections
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            onNavigate={props.onNavigate}
            onTerminalAdminError={props.onTerminalAdminError}
          />
        </>
      );
    case "who-came-back":
      return (
        <>
          <WhoCameBackSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            detailsLink={null}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoCameBackBreakdownSections
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            onTerminalAdminError={props.onTerminalAdminError}
          />
        </>
      );
    case "who-paid-us":
      return (
        <>
          <WhoPaidUsSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            detailsLink={null}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoPaidUsBreakdownSections
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
function ChartedLevelOneMetricDetailsPage(
  props: LevelOneMetricDetailsPageProps<ChartedLevelOneMetricDetail>,
): JSX.Element {
  const selectionState = useLevelOneMetricsSelection(props.config, props.onTerminalAdminError);

  return (
    <>
      {props.renderNavigation(selectionState.search)}

      <LevelOneMetricDetailsHeader
        backPath={`${getAnalyticsAreaPath("level-1-metrics")}${selectionState.search}`}
        backLabel="Level 1 metrics"
        title={`${levelOneMetricDetailLabels[props.metric]} details`}
        onNavigate={props.onNavigate}
      />

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

export function LevelOneMetricDetailsPage(props: LevelOneMetricDetailsPageProps<LevelOneMetricDetail>): JSX.Element {
  return props.metric === "who-saw-us" ? (
    <WhoSawUsDatasetPicker onNavigate={props.onNavigate} renderNavigation={props.renderNavigation} />
  ) : (
    <ChartedLevelOneMetricDetailsPage {...props} metric={props.metric} />
  );
}

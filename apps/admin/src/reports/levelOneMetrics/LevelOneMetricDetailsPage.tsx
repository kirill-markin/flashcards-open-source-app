import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { AdminLink } from "../../navigation/AdminLink";
import { getAnalyticsAreaPath, type LevelOneMetricDetail } from "../../routing";
import { WhoOpenedTheAppSection } from "../whoOpenedTheApp/WhoOpenedTheAppSection";
import { WhoSawUsSection } from "../whoSawUs/WhoSawUsSection";
import { LevelOneMetricsFrame } from "./LevelOneMetricsFrame";
import type { LevelOneMetricsSelection } from "./levelOneMetricsUrl";
import { useLevelOneMetricsSelection } from "./useLevelOneMetricsSelection";

const levelOneMetricDetailLabels: Readonly<Record<LevelOneMetricDetail, string>> = {
  "who-saw-us": "Who saw us",
  "who-opened-the-app": "Who opened the app",
};

type LevelOneMetricDetailsPageProps = Readonly<{
  metric: LevelOneMetricDetail;
  config: AdminAppConfig;
  onNavigate: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>;

/** The metric's own chart, without a Details button: it already is on its Details page. */
function renderMetricSection(
  props: LevelOneMetricDetailsPageProps,
  selection: LevelOneMetricsSelection,
): JSX.Element {
  switch (props.metric) {
    case "who-saw-us":
      return (
        <WhoSawUsSection
          config={props.config}
          dateRange={selection.dateRange}
          period={selection.period}
          detailsLink={null}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      );
    case "who-opened-the-app":
      return (
        <WhoOpenedTheAppSection
          config={props.config}
          dateRange={selection.dateRange}
          period={selection.period}
          detailsLink={null}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      );
  }
}

/** One Level 1 chart in the top-left cell of the main page's grid, on the main page's selection. */
export function LevelOneMetricDetailsPage(props: LevelOneMetricDetailsPageProps): JSX.Element {
  const selectionState = useLevelOneMetricsSelection(props.config, props.onTerminalAdminError);

  return (
    <>
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
          <div className="level-1-metrics-grid">{renderMetricSection(props, selection)}</div>
        )}
      />
    </>
  );
}

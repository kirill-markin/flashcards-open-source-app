import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { WhoSawUsSection } from "../whoSawUs/WhoSawUsSection";
import { WhoOpenedTheAppSection } from "../whoOpenedTheApp/WhoOpenedTheAppSection";
import { WhoStudiedSection } from "../whoStudied/WhoStudiedSection";
import { WhoCameBackSection } from "../whoCameBack/WhoCameBackSection";
import { WhoPaidUsSection } from "../whoPaidUs/WhoPaidUsSection";
import { buildLevelOneMetricDetailsLink } from "./LevelOneMetricDetailsLink";
import { LevelOneMetricsFrame } from "./LevelOneMetricsFrame";
import { useLevelOneMetricsSelection } from "./useLevelOneMetricsSelection";

export function LevelOneMetricsArea(
  props: Readonly<{
    config: AdminAppConfig;
    onNavigate: (path: string) => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  const selectionState = useLevelOneMetricsSelection(props.config, props.onTerminalAdminError);

  return (
    <LevelOneMetricsFrame
      selectionState={selectionState}
      onNavigate={props.onNavigate}
      renderCharts={(selection, search) => (
        <div className="level-1-metrics-grid">
          <WhoSawUsSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            detailsLink={buildLevelOneMetricDetailsLink("who-saw-us", search, props.onNavigate)}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoOpenedTheAppSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            detailsLink={buildLevelOneMetricDetailsLink("who-opened-the-app", search, props.onNavigate)}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoStudiedSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            detailsLink={buildLevelOneMetricDetailsLink("who-studied", search, props.onNavigate)}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoCameBackSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoPaidUsSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            onTerminalAdminError={props.onTerminalAdminError}
          />
        </div>
      )}
    />
  );
}

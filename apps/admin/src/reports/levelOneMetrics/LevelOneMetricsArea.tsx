import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { defaultSiteVisitorFilterState } from "../../filters/analyticsFilters";
import { WhoPaidUsSection } from "../whoPaidUs/WhoPaidUsSection";
import { WhoStudiedSection } from "../whoStudied/WhoStudiedSection";
import { WhoOpenedTheAppSection } from "../whoOpenedTheApp/WhoOpenedTheAppSection";
import { WhoSawUsSection } from "../whoSawUs/WhoSawUsSection";
import { buildLevelOneMetricDetailsLink } from "./LevelOneMetricDetailsLink";
import { LevelOneMetricsFrame, levelOneMetricsFilterBar } from "./LevelOneMetricsFrame";
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
      filterBar={levelOneMetricsFilterBar}
      onNavigate={props.onNavigate}
      renderCharts={(selection, search) => (
        <div className="level-1-metrics-grid">
          <WhoPaidUsSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            eventPlatforms={selection.eventPlatforms}
            detailsLink={buildLevelOneMetricDetailsLink("who-paid-us", search, props.onNavigate)}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoStudiedSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            eventPlatforms={selection.eventPlatforms}
            detailsLink={buildLevelOneMetricDetailsLink("who-studied", search, props.onNavigate)}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoOpenedTheAppSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            eventPlatforms={selection.eventPlatforms}
            detailsLink={buildLevelOneMetricDetailsLink("who-opened-the-app", search, props.onNavigate)}
            onTerminalAdminError={props.onTerminalAdminError}
          />
          <WhoSawUsSection
            config={props.config}
            dateRange={selection.dateRange}
            period={selection.period}
            series={selection.eventPlatforms}
            siteFilters={defaultSiteVisitorFilterState}
            detailsLink={buildLevelOneMetricDetailsLink("who-saw-us", search, props.onNavigate)}
            onTerminalAdminError={props.onTerminalAdminError}
          />
        </div>
      )}
    />
  );
}

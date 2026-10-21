import { useMemo, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelDetail } from "../../routing";
import { FirstLaunchFunnelDetailsPage } from "../firstLaunchFunnel/FirstLaunchFunnelDetailsPage";
import { funnelSections, type FunnelReportProps } from "./funnelSections";

const funnelDetailsPages: Readonly<Record<FunnelDetail, (props: FunnelReportProps) => JSX.Element>> = {
  "first-launch": FirstLaunchFunnelDetailsPage,
};

/**
 * The selection with the catalog fields cleared. No funnel reads them and the Funnels area offers no
 * control for them, so a value carried over from another area must not reload a funnel unseen.
 */
function buildFunnelsAreaFilters(filters: AnalyticsFilterState): AnalyticsFilterState {
  return {
    ...filters,
    installedDecks: [],
    catalogPlacements: [],
    catalogSources: [],
    catalogDeviceCategories: [],
    catalogClickBrowserLanguages: [],
  };
}

/**
 * The Funnels area: every funnel in `funnelSections` order as a chart card in the Level 1 metrics
 * grid, or one funnel's Details page when `funnelDetail` names it.
 */
export function FunnelsArea(
  props: Readonly<{
    config: AdminAppConfig;
    filters: AnalyticsFilterState;
    funnelDetail: FunnelDetail | null;
    isReportLoading: boolean;
    onNavigate: (path: string) => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  // Memoized on the selection, because every section reloads whenever the object it is given changes.
  const funnelFilters = useMemo(() => buildFunnelsAreaFilters(props.filters), [props.filters]);
  const FunnelDetailsPage = props.funnelDetail === null ? null : funnelDetailsPages[props.funnelDetail];

  return FunnelDetailsPage === null ? (
    <div className="level-1-metrics-grid">
      {funnelSections.map((funnel) => (
        <funnel.Section
          key={funnel.anchor.funnelId}
          config={props.config}
          filters={funnelFilters}
          isRangeLoading={props.isReportLoading}
          onTerminalAdminError={props.onTerminalAdminError}
          onDetailsNavigate={props.onNavigate}
        />
      ))}
    </div>
  ) : (
    <FunnelDetailsPage
      config={props.config}
      filters={funnelFilters}
      isRangeLoading={props.isReportLoading}
      onTerminalAdminError={props.onTerminalAdminError}
    />
  );
}

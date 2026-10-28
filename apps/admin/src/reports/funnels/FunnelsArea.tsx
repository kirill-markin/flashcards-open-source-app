import { useMemo, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelDetail } from "../../routing";
import { FirstLaunchFunnelDetailsPage } from "../firstLaunchFunnel/FirstLaunchFunnelDetailsPage";
import type { RetentionCurveCohortFilters } from "../retentionCurve/query";
import { StudiedRetentionCurveSection } from "../retentionCurve/RetentionCurveSections";
import { RetentionDetailsPage } from "../retentionCurve/RetentionDetailsPage";
import { funnelSections, type FunnelReportProps } from "./funnelSections";

/** What the Journeys tab shows: its cards, or the Details page of one of them. */
export type JourneysPage =
  | Readonly<{ kind: "cards" }>
  | Readonly<{ kind: "funnelDetails"; funnelId: FunnelDetail }>
  | Readonly<{ kind: "retentionDetails" }>;

const funnelDetailsPages: Readonly<Record<FunnelDetail, (props: FunnelReportProps) => JSX.Element>> = {
  "first-launch": FirstLaunchFunnelDetailsPage,
};

/**
 * The selection with the catalog fields cleared. No funnel reads them and the Journeys area offers no
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
 * The selection's cohort fields as one object that stays the same while their values do, because a
 * retention curve reloads whenever the object it is given changes and every apply makes new lists.
 * Equal joined values are equal lists, so the memo may keep the lists of the render that keyed it.
 */
function useRetentionCurveCohortFilters(filters: AnalyticsFilterState): RetentionCurveCohortFilters {
  const { eventPlatforms, connectionCountries, appUiLanguages } = filters;
  const eventPlatformsKey = eventPlatforms.join(",");
  const connectionCountriesKey = connectionCountries.join(",");
  const appUiLanguagesKey = appUiLanguages.join(",");
  return useMemo(
    () => ({ eventPlatforms, connectionCountries, appUiLanguages }),
    [eventPlatformsKey, connectionCountriesKey, appUiLanguagesKey],
  );
}

/**
 * The Journeys area: the Retention card, then every funnel in `funnelSections` order, as chart cards
 * in the Level 1 metrics grid, or the Details page `page` names.
 */
export function FunnelsArea(
  props: Readonly<{
    config: AdminAppConfig;
    filters: AnalyticsFilterState;
    page: JourneysPage;
    isReportLoading: boolean;
    onNavigate: (path: string) => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  // Memoized on the selection, because every section reloads whenever the object it is given changes.
  const funnelFilters = useMemo(() => buildFunnelsAreaFilters(props.filters), [props.filters]);
  const retentionCohortFilters = useRetentionCurveCohortFilters(props.filters);

  switch (props.page.kind) {
    case "cards":
      return (
        <div className="level-1-metrics-grid">
          <StudiedRetentionCurveSection
            config={props.config}
            dateRange={funnelFilters.dateRange}
            cohortFilters={retentionCohortFilters}
            comparisonDateRange={funnelFilters.comparisonDateRange}
            isRangeLoading={props.isReportLoading}
            onDetailsNavigate={props.onNavigate}
            onTerminalAdminError={props.onTerminalAdminError}
          />
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
      );
    case "funnelDetails": {
      const FunnelDetailsPage = funnelDetailsPages[props.page.funnelId];
      return (
        <FunnelDetailsPage
          config={props.config}
          filters={funnelFilters}
          isRangeLoading={props.isReportLoading}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      );
    }
    case "retentionDetails":
      return (
        <RetentionDetailsPage
          config={props.config}
          filters={funnelFilters}
          cohortFilters={retentionCohortFilters}
          isRangeLoading={props.isReportLoading}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      );
  }
}

import { useMemo, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { FunnelAudienceModeControl } from "./FunnelAudienceModeControl";
import { funnelSections } from "./funnelSections";

/**
 * The selection with the deck funnel's own fields cleared. The Funnels area offers no control for
 * them, so a value carried over from another area must not narrow a funnel unseen.
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
 * The Funnels area: the audience mode, then every funnel in `funnelSections` order as a chart card in
 * the Level 1 metrics grid.
 *
 * The mode sits above all of them and applies to all of them, because it answers a question the
 * funnels have to agree on: a number from one funnel and a number from another can only be compared
 * when both counted the same kind of person.
 */
export function FunnelsArea(
  props: Readonly<{
    config: AdminAppConfig;
    filters: AnalyticsFilterState;
    isReportLoading: boolean;
    onFiltersChange: (filters: AnalyticsFilterState) => boolean;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  // Memoized on the selection, because every section reloads whenever the object it is given changes.
  const funnelFilters = useMemo(() => buildFunnelsAreaFilters(props.filters), [props.filters]);

  return (
    <>
      {/* The full selection, so a mode change writes back every field rather than the cleared copy. */}
      <FunnelAudienceModeControl
        filters={props.filters}
        isReportLoading={props.isReportLoading}
        onFiltersChange={props.onFiltersChange}
      />
      <div className="level-1-metrics-grid">
        {funnelSections.map((funnel) => (
          <funnel.Section
            key={funnel.anchor.funnelId}
            config={props.config}
            filters={funnelFilters}
            isRangeLoading={props.isReportLoading}
            onTerminalAdminError={props.onTerminalAdminError}
          />
        ))}
      </div>
    </>
  );
}

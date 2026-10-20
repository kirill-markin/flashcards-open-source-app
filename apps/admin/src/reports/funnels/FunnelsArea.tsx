import type { JSX } from "react";
import type { ReviewEventsByDateUser } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { UserColorScale } from "../../dashboard/userColors";
import { AnalyticsFilterBar } from "../../filters/AnalyticsFilterBar";
import type { AnalyticsDateRange, AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { AnalyticsFilterOptions } from "../../filters/optionsQuery";
import { FunnelAudienceModeControl } from "./FunnelAudienceModeControl";
import { funnelSections } from "./funnelSections";

const noOptions: ReadonlyArray<never> = [];

/**
 * The Funnels area: the audience mode, then every funnel in `funnelSections` order, each with its own
 * filter row when it has one.
 *
 * The mode sits above all of them and applies to all of them, because it answers a question the
 * funnels have to agree on: a number from one funnel and a number from another can only be compared
 * when both counted the same kind of person.
 */
export function FunnelsArea(
  props: Readonly<{
    config: AdminAppConfig;
    /** `null` while the range lookup runs. */
    availableRange: AnalyticsDateRange | null;
    defaultRange: AnalyticsDateRange;
    filters: AnalyticsFilterState;
    /** `null` until the General batch first lands. */
    filterOptions: AnalyticsFilterOptions | null;
    userOptions: ReadonlyArray<ReviewEventsByDateUser>;
    userColorScale: UserColorScale;
    isReportLoading: boolean;
    dateRangeError: string;
    onFiltersChange: (filters: AnalyticsFilterState) => boolean;
    onNavigate: (path: string) => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  const filterOptions = props.filterOptions;

  return (
    <>
      <FunnelAudienceModeControl
        filters={props.filters}
        isReportLoading={props.isReportLoading}
        onFiltersChange={props.onFiltersChange}
      />
      {funnelSections.map((funnel) => (
        <funnel.Section
          key={funnel.anchor.funnelId}
          config={props.config}
          filters={props.filters}
          isRangeLoading={props.isReportLoading}
          onTerminalAdminError={props.onTerminalAdminError}
          filterRow={funnel.filterFields.length === 0 ? null : (
            // A funnel matches any click rather than a completed install, so its click dimensions
            // offer the values the clicks themselves carried.
            <AnalyticsFilterBar
              area="funnels"
              fields={funnel.filterFields}
              title={`${funnel.title} filters`}
              headingLevel={3}
              headingId={`funnel-${funnel.anchor.funnelId}-filters-title`}
              resetAllLabel={`Reset all ${funnel.anchor.funnelId} funnel filters`}
              availableRange={props.availableRange}
              defaultRange={props.defaultRange}
              filters={props.filters}
              userOptions={props.userOptions}
              connectionCountryOptions={filterOptions?.connectionCountries ?? noOptions}
              appUiLanguageOptions={filterOptions?.appUiLanguages ?? noOptions}
              catalogDeckOptions={filterOptions?.catalogDecks ?? noOptions}
              catalogPlacementOptions={filterOptions?.funnelCatalogPlacements ?? noOptions}
              catalogSourceOptions={filterOptions?.funnelCatalogSources ?? noOptions}
              catalogDeviceCategoryOptions={filterOptions?.funnelCatalogDeviceCategories ?? noOptions}
              catalogClickBrowserLanguageOptions={filterOptions?.funnelCatalogClickBrowserLanguages ?? noOptions}
              areOptionListsLoading={filterOptions === null}
              isReportLoading={props.isReportLoading}
              dateRangeError={props.dateRangeError}
              userColorScale={props.userColorScale}
              onFiltersChange={props.onFiltersChange}
              onNavigate={props.onNavigate}
            />
          )}
        />
      ))}
    </>
  );
}

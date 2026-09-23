import type { JSX } from "react";
import type { ReviewEventsByDateUser } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { UserColorScale } from "../../dashboard/userColors";
import { AnalyticsFilterBar } from "../../filters/AnalyticsFilterBar";
import type { AnalyticsDateRange, AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { AnalyticsFilterOptions } from "../../filters/optionsQuery";
import { FunnelAudienceModeControl } from "./FunnelAudienceModeControl";
import { funnelSections } from "./funnelSections";

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
    availableRange: AnalyticsDateRange;
    defaultRange: AnalyticsDateRange;
    filters: AnalyticsFilterState;
    filterOptions: AnalyticsFilterOptions;
    userOptions: ReadonlyArray<ReviewEventsByDateUser>;
    userColorScale: UserColorScale;
    isReportLoading: boolean;
    dateRangeError: string;
    onFiltersChange: (filters: AnalyticsFilterState) => boolean;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
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
              connectionCountryOptions={props.filterOptions.connectionCountries}
              appUiLanguageOptions={props.filterOptions.appUiLanguages}
              catalogDeckOptions={props.filterOptions.catalogDecks}
              catalogPlacementOptions={props.filterOptions.funnelCatalogPlacements}
              catalogSourceOptions={props.filterOptions.funnelCatalogSources}
              catalogDeviceCategoryOptions={props.filterOptions.funnelCatalogDeviceCategories}
              catalogClickBrowserLanguageOptions={props.filterOptions.funnelCatalogClickBrowserLanguages}
              isReportLoading={props.isReportLoading}
              dateRangeError={props.dateRangeError}
              userColorScale={props.userColorScale}
              onFiltersChange={props.onFiltersChange}
            />
          )}
        />
      ))}
    </>
  );
}

import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import { appStoreProductPagesAnalyticsFilterFields, type AnalyticsDateRange } from "../../filters/analyticsFilters";
import { loadAppStoreProductPageFilterOptions, type AppStoreProductPageFilterOptions } from "../../filters/optionsQuery";
import { getWhoSawUsDatasetPath } from "../../routing";
import { LevelOneMetricDetailsHeader } from "../levelOneMetrics/LevelOneMetricDetailsHeader";
import {
  LevelOneMetricsFrame,
  noAppVersionOptions,
  noSiteOptions,
  type LevelOneMetricsFilterBar,
} from "../levelOneMetrics/LevelOneMetricsFrame";
import type { LevelOneMetricsSelection } from "../levelOneMetrics/levelOneMetricsUrl";
import { useFilterOptionsLookup, type FilterOptionsLookup } from "../levelOneMetrics/useFilterOptionsLookup";
import { useLevelOneMetricsSelection } from "../levelOneMetrics/useLevelOneMetricsSelection";
import { AppStoreProductPagesSections } from "./AppStoreProductPagesSections";
import {
  appStoreProductPagePeriods,
  defaultAppStoreListing,
  getShownAppStoreProductPagePeriod,
  loadAppStoreListings,
} from "./query";

const listingFieldId = "app-store-product-pages-listing";

// The page counts Apple's whole weekly or monthly rows rather than days, so the Level 1 days wording would be false here.
const dateRangeExplanation = "Counts only the whole weeks or months inside this range, from Apple's detailed weekly and monthly reports.";

function useAppStoreListings(
  config: AdminAppConfig,
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean,
): FilterOptionsLookup<ReadonlyArray<string>> {
  const [lookup, setLookup] = useState<FilterOptionsLookup<ReadonlyArray<string>>>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    setLookup({ status: "loading" });
    const abortController = new AbortController();
    void loadAppStoreListings(config, abortController.signal).then((options) => {
      if (!cancelled) setLookup({ status: "ready", options });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setLookup({
        status: "error",
        message: error instanceof Error ? error.message : "Unexpected App Store listings error.",
        retry: () => setRevision((value) => value + 1),
      });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [config, onTerminalAdminError, revision]);
  return lookup;
}

/** The listing in the URL while Apple still reports it, else the default listing, else the first one; `null` without any. */
function resolveListing(listings: ReadonlyArray<string>, requestedListing: string | null): string | null {
  if (requestedListing !== null && listings.includes(requestedListing)) return requestedListing;
  if (listings.includes(defaultAppStoreListing)) return defaultAppStoreListing;
  return listings[0] ?? null;
}

/**
 * Per App Store listing, Apple's detailed weekly or monthly product page views and first-time
 * downloads, on the Level 1 selection plus the App Store filters and the listing it carries.
 */
export function AppStoreProductPagesPage(
  props: Readonly<{
    config: AdminAppConfig;
    onNavigate: (path: string) => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
    /** The admin tab row, given the query string that carries this page's selection. */
    renderNavigation: (levelOneMetricsSearch: string) => ReactNode;
  }>,
): JSX.Element {
  const selectionState = useLevelOneMetricsSelection(props.config, props.onTerminalAdminError);
  const shownPeriod = getShownAppStoreProductPagePeriod(selectionState.selection.period);
  const loadFilterOptions = useCallback(
    (config: AdminAppConfig, dateRange: AnalyticsDateRange, signal: AbortSignal): Promise<AppStoreProductPageFilterOptions> => (
      loadAppStoreProductPageFilterOptions(config, dateRange, shownPeriod, signal)
    ),
    [shownPeriod],
  );
  const appStoreOptions = useFilterOptionsLookup(
    props.config,
    selectionState.selection.dateRange,
    loadFilterOptions,
    "Unexpected App Store filter options error.",
    props.onTerminalAdminError,
  );
  const filterBar = useMemo((): LevelOneMetricsFilterBar => ({
    fields: appStoreProductPagesAnalyticsFilterFields,
    dateRangeExplanation,
    siteOptions: noSiteOptions,
    appStoreOptions,
    appVersionOptions: noAppVersionOptions,
    title: "Filters",
    resetAllLabel: "Reset the Product pages filters",
  }), [appStoreOptions]);
  const listings = useAppStoreListings(props.config, props.onTerminalAdminError);

  const renderCharts = (selection: LevelOneMetricsSelection): ReactNode => {
    const listing = listings.status === "ready" ? resolveListing(listings.options, selection.appStoreListing) : null;
    return (
      <>
        <div className="funnel-group-by-row">
          <div className="funnel-group-by">
            <label htmlFor={listingFieldId}>Listing</label>
            <select
              id={listingFieldId}
              className="funnel-group-by-select"
              data-testid={listingFieldId}
              value={listing ?? ""}
              disabled={listing === null}
              onChange={(event) => selectionState.setAppStoreListing(event.target.value)}
            >
              {listings.status === "ready"
                ? listings.options.map((option) => <option key={option} value={option}>{option}</option>)
                : <option value="">{listings.status === "loading" ? "Loading listings…" : "Listings failed to load"}</option>}
              {listings.status === "ready" && listing === null ? <option value="">No listing yet</option> : null}
            </select>
          </div>
        </div>

        {listings.status === "error" ? (
          <div className="report-state report-state-error" role="alert">
            <strong>The App Store listings failed to load.</strong>
            <span>{listings.message}</span>
            <button className="filter-button" type="button" onClick={listings.retry}>Retry</button>
          </div>
        ) : null}

        {listings.status === "ready" && listing === null ? (
          <p className="report-state" data-testid="app-store-product-pages-no-listings">
            Apple has not reported any App Store listing in its detailed product page rows yet. It may not have published enough data: it omits every detailed row below 5.
          </p>
        ) : null}

        {listing === null ? null : (
          <AppStoreProductPagesSections
            config={props.config}
            dateRange={selection.dateRange}
            period={getShownAppStoreProductPagePeriod(selection.period)}
            listing={listing}
            filters={selection.appStoreFilters}
            onTerminalAdminError={props.onTerminalAdminError}
          />
        )}
      </>
    );
  };

  return (
    <>
      {props.renderNavigation(selectionState.search)}

      <LevelOneMetricDetailsHeader
        backPath={`${getWhoSawUsDatasetPath("app-store")}${selectionState.search}`}
        backLabel="App Store details"
        title="Who saw us · App Store · Product pages"
        onNavigate={props.onNavigate}
      />

      <LevelOneMetricsFrame
        selectionState={selectionState}
        filterBar={filterBar}
        groupByPeriods={appStoreProductPagePeriods}
        onNavigate={props.onNavigate}
        renderCharts={renderCharts}
      />
    </>
  );
}

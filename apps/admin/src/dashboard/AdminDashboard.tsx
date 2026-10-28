import { useMemo, type JSX } from "react";
import type {
  CatalogInstallsReport,
  ReviewEventsByDateReport,
  ReviewEventsByDateUser,
} from "../adminApi";
import { getPackageColorScale } from "../charts/chartPrimitives";
import { formatDateRangeLabel } from "../charts/formatting";
import type { AdminAppConfig } from "../config";
import { AnalyticsFilterBar } from "../filters/AnalyticsFilterBar";
import {
  analyticsFilterFieldsByArea,
  reviewPromptDetailsAnalyticsFilterFields,
  type AnalyticsFilterState,
} from "../filters/analyticsFilters";
import { noSiteVisitorFilterOptions, type AnalyticsFilterOptions } from "../filters/optionsQuery";
import { AdminNavigation } from "../navigation/AdminNavigation";
import { AiUsageCohortsSection } from "../reports/aiUsageCohorts/AiUsageCohortsSection";
import { AudienceSection } from "../reports/audience/AudienceSection";
import { CatalogInstallsSection } from "../reports/catalogInstalls/CatalogInstallsSection";
import { FunnelDetailsHeader } from "../reports/funnels/FunnelDetailsHeader";
import { FunnelsArea } from "../reports/funnels/FunnelsArea";
import type { GeneralReportView } from "../reports/generalReportView";
import { LevelOneMetricDetailsPage } from "../reports/levelOneMetrics/LevelOneMetricDetailsPage";
import { LevelOneMetricsArea } from "../reports/levelOneMetrics/LevelOneMetricsArea";
import type { ReviewEventsByDateRange } from "../reports/reviewEventsByDate/query";
import type { ReviewPromptId } from "../reports/reviewPrompts/reviewPromptDefinitions";
import { ReviewPromptDetailsHeader, ReviewPromptDetailsPage } from "../reports/reviewPrompts/ReviewPromptDetailsPage";
import { ReviewPromptsArea } from "../reports/reviewPrompts/ReviewPromptsArea";
import { SocialConnectionsSection } from "../reports/socialConnections/SocialConnectionsSection";
import { WhoSawUsDatasetPage } from "../reports/whoSawUs/WhoSawUsDatasetPage";
import type { AdminRoute, AnalyticsArea, FunnelDetail } from "../routing";
import { getStableUserColorDomain, getUserColorScale } from "./userColors";

export type AdminReportsData = Readonly<{
  filterOptions: AnalyticsFilterOptions;
  report: ReviewEventsByDateReport;
  catalogInstallsReport: CatalogInstallsReport;
}>;

/**
 * The General batch - the filter bar's option lists and the two General reports - an analytics
 * area either already has, is still fetching, or failed to fetch. Every area but Level 1 metrics
 * loads it; only General waits for it. A failure is area-local and retryable; only a terminal
 * 401/403 replaces the whole page.
 */
export type AdminReportState =
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "error";
      message: string;
      /** A Retry the operator pressed is in flight, so the control says so instead of reading as dead. */
      isRetrying: boolean;
    }>
  | Readonly<{
      status: "ready";
      data: AdminReportsData;
      isReportLoading: boolean;
      /**
       * The failure of a reload that had numbers on screen already. Non-empty is also the record
       * that those numbers answer an older selection than the current one, so it drives both the
       * sticky failure banner and the stale mark on the sections. Only an outcome clears it.
       */
      reloadError: string;
    }>;

/** The available range the date picker is bounded by, looked up once per page load in the background. */
export type AnalyticsRangeLookup =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
      status: "ready";
      availableRange: ReviewEventsByDateRange;
      defaultRange: ReviewEventsByDateRange;
    }>;

const noOptions: ReadonlyArray<never> = [];

type AnalyticsReportSectionsProps = Readonly<{
  activeArea: AnalyticsArea;
  /** The funnel whose Details page the Funnels area shows, or `null` for the area itself. */
  funnelDetail: FunnelDetail | null;
  /** The prompt whose Details page the Review prompts area shows, or `null` for its table. */
  reviewPromptDetail: ReviewPromptId | null;
  config: AdminAppConfig;
  reportState: AdminReportState;
  rangeLookup: AnalyticsRangeLookup;
  /** The lookup's default once it returns, the browser-computed one until then. */
  defaultRange: ReviewEventsByDateRange;
  filters: AnalyticsFilterState;
  /** A filter change is still inside the reload debounce, so the areas that query on their own wait. */
  isSelectionSettling: boolean;
  dateRangeError: string;
  onReportRetry: () => void;
  onRangeLookupRetry: () => void;
  onFiltersChange: (filters: AnalyticsFilterState) => boolean;
  onNavigate: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>;

type GeneralReportState = Extract<AdminReportState, { status: "loading" | "ready" }>;

/** Loading while a batch is in flight, so the charts hold placeholders; a failed reload falls back to the last loaded report, marked stale. */
function toGeneralReportView<Report>(
  reportState: GeneralReportState,
  selectReport: (data: AdminReportsData) => Report,
): GeneralReportView<Report> {
  if (reportState.status === "loading") {
    return { status: "loading", lastLoadedReport: null };
  }

  const report = selectReport(reportState.data);
  return reportState.isReportLoading
    ? { status: "loading", lastLoadedReport: report }
    : { status: "ready", report };
}

function GeneralReportSections(
  props: Readonly<{
    reportState: GeneralReportState;
  }>,
): JSX.Element {
  const data = props.reportState.status === "ready" ? props.reportState.data : null;
  // The numbers on screen are the ones a failed reload left behind.
  const isReportStale = props.reportState.status === "ready" && props.reportState.reloadError !== "";
  const catalogPackageSlugs = data === null ? noOptions : data.filterOptions.catalogPackageSlugs;

  // From the options rather than the report, so a deck does not change colour because a filter
  // removed another deck.
  const packageColorScale = useMemo(
    () => getPackageColorScale(catalogPackageSlugs),
    [catalogPackageSlugs],
  );

  return (
    <div className={isReportStale ? "report-sections-stale" : undefined}>
      <CatalogInstallsSection
        filteredReport={toGeneralReportView(props.reportState, (loaded) => loaded.catalogInstallsReport)}
        packageColorScale={packageColorScale}
      />

      <SocialConnectionsSection
        filteredReport={toGeneralReportView(props.reportState, (loaded) => loaded.report)}
      />
    </div>
  );
}

function AnalyticsReportSections(props: AnalyticsReportSectionsProps): JSX.Element {
  const reportState = props.reportState;
  const filterOptions = reportState.status === "ready" ? reportState.data.filterOptions : null;
  const availableRange = props.rangeLookup.status === "ready" ? props.rangeLookup.availableRange : null;
  const userOptions: ReadonlyArray<ReviewEventsByDateUser> = filterOptions?.users ?? noOptions;
  // Only General draws the General batch, so only there does its reload drive the bar; every other
  // area queries on its own once the selection settles.
  const isReportLoading = props.activeArea === "general"
    ? reportState.status === "loading" || (reportState.status === "ready" && reportState.isReportLoading)
    : props.isSelectionSettling;

  // The user colour domain comes from the range-scoped options rather than from the reports on
  // screen, so a person keeps one colour wherever they appear. The options span every section's
  // users, so no section can ask the shared scale for an id it does not hold.
  const userColorScale = useMemo(
    () => getUserColorScale(getStableUserColorDomain(userOptions)),
    [userOptions],
  );
  // The shared bar offers catalog fields only on the user-scoped areas, which match a person through a
  // completed install and offer what that bridge can reach.
  return (
    <>
      <AnalyticsFilterBar
        area={props.activeArea}
        fields={props.reviewPromptDetail === null
          ? analyticsFilterFieldsByArea[props.activeArea]
          : reviewPromptDetailsAnalyticsFilterFields}
        title="Filters"
        headingLevel={2}
        headingId="analytics-filters-title"
        resetAllLabel="Reset all filters"
        availableRange={availableRange}
        defaultRange={props.defaultRange}
        filters={props.filters}
        userOptions={userOptions}
        connectionCountryOptions={filterOptions?.connectionCountries ?? noOptions}
        appUiLanguageOptions={filterOptions?.appUiLanguages ?? noOptions}
        catalogDeckOptions={filterOptions?.catalogDecks ?? noOptions}
        catalogPlacementOptions={filterOptions?.catalogPlacements ?? noOptions}
        catalogSourceOptions={filterOptions?.catalogSources ?? noOptions}
        catalogDeviceCategoryOptions={filterOptions?.catalogDeviceCategories ?? noOptions}
        catalogClickBrowserLanguageOptions={filterOptions?.catalogClickBrowserLanguages ?? noOptions}
        siteVisitorOptions={noSiteVisitorFilterOptions}
        areOptionListsLoading={filterOptions === null}
        isReportLoading={isReportLoading}
        dateRangeError={props.dateRangeError}
        userColorScale={userColorScale}
        onFiltersChange={props.onFiltersChange}
        onNavigate={props.onNavigate}
      />

      {props.rangeLookup.status === "error" ? (
        <div className="report-state report-state-error" role="alert">
          <strong>The analytics date range failed to load.</strong>
          <span>{props.rangeLookup.message}</span>
          <button
            className="filter-button"
            type="button"
            onClick={props.onRangeLookupRetry}
          >Retry</button>
        </div>
      ) : null}

      {/* Every other area renders without the General batch, which only fills the option lists there. */}
      {reportState.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{props.activeArea === "general"
            ? "Analytics reports failed to load."
            : "The filter option lists failed to load."}</strong>
          <span>{reportState.message}</span>
          <button
            className="filter-button"
            type="button"
            disabled={reportState.isRetrying}
            onClick={props.onReportRetry}
          >{reportState.isRetrying ? "Retrying…" : "Retry"}</button>
        </div>
      ) : null}

      {/*
        Only the General sections are drawn from the report state a failed reload leaves behind;
        Audience and Funnels fetch their own data from the live selection and own their error states,
        so the stale mark stops here.
      */}
      {props.activeArea === "general" && reportState.status !== "error" ? <GeneralReportSections
        reportState={reportState}
      /> : null}

      {props.activeArea === "funnels" ? <FunnelsArea
        config={props.config}
        filters={props.filters}
        funnelDetail={props.funnelDetail}
        isReportLoading={props.isSelectionSettling}
        onNavigate={props.onNavigate}
        onTerminalAdminError={props.onTerminalAdminError}
      /> : null}

      {props.activeArea === "review-prompts" && props.reviewPromptDetail === null ? <ReviewPromptsArea
        config={props.config}
        filters={props.filters}
        isReportLoading={props.isSelectionSettling}
        onNavigate={props.onNavigate}
        onTerminalAdminError={props.onTerminalAdminError}
      /> : null}

      {/* Keyed by prompt, so moving between two Details pages starts each card afresh. */}
      {props.reviewPromptDetail === null ? null : <ReviewPromptDetailsPage
        key={props.reviewPromptDetail}
        promptId={props.reviewPromptDetail}
        config={props.config}
        filters={props.filters}
        isRangeLoading={props.isSelectionSettling}
        onTerminalAdminError={props.onTerminalAdminError}
      />}

      {props.activeArea === "audience" ? <AudienceSection
        config={props.config}
        filters={props.filters}
        isRangeLoading={props.isSelectionSettling}
        onTerminalAdminError={props.onTerminalAdminError}
      /> : null}

      {props.activeArea === "ai-usage" ? <AiUsageCohortsSection
        config={props.config}
        filters={props.filters}
        isRangeLoading={props.isSelectionSettling}
        onTerminalAdminError={props.onTerminalAdminError}
      /> : null}
    </>
  );
}

/**
 * The routes the dashboard shell renders: an analytics area, or a Level 1 Details, Who saw us
 * dataset, funnel Details or review prompt Details page under its tab.
 */
export type AdminDashboardRoute = Extract<
  AdminRoute,
  { kind: "analyticsArea" | "levelOneMetricDetails" | "whoSawUsDataset" | "funnelDetails" | "reviewPromptDetails" }
>;

function getActiveArea(route: AdminDashboardRoute): AnalyticsArea {
  switch (route.kind) {
    case "analyticsArea":
      return route.area;
    case "funnelDetails":
      return "funnels";
    case "reviewPromptDetails":
      return "review-prompts";
    case "levelOneMetricDetails":
    case "whoSawUsDataset":
      return "level-1-metrics";
  }
}

export function AdminDashboard(
  props: Readonly<{
    route: AdminDashboardRoute;
    onNavigate: (path: string) => void;
    config: AdminAppConfig;
    adminEmail: string;
    reportState: AdminReportState;
    rangeLookup: AnalyticsRangeLookup;
    /** `null` exactly while `filters` is, before the first analytics area opens. */
    defaultRange: ReviewEventsByDateRange | null;
    filters: AnalyticsFilterState | null;
    isSelectionSettling: boolean;
    dateRangeError: string;
    onReportRetry: () => void;
    onRangeLookupRetry: () => void;
    onFiltersChange: (filters: AnalyticsFilterState) => boolean;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  const activeArea = getActiveArea(props.route);
  const funnelDetail = props.route.kind === "funnelDetails" ? props.route.funnelId : null;
  const reviewPromptDetail = props.route.kind === "reviewPromptDetails" ? props.route.promptId : null;
  // Level 1 metrics loads and ranges its own charts, so nothing below about the General reports applies.
  const usesGeneralReports = activeArea !== "level-1-metrics";
  // The range the numbers on screen were produced with, which lags the selection while a reload runs.
  const appliedRange = usesGeneralReports && props.reportState.status === "ready"
    ? { from: props.reportState.data.report.from, to: props.reportState.data.report.to }
    : null;
  const renderNavigation = (levelOneMetricsSearch: string): JSX.Element => (
    <AdminNavigation
      activePage={activeArea}
      levelOneMetricsSearch={levelOneMetricsSearch}
      onNavigate={props.onNavigate}
    />
  );

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Admin Analytics</p>
          <h1>Product Analytics</h1>
        </div>
        <div className="hero-meta">
          <span className="hero-badge">Signed in as {props.adminEmail}</span>
          {appliedRange !== null ? <span className="hero-badge">General range {formatDateRangeLabel(appliedRange.from)} to {formatDateRangeLabel(appliedRange.to)}</span> : null}
          <span className="hero-badge">All dates and times in UTC</span>
        </div>
      </section>

      {/*
        A Details or Who saw us dataset page renders the tab row itself, because only it knows the
        selection its Level 1 metrics tab has to carry back. Keyed by metric or dataset, because its
        selection is read from the URL once, so moving between two such pages in history has to
        remount it.
      */}
      {props.route.kind === "levelOneMetricDetails" ? (
        <LevelOneMetricDetailsPage
          key={props.route.metric}
          metric={props.route.metric}
          config={props.config}
          onNavigate={props.onNavigate}
          onTerminalAdminError={props.onTerminalAdminError}
          renderNavigation={renderNavigation}
        />
      ) : null}

      {props.route.kind === "whoSawUsDataset" ? (
        <WhoSawUsDatasetPage
          key={props.route.dataset}
          dataset={props.route.dataset}
          config={props.config}
          onNavigate={props.onNavigate}
          onTerminalAdminError={props.onTerminalAdminError}
          renderNavigation={renderNavigation}
        />
      ) : null}

      {props.route.kind === "analyticsArea" || props.route.kind === "funnelDetails" || props.route.kind === "reviewPromptDetails"
        ? renderNavigation("")
        : null}

      {funnelDetail === null ? null : <FunnelDetailsHeader funnelId={funnelDetail} onNavigate={props.onNavigate} />}
      {reviewPromptDetail === null ? null : <ReviewPromptDetailsHeader promptId={reviewPromptDetail} onNavigate={props.onNavigate} />}

      {props.route.kind === "analyticsArea" && props.route.area === "level-1-metrics" ? (
        <LevelOneMetricsArea
          config={props.config}
          onNavigate={props.onNavigate}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      ) : null}

      {/*
        A reload that fails leaves complete, confidently drawn numbers on screen, so the failure gets
        the one place a filter popover cannot cover and a scroll to the charts cannot leave behind: a
        sticky banner above the filter panel, stacked over the popovers, carrying the Retry the
        operator has to press because nothing retries on its own.
      */}
      {usesGeneralReports && props.reportState.status === "ready" && props.reportState.reloadError !== "" ? (
        <div className="report-reload-banner" role="alert">
          <div className="report-reload-banner-text">
            {/*
              Funnels and Audience fetch their own numbers from the live selection, so on those areas
              the report on screen is not what the failure left behind. The shared range is loaded
              once per page load and cannot go stale, so the only thing the failed reload can leave
              behind there is the option lists, which are refetched with it whenever the range moves.
            */}
            <strong>{activeArea === "general"
              ? "General reports failed to reload. The numbers below are stale."
              : "General reports failed to reload. The filter option lists may not match the current range."}</strong>
            {/* Clamped to three lines in CSS, so a long backend message cannot take over a short
                viewport for as long as the failure stands; `title` keeps the whole text reachable. */}
            <span title={props.reportState.reloadError}>{props.reportState.reloadError}</span>
          </div>
          <button
            className="filter-button"
            type="button"
            disabled={props.reportState.isReportLoading}
            onClick={props.onReportRetry}
          >{props.reportState.isReportLoading ? "Reloading…" : "Retry"}</button>
        </div>
      ) : null}

      {usesGeneralReports && props.filters !== null && props.defaultRange !== null ? (
        <AnalyticsReportSections
          activeArea={activeArea}
          funnelDetail={funnelDetail}
          reviewPromptDetail={reviewPromptDetail}
          config={props.config}
          reportState={props.reportState}
          rangeLookup={props.rangeLookup}
          defaultRange={props.defaultRange}
          filters={props.filters}
          isSelectionSettling={props.isSelectionSettling}
          dateRangeError={props.dateRangeError}
          onReportRetry={props.onReportRetry}
          onRangeLookupRetry={props.onRangeLookupRetry}
          onFiltersChange={props.onFiltersChange}
          onNavigate={props.onNavigate}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      ) : null}
    </main>
  );
}

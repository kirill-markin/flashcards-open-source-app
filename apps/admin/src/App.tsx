import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { AdminApiError, fetchAdminSession, type AdminSession } from "./adminApi";
import { getAdminAppConfig, type AdminAppConfig } from "./config";
import { AdminDashboard, type AdminReportState } from "./dashboard/AdminDashboard";
import type { AnalyticsDateRange, AnalyticsFilterState } from "./filters/analyticsFilters";
import {
  normalizeAnalyticsFilterState,
  parseAnalyticsFilterState,
  toAnalyticsFilterSearchParams,
} from "./filters/analyticsFiltersUrl";
import { loadAnalyticsFilterOptions, type AnalyticsFilterOptions } from "./filters/optionsQuery";
import { AnalyticsIndexPage } from "./navigation/AnalyticsIndexPage";
import { NotFoundPage } from "./navigation/NotFoundPage";
import { RootIndexPage } from "./navigation/RootIndexPage";
import {
  parseAiUsageControls,
  withAiUsageControlSearchParams,
} from "./reports/aiUsageCohorts/aiUsageCohortsUrl";
import { loadCatalogInstallFunnelAvailableRange } from "./reports/catalogInstallFunnel/query";
import { loadCatalogInstallsReport } from "./reports/catalogInstalls/query";
import { loadDailyActiveUsersReport } from "./reports/dailyActiveUsers/query";
import {
  parseFunnelAnchorStepId,
  withFunnelAnchorSearchParams,
} from "./reports/funnels/funnelAnchorUrl";
import {
  readFunnelGroupByParam,
  withFunnelGroupBySearchParams,
} from "./reports/funnels/funnelGroupBy";
import { funnelSections } from "./reports/funnels/funnelSections";
import { buildDefaultReportRange } from "./reports/reportValues";
import {
  loadReviewEventsByDateAvailableRange,
  loadReviewEventsByDateReport,
  type ReviewEventsByDateRange,
} from "./reports/reviewEventsByDate/query";
import { getAdminRoutePath, parseAdminRoute, type AdminRoute } from "./routing";

type AppState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "redirecting" }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; config: AdminAppConfig; session: AdminSession }>;

/** The ranges the picker validates against, loaded once per page load. */
type AdminReportRanges = Readonly<{
  availableRange: ReviewEventsByDateRange;
  defaultRange: ReviewEventsByDateRange;
}>;

// Every filter is applied server-side, so a burst of clicks would be a burst of report queries. The
// newest selection waits this long before it is sent, and the ones it superseded never reach the
// network at all.
const filterReloadDebounceMs = 400;

const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

function parseCalendarDate(date: string, fieldName: string): Date {
  const match = calendarDatePattern.exec(date);
  if (match === null) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD date.`);
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const parsedDate = new Date(Date.UTC(year, monthIndex, day));

  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== monthIndex
    || parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} must be a valid calendar date.`);
  }

  return parsedDate;
}

function compareCalendarDates(left: string, right: string): number {
  return parseCalendarDate(left, "Date").getTime() - parseCalendarDate(right, "Date").getTime();
}

function validateRequestedRange(
  range: ReviewEventsByDateRange,
  availableRange: ReviewEventsByDateRange,
): string | null {
  try {
    parseCalendarDate(range.from, "From date");
    parseCalendarDate(range.to, "To date");
  } catch (error) {
    return error instanceof Error ? error.message : "Date range is invalid.";
  }

  if (compareCalendarDates(range.from, range.to) > 0) {
    return "From date must be on or before To date.";
  }

  if (compareCalendarDates(range.from, availableRange.from) < 0) {
    return `From date must be on or after ${availableRange.from}.`;
  }

  if (compareCalendarDates(range.to, availableRange.to) > 0) {
    return `To date must be on or before ${availableRange.to}.`;
  }

  return null;
}

/**
 * The bounds the shared date picker allows: every day either area can carry data on.
 *
 * The review events and the catalog funnel start on different days, and one bar now drives both, so
 * a range with data in one area and none in the other stays selectable and simply shows an empty
 * tail rather than being refused.
 */
function buildUnionRange(
  left: ReviewEventsByDateRange,
  right: ReviewEventsByDateRange,
): ReviewEventsByDateRange {
  return {
    from: compareCalendarDates(left.from, right.from) <= 0 ? left.from : right.from,
    to: compareCalendarDates(left.to, right.to) >= 0 ? left.to : right.to,
  };
}

/** Every analytics area renders the shared filter bar and carries its selection in the URL. */
function doesRouteUseAnalyticsFilters(route: AdminRoute): boolean {
  return route.kind === "analyticsArea";
}

/**
 * The query string of one area: the shared filter selection, plus whatever parameters that area owns.
 *
 * An area-specific parameter is carried over from the URL the browser is on rather than held in this
 * component, because the control that owns it lives inside the area and writes it there directly.
 * Every one of them is added on its own route only, so none can leak into another area's links: the
 * filter writer starts from a fresh `URLSearchParams` each time, which is what drops them again on
 * the way out.
 *
 * The Funnels parameters are validated on the way through - an anchor against that funnel's own steps
 * - while a group-by value is only carried, because the option list is per funnel and lives with the
 * funnel. The Study-vs-AI controls are validated by their own parser, which falls back to the default
 * for anything outside the two closed option lists.
 */
function buildAreaSearchParams(
  route: AdminRoute,
  filterSearchParams: URLSearchParams,
  currentSearchParams: URLSearchParams,
): URLSearchParams {
  if (route.kind !== "analyticsArea") {
    return filterSearchParams;
  }

  if (route.area === "funnels") {
    return funnelSections.reduce(
      (nextSearchParams, funnel) => withFunnelGroupBySearchParams(
        withFunnelAnchorSearchParams(
          nextSearchParams,
          funnel.anchor,
          parseFunnelAnchorStepId(currentSearchParams, funnel.anchor),
        ),
        funnel.anchor.funnelId,
        readFunnelGroupByParam(currentSearchParams, funnel.anchor.funnelId),
      ),
      filterSearchParams,
    );
  }

  if (route.area === "ai-usage") {
    return withAiUsageControlSearchParams(
      filterSearchParams,
      parseAiUsageControls(currentSearchParams),
    );
  }

  return filterSearchParams;
}

function redirectToLogin(config: AdminAppConfig): void {
  const loginUrl = new URL(`${config.authBaseUrl}/login`);
  loginUrl.searchParams.set("redirect_uri", window.location.href);
  loginUrl.searchParams.set("locale", navigator.language || "en");
  window.location.replace(loginUrl.toString());
}

function LoadingState(): JSX.Element {
  return (
    <main className="shell centered-shell">
      <section className="state-panel">
        <p className="eyebrow">Admin</p>
        <h1>Loading dashboard</h1>
        <p className="state-copy">Checking the current admin session.</p>
      </section>
    </main>
  );
}

function DeniedState(): JSX.Element {
  return (
    <main className="shell centered-shell">
      <section className="state-panel">
        <p className="eyebrow">Admin Access Required</p>
        <h1>У вас нет доступа администратора.</h1>
        <p className="state-copy">Запросите доступ администратора, пожалуйста.</p>
      </section>
    </main>
  );
}

function ErrorState(props: Readonly<{ message: string }>): JSX.Element {
  const isUnsupportedHostError = props.message.startsWith("Unsupported admin hostname:");
  const title = isUnsupportedHostError ? "Unsupported admin hostname" : "Dashboard failed to load";

  return (
    <main className="shell centered-shell">
      <section className="state-panel">
        <p className="eyebrow">Admin Error</p>
        <h1>{title}</h1>
        <p className="state-copy">{props.message}</p>
      </section>
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected admin app error.";
}

export default function App(): JSX.Element {
  const [appState, setAppState] = useState<AppState>({ status: "loading" });
  const [reportState, setReportState] = useState<AdminReportState>({ status: "loading" });
  const [route, setRoute] = useState<AdminRoute>(() => parseAdminRoute(window.location.pathname));
  const [reportLoadRevision, setReportLoadRevision] = useState<number>(0);
  // The whole filter selection lives here, above every area, so leaving General for Funnels and
  // coming back keeps it. It is null until the available range is known, because the default
  // selection opens on the default range.
  const [filterState, setFilterState] = useState<AnalyticsFilterState | null>(null);
  // Mirrors `filterState` for `applyFilters`, which has to stay stable across renders and therefore
  // cannot read the state itself.
  const filterStateRef = useRef<AnalyticsFilterState | null>(null);
  const [reportRanges, setReportRanges] = useState<AdminReportRanges | null>(null);
  // The available range is fetched at most once per page load. The latch is also the re-entry guard:
  // while that request is in flight no revision bump or area switch can start a second one.
  const hasRequestedAvailableRangeRef = useRef<boolean>(false);
  // Only a view that already has numbers on screen waits for the debounce; the first load has
  // nothing to coalesce.
  const hasLoadedReportsRef = useRef<boolean>(false);
  const loadedFilterOptionsRef = useRef<Readonly<{
    dateRange: AnalyticsDateRange;
    options: AnalyticsFilterOptions;
  }> | null>(null);

  // A trailing-slash variant of a known route is rewritten in place, so the address bar and any
  // later history entry carry the canonical path without a network redirect.
  useEffect(() => {
    const canonicalPath = getAdminRoutePath(parseAdminRoute(window.location.pathname));
    if (canonicalPath !== window.location.pathname) {
      window.history.replaceState(
        null,
        "",
        `${canonicalPath}${window.location.search}${window.location.hash}`,
      );
    }
  }, []);

  useEffect(() => {
    function handlePopState(): void {
      setRoute(parseAdminRoute(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const navigateToPath = useCallback((path: string): void => {
    if (path !== window.location.pathname) {
      window.history.pushState(null, "", path);
    }

    setRoute(parseAdminRoute(path));
  }, []);

  const handleTerminalAdminError = useCallback((error: unknown, config: AdminAppConfig): boolean => {
    if (error instanceof AdminApiError) {
      if (error.status === 401) {
        setAppState({ status: "redirecting" });
        redirectToLogin(config);
        return true;
      }

      if (error.status === 403 && error.code === "ADMIN_ACCESS_REQUIRED") {
        setAppState({ status: "denied" });
        return true;
      }
    }

    return false;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSession(): Promise<void> {
      let config: AdminAppConfig | null = null;

      try {
        config = getAdminAppConfig();
        const session = await fetchAdminSession(config);

        if (cancelled) {
          return;
        }

        setAppState({ status: "ready", config, session });
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (config !== null && handleTerminalAdminError(error, config)) {
          return;
        }

        setAppState({
          status: "error",
          message: getErrorMessage(error),
        });
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, [handleTerminalAdminError]);

  const sessionConfig = appState.status === "ready" ? appState.config : null;
  const usesAnalyticsFilters = doesRouteUseAnalyticsFilters(route);

  useEffect(() => {
    if (!usesAnalyticsFilters || sessionConfig === null || hasRequestedAvailableRangeRef.current) {
      return;
    }

    hasRequestedAvailableRangeRef.current = true;
    setReportState({ status: "loading" });

    async function loadAvailableRange(config: AdminAppConfig): Promise<void> {
      try {
        const [reviewAvailableRange, funnelAvailableRange] = await Promise.all([
          loadReviewEventsByDateAvailableRange(config),
          loadCatalogInstallFunnelAvailableRange(config),
        ]);
        const availableRange = buildUnionRange(reviewAvailableRange, funnelAvailableRange);
        const defaultRange = buildDefaultReportRange(availableRange, "Analytics default");
        // The URL carries the whole selection, so a reload or a shared link opens the view it asks
        // for; anything it does not carry, or carries malformed, opens on the default instead.
        const urlFilterState = parseAnalyticsFilterState(
          new URLSearchParams(window.location.search),
          availableRange,
        );

        setReportRanges({ availableRange, defaultRange });
        filterStateRef.current = urlFilterState;
        setFilterState(urlFilterState);
      } catch (error) {
        // Nothing is loaded and nothing is in flight, so the next revision bump or area switch may
        // ask for the range again.
        hasRequestedAvailableRangeRef.current = false;

        if (handleTerminalAdminError(error, config)) {
          return;
        }

        // A failed report load stays inside the reports area: the session, the hero and the nav keep
        // working, and only a 401/403 replaces the whole page.
        setReportState({
          status: "error",
          message: getErrorMessage(error),
          isRetrying: false,
        });
      }
    }

    void loadAvailableRange(sessionConfig);
  }, [handleTerminalAdminError, reportLoadRevision, sessionConfig, usesAnalyticsFilters]);

  // The option lists and the colour domains are deliberately blind to the rest of the selection - a
  // user a filter just removed from every chart is exactly the user the popup has to keep offering -
  // so only a range change asks for them again. The five catalog attribution lists do not depend on
  // the range at all and are simply reloaded with the rest.
  const loadFilterOptions = useCallback(async (
    config: AdminAppConfig,
    dateRange: AnalyticsDateRange,
  ): Promise<AnalyticsFilterOptions> => {
    const loadedOptions = loadedFilterOptionsRef.current;
    if (
      loadedOptions !== null
      && loadedOptions.dateRange.from === dateRange.from
      && loadedOptions.dateRange.to === dateRange.to
    ) {
      return loadedOptions.options;
    }

    const options = await loadAnalyticsFilterOptions(config, dateRange);
    loadedFilterOptionsRef.current = { dateRange, options };
    return options;
  }, []);

  useEffect(() => {
    if (sessionConfig === null || filterState === null || reportRanges === null) {
      return;
    }

    const config = sessionConfig;
    const filters = filterState;
    const ranges = reportRanges;
    let isSuperseded = false;

    async function loadReports(): Promise<void> {
      // `reloadError` is deliberately left standing while this attempt runs: clearing it here would
      // let a failure blink away the moment the next request leaves and put the operator back in
      // front of confidently rendered stale numbers. Only an outcome clears it.
      setReportState((currentState) => (currentState.status === "ready"
        ? { ...currentState, isReportLoading: true, dateRangeError: "" }
        : currentState));

      try {
        const [filterOptions, report, dailyActiveUsersReport, catalogInstallsReport] = await Promise.all([
          loadFilterOptions(config, filters.dateRange),
          loadReviewEventsByDateReport(config, filters),
          loadDailyActiveUsersReport(config, filters),
          loadCatalogInstallsReport(config, filters),
        ]);

        if (isSuperseded) {
          return;
        }

        hasLoadedReportsRef.current = true;
        setReportState({
          status: "ready",
          data: {
            ...ranges,
            filterOptions,
            report,
            dailyActiveUsersReport,
            catalogInstallsReport,
          },
          isReportLoading: false,
          dateRangeError: "",
          reloadError: "",
        });
      } catch (error) {
        if (isSuperseded) {
          return;
        }

        if (handleTerminalAdminError(error, config)) {
          return;
        }

        // A selection that fails keeps the numbers it replaced, and the failure goes into
        // `reloadError`, which the dashboard shows as a sticky banner over the reports and uses to
        // mark those numbers stale; only a view that has nothing on screen yet falls back to the
        // retryable error state.
        setReportState((currentState) => (currentState.status === "ready"
          ? { ...currentState, isReportLoading: false, reloadError: getErrorMessage(error) }
          : { status: "error", message: getErrorMessage(error), isRetrying: false }));
      }
    }

    const reloadTimeoutId = window.setTimeout(
      () => { void loadReports(); },
      hasLoadedReportsRef.current ? filterReloadDebounceMs : 0,
    );

    return () => {
      isSuperseded = true;
      window.clearTimeout(reloadTimeoutId);
    };
  }, [
    filterState,
    handleTerminalAdminError,
    loadFilterOptions,
    reportLoadRevision,
    reportRanges,
    sessionConfig,
  ]);

  // The selection is written back into the URL so a reload or a shared link reopens the same view.
  // It replaces the current history entry rather than pushing one, so Back leaves the area instead of
  // stepping through every click, and the single write this does on load is the canonicalization of a
  // hand-typed query string rather than a filter change of its own. The selection lives above the
  // areas, so switching area re-writes it onto the new path instead of being read back from it.
  // Area-specific parameters - the Funnels charts' anchors and group-by fields, and the Study-vs-AI
  // period length and audience - are carried over by `buildAreaSearchParams` above, on their own
  // route only.
  useEffect(() => {
    if (filterState === null || reportRanges === null || doesRouteUseAnalyticsFilters(route) === false) {
      return;
    }

    const filterSearchParams = toAnalyticsFilterSearchParams(filterState, reportRanges.availableRange);
    const currentSearchParams = new URLSearchParams(window.location.search);
    const searchParams = buildAreaSearchParams(route, filterSearchParams, currentSearchParams);
    const serializedParams = searchParams.toString();
    const nextSearch = serializedParams === "" ? "" : `?${serializedParams}`;
    if (nextSearch === window.location.search) {
      return;
    }

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch}${window.location.hash}`,
    );
  }, [filterState, reportRanges, route]);

  // Both Retry controls - the one in the failure banner over stale numbers and the one in the error
  // panel - reach the reports effect only through this revision bump, and the in-flight mark is
  // raised here rather than when the request finally leaves, for a different reason on each path.
  // From the banner, because the reload waits out the same debounce a filter click does and nothing
  // would change on screen for those 400 ms. From the error panel, because `loadReports` raises its
  // own mark only on the `ready` branch, so without this the panel's button would stay unmarked for
  // the entire request. Either way a Retry that ends in the same message it started from would be
  // pixel-identical from click to outcome and read as a dead control. Nothing here re-requests on
  // its own; the effect owns the attempt, and only its outcome lowers the mark again.
  const retryReportLoad = useCallback((): void => {
    setReportState((currentState) => {
      if (currentState.status === "ready") {
        return { ...currentState, isReportLoading: true };
      }

      if (currentState.status === "error") {
        return { ...currentState, isRetrying: true };
      }

      return currentState;
    });
    setReportLoadRevision((revision) => revision + 1);
  }, []);

  // Stable across renders on purpose: this reaches the charts through the filter callbacks, and a new
  // identity on every render would tear down and redraw every chart on every click.
  // Returns whether the selection was accepted, so a caller that dismisses its own control on
  // success - the date popover - keeps it open to show the rejection instead.
  const applyFilters = useCallback((nextFilters: AnalyticsFilterState): boolean => {
    if (reportRanges === null) {
      return false;
    }

    // Canonical here rather than only where it is serialized, so a value the URL codec would drop or
    // reorder cannot stay on screen as a checked option and a popover header and then change on the
    // next reload.
    const filters = normalizeAnalyticsFilterState(nextFilters);

    // Every selection is judged against the available data, including one that only changes another
    // field: a range the URL carried is already clamped into that window by the parser, so this
    // cannot refuse a filter click on a link older than the retained data.
    const validationError = validateRequestedRange(filters.dateRange, reportRanges.availableRange);
    if (validationError !== null) {
      setReportState((currentState) => (currentState.status === "ready"
        ? { ...currentState, dateRangeError: validationError }
        : currentState));
      return false;
    }

    // The reload waits out the debounce, so the indicator is raised here rather than when the request
    // finally leaves: a selection that shows nothing for 400 ms reads as a dead control. Only the
    // range-validation message is cleared; an unresolved reload failure and its stale numbers stay on
    // screen until this new attempt has an outcome of its own.
    setReportState((currentState) => (currentState.status === "ready"
      ? { ...currentState, isReportLoading: true, dateRangeError: "" }
      : currentState));
    filterStateRef.current = filters;
    setFilterState(filters);
    return true;
  }, [reportRanges]);

  // Clicking a person in a chart narrows the selection to them. It reads the current selection from
  // the ref rather than taking it as a dependency, so this identity survives every filter change:
  // it reaches the charts' render effects, and a new one on each change would tear down and redraw
  // all nine charts at click time with the data already on screen.
  const applyChartUserFilter = useCallback((userId: string): void => {
    const currentFilters = filterStateRef.current;
    if (currentFilters === null) {
      return;
    }

    applyFilters({ ...currentFilters, users: [userId] });
  }, [applyFilters]);

  if (appState.status === "loading" || appState.status === "redirecting") {
    return <LoadingState />;
  }

  if (appState.status === "denied") {
    return <DeniedState />;
  }

  if (appState.status === "error") {
    return <ErrorState message={appState.message} />;
  }

  if (route.kind === "root") {
    return <RootIndexPage onNavigate={navigateToPath} />;
  }

  if (route.kind === "analyticsIndex") {
    return <AnalyticsIndexPage onNavigate={navigateToPath} />;
  }

  if (route.kind === "notFound") {
    return <NotFoundPage pathname={route.pathname} onNavigate={navigateToPath} />;
  }

  return (
    <AdminDashboard
      activeArea={route.area}
      onNavigate={navigateToPath}
      config={appState.config}
      adminEmail={appState.session.email}
      reportState={reportState}
      filters={filterState}
      onReportRetry={retryReportLoad}
      onFiltersChange={applyFilters}
      onChartUserFilterApply={applyChartUserFilter}
      onTerminalAdminError={handleTerminalAdminError}
    />
  );
}

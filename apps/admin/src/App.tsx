import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { AdminApiError, fetchAdminSession, type AdminSession } from "./adminApi";
import { getAdminAppConfig, type AdminAppConfig } from "./config";
import { AdminDashboard, type AdminReportState } from "./dashboard/AdminDashboard";
import {
  buildDefaultAnalyticsFilterState,
  type AnalyticsDateRange,
  type AnalyticsFilterState,
} from "./filters/analyticsFilters";
import { loadAnalyticsFilterOptions, type AnalyticsFilterOptions } from "./filters/optionsQuery";
import { AnalyticsIndexPage } from "./navigation/AnalyticsIndexPage";
import { NotFoundPage } from "./navigation/NotFoundPage";
import { RootIndexPage } from "./navigation/RootIndexPage";
import { loadCatalogInstallsReport } from "./reports/catalogInstalls/query";
import { loadDailyActiveUsersReport } from "./reports/dailyActiveUsers/query";
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

/** Only the areas that chart the General reports pay for loading them. */
function doesRouteNeedReportData(route: AdminRoute): boolean {
  return route.kind === "analyticsArea" && route.area !== "funnels";
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
  const needsReportData = doesRouteNeedReportData(route);

  useEffect(() => {
    if (!needsReportData || sessionConfig === null || hasRequestedAvailableRangeRef.current) {
      return;
    }

    hasRequestedAvailableRangeRef.current = true;
    setReportState({ status: "loading" });

    async function loadAvailableRange(config: AdminAppConfig): Promise<void> {
      try {
        const availableRange = await loadReviewEventsByDateAvailableRange(config);
        const defaultRange = buildDefaultReportRange(availableRange, "Review events default");

        setReportRanges({ availableRange, defaultRange });
        setFilterState(buildDefaultAnalyticsFilterState(defaultRange));
      } catch (error) {
        // Nothing is loaded and nothing is in flight, so the next revision bump or area switch may
        // ask for the range again.
        hasRequestedAvailableRangeRef.current = false;

        if (handleTerminalAdminError(error, config)) {
          return;
        }

        // A failed report load stays inside the reports area: the session, the hero, the nav and the
        // Funnels area keep working, and only a 401/403 replaces the whole page.
        setReportState({
          status: "error",
          message: getErrorMessage(error),
        });
      }
    }

    void loadAvailableRange(sessionConfig);
  }, [handleTerminalAdminError, needsReportData, reportLoadRevision, sessionConfig]);

  // The user options and the colour domains are scoped to the range and deliberately blind to the
  // rest of the selection - a user a filter just removed from every chart is exactly the user the
  // popup has to keep offering - so only a range change asks for them again.
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
        });
      } catch (error) {
        if (isSuperseded) {
          return;
        }

        if (handleTerminalAdminError(error, config)) {
          return;
        }

        // A selection that fails keeps the numbers it replaced, with the failure shown in the filter
        // row; only a view that has nothing on screen yet falls back to the retryable error state.
        setReportState((currentState) => (currentState.status === "ready"
          ? { ...currentState, isReportLoading: false, dateRangeError: getErrorMessage(error) }
          : { status: "error", message: getErrorMessage(error) }));
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

  const retryReportLoad = useCallback((): void => {
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

    const validationError = validateRequestedRange(nextFilters.dateRange, reportRanges.availableRange);
    if (validationError !== null) {
      setReportState((currentState) => (currentState.status === "ready"
        ? { ...currentState, dateRangeError: validationError }
        : currentState));
      return false;
    }

    // The reload waits out the debounce, so the indicator is raised here rather than when the request
    // finally leaves: a selection that shows nothing for 400 ms reads as a dead control.
    setReportState((currentState) => (currentState.status === "ready"
      ? { ...currentState, isReportLoading: true, dateRangeError: "" }
      : currentState));
    setFilterState(nextFilters);
    return true;
  }, [reportRanges]);

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
      onTerminalAdminError={handleTerminalAdminError}
    />
  );
}

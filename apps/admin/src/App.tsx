import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { AdminApiError, fetchAdminSession, type AdminSession } from "./adminApi";
import { getAdminAppConfig, type AdminAppConfig } from "./config";
import { AdminDashboard, type AdminReportState } from "./dashboard/AdminDashboard";
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
  // The reports are fetched at most once per page load, so moving between General and Audience,
  // or leaving for Funnels and coming back, reuses what is already in memory. The latch is also the
  // re-entry guard: while a load is in flight no revision bump or area switch can start a second one.
  const hasRequestedReportsRef = useRef<boolean>(false);

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
    if (!needsReportData || sessionConfig === null || hasRequestedReportsRef.current) {
      return;
    }

    hasRequestedReportsRef.current = true;
    setReportState({ status: "loading" });

    async function loadReports(config: AdminAppConfig): Promise<void> {
      try {
        const availableRange = await loadReviewEventsByDateAvailableRange(config);
        const defaultRange = buildDefaultReportRange(availableRange, "Review events default");
        const [report, dailyActiveUsersReport, catalogInstallsReport] = await Promise.all([
          loadReviewEventsByDateReport(config, defaultRange.from, defaultRange.to),
          loadDailyActiveUsersReport(config, defaultRange.from, defaultRange.to),
          loadCatalogInstallsReport(config, defaultRange.from, defaultRange.to),
        ]);

        setReportState({
          status: "ready",
          data: {
            availableRange,
            defaultRange,
            report,
            dailyActiveUsersReport,
            catalogInstallsReport,
          },
          isReportLoading: false,
          dateRangeError: "",
        });
      } catch (error) {
        // Nothing is loaded and nothing is in flight, so the next revision bump or area switch may
        // ask for the reports again.
        hasRequestedReportsRef.current = false;

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

    void loadReports(sessionConfig);
  }, [handleTerminalAdminError, needsReportData, reportLoadRevision, sessionConfig]);

  const retryReportLoad = useCallback((): void => {
    setReportLoadRevision((revision) => revision + 1);
  }, []);

  async function reloadReport(range: ReviewEventsByDateRange): Promise<void> {
    if (appState.status !== "ready" || reportState.status !== "ready" || reportState.isReportLoading) {
      return;
    }

    const validationError = validateRequestedRange(range, reportState.data.availableRange);
    if (validationError !== null) {
      setReportState({
        ...reportState,
        dateRangeError: validationError,
      });
      return;
    }

    const config = appState.config;
    setReportState({
      ...reportState,
      isReportLoading: true,
      dateRangeError: "",
    });

    try {
      const [report, dailyActiveUsersReport, catalogInstallsReport] = await Promise.all([
        loadReviewEventsByDateReport(config, range.from, range.to),
        loadDailyActiveUsersReport(config, range.from, range.to),
        loadCatalogInstallsReport(config, range.from, range.to),
      ]);

      setReportState((currentState) => {
        if (currentState.status !== "ready") {
          return currentState;
        }

        return {
          ...currentState,
          data: {
            ...currentState.data,
            report,
            dailyActiveUsersReport,
            catalogInstallsReport,
          },
          isReportLoading: false,
          dateRangeError: "",
        };
      });
    } catch (error) {
      if (handleTerminalAdminError(error, config)) {
        return;
      }

      setReportState((currentState) => {
        if (currentState.status !== "ready") {
          return currentState;
        }

        return {
          ...currentState,
          isReportLoading: false,
          dateRangeError: getErrorMessage(error),
        };
      });
    }
  }

  function resetReportRange(): void {
    if (reportState.status !== "ready") {
      return;
    }

    void reloadReport(reportState.data.defaultRange);
  }

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
      onReportRetry={retryReportLoad}
      onDateRangeApply={(range) => void reloadReport(range)}
      onDateRangeReset={resetReportRange}
      onTerminalAdminError={handleTerminalAdminError}
    />
  );
}

import { useEffect, useState, type JSX } from "react";
import {
  AdminApiError,
  fetchAdminSession,
  type AdminSession,
  type ReviewEventsByDateReport,
} from "./adminApi";
import { getAdminAppConfig, type AdminAppConfig } from "./config";
import { ReviewEventsByDateDashboard } from "./reports/reviewEventsByDate/ReviewEventsByDateDashboard";
import {
  loadReviewEventsByDateDefaultRange,
  loadReviewEventsByDateReport,
  type ReviewEventsByDateRange,
} from "./reports/reviewEventsByDate/query";

type AppState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "redirecting" }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
      status: "ready";
      config: AdminAppConfig;
      session: AdminSession;
      timezone: string;
      defaultRange: ReviewEventsByDateRange;
      report: ReviewEventsByDateReport;
      isReportLoading: boolean;
      dateRangeError: string;
    }>;

const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

function resolveBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

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
  defaultRange: ReviewEventsByDateRange,
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

  if (compareCalendarDates(range.from, defaultRange.from) < 0) {
    return `From date must be on or after ${defaultRange.from}.`;
  }

  if (compareCalendarDates(range.to, defaultRange.to) > 0) {
    return `To date must be on or before ${defaultRange.to}.`;
  }

  return null;
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
        <p className="state-copy">Checking the current session and preparing the analytics report.</p>
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

  function handleTerminalAdminError(error: unknown, config: AdminAppConfig): boolean {
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
  }

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      let config: AdminAppConfig | null = null;

      try {
        config = getAdminAppConfig();
        const session = await fetchAdminSession(config);
        const timezone = resolveBrowserTimezone();
        const defaultRange = await loadReviewEventsByDateDefaultRange(config, timezone);
        const report = await loadReviewEventsByDateReport(config, timezone, defaultRange.from, defaultRange.to);

        if (cancelled) {
          return;
        }

        setAppState({
          status: "ready",
          config,
          session,
          timezone,
          defaultRange,
          report,
          isReportLoading: false,
          dateRangeError: "",
        });
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

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadReport(range: ReviewEventsByDateRange): Promise<void> {
    if (appState.status !== "ready" || appState.isReportLoading) {
      return;
    }

    const validationError = validateRequestedRange(range, appState.defaultRange);
    if (validationError !== null) {
      setAppState({
        ...appState,
        dateRangeError: validationError,
      });
      return;
    }

    const readyState = appState;
    setAppState({
      ...readyState,
      isReportLoading: true,
      dateRangeError: "",
    });

    try {
      const report = await loadReviewEventsByDateReport(
        readyState.config,
        readyState.timezone,
        range.from,
        range.to,
      );

      setAppState((currentState) => {
        if (currentState.status !== "ready") {
          return currentState;
        }

        return {
          ...currentState,
          report,
          isReportLoading: false,
          dateRangeError: "",
        };
      });
    } catch (error) {
      if (handleTerminalAdminError(error, readyState.config)) {
        return;
      }

      setAppState((currentState) => {
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
    if (appState.status !== "ready") {
      return;
    }

    void reloadReport(appState.defaultRange);
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

  return (
    <ReviewEventsByDateDashboard
      report={appState.report}
      adminEmail={appState.session.email}
      defaultRange={appState.defaultRange}
      isReportLoading={appState.isReportLoading}
      dateRangeError={appState.dateRangeError}
      onDateRangeApply={(range) => void reloadReport(range)}
      onDateRangeReset={resetReportRange}
    />
  );
}

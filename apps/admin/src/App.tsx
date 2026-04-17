import { useEffect, useState, type JSX } from "react";
import {
  AdminApiError,
  fetchAdminSession,
  type AdminSession,
  type ReviewEventsByDateReport,
} from "./adminApi";
import { getAdminAppConfig, type AdminAppConfig } from "./config";
import { ReviewEventsByDateDashboard } from "./reports/reviewEventsByDate/ReviewEventsByDateDashboard";
import { loadReviewEventsByDateReport } from "./reports/reviewEventsByDate/query";

type AppState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "redirecting" }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
      status: "ready";
      session: AdminSession;
      report: ReviewEventsByDateReport;
    }>;

function resolveBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultRange(): Readonly<{ from: string; to: string }> {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 89);

  return {
    from: formatDateOnly(startDate),
    to: formatDateOnly(endDate),
  };
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

export default function App(): JSX.Element {
  const [appState, setAppState] = useState<AppState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const config = getAdminAppConfig();
        const session = await fetchAdminSession(config);
        const timezone = resolveBrowserTimezone();
        const range = getDefaultRange();
        const report = await loadReviewEventsByDateReport(config, timezone, range.from, range.to);

        if (cancelled) {
          return;
        }

        setAppState({
          status: "ready",
          session,
          report,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof AdminApiError) {
          if (error.status === 401) {
            setAppState({ status: "redirecting" });
            const config = getAdminAppConfig();
            redirectToLogin(config);
            return;
          }

          if (error.status === 403 && error.code === "ADMIN_ACCESS_REQUIRED") {
            setAppState({ status: "denied" });
            return;
          }
        }

        const message = error instanceof Error ? error.message : "Unexpected admin app error.";
        setAppState({
          status: "error",
          message,
        });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

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
    />
  );
}

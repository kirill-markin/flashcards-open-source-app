import type { Handler } from "aws-lambda";
import {
  addBackendBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
  type BackendObservationScope,
} from "../../observability/sentry";
import { markCapturedBackendException } from "../../observability/reportedErrors";
import type { AppleHistoryImportSummary } from "../../billing/history/appleImport";
import type { AppleImportSummary } from "../../storeAnalytics/appleImport";
import type { PlayImportSummary } from "../../storeAnalytics/playImport";
import type { GoogleHistoryImportSummary } from "../../billing/history/googleImport";
import type { StripeHistoryImportSummary } from "../../billing/history/stripeImport";

initializeBackendSentry("store-analytics-import");

// The rest of the 15-minute Lambda timeout lets the request in flight finish.
const importTimeBudgetMs = 12 * 60 * 1000;
const stripeHistoryTimeBudgetMs = 3 * 60 * 1000;
const appleHistoryTimeBudgetMs = 4 * 60 * 1000;
const googleHistoryTimeBudgetMs = 4 * 60 * 1000;
const reportTimeBudgetMs = (importTimeBudgetMs - stripeHistoryTimeBudgetMs - appleHistoryTimeBudgetMs) / 2;

// One run at a time: replacing a report date is check-then-delete-then-insert under READ
// COMMITTED, so two overlapping runs (a duplicate scheduler delivery or a manual invoke) could
// both insert the same date. A run that cannot take the lock within the timeout fails like any
// other error, so a stuck lock or an unreachable database alerts instead of silently skipping.
const importLockName = "store-analytics-import";
const importLockKey = "store_analytics.import";
const importLockTimeoutMs = 10_000;
const importLockPollIntervalMs = 1_000;

type StoreAnalyticsImportResponse = Readonly<{
  ok: true;
  appStore: AppleImportSummary;
  googlePlay: PlayImportSummary;
  googleHistory: GoogleHistoryImportSummary;
  stripe: StripeHistoryImportSummary;
  appleHistory: AppleHistoryImportSummary;
}>;

type ImportSource = "app_store" | "google_play" | "google_history" | "stripe_history" | "apple_history";

type SourceOutcome<Summary> =
  | Readonly<{ ok: true; summary: Summary }>
  | Readonly<{ ok: false; source: ImportSource; error: Error }>;

type ImportOutcomes = Readonly<{
  appStore: SourceOutcome<AppleImportSummary>;
  googlePlay: SourceOutcome<PlayImportSummary>;
  googleHistory: SourceOutcome<GoogleHistoryImportSummary>;
  stripe: SourceOutcome<StripeHistoryImportSummary>;
  appleHistory: SourceOutcome<AppleHistoryImportSummary>;
}>;

async function runSource<Summary>(
  scope: BackendObservationScope,
  source: ImportSource,
  run: () => Promise<Summary>,
): Promise<SourceOutcome<Summary>> {
  try {
    return { ok: true, summary: await run() };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "store_analytics_import_failed",
      scope,
      error: normalizedError,
      details: { source, message: normalizedError.message },
    });
    return { ok: false, source, error: normalizedError };
  }
}

async function runImports(scope: BackendObservationScope, deadlineAtMs: number): Promise<ImportOutcomes> {
  const { withSessionAdvisoryLock } = await import("../../database");
  const { importAppleReports } = await import("../../storeAnalytics/appleImport");
  const { importPlayReports, PlayReportsImportError } = await import("../../storeAnalytics/playImport");
  const { importGoogleBillingHistory } = await import("../../billing/history/googleImport");
  const { importStripeHistory } = await import("../../billing/history/stripeImport");
  const { importAppleHistory } = await import("../../billing/history/appleImport");
  return withSessionAdvisoryLock(
    {
      lockName: importLockName,
      lockKey: importLockKey,
      timeoutMs: importLockTimeoutMs,
      pollIntervalMs: importLockPollIntervalMs,
      signal: new AbortController().signal,
    },
    async (signal) => {
      const startedAtMs = Date.now();
      // Start every independent source before awaiting any in-flight work that can overrun its turn.
      const stripePromise = runSource(scope, "stripe_history", () => importStripeHistory(scope,
        Math.min(deadlineAtMs, startedAtMs + stripeHistoryTimeBudgetMs), signal));
      const appleHistoryPromise = runSource(scope, "apple_history", () => importAppleHistory(scope,
        Math.min(deadlineAtMs, startedAtMs + appleHistoryTimeBudgetMs), signal));
      const appStorePromise = runSource(scope, "app_store", () => importAppleReports(scope,
        Math.min(deadlineAtMs, startedAtMs + reportTimeBudgetMs), signal));
      const googlePlayPromise = runSource(scope, "google_play", () => importPlayReports(scope,
        Math.min(deadlineAtMs, startedAtMs + reportTimeBudgetMs), signal));
      const googleHistoryPromise = googlePlayPromise.then((googlePlay) => {
        const reports = googlePlay.ok ? googlePlay.summary
          : googlePlay.error instanceof PlayReportsImportError ? googlePlay.error.summary : null;
        return runSource(scope, "google_history", () => importGoogleBillingHistory(scope,
          Math.min(deadlineAtMs, Date.now() + googleHistoryTimeBudgetMs), signal, reports));
      });
      const [stripe, appleHistory, appStore, googlePlay, googleHistory] = await Promise.all([
        stripePromise, appleHistoryPromise, appStorePromise, googlePlayPromise, googleHistoryPromise,
      ]);
      return { stripe, appleHistory, appStore, googlePlay, googleHistory };
    },
  );
}

const storeAnalyticsImportHandler: Handler<
  Record<string, never>,
  StoreAnalyticsImportResponse
> = async (_event, context) => {
  const scope = createBackendObservationScope(
    "store-analytics-import",
    context.awsRequestId ?? null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  const deadlineAtMs = Date.now() + importTimeBudgetMs;
  let outcomes: ImportOutcomes;
  try {
    outcomes = await runImports(scope, deadlineAtMs);
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "store_analytics_import_failed",
      scope,
      error: normalizedError,
      details: { source: null, message: normalizedError.message },
    });
    addBackendBreadcrumb({
      action: "store_analytics_import_completed",
      scope,
      details: { succeeded: 0 },
    });
    throw error;
  }

  const { appStore, googlePlay, googleHistory, stripe, appleHistory } = outcomes;
  if (!appStore.ok || !googlePlay.ok || !googleHistory.ok || !stripe.ok || !appleHistory.ok) {
    const failures = [appStore, googlePlay, googleHistory, stripe, appleHistory].flatMap((outcome) => outcome.ok ? [] : [outcome]);
    const failure = new AggregateError(
      failures.map((outcome) => outcome.error),
      `Store analytics import failed: ${failures.map((outcome) => `${outcome.source}: ${outcome.error.message}`).join(" | ")}`,
    );
    // Each source error was captured on its own; the aggregate only fails the invocation.
    markCapturedBackendException(failure);
    addBackendBreadcrumb({
      action: "store_analytics_import_completed",
      scope,
      details: { succeeded: 0 },
    });
    throw failure;
  }
  addBackendBreadcrumb({
    action: "store_analytics_import_completed",
    scope,
    details: { succeeded: 1 },
  });
  return { ok: true, appStore: appStore.summary, googlePlay: googlePlay.summary,
    googleHistory: googleHistory.summary, stripe: stripe.summary, appleHistory: appleHistory.summary };
};

export const handler = wrapBackendHandler(storeAnalyticsImportHandler);

import type { Handler } from "aws-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
  type BackendObservationScope,
} from "../../observability/sentry";
import { markCapturedBackendException } from "../../observability/reportedErrors";
import type { AppleImportSummary } from "../../storeAnalytics/appleImport";
import type { PlayImportSummary } from "../../storeAnalytics/playImport";
import type { StripeHistoryImportSummary } from "../../billing/history/stripeImport";

initializeBackendSentry("store-analytics-import");

// The rest of the 15-minute Lambda timeout lets the request in flight finish.
const importTimeBudgetMs = 12 * 60 * 1000;
const stripeHistoryTimeBudgetMs = 3 * 60 * 1000;

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
  stripe: StripeHistoryImportSummary;
}>;

type ImportSource = "app_store" | "google_play" | "stripe_history";

type SourceOutcome<Summary> =
  | Readonly<{ ok: true; summary: Summary }>
  | Readonly<{ ok: false; source: ImportSource; error: Error }>;

type ImportOutcomes = Readonly<{
  appStore: SourceOutcome<AppleImportSummary>;
  googlePlay: SourceOutcome<PlayImportSummary>;
  stripe: SourceOutcome<StripeHistoryImportSummary>;
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
  const { importPlayReports } = await import("../../storeAnalytics/playImport");
  const { importStripeHistory } = await import("../../billing/history/stripeImport");
  return withSessionAdvisoryLock(
    {
      lockName: importLockName,
      lockKey: importLockKey,
      timeoutMs: importLockTimeoutMs,
      pollIntervalMs: importLockPollIntervalMs,
      signal: new AbortController().signal,
    },
    async (signal) => ({
      stripe: await runSource(scope, "stripe_history", () => importStripeHistory(scope,
        Math.min(deadlineAtMs, Date.now() + stripeHistoryTimeBudgetMs), signal)),
      appStore: await runSource(scope, "app_store", () => importAppleReports(scope, deadlineAtMs, signal)),
      googlePlay: await runSource(scope, "google_play", () => importPlayReports(scope, deadlineAtMs, signal)),
    }),
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
    throw error;
  }

  const { appStore, googlePlay, stripe } = outcomes;
  if (!appStore.ok || !googlePlay.ok || !stripe.ok) {
    const failures = [appStore, googlePlay, stripe].flatMap((outcome) => outcome.ok ? [] : [outcome]);
    const failure = new AggregateError(
      failures.map((outcome) => outcome.error),
      `Store analytics import failed: ${failures.map((outcome) => `${outcome.source}: ${outcome.error.message}`).join(" | ")}`,
    );
    // Each source error was captured on its own; the aggregate only fails the invocation.
    markCapturedBackendException(failure);
    throw failure;
  }
  return { ok: true, appStore: appStore.summary, googlePlay: googlePlay.summary, stripe: stripe.summary };
};

export const handler = wrapBackendHandler(storeAnalyticsImportHandler);

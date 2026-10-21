import type { Handler } from "aws-lambda";
import {
  createBackendObservationScope, initializeBackendSentry, wrapBackendHandler,
  type BackendObservationScope,
} from "../../observability/sentry";
import {
  failImportSources, runImportSource as runSource, runStoreImportJob, type SourceOutcome,
} from "./storeImportSupport";
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

type StoreAnalyticsImportResponse = Readonly<{
  ok: true;
  appStore: AppleImportSummary;
  googlePlay: PlayImportSummary;
  googleHistory: GoogleHistoryImportSummary;
  stripe: StripeHistoryImportSummary;
  appleHistory: AppleHistoryImportSummary;
}>;

type ImportOutcomes = Readonly<{
  appStore: SourceOutcome<AppleImportSummary>;
  googlePlay: SourceOutcome<PlayImportSummary>;
  googleHistory: SourceOutcome<GoogleHistoryImportSummary>;
  stripe: SourceOutcome<StripeHistoryImportSummary>;
  appleHistory: SourceOutcome<AppleHistoryImportSummary>;
}>;

async function runImports(scope: BackendObservationScope, deadlineAtMs: number, signal: AbortSignal): Promise<ImportOutcomes> {
  const { importAppleReports } = await import("../../storeAnalytics/appleImport");
  const { importPlayReports, PlayReportsImportError } = await import("../../storeAnalytics/playImport");
  const { importGoogleBillingHistory } = await import("../../billing/history/googleImport");
  const { importStripeHistory } = await import("../../billing/history/stripeImport");
  const { importAppleHistory } = await import("../../billing/history/appleImport");
  const startedAtMs = Date.now();
  // Start every independent source before awaiting any in-flight work that can overrun its turn.
  const stripePromise = runSource(scope, "stripe_history", () => importStripeHistory(scope, "production",
    Math.min(deadlineAtMs, startedAtMs + stripeHistoryTimeBudgetMs), signal));
  const appleHistoryPromise = runSource(scope, "apple_history", () => importAppleHistory(scope, "production",
    Math.min(deadlineAtMs, startedAtMs + appleHistoryTimeBudgetMs), signal));
  const appStorePromise = runSource(scope, "app_store", () => importAppleReports(scope,
    Math.min(deadlineAtMs, startedAtMs + reportTimeBudgetMs), signal));
  const googlePlayPromise = runSource(scope, "google_play", () => importPlayReports(scope,
    Math.min(deadlineAtMs, startedAtMs + reportTimeBudgetMs), signal));
  const googleHistoryPromise = googlePlayPromise.then((googlePlay) => {
    const reports = googlePlay.ok ? googlePlay.summary
      : googlePlay.error instanceof PlayReportsImportError ? googlePlay.error.summary : null;
    return runSource(scope, "google_history", () => importGoogleBillingHistory(scope, "production",
      Math.min(deadlineAtMs, Date.now() + googleHistoryTimeBudgetMs), signal, reports));
  });
  const [stripe, appleHistory, appStore, googlePlay, googleHistory] = await Promise.all([
    stripePromise, appleHistoryPromise, appStorePromise, googlePlayPromise, googleHistoryPromise,
  ]);
  return { stripe, appleHistory, appStore, googlePlay, googleHistory };
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
  return runStoreImportJob<StoreAnalyticsImportResponse>(scope, "store_analytics.import", async (signal) => {
    const outcomes = await runImports(scope, Date.now() + importTimeBudgetMs, signal);
    const { appStore, googlePlay, googleHistory, stripe, appleHistory } = outcomes;
    if (!appStore.ok || !googlePlay.ok || !googleHistory.ok || !stripe.ok || !appleHistory.ok) {
      failImportSources([appStore, googlePlay, googleHistory, stripe, appleHistory]);
    }
    return { ok: true, appStore: appStore.summary, googlePlay: googlePlay.summary,
      googleHistory: googleHistory.summary, stripe: stripe.summary, appleHistory: appleHistory.summary };
  });
};

export const handler = wrapBackendHandler(storeAnalyticsImportHandler);

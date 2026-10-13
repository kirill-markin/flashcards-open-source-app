import type { Handler } from "aws-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../../observability/sentry";
import type { AppleImportSummary } from "../../storeAnalytics/appleImport";

initializeBackendSentry("store-analytics-import");

// No new report instance starts after this; the rest of the 15-minute Lambda timeout lets the
// instance in flight finish. The next hourly run continues with what remains.
const importTimeBudgetMs = 12 * 60 * 1000;

// One run at a time: replacing a report date is check-then-delete-then-insert under READ
// COMMITTED, so two overlapping runs (a duplicate scheduler delivery or a manual invoke) could
// both insert the same date. A run that cannot take the lock within the timeout fails like any
// other error, so a stuck lock or an unreachable database alerts instead of silently skipping.
const importLockName = "store-analytics-import";
const importLockKey = "store_analytics.import";
const importLockTimeoutMs = 10_000;
const importLockPollIntervalMs = 1_000;

type StoreAnalyticsImportResponse = Readonly<{ ok: true; appStore: AppleImportSummary }>;

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
  try {
    const { withSessionAdvisoryLock } = await import("../../database");
    const { importAppleReports } = await import("../../storeAnalytics/appleImport");
    const appStore = await withSessionAdvisoryLock(
      {
        lockName: importLockName,
        lockKey: importLockKey,
        timeoutMs: importLockTimeoutMs,
        pollIntervalMs: importLockPollIntervalMs,
        signal: new AbortController().signal,
      },
      (signal) => importAppleReports(scope, deadlineAtMs, signal),
    );
    return { ok: true, appStore };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "store_analytics_import_failed",
      scope,
      error: normalizedError,
      details: { source: "app_store", message: normalizedError.message },
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(storeAnalyticsImportHandler);

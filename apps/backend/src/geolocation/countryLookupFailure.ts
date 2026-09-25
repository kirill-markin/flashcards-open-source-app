import { writeCloudWatchRecord } from "../observability/cloudWatch";
import { captureBackendWarning, type BackendWarningEvent } from "../observability/sentry";

const countryLookupFailureSentryThrottleMs = 5 * 60 * 1000;

/**
 * A reporter for a failed country lookup, which fails for a whole deployment at once rather than for
 * one caller: `assertCountryDatabaseFresh` throws on every lookup once the database is stale or the
 * wrong type, and an S3 failure re-throws per request (./country.ts), so one broken database would
 * otherwise become one Sentry event per request of every visitor worldwide. CloudWatch keeps every
 * occurrence — that is what the log groups are queried for — and Sentry gets at most one per
 * container per interval, which is all it takes to notice the condition.
 *
 * Each call site holds its own reporter, so a broken database is reported once per route that looks a
 * country up rather than only on whichever route happened to fail first.
 *
 * The detail carrying the error text must use one of the key names in the Sentry redaction set
 * (`exceptionTextFieldNames` in apps/backend/src/observability/sentry/redaction.ts), so that Sentry
 * receives `<redacted-content>`; `errorMessage` is the conventional choice here. CloudWatch keeps
 * the text whatever the key is called, because a warning carries no `error` and
 * ../observability/cloudWatch.ts redacts a record's details only when it does.
 */
export function createCountryLookupFailureReporter(): (warning: BackendWarningEvent) => void {
  let capturedAtMs: number | null = null;

  return (warning) => {
    const nowMs = Date.now();
    if (capturedAtMs !== null && nowMs - capturedAtMs < countryLookupFailureSentryThrottleMs) {
      writeCloudWatchRecord(warning, "warning");
      return;
    }

    capturedAtMs = nowMs;
    captureBackendWarning(warning);
  };
}

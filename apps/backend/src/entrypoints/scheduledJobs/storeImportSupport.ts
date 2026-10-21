import {
  addBackendBreadcrumb, captureBackendException, hasCapturedBackendException, normalizeCaughtError,
  type BackendObservationScope,
} from "../../observability/sentry";
import { markCapturedBackendException } from "../../observability/reportedErrors";

type ImportSource = "app_store" | "google_play" | "google_history" | "stripe_history" | "apple_history" | "google_token_discovery";
export type SourceOutcome<Summary> =
  | Readonly<{ ok: true; summary: Summary }>
  | Readonly<{ ok: false; source: ImportSource; error: Error }>;

export async function runImportSource<Summary>(
  scope: BackendObservationScope, source: ImportSource, run: () => Promise<Summary>,
): Promise<SourceOutcome<Summary>> {
  try {
    return { ok: true, summary: await run() };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({ action: "store_analytics_import_failed", scope, error: normalizedError,
      details: { source, message: normalizedError.message } });
    return { ok: false, source, error: normalizedError };
  }
}

export function failImportSources(outcomes: ReadonlyArray<SourceOutcome<unknown>>): never {
  const failures = outcomes.flatMap((outcome) => outcome.ok ? [] : [outcome]);
  const failure = new AggregateError(failures.map((outcome) => outcome.error),
    `Store import failed: ${failures.map((outcome) => `${outcome.source}: ${outcome.error.message}`).join(" | ")}`);
  // Each source error was captured on its own; the aggregate only fails the invocation.
  markCapturedBackendException(failure);
  throw failure;
}

export async function runStoreImportJob<Summary>(
  scope: BackendObservationScope, lockKey: string, run: (signal: AbortSignal) => Promise<Summary>,
): Promise<Summary> {
  try {
    const { withSessionAdvisoryLock } = await import("../../database");
    // Report replacement and resumable checkpoints require serialization even for manual invocations.
    const summary = await withSessionAdvisoryLock({ lockName: scope.service, lockKey,
      timeoutMs: 10_000, pollIntervalMs: 1_000, signal: new AbortController().signal }, run);
    addBackendBreadcrumb({ action: "store_analytics_import_completed", scope, details: { succeeded: 1 } });
    return summary;
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    if (!hasCapturedBackendException(normalizedError)) {
      captureBackendException({ action: "store_analytics_import_failed", scope, error: normalizedError,
        details: { source: null, message: normalizedError.message } });
    }
    addBackendBreadcrumb({ action: "store_analytics_import_completed", scope, details: { succeeded: 0 } });
    throw normalizedError;
  }
}

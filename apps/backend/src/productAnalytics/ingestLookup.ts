import { normalizeCaughtError } from "../observability/sentry";
import { markBackendExceptionWrapperAsReported } from "../observability/reporting";

// A LOOKUP FAILURE REFUSES THE REQUEST RATHER THAN STORING A NULL, deliberately: the analytics
// columns these lookups fill are written once into an append-only table, so a NULL fabricated from a
// broken or expired database is the irreversible choice and a rejected request is the recoverable
// one - its producer retries it under the same idempotent event ids, and nothing reconstructs a
// country or a network after the fact. It is the call docs/geolite-country.md states for every
// ingestion path and the one ./installationCountry.ts already makes. Only the report is throttled,
// not the refusal.
export async function runAnalyticsIngestLookup<Value>(
  lookup: () => Promise<Value | null>,
  reportFailure: (errorMessage: string) => void,
): Promise<Value | null> {
  try {
    return await lookup();
  } catch (error) {
    reportFailure(normalizeCaughtError(error).message);

    // Reported once per container per interval just above, so the route's own handler adds a
    // breadcrumb instead of the per-request Sentry exception the throttle exists to prevent. The 500
    // and the API Gateway 5XX alarm stay: an ingest that cannot derive the facts it must store is an
    // outage.
    //
    // Unlike the other callers, this marks a caught instance rather than a freshly constructed one,
    // so the mark is a property of that instance and not of this request, and a caught instance can
    // be shared: the rejected `pendingDownload` in ../geolocation/databaseLoader.ts hands the same
    // one to every awaiter, and a non-`Error` rejection is wrapped once and cached for the
    // container's life (../observability/sentry/errorNormalization.ts). Nothing here can be relied on to keep the
    // instance private to this request, so anything else that ends up holding it is treated as
    // already reported too.
    throw markBackendExceptionWrapperAsReported(normalizeCaughtError(error));
  }
}

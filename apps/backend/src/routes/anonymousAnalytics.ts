import { Hono, type Handler } from "hono";
import { createBackendFailureDetails } from "../server/logging";
import { parseJsonBodyWithByteLimit } from "../server/requestParsing";
import { HttpError } from "../shared/errors";
import {
  extractRequestOriginHeaders,
  getRequestOrigin,
  type RequestOriginHeaders,
} from "../auth/requestSecurity";
import { createCountryLookupFailureReporter } from "../geolocation/countryLookupFailure";
import {
  getDirectRequestCountryLookup,
  getDirectRequestSourceIp,
} from "../geolocation/requestCountry";
import { parseAnonymousEvent } from "../productAnalytics/anonymousEvent";
import { isAutomatedUserAgent } from "../productAnalytics/automatedClient";
import { findProductAnalyticsEventDefinition } from "../productAnalytics/catalog";
import { resolveDailyVisitorHash } from "../productAnalytics/dailyVisitorHash";
import { insertAnonymousProductAnalyticsEvent } from "../productAnalytics/writer";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
  type BackendWarningEvent,
} from "../observability/sentry";
import {
  markBackendExceptionWrapperAsReported,
  reportBackendExceptionOrBreadcrumb,
} from "../observability/reporting";
import type { ProductAnalyticsEventRow } from "../productAnalytics/types";
import type { AppEnv } from "../server/app";

type AnonymousAnalyticsResponse = Readonly<{
  accepted: true;
}>;

type AnonymousAnalyticsRouteOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  // The auth origins on the allowlist above, read only to withhold a country from their rows; see
  // resolveAnonymousEventCountry below.
  authOrigins: ReadonlyArray<string>;
}>;

// The product-analytics off switch (org.user_settings.product_analytics_enabled and
// auth.guest_sessions.product_analytics_enabled, db/migrations/0149_product_analytics_off_switch.sql)
// cannot be enforced on this collector and deliberately is not attempted here. The authenticated
// batch route refuses an opted-out credential because it has one to look the answer up by; this
// route reads no credential at all, by design, so a request arrives with nothing to match an answer
// against. What stops these events is the client: a browser that holds the switch off sends nothing
// here. Guessing an identity from the request in order to enforce it - by IP, User-Agent or the
// daily visitor hash - would build the identification the identity-free rows exist to avoid.
export const anonymousAnalyticsEventPath = "/analytics/anonymous-events";

// The path this collector carried while it accepted only the catalog install funnel. It is the same
// collector on both paths: released web and auth builds post here, and analytics.product_events is
// append-only, so a funnel that loses its middle steps for a release cycle cannot be repaired.
export const legacyCatalogInstallAnalyticsEventPath = "/analytics/catalog-install-events";

const anonymousAnalyticsBodyMaximumBytes = 8 * 1024;

// This is the product's highest-volume route, so a broken GeoLite database would otherwise become
// one Sentry event per credential-free event of every visitor worldwide. The shape and the reason
// are in ../geolocation/countryLookupFailure.ts.
const reportCountryLookupFailure = createCountryLookupFailureReporter();

// The collector is origin-restricted instead of authenticated, so the origin is the whole of what
// bounds who may write to it. A request that presents neither `Origin` nor `Referer` is refused too:
// it proves nothing, and treating it as originless let a plain `curl` through, which on a route that
// mints unverified actors is the same as no check at all. getRequestOrigin is the resolution the
// analytics visitor route and session CSRF already share.
//
// enforceAllowedBrowserOrigin's other half, the `Sec-Fetch-Site: cross-site` refusal, is
// deliberately not applied here. This collector is cross-site by design: the marketing site is on
// its own domain and posts to the API host, so refusing cross-site requests would refuse the
// producer this route exists for.
function requireAnonymousAnalyticsOrigin(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
): string {
  // Only the two headers the check reads. `extractRequestAuthInputs` would also parse the caller's
  // `session` cookie, and this collector reads no credential at all: a caller that sent a malformed
  // cookie would otherwise fail here, before the origin was even compared.
  const originHeaders = extractRequestOriginHeaders(request);
  const origin = readAnonymousAnalyticsOrigin(originHeaders);
  if (allowedOrigins.includes(origin) === false) {
    throw new HttpError(
      403,
      "Origin is not allowed for anonymous analytics.",
      "ANONYMOUS_ANALYTICS_ORIGIN_NOT_ALLOWED",
    );
  }

  return origin;
}

// The shared helper throws its "no origin at all" and "unparseable Referer" refusals uncoded, and its
// visitor and session callers keep that. Here they are relabelled, so every refusal this route can
// answer with carries a code: `createBackendFailureDetails` puts it in the CloudWatch breadcrumb, and
// the producers log `data.code`, where an uncoded 403 would read as `null`.
function readAnonymousAnalyticsOrigin(originHeaders: RequestOriginHeaders): string {
  try {
    return getRequestOrigin(originHeaders.originHeader, originHeaders.refererHeader);
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(
        error.statusCode,
        error.message,
        "ANONYMOUS_ANALYTICS_ORIGIN_NOT_ALLOWED",
        undefined,
        error,
      );
    }

    throw error;
  }
}

function assertAnonymousAnalyticsContentType(headers: Headers): void {
  const contentTypeHeader = headers.get("content-type");
  const contentType = contentTypeHeader?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType !== "application/json") {
    throw new HttpError(
      415,
      "content-type must be application/json",
      "ANONYMOUS_ANALYTICS_CONTENT_TYPE_UNSUPPORTED",
    );
  }
}

// The path the caller actually used, without its trailing slash, or null when it had none. The
// instruction has to name that path rather than the current one: a released build posts to the
// legacy path and does not know the new one, so telling it to move would be telling it to stop
// reporting.
function readPathToRetryWithoutTrailingSlash(request: Request): string | null {
  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith("/") === false) {
    return null;
  }

  return pathname.replace(/\/+$/u, "");
}

// The two-letter country the request arrived from, derived at ingest and stored with no raw address
// anywhere. It is null for the two kinds of row that may not carry one, and for an ordinary request
// that has no direct source address here or whose address the database cannot place.
//
// An `identityFree` entry gets none: those rows may be stored beside nothing that describes the
// visitor, and the catalog is what decides it, read the way resolveDailyVisitorHash reads it so a
// second list cannot drift from it in silence.
//
// The auth origin gets none because its sign-in funnel is posted server-side from the auth Lambda
// (apps/auth/src/server/analytics/client.ts), so the address such a request arrives from is that
// Lambda's egress address and a country derived from it would be a fabricated fact about the
// visitor. The origin the allowlist was checked against is the signal, rather than a second one
// invented here.
//
// A LOOKUP FAILURE REFUSES THE EVENT RATHER THAN STORING A NULL COUNTRY, deliberately: this column is
// written once into an append-only table, so a NULL fabricated from a broken or expired database is
// the irreversible choice and a rejected event is the recoverable one - its producer retries it
// under the same idempotent event id, and nothing reconstructs a country after the fact. It is the
// call docs/geolite-country.md states for every ingestion path and the one
// apps/backend/src/productAnalytics/installationCountry.ts already makes. Only the report is
// throttled, not the refusal.
async function resolveAnonymousEventCountry(
  row: ProductAnalyticsEventRow,
  requestOrigin: string,
  authOrigins: ReadonlyArray<string>,
  scope: BackendObservationScope,
): Promise<string | null> {
  if (authOrigins.includes(requestOrigin)) {
    return null;
  }

  if (findProductAnalyticsEventDefinition(row.eventName)?.identityFree === true) {
    return null;
  }

  const countryLookup = getDirectRequestCountryLookup();
  if (countryLookup === null) {
    return null;
  }

  try {
    return await countryLookup();
  } catch (error) {
    const warning: BackendWarningEvent = {
      action: "anonymous_analytics_country_lookup_failed",
      message: "Anonymous analytics country lookup failed; the event is refused so its producer retries it.",
      scope,
      // `errorMessage` is in the Sentry redaction set
      // (apps/backend/src/observability/sentry/redaction.ts), so Sentry receives
      // `<redacted-content>` while CloudWatch keeps the text; the rule for naming this detail is in
      // ../geolocation/countryLookupFailure.ts.
      details: { errorMessage: normalizeCaughtError(error).message },
    };
    reportCountryLookupFailure(warning);

    // Reported once per container per interval just above, so the route's own handler adds a
    // breadcrumb instead of the per-request Sentry exception the throttle exists to prevent. The 500
    // and the API Gateway 5XX alarm stay: a collector that cannot derive the country it must store
    // is an outage.
    //
    // Unlike the other callers, this marks a caught instance rather than a freshly constructed one,
    // so the mark is a property of that instance and not of this request, and a caught instance can
    // be shared: the rejected `pendingDownload` in ../geolocation/country.ts hands the same one to
    // every awaiter, and a non-`Error` rejection is wrapped once and cached for the container's
    // life (../observability/sentry/errorNormalization.ts). Nothing here can be relied on to keep
    // the instance private to this request, so anything else that ends up holding it is treated as
    // already reported too.
    throw markBackendExceptionWrapperAsReported(normalizeCaughtError(error));
  }
}

function createAnonymousAnalyticsScope(
  requestId: string,
  path: string,
  method: string,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    path,
    method,
    null,
    null,
    null,
    null,
    null,
    null,
    "web",
  );
}

export function createAnonymousAnalyticsRoutes(
  options: AnonymousAnalyticsRouteOptions,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const collectAnonymousEvent: Handler<AppEnv> = async (context) => {
    const pathToRetry = readPathToRetryWithoutTrailingSlash(context.req.raw);
    if (pathToRetry !== null) {
      throw new HttpError(
        404,
        `Not found. Post anonymous analytics to ${pathToRetry} without a trailing slash.`,
        "ANONYMOUS_ANALYTICS_ROUTE_NOT_FOUND",
      );
    }

    const requestId = context.get("requestId");
    const scope = createAnonymousAnalyticsScope(
      requestId,
      context.req.path,
      context.req.method,
    );
    let row: ProductAnalyticsEventRow | null = null;

    try {
      const requestOrigin = requireAnonymousAnalyticsOrigin(context.req.raw, options.allowedOrigins);
      assertAnonymousAnalyticsContentType(context.req.raw.headers);
      const body = await parseJsonBodyWithByteLimit(
        context.req.raw,
        anonymousAnalyticsBodyMaximumBytes,
        "Anonymous analytics event is too large.",
        "ANONYMOUS_ANALYTICS_BODY_TOO_LARGE",
      );
      const serverReceivedAt = new Date();
      row = parseAnonymousEvent(body, serverReceivedAt, requestId);
      // Read once and used twice: the hash derives from it, and the automated-client verdict is the
      // whole of what it is classified by. Neither stores it.
      const userAgent = context.req.header("user-agent") ?? null;
      const dailyVisitorHash = await resolveDailyVisitorHash(row, {
        sourceIp: getDirectRequestSourceIp(),
        userAgent,
      });
      const country = await resolveAnonymousEventCountry(
        row,
        requestOrigin,
        options.authOrigins,
        scope,
      );
      const storedCount = await insertAnonymousProductAnalyticsEvent({
        ...row,
        country,
        dailyVisitorHash,
        automatedClient: isAutomatedUserAgent(userAgent),
      });
      addBackendBreadcrumb({
        action: "analytics_events_ingest",
        scope,
        details: {
          statusCode: 200,
          authTransport: "none",
          trustLevel: "anonymous_client",
          platform: "web",
          appVersion: null,
          eventCount: 1,
          acceptedCount: 1,
          rejectedCount: 0,
          outOfWindowCount: 0,
          contractRejectedCount: 0,
          storedCount,
          identityLinked: null,
        },
      });

      return context.json({ accepted: true } satisfies AnonymousAnalyticsResponse);
    } catch (error) {
      const isOutOfWindow = error instanceof HttpError
        && error.code === "ANONYMOUS_ANALYTICS_EVENT_TIME_INVALID";
      const details = {
        authTransport: "none",
        trustLevel: "anonymous_client",
        platform: "web",
        appVersion: null,
        eventCount: row === null ? null : 1,
        acceptedCount: row === null ? null : 1,
        rejectedCount: row === null ? 1 : 0,
        outOfWindowCount: isOutOfWindow ? 1 : 0,
        contractRejectedCount: row === null && isOutOfWindow === false ? 1 : 0,
        storedCount: null,
        identityLinked: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "analytics_events_ingest_error", error: normalizeCaughtError(error), scope, details },
        { action: "analytics_events_ingest_error", scope, details },
      );
      throw error;
    }
  };

  app.post(anonymousAnalyticsEventPath, collectAnonymousEvent);
  app.post(legacyCatalogInstallAnalyticsEventPath, collectAnonymousEvent);

  return app;
}

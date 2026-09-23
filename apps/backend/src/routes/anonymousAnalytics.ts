import { Hono, type Handler } from "hono";
import { createBackendFailureDetails } from "../server/logging";
import { parseJsonBodyWithByteLimit } from "../server/requestParsing";
import { HttpError } from "../shared/errors";
import {
  extractRequestOriginHeaders,
  getRequestOrigin,
  type RequestOriginHeaders,
} from "../auth/requestSecurity";
import { getDirectRequestSourceIp } from "../geolocation/requestCountry";
import { parseAnonymousEvent } from "../productAnalytics/anonymousEvent";
import { isAutomatedUserAgent } from "../productAnalytics/automatedClient";
import { resolveDailyVisitorHash } from "../productAnalytics/dailyVisitorHash";
import { insertAnonymousProductAnalyticsEvent } from "../productAnalytics/writer";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { ProductAnalyticsEventRow } from "../productAnalytics/types";
import type { AppEnv } from "../server/app";

type AnonymousAnalyticsResponse = Readonly<{
  accepted: true;
}>;

type AnonymousAnalyticsRouteOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
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
function assertAnonymousAnalyticsOrigin(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
): void {
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
      assertAnonymousAnalyticsOrigin(context.req.raw, options.allowedOrigins);
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
      const storedCount = await insertAnonymousProductAnalyticsEvent({
        ...row,
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

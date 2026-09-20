/**
 * The product domain's analytics visitor identity, and the geo answer a cookie-less browser needs
 * before it can decide whether to ask for consent first.
 *
 * The country is read from the GeoLite database wired to this Lambda
 * (apps/backend/src/geolocation/country.ts), which is why this endpoint lives on the API rather than
 * in the server-less web app.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import {
  clearAnalyticsVisitor,
  createAnalyticsVisitorId,
  readAnalyticsVisitorId,
  writeAnalyticsVisitorId,
} from "../analyticsVisitor/cookie";
import { isConsentRequiredCountry } from "../analyticsVisitor/consentJurisdiction";
import { enforceAllowedBrowserOrigin, extractRequestAuthInputs } from "../auth/requestSecurity";
import { getDirectRequestCountryLookup } from "../geolocation/requestCountry";
import { writeCloudWatchRecord } from "../observability/cloudWatch";
import {
  captureBackendWarning,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
  type BackendWarningEvent,
} from "../observability/sentry";
import type { AppEnv } from "../server/app";
import { expectBoolean, expectRecord, parseJsonBody } from "../server/requestParsing";

export const analyticsVisitorPath = "/analytics/visitor";

/**
 * `assertCountryDatabaseFresh` throws on every lookup once the database is stale or the wrong type,
 * and an S3 failure re-throws per request, so one broken database would otherwise become one Sentry
 * event per page load of every visitor worldwide. CloudWatch keeps every occurrence — that is what
 * the log groups are queried for — and Sentry gets at most one per container per interval, which is
 * all it takes to notice the condition.
 */
const countryLookupFailureSentryThrottleMs = 5 * 60 * 1000;
let countryLookupFailureCapturedAtMs: number | null = null;

type AnalyticsVisitorRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

type AnalyticsVisitorEnvelope = Readonly<{
  consentRequired: boolean;
  visitorId: string | null;
}>;

function createObservationScope(context: Context<AppEnv>): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    context.get("requestId"),
    context.req.path,
    context.req.method,
    null,
    null,
    null,
    null,
    null,
    context.get("clientAppVersion") ?? null,
    context.get("clientPlatform") ?? null,
  );
}

function shouldCaptureCountryLookupFailure(nowMs: number): boolean {
  if (
    countryLookupFailureCapturedAtMs !== null
    && nowMs - countryLookupFailureCapturedAtMs < countryLookupFailureSentryThrottleMs
  ) {
    return false;
  }

  countryLookupFailureCapturedAtMs = nowMs;
  return true;
}

/**
 * A country this request cannot be placed in is consent-required, so a broken or missing GeoLite
 * database costs measurement rather than consent. The failure is reported with its text, because a
 * database that stopped loading looks exactly like a sudden all-European audience otherwise.
 */
async function isConsentRequiredForRequest(context: Context<AppEnv>): Promise<boolean> {
  const countryLookup = getDirectRequestCountryLookup();
  if (countryLookup === null) {
    return true;
  }

  try {
    return isConsentRequiredCountry(await countryLookup());
  } catch (error) {
    // The detail is named `errorMessage` because that exact key is what the Sentry redaction set
    // matches (apps/backend/src/observability/sentry/redaction.ts): CloudWatch keeps the text and
    // Sentry receives `<redacted-content>`. Any other name silently ships the raw text to Sentry.
    const warning: BackendWarningEvent = {
      action: "analytics_visitor_country_lookup_failed",
      message: "Analytics visitor country lookup failed; the caller is treated as consent-required.",
      scope: createObservationScope(context),
      details: { errorMessage: normalizeCaughtError(error).message },
    };
    if (shouldCaptureCountryLookupFailure(Date.now())) {
      captureBackendWarning(warning);
    } else {
      writeCloudWatchRecord(warning, "warning");
    }

    return true;
  }
}

export function createAnalyticsVisitorRoutes(
  options: AnalyticsVisitorRoutesOptions,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * On any method, this route refuses a caller that does not present an allowlisted `Origin` — or
   * `Referer`, when a navigation sends no `Origin`. The check is the one already used for session
   * requests (apps/backend/src/auth/requestSecurity.ts). `cors()` cannot stand in for it: it sets
   * response headers and never refuses a request, so the handler runs either way.
   *
   * Two things it stops. A cross-site top-level `GET` navigation is exactly what `SameSite=Lax`
   * permits an answer that carries a `Set-Cookie` to be stored from, so without the check one link
   * or redirect would plant a 13-month analytics identity on a visitor who never saw a banner. And
   * `POST` is unauthenticated and has a server-side effect of its own: the decline branch calls
   * `clearAnalyticsVisitor`, whose deletion `Set-Cookie` carries no explicit `SameSite` at all
   * (apps/backend/src/analyticsVisitor/cookie.ts), unlike the explicit `Lax` on the mint.
   *
   * A request carrying neither `Origin` nor `Referer` is refused too. This route exists only to hand
   * a browser a cookie, and a browser names its origin on the cross-origin call the web app makes,
   * so `curl`, smoke scripts and integration harnesses get a 403 by design; there is no exemption
   * for tooling, and a non-browser caller that does send an allowed `Origin` passes. It is stated in
   * docs/analytics-visitor-identity.md for the next person testing it.
   *
   * Every answer is also specific to one browser, so nothing may hold it: a heuristically cached
   * copy would hand a second visitor the first one's id.
   */
  app.use(analyticsVisitorPath, async (context, next) => {
    enforceAllowedBrowserOrigin(
      extractRequestAuthInputs(context.req.raw),
      options.allowedOrigins,
      "Origin is not allowed for the analytics visitor identity",
    );
    context.header("Cache-Control", "no-store");
    await next();
  });

  /**
   * `GET` never records a consent grant, and carries no marker that could. That is defence in depth
   * rather than the defence — the origin check above is what keeps another site from driving this
   * route — but a grant reachable through a safe method would sit one link or redirect away from
   * any page, so the grant stays on `POST` alone.
   *
   * `consentRequired` answers "must this browser be asked before it may be given an identity", so a
   * browser that already holds a cookie is answered `false` and the country is not looked up at all:
   * the cookie is the record that this browser was allowed one, and a cold container should not pay
   * a GeoLite download on a returning visitor's first page load.
   */
  app.get(analyticsVisitorPath, async (context) => {
    const existingVisitorId = readAnalyticsVisitorId(context);
    if (existingVisitorId !== null) {
      writeAnalyticsVisitorId(context, existingVisitorId);
      const refreshedEnvelope: AnalyticsVisitorEnvelope = {
        consentRequired: false,
        visitorId: existingVisitorId,
      };
      return context.json(refreshedEnvelope);
    }

    const consentRequired = await isConsentRequiredForRequest(context);
    if (consentRequired) {
      const withheldEnvelope: AnalyticsVisitorEnvelope = { consentRequired, visitorId: null };
      return context.json(withheldEnvelope);
    }

    const visitorId = createAnalyticsVisitorId();
    writeAnalyticsVisitorId(context, visitorId);
    const mintedEnvelope: AnalyticsVisitorEnvelope = { consentRequired, visitorId };
    return context.json(mintedEnvelope);
  });

  /** The consent banner's answer, and the only surface that records a grant. */
  app.post(analyticsVisitorPath, async (context) => {
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const granted = expectBoolean(body.granted, "granted");
    const consentRequired = await isConsentRequiredForRequest(context);
    if (!granted) {
      // A decline drops the cookie and is recorded nowhere else yet: the durable consent record is
      // p03/p08 work. Until those land, "never mint on a decline" holds only through `GET` refusing
      // to mint in a consent-required country, and a decline outside one is re-minted on the next
      // `GET`. That is expected at this stage, not a bug.
      clearAnalyticsVisitor(context);
      const declinedEnvelope: AnalyticsVisitorEnvelope = { consentRequired, visitorId: null };
      return context.json(declinedEnvelope);
    }

    const visitorId = readAnalyticsVisitorId(context) ?? createAnalyticsVisitorId();
    writeAnalyticsVisitorId(context, visitorId);
    const envelope: AnalyticsVisitorEnvelope = { consentRequired, visitorId };
    return context.json(envelope);
  });

  return app;
}

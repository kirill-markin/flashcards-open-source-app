/**
 * The auth origin's product analytics transport: one best-effort call against the credential-free
 * collector, `POST /v1/analytics/anonymous-events`
 * (`apps/backend/src/routes/anonymousAnalytics.ts`, `docs/anonymous-client-analytics.md`).
 *
 * Nothing in this module throws into a route handler and nothing it does changes a response. The
 * auth service's job is signing people in, and a measurement that fails must cost the person
 * nothing but the measurement.
 *
 * There is deliberately no queue, no backoff and no `Retry-After` handling, unlike the web client in
 * `apps/web/src/analytics/`: a Lambda invocation has no durable store and nothing to retry into
 * once the response is sent. A `5xx`, a refused event and a timeout all mean one thing here — that
 * event is lost, logged with its status and error text, and never resent. That is the design of this
 * producer, not an omission from it.
 *
 * What it costs is now nothing but the call. The collector reads no credential at all, so reporting
 * a step no longer mints a `web` guest session, and this service no longer creates a guest user, a
 * guest workspace or the rows the 90-day web guest reaper was left to collect. What it buys is the
 * step actually being delivered: the mint was a second cross-service call inside the same deadline
 * and it did not fit. Over the seven full days 2026-09-17 to 2026-09-24 UTC it lost 404 of these
 * events to that local timeout against 57 delivered, counted in this service's CloudWatch log group
 * against the rows in `analytics.product_events`.
 */
import type { AuthAnalyticsWireEvent } from "./catalog.js";
import { logWarning } from "../logger.js";
import type { AuthTraceId } from "../sentry.js";

/** Keeps one failing response from filling the log group with a body nobody reads. */
const loggedErrorTextMaxLength = 300;

/** Everything one report's single call needs beyond the event itself. */
export type AuthAnalyticsCall = Readonly<{
  apiBaseUrl: string;
  /**
   * The `Origin` header this call sends, which is the whole of what the collector authorizes it by:
   * it reads no credential and refuses a request whose `Origin`, or `Referer` standing in for it, is
   * not on `getConfiguredAnonymousAnalyticsCorsOrigins()`
   * (`apps/backend/src/shared/publicUrls.ts`). A server-side `fetch` sends neither header on its
   * own, so one is set explicitly, and wherever an origin is configured it is that configured public
   * auth origin rather than the host the browser happened to use: the backend builds its allowlist
   * from the same `PUBLIC_AUTH_BASE_URL` that value comes from, while the second auth host is on
   * that list only where `PUBLIC_AUTH_ALTERNATE_BASE_URL` is configured. Every deployed environment
   * configures one, because `infra/aws/lib/gateways/auth-gateway.ts` pins `PUBLIC_AUTH_BASE_URL`
   * with no override; `getPublicAuthBaseUrl` (`../publicUrls.ts`) returns the request origin instead
   * only where that variable is unset, which is the local-dev path. The collector stores no origin,
   * so naming the pinned one costs the data nothing.
   */
  origin: string;
  /**
   * The browser's own `User-Agent`, forwarded verbatim, which the collector stamps
   * `automated_client` from and from nothing else (`isAutomatedUserAgent` in
   * `apps/backend/src/productAnalytics/automatedClient.ts`).
   *
   * It is required rather than nullable on purpose, and the value has to be the visitor's. A
   * missing `User-Agent` counts as automated there, and a `fetch` that forwards none does not leave
   * the verdict open either: the Node runtime substitutes a default of its own, which decides every
   * one of these rows on behalf of a header this service never read. `analytics.product_events` is
   * append-only and keeps no `User-Agent` beside the row, so whichever way that default fell it
   * could never be recomputed. The caller does not report at all when the browser sent none.
   */
  userAgent: string;
  requestId: string;
  traceId: AuthTraceId | null;
  route: string;
  timeoutMs: number;
}>;

function logAnalyticsFailure(
  call: AuthAnalyticsCall,
  statusCode: number | null,
  errorMessage: string,
): void {
  logWarning({
    domain: "auth",
    action: "analytics_ingest_error",
    requestId: call.requestId,
    traceId: call.traceId,
    route: call.route,
    statusCode: statusCode ?? undefined,
    // Truncated here rather than at the source, so what is parsed below is always the whole body.
    errorMessage: errorMessage.slice(0, loggedErrorTextMaxLength),
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A response body, or this module's own account of why there is none to look at.
 *
 * The budget's `AbortSignal` covers the body read as well as the connection, so an otherwise fine
 * 200 whose body did not finish arriving lands here. The two stay apart in the type rather than
 * collapsing into one string, because the other failure — a 200 carrying a body this module cannot
 * parse — is a real contract break between this producer and the collector, and the one log record
 * either produces is the only signal that tells them apart. `unreadReason` is written here and
 * repeats nothing from the response, so it is safe to log whatever the status was.
 */
type AuthAnalyticsResponseBody =
  | Readonly<{ read: true; text: string }>
  | Readonly<{ read: false; unreadReason: string }>;

async function readResponseBody(response: Response): Promise<AuthAnalyticsResponseBody> {
  try {
    return { read: true, text: await response.text() };
  } catch (error) {
    return { read: false, unreadReason: `<response body was not read: ${toErrorMessage(error)}>` };
  }
}

function toLoggedBodyText(body: AuthAnalyticsResponseBody): string {
  return body.read ? body.text : body.unreadReason;
}

function isAcceptedEnvelope(responseText: string): boolean {
  try {
    const payload = JSON.parse(responseText) as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return false;
    }

    return (payload as Readonly<Record<string, unknown>>).accepted === true;
  } catch {
    return false;
  }
}

/**
 * Posts one event to the credential-free collector and reports whether the backend stored it.
 *
 * Every response here is safe to log whole. This call sends no credential at all — no guest token,
 * no bearer token, no cookie — so neither a refusal envelope nor the `{ accepted: true }` success
 * body can echo one back.
 *
 * `x-analytics-relay: auth` still travels with the call, as it did on the authenticated ingest route.
 * It tells `runWithApiGatewayCountry` (`apps/backend/src/geolocation/requestCountry.ts`) that the
 * API Gateway source IP belongs to this Lambda rather than to the visitor, which keeps that address
 * out of every derivation the backend makes from it. Nothing the collector stores for an event
 * carrying an `anonymousId` reads it today — `country` is unconditionally NULL on this route and the
 * daily visitor hash is only derived for a row with no identity at all — but without the marker one
 * NAT address shared by every sign-in would be standing in for a visitor's, and both of those
 * columns are written once and never repaired.
 *
 * The path carries no trailing slash: the route answers a slash form with `404` and an instruction
 * to retry without it.
 */
export async function postAnonymousAnalyticsEvent(
  call: AuthAnalyticsCall,
  event: AuthAnalyticsWireEvent,
): Promise<boolean> {
  try {
    const response = await fetch(`${call.apiBaseUrl}/analytics/anonymous-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: call.origin,
        "User-Agent": call.userAgent,
        "x-analytics-relay": "auth",
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(call.timeoutMs),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      logAnalyticsFailure(call, response.status, toLoggedBodyText(body));
      return false;
    }

    // A 200 whose body is not the collector's acceptance envelope means this producer and the
    // collector contract disagree. Nothing else would ever show it: the event is gone and the
    // request looked fine.
    if (!body.read || isAcceptedEnvelope(body.text) === false) {
      logAnalyticsFailure(call, response.status, toLoggedBodyText(body));
      return false;
    }

    return true;
  } catch (error) {
    logAnalyticsFailure(call, null, toErrorMessage(error));
    return false;
  }
}

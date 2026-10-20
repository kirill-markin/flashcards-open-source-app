/**
 * The auth origin's sign-in funnel: which browser request reports which step, and how much of a
 * person's wait a report may spend.
 *
 * Every export here is best-effort and guarded. Nothing throws into a handler and nothing changes a
 * status, a response body, or a cookie the sign-in itself sets. The budget below is what keeps "best
 * effort" from meaning "for as long as it takes", which on this Lambda is not a latency preference
 * but the difference between a slow sign-in and a broken one.
 *
 * Where these rows land, and what a report over them owes: the collector reads no credential, so
 * they are stored with `trust_level = 'anonymous_client'`, no `user_id` and the visitor's shared
 * `anonymous_id`. `analytics.product_events_resolved` then reaches them through its
 * `first_anonymous_link` arm, which is the arm for a row carrying no `user_id`
 * (`db/migrations/0137_audience_context.sql`), so a visitor's signed-out sign-in steps resolve to the
 * account whenever that shared id is linked to one — by the web app on the product domain, which
 * links it, rather than by a credential minted here.
 *
 * That is what this service stopped minting a `web` guest session for. A row delivered on a guest
 * credential carried the guest's `user_id`, and that column is permanent, because
 * `analytics.product_events` is append-only. Where such a row resolves is not: `user_id` outranks
 * the anonymous link in that view's COALESCE, but the `server_derived` guest-upgrade arm outranks
 * `user_id` in turn and joins on the row's `subject_user_id`, which guest transport stamps with the
 * guest's own id (`db/migrations/0137_audience_context.sql`). Such a row therefore resolves to the
 * account wherever that link landed, and to the guest only where it did not — which a first-ever
 * sign-in, writing the link inside the budget below, usually lost.
 *
 * No report caught that for us.
 *
 * What a future report must declare: `buildTrustedActorRowsFilterSql` in the admin app excludes
 * `anonymous_client` rows, so a sign-in funnel report built over these has to except them the way
 * the catalog-install funnel already excepts its own credential-free site rows. There is no such
 * report today, and no admin SQL is changed here.
 */
import type { Context } from "hono";
import { performance } from "node:perf_hooks";
import { normalizeSupportedLoginPageLocale } from "../../routes/browser/loginPageLocale.js";
import type { LoginPageLocale } from "../../routes/browser/loginPageLocale.js";
import { type AuthAppEnv, getRequestId, getTraceId } from "../apiErrors.js";
import { logWarning } from "../logger.js";
import { getPublicApiBaseUrl, getPublicAuthBaseUrl } from "../publicUrls.js";
import {
  createSignInCodeRequestedEvent,
  createAuthAnalyticsFactEventFactory,
  createSignInSucceededWithMethodEventFactory,
  type AuthAnalyticsFact,
  type AuthAnalyticsMethod,
  createSignInFailedEventFactory,
  createSignInScreenViewedEvent,
  createSignInSucceededEvent,
  type AuthAnalyticsEventFactory,
  type AuthSignInFailureReason,
} from "./catalog.js";
import { postAnonymousAnalyticsEvent, type AuthAnalyticsCall } from "./client.js";
import {
  clearAuthAnalyticsGuestSession,
  hasAuthAnalyticsGuestSession,
  isSharedProductAnalyticsCollectionEnabled,
  readSharedAnalyticsVisitorId,
} from "./visitorSession.js";

/**
 * The size of it is a concurrency limit, and it is derived rather than chosen. Concurrency is
 * arrival rate x invocation duration, so residency added here is multiplied by the rate at which
 * these routes can be driven — and they can be driven hard, because they are unauthenticated and
 * every gate this measurement sits behind is replayable: the shared visitor cookie by anyone who
 * sends a UUID of their own, since it is unsigned and this origin only reads it, and the `429`
 * branches of both OTP routes by anyone holding one signed `otp_session`.
 *
 * Every browser route of this service — `/api/refresh-session`, `/api/send-code` and
 * `/api/verify-code` — is the one `{proxy+}` ANY method of a single API Gateway stage whose default
 * method throttle is 20 requests per second (`infra/aws/lib/gateways/auth-gateway.ts`), and all of
 * them run in the one `AuthHandler` function, whose `authHandlerReservedConcurrency` is 6
 * (`infra/aws/lib/lambda-database-capacity.ts`). That 6 is 2x the observed p95 concurrency of 3, so 3
 * concurrent containers are the headroom this measurement may spend and no more:
 *
 *   20 requests/second x 0.150 seconds = 3 concurrent containers
 *
 * The 20 bounds all of those routes together rather than each of them, because they are literally
 * one method, and added concurrency is linear in the rate. So one budget per instrumented *request*
 * is the whole bound: however the 20 rps is split between reporting a screen, a code request or an
 * outcome, the added concurrency stays at 20 x 0.150 = 3 containers. Instrumenting more of these
 * routes therefore spends no headroom beyond this one; raising this budget spends it immediately,
 * and multiplies by 20 while doing so.
 *
 * The bound is against the stage's sustained `throttlingRateLimit`, not the `throttlingBurstLimit`
 * beside it, and what it bounds is added residency rather than whole duration. `/api/send-code` and
 * `/api/verify-code` were never short — both make Cognito round trips, and `send-code` also holds
 * its 200-800 ms anti-enumeration jitter — and none of that belongs in the arithmetic above: the
 * reservation was sized against those durations as they already were. Only what this measurement
 * adds is new. On `/api/refresh-session`'s `REFRESH_TOKEN_MISSING` branch the two coincide, because
 * before this measurement existed that branch did no I/O at all and returned in a few milliseconds.
 *
 * At 150 ms, driving these routes flat out at the stage ceiling draws those 3 spare containers and
 * still leaves the p95 demand of sign-in served. Past it the reservation saturates, Lambda throttles,
 * and — in the words of the budget comment in `lambda-database-capacity.ts` — the caller sees a
 * gateway error: `send-code` and `verify-code` would answer a sign-in with a gateway error so that
 * a measurement could be taken, which is the one outcome this instrumentation must never cause.
 *
 * Raising this number therefore means raising `authHandlerReservedConcurrency` in the same change,
 * and that reservation is multiplied by `databasePoolMaxConnectionsPerContainer` against a Postgres
 * connection budget the same file documents as deliberately thin. Re-do the arithmetic above against
 * both before touching it.
 *
 */
const analyticsReportBudgetMs = 150;

/**
 * The login page marks its own calls with this, and it is what makes these events mean what they
 * claim. Every route instrumented here is shared with callers that are not sign-in funnel entries,
 * and the visitor cookie cannot tell them apart: it is the product domain's, so every browser that
 * holds one carries it onto all of them.
 *
 *   `POST /api/refresh-session` has four callers, and a 401 means something different to each: the
 *   login page shows the sign-in form; the OAuth consent page shows its own form to agent and MCP
 *   clients; the web app's auth recovery on `app.<domain>` is a signed-in person whose session just
 *   expired; and the admin app on `admin.<domain>` (`apps/admin/src/adminApi.ts`) is the same for an
 *   operator. Only the first is a funnel entry.
 *
 *   `POST /api/send-code` and `POST /api/verify-code` have two browser callers, `templates/login.ts`
 *   and the OAuth consent page in `templates/authorize.ts`.
 *
 *   Both routes have two non-browser callers as well, and they are listed because the marker is what
 *   a later change is checked against, not because either can be counted today. The iOS client
 *   (`apps/ios/Flashcards/Flashcards/Cloud/Auth/CloudAuthService.swift`) and the Android client
 *   (`apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/remote/auth/CloudAuthRemoteApi.kt`)
 *   post the same email-and-code exchange from native HTTP stacks, and send no `screen` query at
 *   all. Both also carry their own OTP challenge in the request body rather than in cookies, which
 *   is why neither needs a cookie jar for this exchange in the first place. The live smoke scripts
 *   under `scripts/checks/` call both routes too, and are excluded the same way.
 *
 */
const signInScreenMarker = "signin";

function logReportFailure(c: Context<AuthAppEnv>, errorMessage: string): void {
  logWarning({
    domain: "auth",
    action: "analytics_ingest_error",
    requestId: getRequestId(c),
    traceId: getTraceId(c),
    route: c.req.path,
    errorMessage,
  });
}

/**
 * The browser's own `User-Agent`, or null where it sent none.
 *
 * A request without one is not reported at all, and that is the point rather than a shortcut. The
 * collector classifies a row `automated_client` from this header and from nothing else, stores no
 * `User-Agent` beside the row, and so can never recompute that verdict — and on this branch there
 * is no honest value to give it. Forwarding the absence means sending an empty header, which counts
 * as automated and drops the row from every report that excludes automated traffic. Sending no
 * header at all is worse: the runtime substitutes its own, which on the `NODEJS_24_X` this function
 * is deployed on is `node`, matching no marker, so a caller that announced nothing would be filed as
 * an ordinary person. Reporting nothing is the undercount this repository prefers over either, and
 * it costs a population a browser does not belong to: every browser sends a `User-Agent`.
 *
 * Forwarding it also puts a real `automated_client` verdict on rows that carried NULL while they
 * were delivered on a guest credential, and that verdict now lands on the browser's shared visitor
 * id. `buildExcludedActorSqlLines` in `apps/admin/src/filters/filterSql.ts` drops an actor from
 * every number it is applied to once any one row of theirs is `automated_client IS TRUE`, and
 * `analytics.product_events` is append-only, so nothing takes that back. These routes are
 * unauthenticated and the visitor cookie is unsigned, so a request replaying someone else's visitor
 * id under a bot-ish `User-Agent` removes that person permanently. The collector itself is
 * reachable the same way with a forged `Origin`, so this is an old exposure in a new place rather
 * than a new one.
 */
function readBrowserUserAgent(c: Context<AuthAppEnv>): string | null {
  const userAgent = c.req.header("user-agent") ?? "";
  return userAgent.trim() === "" ? null : userAgent;
}

function createReportCall(c: Context<AuthAppEnv>, userAgent: string, timeoutMs: number): AuthAnalyticsCall {
  return {
    apiBaseUrl: getPublicApiBaseUrl(c.req.url),
    origin: getPublicAuthBaseUrl(c.req.url),
    userAgent,
    requestId: getRequestId(c),
    traceId: getTraceId(c),
    route: c.req.path,
    timeoutMs,
  };
}

/**
 * Reports one funnel step of a request the login page marked as its own.
 *
 * The wait is awaited on purpose. There is no `waitUntil` on this Lambda, so work left running after
 * the response is frozen with the container and resumes, if ever, inside an unrelated later
 * invocation. Bounding the wait is therefore the only lever there is.
 *
 * A browser holding no shared visitor id is not measured here — this origin mints none — so a
 * first-ever touch that is the sign-in page produces no funnel rows.
 */
async function reportSignInFunnelEvent(
  c: Context<AuthAppEnv>,
  createEvent: AuthAnalyticsEventFactory,
  context: AuthAnalyticsContext,
): Promise<void> {
  await reportSignInFunnelEvents(c, [{ createEvent, occurredAt: Date.now() }], context);
}

export type ObservedAuthAnalyticsEvent = Readonly<{ createEvent: AuthAnalyticsEventFactory; occurredAt: number }>;

async function reportSignInFunnelEvents(
  c: Context<AuthAppEnv>,
  events: ReadonlyArray<ObservedAuthAnalyticsEvent>,
  context: AuthAnalyticsContext,
): Promise<void> {
  try {
    if (context.screen === null || events.length === 0) {
      return;
    }

    if (isSharedProductAnalyticsCollectionEnabled(c) === false) {
      return;
    }

    const anonymousId = readSharedAnalyticsVisitorId(c);
    if (anonymousId === null) {
      return;
    }

    const userAgent = readBrowserUserAgent(c);
    if (userAgent === null) {
      logReportFailure(
        c,
        "Sign-in funnel event was not reported: the request carried no User-Agent to forward, and "
          + "the collector would have stored the row as automated.",
      );
      return;
    }

    const remaining = c.get("analyticsReportBudgetRemainingMs") ?? analyticsReportBudgetMs;
    if (remaining <= 0) return;
    const startedAt = performance.now();
    try {
      await Promise.all(events.map(({ createEvent, occurredAt }) => {
        const event = createEvent(anonymousId, occurredAt, context.uiLocale);
        if (context.screen === "settings" && !event.eventName.startsWith("auth_")) return Promise.resolve();
        return postAnonymousAnalyticsEvent(createReportCall(c, userAgent, remaining),
          { ...event, screen: event.eventName.startsWith("auth_") ? context.screen : event.screen,
            clientSentAt: new Date().toISOString() });
      }));
    } finally {
      c.set("analyticsReportBudgetRemainingMs", Math.max(0, remaining - Math.max(1, Math.ceil(performance.now() - startedAt))));
    }
  } catch (error) {
    logReportFailure(c, error instanceof Error ? error.message : String(error));
  }
}

export async function reportSignInScreenViewed(c: Context<AuthAppEnv>): Promise<void> {
  await reportSignInFunnelEvent(c, createSignInScreenViewedEvent, readAuthAnalyticsContext(c));
}

export async function reportSignInCodeRequested(c: Context<AuthAppEnv>): Promise<void> {
  await reportSignInFunnelEvent(c, createSignInCodeRequestedEvent, readAuthAnalyticsContext(c));
}

export async function reportSignInFailed(
  c: Context<AuthAppEnv>,
  reason: AuthSignInFailureReason,
): Promise<void> {
  await reportSignInFunnelEvent(c, createSignInFailedEventFactory(reason), readAuthAnalyticsContext(c));
}

/**
 * Reports the sign-in, and retires the guest credential a build from before this change may have
 * left on this browser.
 *
 * The clear runs first and outside the marker gate, exactly as it did when this service minted that
 * cookie: a token left behind on the OAuth consent page is one this service must never leave live.
 * Nothing links it to this account any more — that call is gone with the mint — so dropping it is the whole retirement, and
 * it is the right way round: `analytics.identity_links` is append-only and first-link-wins on the
 * guest user id, so a surviving token offered at the next sign-in on this browser, which need not be
 * the same person, would hand that browser's signed-out tail to the wrong account permanently. The
 * 90-day web guest reaper collects the session itself.
 *
 * The shared visitor id is left alone, here and on every logout route. It is the product domain's
 * rather than this origin's, and nothing about a sign-in is a reason to end it.
 */
export async function reportSignInSucceeded(c: Context<AuthAppEnv>): Promise<void> {
  try {
    if (hasAuthAnalyticsGuestSession(c)) {
      clearAuthAnalyticsGuestSession(c);
    }
  } catch (error) {
    logReportFailure(c, error instanceof Error ? error.message : String(error));
  }

  await reportSignInFunnelEvent(c, createSignInSucceededEvent, readAuthAnalyticsContext(c));
}

export async function reportAuthFact(c: Context<AuthAppEnv>, fact: AuthAnalyticsFact): Promise<void> {
  await reportSignInFunnelEvent(c, createAuthAnalyticsFactEventFactory(fact), readAuthAnalyticsContext(c));
}

export async function reportSignInSucceededWithMethod(c: Context<AuthAppEnv>, method: AuthAnalyticsMethod): Promise<void> {
  await reportSignInFunnelEvent(c, createSignInSucceededWithMethodEventFactory(method), readAuthAnalyticsContext(c));
}

export type AuthAnalyticsContext = Readonly<{ screen: "signin" | "settings" | null; uiLocale: LoginPageLocale | null }>;

export function readAuthAnalyticsContext(c: Context<AuthAppEnv>): AuthAnalyticsContext {
  return { screen: c.req.query("screen") === signInScreenMarker ? "signin" : c.req.query("screen") === "settings" ? "settings" : null,
    uiLocale: normalizeSupportedLoginPageLocale(c.req.query("ui_locale") ?? "") };
}

/** Context is authenticated by the callback cookie; consent and visitor cookies are still read live. */
export async function reportBrowserAuthEvents(
  c: Context<AuthAppEnv>, events: ReadonlyArray<ObservedAuthAnalyticsEvent>, context: AuthAnalyticsContext,
): Promise<void> {
  await reportSignInFunnelEvents(c, events, context);
}

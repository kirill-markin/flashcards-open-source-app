import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  type AuthAppEnv,
  getRequestLogger,
  getRequestId,
  getTraceId,
  jsonAuthError,
} from "../../server/apiErrors.js";
import { createSignInScreenViewedBatch } from "../../server/analytics/catalog.js";
import {
  mintWebGuestSession,
  postAnalyticsEvents,
  type AuthAnalyticsCall,
  type AuthAnalyticsTarget,
} from "../../server/analytics/client.js";
import {
  readAuthAnalyticsVisitor,
  refreshAuthAnalyticsVisitorSession,
  writeAuthAnalyticsVisitor,
  type AuthAnalyticsVisitor,
} from "../../server/analytics/visitorSession.js";
import { clearBrowserSessionCookies, setBrowserSessionCookies } from "../../server/browserSession.js";
import { isTerminalRefreshFailure, refreshTokens } from "../../server/cognito/cognitoAuth.js";
import { logWarning } from "../../server/logger.js";
import { getPublicApiBaseUrl } from "../../server/publicUrls.js";

/**
 * The whole best-effort report gets one budget, not one per call: this response is what makes the
 * login page run `showEmailStep()`, so the visitor's wait for the form is bounded once here instead
 * of growing with the number of calls a first-ever visitor needs. Whatever does not fit inside it is
 * lost and logged, exactly like every other ingest failure on this surface.
 *
 * The size of it is not a latency preference, it is a concurrency limit, and it is derived rather
 * than chosen. Concurrency is arrival rate x invocation duration, so residency added here is
 * multiplied by the rate at which this route can be driven — and it can be driven hard, because the
 * route is unauthenticated and the visitor cookie that gates the report is replayable by anyone who
 * fetches `GET /login` once. Every browser route of this service — this one, `/api/send-code` and
 * `/api/verify-code` alike — is the one `{proxy+}` ANY method of a single API Gateway stage whose
 * default method throttle is 20 requests per second, and all of them run in the one `AuthHandler`
 * function (`infra/aws/lib/gateways/auth-gateway.ts`), whose `authHandlerReservedConcurrency` is 6
 * (`infra/aws/lib/gateways/api-gateway.ts`). That 6 is 2x the observed p95 concurrency of 3, so 3
 * concurrent containers are the headroom this measurement may spend and no more:
 *
 *   20 requests/second x 0.150 seconds = 3 concurrent containers
 *
 * The bound is against the stage's sustained `throttlingRateLimit`, not the `throttlingBurstLimit`
 * beside it, and what it bounds is added residency. On the `REFRESH_TOKEN_MISSING` branch the two
 * are the same thing: before this measurement existed that branch did no I/O and returned in a few
 * milliseconds, so the budget is effectively its whole duration. The terminal branch has already
 * awaited a Cognito refresh by the time it reports, so there the budget is added to an invocation
 * that was never short — derive from the added duration, never from the whole one. At 150 ms,
 * driving this route flat out at the stage ceiling draws those 3 spare containers and still leaves
 * the p95 demand of `send-code` and `verify-code` served. Past it the reservation saturates, Lambda
 * throttles, and — in the words of the budget comment in `api-gateway.ts` — the caller sees a
 * gateway error: sign-in would break so that a measurement could be taken, which is the one outcome
 * this instrumentation must never cause.
 *
 * Raising this number therefore means raising `authHandlerReservedConcurrency` in the same change,
 * and that reservation is multiplied by `databasePoolMaxConnectionsPerContainer` against a Postgres
 * connection budget the same file documents as deliberately thin. Re-do the arithmetic above against
 * both before touching it.
 */
const analyticsReportBudgetMs = 150;

/**
 * The mint's share of the budget. It is capped instead of being handed the whole deadline so that a
 * slow backend cannot make a slow mint and a lost event the same event: the post is what this work
 * exists to produce, and it must always have room left to run.
 *
 * The mint stays on this path because there is nowhere cheaper to put it. `GET /login` is the same
 * function behind the same throttle, so minting there would relocate the residency rather than
 * remove it, and it would make the mint reachable with no cookie at all where here it needs a signed
 * one. What replaying that cookie forces is a guest row, and `POST /v1/guest-auth/session` is itself
 * public and unauthenticated, so those rows can be written straight against the backend without ever
 * touching this function. What only this function can lose is a container of its reservation, and
 * that is what the budget above bounds.
 */
const analyticsGuestMintBudgetMs = 90;

/**
 * Below this there is no call left worth making, only an `AbortSignal` that fires before the
 * connection opens. The post is skipped and logged for what it is, so an exhausted budget is not
 * disguised in the log group as a network failure.
 */
const analyticsMinimumCallBudgetMs = 25;

function remainingBudgetMs(deadlineMs: number): number {
  return Math.max(deadlineMs - Date.now(), 0);
}

async function mintVisitorGuestSession(
  visitor: AuthAnalyticsVisitor,
  call: AuthAnalyticsCall,
): Promise<AuthAnalyticsVisitor> {
  const guestSession = await mintWebGuestSession(call);
  if (guestSession === null) {
    return visitor;
  }

  return { ...visitor, guestToken: guestSession.guestToken, guestUserId: guestSession.userId };
}

/**
 * The login page marks its own call with this, and it is what makes the event mean what it claims.
 * Four callers share this endpoint, and a 401 means something different to each: the login page
 * shows the sign-in form; the OAuth consent page shows its own form to agent and MCP clients; the
 * web app's auth recovery on `app.<domain>` is a signed-in person whose session just expired; and
 * the admin app on `admin.<domain>` (`apps/admin/src/adminApi.ts`) is the same for an operator.
 * Only the first is a sign-in funnel entry. The visitor cookie cannot tell them apart, because it is
 * host-only for this origin and every returning visitor carries it onto all four.
 *
 * This list is the audit of who can set the marker, so keep it complete: none of the other three
 * sends it today, and a caller that started to would silently be counted as a sign-in funnel entry.
 */
const signInScreenMarker = "signin";

/**
 * Runs the report inside `deadlineMs` and returns the visitor state that must be stored, which is
 * not always the one it started from.
 *
 * A guest session minted here is part of that returned state whatever then happens to the event, so
 * the caller stores it on the response that minted it. That is what keeps a dropped event from
 * turning into a re-mint — and a fresh orphaned guest identity — on every later load. In the other
 * direction `lastEventAtMs` advances only for an event whose acceptance this producer finished
 * reading, because that is what the 30-minute session rule reads. That is narrower than "stored",
 * and deliberately so: the ingest envelope adjudicates each event of a batch into `accepted` and
 * `rejected`, so a 2xx on its own says nothing about whether this event was kept, and only a body
 * that was read tells a stored event from a refused one. What that costs a reader of the data is
 * written where the session id is declared, in `server/analytics/catalog.ts`.
 */
async function deliverSignInScreenViewed(
  visitor: AuthAnalyticsVisitor,
  target: AuthAnalyticsTarget,
  deadlineMs: number,
): Promise<AuthAnalyticsVisitor> {
  const identifiedVisitor = visitor.guestToken === null
    ? await mintVisitorGuestSession(visitor, {
      ...target,
      timeoutMs: Math.min(analyticsGuestMintBudgetMs, remainingBudgetMs(deadlineMs)),
    })
    : visitor;
  const guestToken = identifiedVisitor.guestToken;
  if (guestToken === null) {
    // The mint failed and logged why. Nothing can carry the event and the visitor holds no guest
    // token, so the next signed-out login-page load starts over.
    return visitor;
  }

  const postBudgetMs = remainingBudgetMs(deadlineMs);
  if (postBudgetMs < analyticsMinimumCallBudgetMs) {
    logWarning({
      domain: "auth",
      action: "analytics_ingest_error",
      requestId: target.requestId,
      traceId: target.traceId,
      route: target.route,
      errorMessage: "Report budget was spent before the sign-in screen event could be posted.",
    });
    return identifiedVisitor;
  }

  const eventAtMs = Date.now();
  const emittedVisitor = refreshAuthAnalyticsVisitorSession(identifiedVisitor, eventAtMs);
  const delivered = await postAnalyticsEvents(
    { ...target, timeoutMs: postBudgetMs },
    guestToken,
    createSignInScreenViewedBatch(emittedVisitor.anonymousId, emittedVisitor.sessionId, eventAtMs),
  );
  return delivered ? emittedVisitor : identifiedVisitor;
}

/**
 * Reports that a signed-out visitor was shown the sign-in form. Both branches that call it are the
 * exact responses the login page turns into `showEmailStep()`; the success branch never reaches it,
 * because that visitor is redirected and never sees the form.
 *
 * Every step below is best-effort and the whole function is guarded, so no analytics failure can
 * change the response a person is waiting for, and `analyticsReportBudgetMs` bounds how long that
 * person waits for it — the failure that matters here is holding the response, not throwing.
 *
 * The wait is awaited on purpose. There is no `waitUntil` on this Lambda, so work left running after
 * the response is frozen with the container and resumes, if ever, inside an unrelated later
 * invocation. Bounding the wait is therefore the only lever there is.
 */
async function reportSignInScreenViewed(c: Context<AuthAppEnv>): Promise<void> {
  try {
    if (c.req.query("screen") !== signInScreenMarker) {
      return;
    }

    const visitor = readAuthAnalyticsVisitor(c);
    if (visitor === null) {
      return;
    }

    const storedVisitor = await deliverSignInScreenViewed(
      visitor,
      {
        apiBaseUrl: getPublicApiBaseUrl(c.req.url),
        requestId: getRequestId(c),
        traceId: getTraceId(c),
        route: c.req.path,
      },
      Date.now() + analyticsReportBudgetMs,
    );
    // One write, on the response that actually changed the visitor.
    if (storedVisitor !== visitor) {
      writeAuthAnalyticsVisitor(c, storedVisitor);
    }
  } catch (error) {
    logWarning({
      domain: "auth",
      action: "analytics_ingest_error",
      requestId: getRequestId(c),
      traceId: getTraceId(c),
      route: c.req.path,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

type RefreshSessionDependencies = Readonly<{
  refreshTokens: (refreshToken: string) => Promise<Awaited<ReturnType<typeof refreshTokens>>>;
  setBrowserSessionCookies: typeof setBrowserSessionCookies;
  clearBrowserSessionCookies: typeof clearBrowserSessionCookies;
}>;

export function createRefreshSessionApp(dependencies: RefreshSessionDependencies): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();

  app.post("/api/refresh-session", async (c) => {
    const requestId = getRequestId(c);
    const traceId = getTraceId(c);
    const logger = getRequestLogger(c);
    const refreshToken = getCookie(c, "refresh") ?? "";
    if (refreshToken === "") {
      logger({
        domain: "auth",
        action: "refresh_session_missing_cookie",
        requestId,
        traceId,
        route: c.req.path,
        statusCode: 401,
        code: "REFRESH_TOKEN_MISSING",
        reasonCategory: "missing_refresh_cookie",
      });
      dependencies.clearBrowserSessionCookies(c);
      await reportSignInScreenViewed(c);
      return jsonAuthError(c, 401, "REFRESH_TOKEN_MISSING", "Sign in again.");
    }

    try {
      const tokens = await dependencies.refreshTokens(refreshToken);
      dependencies.setBrowserSessionCookies(c, tokens.idToken, refreshToken);
      logger({
        domain: "auth",
        action: "refresh_session",
        requestId,
        traceId,
        route: c.req.path,
        statusCode: 200,
      });
      return c.json({ ok: true });
    } catch (error) {
      if (isTerminalRefreshFailure(error)) {
        const message = error instanceof Error ? error.message : String(error);
        logger({
          domain: "auth",
          action: "refresh_session_error",
          requestId,
          traceId,
          route: c.req.path,
          statusCode: 401,
          code: "REFRESH_TOKEN_FAILED",
          reasonCategory: "cognito_refresh_failed",
          error: message,
        });
        dependencies.clearBrowserSessionCookies(c);
        await reportSignInScreenViewed(c);
        return jsonAuthError(c, 401, "REFRESH_TOKEN_FAILED", "Sign in again.");
      }

      throw error;
    }
  });

  return app;
}

export default createRefreshSessionApp({
  refreshTokens,
  setBrowserSessionCookies,
  clearBrowserSessionCookies,
});

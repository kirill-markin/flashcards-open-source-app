/**
 * The auth origin's sign-in funnel: which browser request reports which step, how much of a person's
 * wait a report may spend, and the identity link that hands the visitor's anonymous history to the
 * account at the end of it.
 *
 * Every export here is best-effort and guarded. Nothing throws into a handler and nothing changes a
 * status, a response body, or a cookie the sign-in itself sets. The budget below is what keeps "best
 * effort" from meaning "for as long as it takes", which on this Lambda is not a latency preference
 * but the difference between a slow sign-in and a broken one.
 */
import type { Context } from "hono";
import { type AuthAppEnv, getRequestId, getTraceId } from "../apiErrors.js";
import { log, logWarning } from "../logger.js";
import { getPublicApiBaseUrl } from "../publicUrls.js";
import {
  createSignInCodeRequestedBatch,
  createSignInFailedBatchFactory,
  createSignInScreenViewedBatch,
  createSignInSucceededBatch,
  type AuthAnalyticsBatchFactory,
  type AuthSignInFailureReason,
} from "./catalog.js";
import {
  ensureAccountIdentityRow,
  linkVisitorGuestToAccount,
  mintWebGuestSession,
  postAnalyticsEvents,
  type AuthAnalyticsTarget,
} from "./client.js";
import {
  clearAuthAnalyticsVisitor,
  readAuthAnalyticsVisitor,
  refreshAuthAnalyticsVisitorSession,
  writeAuthAnalyticsVisitor,
  type AuthAnalyticsVisitor,
} from "./visitorSession.js";

/**
 * The added wait one instrumented request may spend, shared by everything that request reports: on
 * `/api/verify-code` that is the success event *and* the identity link inside one deadline, not one
 * deadline each. Whatever does not fit is abandoned and logged, exactly like every other failure on
 * this surface.
 *
 * The size of it is a concurrency limit, and it is derived rather than chosen. Concurrency is
 * arrival rate x invocation duration, so residency added here is multiplied by the rate at which
 * these routes can be driven — and they can be driven hard, because they are unauthenticated and
 * every gate this measurement sits behind is replayable: the visitor cookie by anyone who fetches
 * `GET /login` once, and the `429` branches of both OTP routes by anyone holding one signed
 * `otp_session`.
 *
 * Every browser route of this service — `/api/refresh-session`, `/api/send-code` and
 * `/api/verify-code` — is the one `{proxy+}` ANY method of a single API Gateway stage whose default
 * method throttle is 20 requests per second (`infra/aws/lib/gateways/auth-gateway.ts`), and all of
 * them run in the one `AuthHandler` function, whose `authHandlerReservedConcurrency` is 6
 * (`infra/aws/lib/gateways/api-gateway.ts`). That 6 is 2x the observed p95 concurrency of 3, so 3
 * concurrent containers are the headroom this measurement may spend and no more:
 *
 *   20 requests/second x 0.150 seconds = 3 concurrent containers
 *
 * The 20 bounds all of those routes together rather than each of them, because they are literally
 * one method, and added concurrency is linear in the rate. So one budget per instrumented *request*
 * is the whole bound: however the 20 rps is split between reporting a screen, a code request, an
 * outcome, or a success plus its link, the added concurrency stays at 20 x 0.150 = 3 containers.
 * Instrumenting more of these routes therefore spends no headroom beyond this one; raising the
 * per-request budget spends it immediately, and multiplies by 20 while doing so.
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
 * and — in the words of the budget comment in `api-gateway.ts` — the caller sees a gateway error:
 * `send-code` and `verify-code` would answer a sign-in with a gateway error so that a measurement
 * could be taken, which is the one outcome this instrumentation must never cause.
 *
 * Raising this number therefore means raising `authHandlerReservedConcurrency` in the same change,
 * and that reservation is multiplied by `databasePoolMaxConnectionsPerContainer` against a Postgres
 * connection budget the same file documents as deliberately thin. Re-do the arithmetic above against
 * both before touching it.
 *
 * What 150 ms buys is deliberately modest, and that is the price of the bound rather than an
 * oversight: two calls on a warm connection, so the ordinary success path — post the event, then
 * link — usually completes, while a first-ever sign-in, which needs two more, usually does not. A
 * call abandoned at the deadline is not the same as work lost. The mint, the ingest write and the
 * link each commit on the backend whether or not this caller is still waiting; what the deadline
 * ends is the waiting, and with it this producer's knowledge of the outcome.
 */
const analyticsReportBudgetMs = 150;

/**
 * The ceiling on the mint's share of a deadline. It is a ceiling and not the share itself: the share
 * is derived from the budget actually in force by `guestMintBudgetMs` below, so that a slow backend
 * cannot make a slow mint and a lost event the same event. The post is what this work exists to
 * produce, and it must always have room left to run.
 *
 * A constant alone cannot state that guarantee, because a constant is sized against one budget and
 * these paths do not share one: 90 leaves the post 60 under `analyticsReportBudgetMs`, and nothing
 * at all under the tighter `signInSucceededEventBudgetMs`. Only subtracting the post's floor from the
 * budget in force keeps it true under every caller, including one added later with a third budget.
 *
 * The mint stays on these paths because there is nowhere cheaper to put it. `GET /login` is the same
 * function behind the same throttle, so minting there would relocate the residency rather than
 * remove it, and it would make the mint reachable with no cookie at all where here it needs a signed
 * one. What replaying that cookie forces is a guest row, and `POST /v1/guest-auth/session` is itself
 * public and unauthenticated, so those rows can be written straight against the backend without ever
 * touching this function. What only this function can lose is a container of its reservation, and
 * that is what the budget above bounds.
 */
const analyticsGuestMintBudgetMs = 90;

/**
 * The success path's share for its event, so the link is never squeezed out by a slow post. The two
 * are not interchangeable: the event is one row, while the link is what resolves that row and every
 * earlier row this visitor produced to the account. A budget spent entirely on the post would buy
 * the funnel's last step and leave the whole funnel orphaned, which is the state this item exists to
 * end.
 *
 * Cutting the post short and starting the link anyway is what that costs, and it is the right way
 * round. A post still in flight can then be refused by the revoke the link performs, losing the one
 * event; waiting for it instead would risk losing the link, and with it every event this visitor
 * ever sent.
 */
const signInSucceededEventBudgetMs = 60;

/**
 * Below this there is no call left worth making, only an `AbortSignal` that fires before the
 * connection opens. The call is skipped and logged for what it is, so an exhausted budget is not
 * disguised in the log group as a network failure.
 */
const analyticsMinimumCallBudgetMs = 25;

/**
 * The slop the mint's share gives back to the post on top of the floor, so the post's room is a
 * margin rather than an equality. `AbortSignal.timeout` is a lower bound: the timer callback can run
 * late, and a mint that resolves inside that slop would leave the post below the floor and skip it,
 * turning a sign-in into a freshly minted guest with no event on it at all.
 *
 * 10 ms is the largest margin the tightest deadline can carry. Under
 * `signInSucceededEventBudgetMs` the mint's share is `60 - 25 - 10 = 25`, which is the floor exactly,
 * so the mint is still made rather than skipped for the sake of the margin; one millisecond more —
 * or one millisecond of drift in the derivation, which is why `guestMintBudgetMs` takes the share
 * from the budget rather than from a clock read — and the success path would stop minting
 * altogether. Under `analyticsReportBudgetMs` the share stays at its `analyticsGuestMintBudgetMs`
 * ceiling — `150 - 25 - 10 = 115` is still above 90 — so the ordinary path is unchanged and only
 * the tight one pays for the guarantee.
 */
const analyticsCallOverrunMarginMs = 10;

/**
 * The login page marks its own calls with this, and it is what makes these events mean what they
 * claim. Every route instrumented here is shared with callers that are not sign-in funnel entries,
 * and the visitor cookie cannot tell them apart: it is host-only for this origin, so every returning
 * visitor carries it onto all of them.
 *
 * This list is the audit of who can set the marker, so keep it complete. None of the callers below
 * sends it today except the login page itself, and one that started to would silently be counted
 * into the sign-in funnel.
 *
 *   `POST /api/refresh-session` has four callers, and a 401 means something different to each: the
 *   login page shows the sign-in form; the OAuth consent page shows its own form to agent and MCP
 *   clients; the web app's auth recovery on `app.<domain>` is a signed-in person whose session just
 *   expired; and the admin app on `admin.<domain>` (`apps/admin/src/adminApi.ts`) is the same for an
 *   operator. Only the first is a funnel entry.
 *
 *   `POST /api/send-code` and `POST /api/verify-code` have two browser callers, `templates/login.ts`
 *   and the OAuth consent page in `templates/authorize.ts`, which runs the same email-and-code
 *   exchange inside the consent flow. Those two are indistinguishable at the route without this
 *   marker — same origin, same cookies, same request shape — and the consent page is a different
 *   population that this measurement deliberately leaves out.
 *
 *   Both routes have two non-browser callers as well, and they are listed because the marker is what
 *   a later change is checked against, not because either can be counted today. The iOS client
 *   (`apps/ios/Flashcards/Flashcards/Cloud/Auth/CloudAuthService.swift`) and the Android client
 *   (`apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/remote/auth/CloudAuthRemoteApi.kt`)
 *   post the same email-and-code exchange from native HTTP stacks. They stay out twice over: they
 *   send no `screen` query at all, and the report is AND-ed with a visitor cookie they cannot hold.
 *   That cookie is minted only by `GET /login` (`routes/browser/loginPage.ts`), which no native
 *   client loads, and its `__Host-` prefix makes it host-only to this origin, so nothing else can
 *   plant one. Both clients also carry their own OTP challenge in the request body rather than in
 *   cookies, which is why neither needs a cookie jar for this exchange in the first place. The live
 *   smoke scripts under `scripts/checks/` call both routes too, and are excluded the same way.
 *
 *   The measurement is therefore browser-only by construction: the marker states intent, and the
 *   cookie is what makes a caller that never saw `GET /login` unable to enter the funnel even if it
 *   started sending the marker.
 */
const signInScreenMarker = "signin";

function remainingBudgetMs(deadlineMs: number): number {
  return Math.max(deadlineMs - Date.now(), 0);
}

/**
 * What is left of the budget in force once the post's floor and its overrun margin are reserved,
 * capped at `analyticsGuestMintBudgetMs`. Reserving first and capping second is what makes the cap
 * unable to decide whether the post has room: it can only lower the mint's share, never raise it
 * past what the budget leaves. Reserving the margin as well as the floor is what makes the post's
 * room something the code enforces rather than something an on-time timer happens to allow. A share
 * that comes out below the floor itself buys nothing either, and the caller skips the mint rather
 * than opening a connection an `AbortSignal` is about to close.
 *
 * The share is taken from the budget as granted, not from a fresh reading of what remains of the
 * deadline. The mint is the first call under that deadline, so in intent the two readings are the
 * same instant — but the floor is cleared exactly under `signInSucceededEventBudgetMs`, and a single
 * millisecond elapsing between the caller sampling its start and a re-read here would put the share
 * at 24 and skip the mint. The post below still measures what actually remains, because by then time
 * really has been spent.
 */
function guestMintBudgetMs(budgetMs: number): number {
  return Math.min(
    analyticsGuestMintBudgetMs,
    budgetMs - analyticsMinimumCallBudgetMs - analyticsCallOverrunMarginMs,
  );
}

type AuthAnalyticsSkipAction = "analytics_ingest_error" | "analytics_identity_link_error";

/** Names an exhausted budget as itself, in the same records the calls it replaces would have made. */
function logSkippedCall(
  target: AuthAnalyticsTarget,
  action: AuthAnalyticsSkipAction,
  errorMessage: string,
): void {
  logWarning({
    domain: "auth",
    action,
    requestId: target.requestId,
    traceId: target.traceId,
    route: target.route,
    errorMessage,
  });
}

function createReportTarget(c: Context<AuthAppEnv>): AuthAnalyticsTarget {
  return {
    apiBaseUrl: getPublicApiBaseUrl(c.req.url),
    requestId: getRequestId(c),
    traceId: getTraceId(c),
    route: c.req.path,
  };
}

function logReportFailure(c: Context<AuthAppEnv>, error: unknown): void {
  logWarning({
    domain: "auth",
    action: "analytics_ingest_error",
    requestId: getRequestId(c),
    traceId: getTraceId(c),
    route: c.req.path,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
}

async function mintVisitorGuestSession(
  visitor: AuthAnalyticsVisitor,
  target: AuthAnalyticsTarget,
  mintBudgetMs: number,
): Promise<AuthAnalyticsVisitor> {
  if (mintBudgetMs < analyticsMinimumCallBudgetMs) {
    logSkippedCall(
      target,
      "analytics_ingest_error",
      "Report budget left no room to mint a guest session and still post the event.",
    );
    return visitor;
  }

  const guestSession = await mintWebGuestSession({ ...target, timeoutMs: mintBudgetMs });
  if (guestSession === null) {
    return visitor;
  }

  return { ...visitor, guestToken: guestSession.guestToken, guestUserId: guestSession.userId };
}

/**
 * Delivers one event inside `deadlineMs` and returns the visitor state that must be stored, which is
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
async function deliverAuthAnalyticsEvent(
  visitor: AuthAnalyticsVisitor,
  createBatch: AuthAnalyticsBatchFactory,
  target: AuthAnalyticsTarget,
  startedAtMs: number,
  budgetMs: number,
): Promise<AuthAnalyticsVisitor> {
  const deadlineMs = startedAtMs + budgetMs;
  const identifiedVisitor = visitor.guestToken === null
    ? await mintVisitorGuestSession(visitor, target, guestMintBudgetMs(budgetMs))
    : visitor;
  const guestToken = identifiedVisitor.guestToken;
  if (guestToken === null) {
    // The mint failed or was skipped, and logged which. Nothing can carry the event and the visitor
    // holds no guest token, so the next signed-out login-page load starts over.
    return visitor;
  }

  const postBudgetMs = remainingBudgetMs(deadlineMs);
  if (postBudgetMs < analyticsMinimumCallBudgetMs) {
    logSkippedCall(
      target,
      "analytics_ingest_error",
      "Report budget was spent before the sign-in funnel event could be posted.",
    );
    return identifiedVisitor;
  }

  const eventAtMs = Date.now();
  const emittedVisitor = refreshAuthAnalyticsVisitorSession(identifiedVisitor, eventAtMs);
  const delivered = await postAnalyticsEvents(
    { ...target, timeoutMs: postBudgetMs },
    guestToken,
    createBatch(emittedVisitor.anonymousId, emittedVisitor.sessionId, eventAtMs),
  );
  return delivered ? emittedVisitor : identifiedVisitor;
}

/**
 * Reports one funnel step of a request the login page marked as its own.
 *
 * The wait is awaited on purpose. There is no `waitUntil` on this Lambda, so work left running after
 * the response is frozen with the container and resumes, if ever, inside an unrelated later
 * invocation. Bounding the wait is therefore the only lever there is.
 */
async function reportSignInFunnelEvent(
  c: Context<AuthAppEnv>,
  createBatch: AuthAnalyticsBatchFactory,
): Promise<void> {
  try {
    if (c.req.query("screen") !== signInScreenMarker) {
      return;
    }

    const visitor = readAuthAnalyticsVisitor(c);
    if (visitor === null) {
      return;
    }

    const storedVisitor = await deliverAuthAnalyticsEvent(
      visitor,
      createBatch,
      createReportTarget(c),
      Date.now(),
      analyticsReportBudgetMs,
    );
    // One write, on the response that actually changed the visitor.
    if (storedVisitor !== visitor) {
      writeAuthAnalyticsVisitor(c, storedVisitor);
    }
  } catch (error) {
    logReportFailure(c, error);
  }
}

/**
 * Runs the link and, on the one refusal that has an in-request remedy, the remedy and one retry.
 *
 * The refusal codes and what each of them owes are in `docs/auth-service.md`, and
 * `linkVisitorGuestToAccount` records which of those obligations a Lambda invocation can honour and
 * why the ones it cannot are still safe here.
 */
async function linkVisitorGuest(
  target: AuthAnalyticsTarget,
  idToken: string,
  guestToken: string,
  deadlineMs: number,
): Promise<void> {
  const linkBudgetMs = remainingBudgetMs(deadlineMs);
  if (linkBudgetMs < analyticsMinimumCallBudgetMs) {
    logSkippedCall(
      target,
      "analytics_identity_link_error",
      "Report budget was spent before the guest identity could be linked.",
    );
    return;
  }

  const outcome = await linkVisitorGuestToAccount({ ...target, timeoutMs: linkBudgetMs }, idToken, guestToken);
  if (outcome !== "account_required") {
    return;
  }

  // `GUEST_IDENTITY_LINK_ACCOUNT_REQUIRED` means `auth.user_identities` has no row for this Cognito
  // subject yet, which is true of a first-ever sign-in and of nothing else. The two calls below are
  // the documented remedy and a retry, so running the first without room for the second buys
  // nothing.
  const remedyBudgetMs = remainingBudgetMs(deadlineMs);
  if (remedyBudgetMs < analyticsMinimumCallBudgetMs * 2) {
    logSkippedCall(
      target,
      "analytics_identity_link_error",
      "Report budget was spent before the first-ever sign-in could be linked.",
    );
    return;
  }

  const accountIsReady = await ensureAccountIdentityRow(
    { ...target, timeoutMs: Math.floor(remedyBudgetMs / 2) },
    idToken,
  );
  if (accountIsReady === false) {
    return;
  }

  const retryBudgetMs = remainingBudgetMs(deadlineMs);
  if (retryBudgetMs < analyticsMinimumCallBudgetMs) {
    logSkippedCall(
      target,
      "analytics_identity_link_error",
      "Report budget was spent between the account identity row and the link retry.",
    );
    return;
  }

  await linkVisitorGuestToAccount({ ...target, timeoutMs: retryBudgetMs }, idToken, guestToken);
}

/** A signed-out visitor was shown the sign-in form. */
export async function reportSignInScreenViewed(c: Context<AuthAppEnv>): Promise<void> {
  await reportSignInFunnelEvent(c, createSignInScreenViewedBatch);
}

/** An OTP was requested and the service accepted the request. */
export async function reportSignInCodeRequested(c: Context<AuthAppEnv>): Promise<void> {
  await reportSignInFunnelEvent(c, createSignInCodeRequestedBatch);
}

/** A sign-in attempt the person made was refused, for the reason this branch already knows. */
export async function reportSignInFailed(
  c: Context<AuthAppEnv>,
  reason: AuthSignInFailureReason,
): Promise<void> {
  await reportSignInFunnelEvent(c, createSignInFailedBatchFactory(reason));
}

/**
 * Reports the sign-in and hands this visitor's anonymous history to the account it just became.
 *
 * The order is forced: the event goes first because the link revokes the guest session, after which
 * the credential the event needs is dead.
 *
 * What the link buys is one `analytics.identity_links` row with `source = 'server_derived'`, keyed on
 * the guest user id. `analytics.product_events_resolved` reads that through `first_guest_upgrade_link`,
 * which joins `identity_links.anonymous_id` to `product_events.subject_user_id` and outranks the
 * row's own `user_id` (`db/migrations/0115_product_analytics_resolved_view.sql`). That is the only
 * arm that can resolve these rows: guest-transport ingest writes the guest user id into `user_id` as
 * well, and the `first_anonymous_link` arm sits below `user_id` in the COALESCE, so it reaches only
 * rows that carry none. The visitor's own `anonymous_id` resolves nothing here.
 *
 * The visitor cookie is dropped on every outcome, including a failed link, and that is the decision
 * rather than a shortcut. A guest token kept past this sign-in would be offered at the next sign-in
 * on this browser, which need not be the same person, and `analytics.identity_links` is append-only
 * and first-link-wins on the guest user id: a token whose link never landed would hand this
 * visitor's entire signed-out tail to whoever signs in next, permanently and with no repair path.
 * `docs/auth-service.md` tells clients never to drop the token
 * on a retryable refusal, and `apps/web/src/appData/session/guest/webGuestIdentityLink.ts` obeys it,
 * because a browser has a durable envelope, an account stamp and an identity generation that make
 * keeping the token safe. None of that exists inside a Lambda invocation, and the cost of dropping it
 * is one visitor's signed-out tail — the undercount this repository consistently prefers to a
 * misattribution.
 *
 * What the ordering costs is a measured population that never reaches an outcome. A visitor counted
 * on the login page who then completes the sign-in from a caller that sends no `signInScreenMarker`
 * is retired with no success event and no link, and stays in the denominator as an abandonment. The
 * branch below logs every retirement it may not attribute, which is not a count of that population:
 * `routes/browser/loginPage.ts` mints the cookie on the render itself, so a browser answered 200 by
 * `tryRefreshSession` holds it having produced no `screen_viewed` at all.
 *
 * A report still in flight from a login page open elsewhere writes the cookie back after the clear,
 * and what survives decides the cost. A revoked token blocks the re-mint —
 * `deliverAuthAnalyticsEvent` mints only for a null one — so every later report is one logged
 * ingest failure and no row. A token no link bound is the kept-token misattribution above, and only
 * a tombstone cookie would close it, which a `5xx` under this race does not earn.
 */
export async function reportSignInSucceeded(c: Context<AuthAppEnv>, idToken: string): Promise<void> {
  try {
    const visitor = readAuthAnalyticsVisitor(c);
    if (visitor === null) {
      return;
    }

    // Cleared before anything can fail or run out of budget, so no exit below can leave the identity
    // behind, and cleared whether or not this sign-in is one this measurement may attribute: the
    // visitor identity is spent either way. A sign-in through the OAuth consent page carries the
    // same cookie and reports nothing, and letting its guest token survive would leave exactly the
    // credential the paragraph above refuses to keep.
    clearAuthAnalyticsVisitor(c);
    if (c.req.query("screen") !== signInScreenMarker) {
      log({
        domain: "auth",
        action: "analytics_visitor_retired_unreported",
        requestId: getRequestId(c),
        traceId: getTraceId(c),
        route: c.req.path,
      });
      return;
    }

    const target = createReportTarget(c);
    const startedAtMs = Date.now();
    const deliveredVisitor = await deliverAuthAnalyticsEvent(
      visitor,
      createSignInSucceededBatch,
      target,
      startedAtMs,
      signInSucceededEventBudgetMs,
    );
    const guestToken = deliveredVisitor.guestToken;
    if (guestToken === null) {
      // The mint failed and logged why. There is no credential to link, and a visitor that never
      // held one has no stored tail for the link to resolve either.
      return;
    }

    await linkVisitorGuest(target, idToken, guestToken, startedAtMs + analyticsReportBudgetMs);
  } catch (error) {
    logReportFailure(c, error);
  }
}

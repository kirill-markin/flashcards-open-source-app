/**
 * Hand-written mirror of the parts of the product analytics contract this service emits, in the same
 * way the web, iOS and Android clients mirror it. The source of truth is
 * `apps/backend/src/productAnalytics/catalog.ts`, and the backend rejects anything it does not
 * declare, so only what the auth origin actually reports is declared here: one surface and the four
 * events of the web sign-in funnel.
 *
 * Nothing server-owned is mirrored. `schema_version`, `platform` and the identity columns are derived
 * by the backend from the request, and the collector this producer posts to refuses an event that
 * carries a field it does not declare.
 */
import { randomBytes } from "node:crypto";
import type { LoginPageLocale } from "../../routes/browser/loginPageLocale.js";

/**
 * The only surface this service reports. `signin` is the sign-in screen itself, whatever steps the
 * page splits it into: the email step, the code step and the workspace choice are one screen.
 */
export type AuthAnalyticsSurface = "signin";

/**
 * The events this service reports: the sign-in funnel from the form being shown to its outcome.
 * Only `signin_failed` declares a property in the catalog.
 */
export type AuthAnalyticsEventName =
  | "screen_viewed"
  | "signin_code_requested"
  | "signin_succeeded"
  | "signin_failed";

/**
 * The `signin_failed.reason` values this origin can produce. The catalog also declares `offline` and
 * `cancelled`, which are client-observable only: a server sees neither a visitor's connectivity nor
 * a form the person walked away from. `code_already_used` is reportable here because
 * `classifyVerifyFailure` in `routes/browser/verifyCode.ts` tells a consumed OTP challenge apart
 * from an expired one; a producer that cannot make that distinction reports `expired_code` instead.
 *
 * Read `server_error` as a floor rather than the whole. A sign-in refused by a non-transient
 * database error is rethrown out of `routes/browser/sendCode.ts` and `routes/browser/verifyCode.ts`
 * for `app.ts` to answer as `500 INTERNAL_ERROR`, and a rethrow reaches no branch that reports, so
 * the person saw a sign-in fail that this reason never counted. What reports is a subset of what
 * failed, and the gap can only close.
 */
export type AuthSignInFailureReason =
  | "invalid_code"
  | "expired_code"
  | "code_already_used"
  | "rate_limited"
  | "server_error";

/** The one property any event of this mirror carries, on `signin_failed` alone. */
export type AuthAnalyticsEventProperties = Readonly<{ reason: AuthSignInFailureReason }>;

/**
 * Exactly the fields the credential-free collector accepts, and no others: `anonymousEventSchema` in
 * `apps/backend/src/productAnalytics/anonymousEvent.ts` is strict, so one undeclared key refuses the
 * whole request as `ANONYMOUS_ANALYTICS_INVALID_EVENT`. That route takes one event per request rather
 * than a batch, so there is no envelope here at all.
 *
 * Three fields the authenticated batch route accepted are therefore gone rather than sent as null:
 * `networkState` and `experimentAssignments`, neither of which a server could fill in honestly, and
 * `sessionId`. These rows carry `session_id = NULL`, so the auth origin contributes to no web session
 * count; the ids it used to send were kept only when the post was answered inside the report budget,
 * which is the population that has just stopped being lost, so counting sessions from them was never
 * safe.
 *
 * `deviceLocale` is declared by the collector and deliberately not sent: a server sees request
 * headers, not the visitor's device, and `uiLocale` already carries the language the login page was
 * rendered in.
 */
export type AuthAnalyticsWireEvent = Readonly<{
  eventId: string;
  eventName: AuthAnalyticsEventName;
  clientOccurredAt: string;
  clientSentAt: string;
  // The shared visitor id, and the only identity these rows carry. The collector stores it in
  // `anonymous_id` with no `user_id` beside it, which is what lets
  // `analytics.product_events_resolved` resolve them through its anonymous-link arm.
  anonymousId: string;
  uiLocale: LoginPageLocale | null;
  // `screen` carries two readings in the server catalog and this producer sends both, so the two are
  // never collapsed here. On `screen_viewed`, `signin_code_requested` and `signin_succeeded` it is
  // the ordinary reading — where the person is — which is the sign-in screen itself. On
  // `signin_failed` it is the entry point: the surface that owned the sign-in control the person
  // tapped, and the catalog's surface comment forbids `signin` there. This origin is reached by a
  // redirect from a client that names no surface, so it cannot know the entry point, and the same
  // comment says a sign-in that cannot be attributed to one reports no `screen` at all. That is why
  // the catalog gives `signin_failed` `requiresScreen: false` while the other three require a
  // surface, and why a funnel must not read the three screens the same way.
  screen: AuthAnalyticsSurface | null;
  properties: AuthAnalyticsEventProperties | null;
}>;

const uuidByteCount = 16;
const uuidVersionByteIndex = 6;
const uuidVariantByteIndex = 8;

/**
 * UUID version 7, ported from `createAnalyticsUuidV7` in `apps/web/src/analytics/identity.ts`.
 * `randomUUID()` is version 4, and `isProductAnalyticsEventIdVersionValid` refuses it, so event ids
 * are built explicitly.
 */
function createAuthAnalyticsUuidV7(nowMs: number): string {
  const bytes = randomBytes(uuidByteCount);
  bytes[0] = Math.floor(nowMs / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(nowMs / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(nowMs / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(nowMs / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(nowMs / 2 ** 8) & 0xff;
  bytes[5] = nowMs & 0xff;
  bytes[uuidVersionByteIndex] = (bytes[uuidVersionByteIndex] & 0x0f) | 0x70;
  bytes[uuidVariantByteIndex] = (bytes[uuidVariantByteIndex] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The collector accepts UTC only: an offset fails `z.string().datetime()` and refuses the event.
 * `toISOString` is always `Z`-suffixed UTC.
 */
function toAuthAnalyticsTimestamp(atMs: number): string {
  return new Date(atMs).toISOString();
}

type AuthAnalyticsEventFacts = Readonly<{
  eventName: AuthAnalyticsEventName;
  screen: AuthAnalyticsSurface | null;
  properties: AuthAnalyticsEventProperties | null;
}>;

/**
 * Builds the one event a report sends, deferred until the moment it is sent so its id and timestamps
 * describe that moment.
 */
export type AuthAnalyticsEventFactory = (
  anonymousId: string,
  nowMs: number,
  uiLocale: LoginPageLocale | null,
) => AuthAnalyticsWireEvent;

/**
 * `clientOccurredAt` and `clientSentAt` are the same instant on purpose. Nothing is queued here, so
 * the event is observed and sent inside one invocation, and the backend's skew correction then
 * stores `occurred_at` as its own receive time rather than shifting it by an interval this producer
 * would have to invent.
 */
function createAuthAnalyticsEvent(
  facts: AuthAnalyticsEventFacts,
  anonymousId: string,
  nowMs: number,
  uiLocale: LoginPageLocale | null,
): AuthAnalyticsWireEvent {
  const timestamp = toAuthAnalyticsTimestamp(nowMs);
  return {
    eventId: createAuthAnalyticsUuidV7(nowMs),
    eventName: facts.eventName,
    clientOccurredAt: timestamp,
    clientSentAt: timestamp,
    anonymousId,
    uiLocale,
    screen: facts.screen,
    properties: facts.properties,
  };
}

export function createSignInScreenViewedEvent(
  anonymousId: string,
  nowMs: number,
  uiLocale: LoginPageLocale | null,
): AuthAnalyticsWireEvent {
  return createAuthAnalyticsEvent(
    { eventName: "screen_viewed", screen: "signin", properties: null },
    anonymousId,
    nowMs,
    uiLocale,
  );
}

export function createSignInCodeRequestedEvent(
  anonymousId: string,
  nowMs: number,
  uiLocale: LoginPageLocale | null,
): AuthAnalyticsWireEvent {
  return createAuthAnalyticsEvent(
    { eventName: "signin_code_requested", screen: "signin", properties: null },
    anonymousId,
    nowMs,
    uiLocale,
  );
}

/**
 * The visitor is now signed in, reported under the same single-call budget as every other step of
 * this funnel: nothing follows it inside the request any more, so its post is no longer the shorter
 * half of a deadline it shared with an identity link.
 */
export function createSignInSucceededEvent(
  anonymousId: string,
  nowMs: number,
  uiLocale: LoginPageLocale | null,
): AuthAnalyticsWireEvent {
  return createAuthAnalyticsEvent(
    { eventName: "signin_succeeded", screen: "signin", properties: null },
    anonymousId,
    nowMs,
    uiLocale,
  );
}

/** The reason is fixed when the branch that refused the sign-in is taken, not when the event is sent. */
export function createSignInFailedEventFactory(reason: AuthSignInFailureReason): AuthAnalyticsEventFactory {
  return (anonymousId, nowMs, uiLocale) => createAuthAnalyticsEvent(
    { eventName: "signin_failed", screen: null, properties: { reason } },
    anonymousId,
    nowMs,
    uiLocale,
  );
}

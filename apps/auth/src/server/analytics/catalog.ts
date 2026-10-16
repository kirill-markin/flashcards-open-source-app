/**
 * Hand-written mirror of the parts of the product analytics contract this service emits, in the same
 * way the web, iOS and Android clients mirror it. The source of truth is
 * `apps/backend/src/productAnalytics/catalog.ts`, and the backend rejects anything it does not
 * declare.
 *
 * Nothing server-owned is mirrored. `schema_version`, `platform` and the identity columns are derived
 * by the backend from the request, and the collector this producer posts to refuses an event that
 * carries a field it does not declare.
 */
import { randomBytes } from "node:crypto";
import type { LoginPageLocale } from "../../routes/browser/loginPageLocale.js";

export type AuthAnalyticsSurface = "signin" | "settings";

export type AuthAnalyticsEventName =
  | "screen_viewed"
  | "signin_code_requested"
  | "signin_succeeded"
  | "signin_failed"
  | "auth_method_selected"
  | "auth_code_form_shown"
  | "auth_code_submitted"
  | "auth_code_resend_requested"
  | "auth_code_request_finished"
  | "auth_code_verification_finished"
  | "auth_provider_requested"
  | "auth_provider_finished"
  | "auth_session_accepted"
  | "auth_account_ready"
  | "auth_account_link_finished"
  | "auth_guest_upgrade_finished"
  | "auth_account_connection";

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

export type AuthAnalyticsMethod = "email" | "apple" | "google";
export type AuthAnalyticsProvider = "apple" | "google";
export type AuthAnalyticsCodeRequestAction = "initial" | "resend";
export type AuthAnalyticsCodeRequestOutcome =
  | "accepted"
  | "rate_limited"
  | "offline"
  | "timeout"
  | "server_error";
export type AuthAnalyticsCodeVerificationOutcome =
  | "verified"
  | "invalid_code"
  | "expired_code"
  | "code_already_used"
  | "rate_limited"
  | "offline"
  | "timeout"
  | "server_error";
export type AuthAnalyticsProviderOutcome =
  | "credential_received"
  | "cancelled"
  | "denied"
  | "unavailable"
  | "invalid_response"
  | "offline"
  | "timeout"
  | "provider_error"
  | "server_error";
export type AuthAnalyticsAccountLinkOutcome =
  | "linked"
  | "already_linked"
  | "conflict"
  | "verification_required"
  | "cancelled"
  | "offline"
  | "timeout"
  | "server_error";
export type AuthAnalyticsGuestUpgradeOutcome =
  | "completed"
  | "conflict"
  | "offline"
  | "timeout"
  | "storage_error"
  | "server_error";

export type ConnectionAnalyticsAction = "begin" | "proof" | "preview" | "consent" | "completion" | "cancel";
export type ConnectionAnalyticsOutcome = "succeeded" | "failed" | "already_connected" | "cancelled";

export type AuthAnalyticsFact =
  | Readonly<{ eventName: "auth_account_connection"; action: ConnectionAnalyticsAction; outcome: ConnectionAnalyticsOutcome }>
  | Readonly<{ eventName: "auth_method_selected"; method: AuthAnalyticsMethod; }>
  | Readonly<{ eventName: "auth_code_form_shown"; method: AuthAnalyticsMethod; }>
  | Readonly<{ eventName: "auth_code_submitted"; method: AuthAnalyticsMethod; }>
  | Readonly<{ eventName: "auth_code_resend_requested"; method: AuthAnalyticsMethod; }>
  | Readonly<{
    eventName: "auth_code_request_finished";
    method: AuthAnalyticsMethod;
    action: AuthAnalyticsCodeRequestAction;
    outcome: AuthAnalyticsCodeRequestOutcome;
  }>
  | Readonly<{
    eventName: "auth_code_verification_finished";
    method: AuthAnalyticsMethod;
    outcome: AuthAnalyticsCodeVerificationOutcome;
  }>
  | Readonly<{ eventName: "auth_provider_requested"; method: AuthAnalyticsProvider; }>
  | Readonly<{
    eventName: "auth_provider_finished";
    method: AuthAnalyticsProvider;
    outcome: AuthAnalyticsProviderOutcome;
  }>
  | Readonly<{ eventName: "auth_session_accepted"; method: AuthAnalyticsMethod; }>
  | Readonly<{ eventName: "auth_account_ready"; method: AuthAnalyticsMethod; }>
  | Readonly<{
    eventName: "auth_account_link_finished";
    method: AuthAnalyticsMethod;
    outcome: AuthAnalyticsAccountLinkOutcome;
  }>
  | Readonly<{
    eventName: "auth_guest_upgrade_finished";
    method: AuthAnalyticsMethod;
    outcome: AuthAnalyticsGuestUpgradeOutcome;
  }>;

export type AuthAnalyticsEventProperties =
  | Readonly<{ action: ConnectionAnalyticsAction; outcome: ConnectionAnalyticsOutcome }>
  | Readonly<{ reason: AuthSignInFailureReason; method?: AuthAnalyticsMethod }>
  | Readonly<{ method: AuthAnalyticsMethod }>
  | Readonly<{
    method: AuthAnalyticsMethod;
    action: AuthAnalyticsCodeRequestAction;
    outcome: AuthAnalyticsCodeRequestOutcome;
  }>
  | Readonly<{ method: AuthAnalyticsMethod; outcome: AuthAnalyticsCodeVerificationOutcome; }>
  | Readonly<{ method: AuthAnalyticsProvider; outcome: AuthAnalyticsProviderOutcome; }>
  | Readonly<{ method: AuthAnalyticsMethod; outcome: AuthAnalyticsAccountLinkOutcome; }>
  | Readonly<{ method: AuthAnalyticsMethod; outcome: AuthAnalyticsGuestUpgradeOutcome; }>;

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

function buildAuthAnalyticsFactProperties(fact: AuthAnalyticsFact): AuthAnalyticsEventProperties {
  switch (fact.eventName) {
    case "auth_account_connection":
      return { action: fact.action, outcome: fact.outcome };
    case "auth_method_selected":
      return { method: fact.method };
    case "auth_code_form_shown":
      return { method: fact.method };
    case "auth_code_submitted":
      return { method: fact.method };
    case "auth_code_resend_requested":
      return { method: fact.method };
    case "auth_code_request_finished":
      return { method: fact.method, action: fact.action, outcome: fact.outcome };
    case "auth_code_verification_finished":
      return { method: fact.method, outcome: fact.outcome };
    case "auth_provider_requested":
      return { method: fact.method };
    case "auth_provider_finished":
      return { method: fact.method, outcome: fact.outcome };
    case "auth_session_accepted":
      return { method: fact.method };
    case "auth_account_ready":
      return { method: fact.method };
    case "auth_account_link_finished":
      return { method: fact.method, outcome: fact.outcome };
    case "auth_guest_upgrade_finished":
      return { method: fact.method, outcome: fact.outcome };
  }
}

export function createAuthAnalyticsFactEventFactory(fact: AuthAnalyticsFact): AuthAnalyticsEventFactory {
  return (anonymousId, nowMs, uiLocale) => createAuthAnalyticsEvent(
    { eventName: fact.eventName, screen: fact.eventName === "auth_account_connection" ? "settings" : "signin", properties: buildAuthAnalyticsFactProperties(fact) },
    anonymousId,
    nowMs,
    uiLocale,
  );
}

export function createSignInCodeRequestedWithMethodEventFactory(
  method: AuthAnalyticsMethod,
): AuthAnalyticsEventFactory {
  return (anonymousId, nowMs, uiLocale) => createAuthAnalyticsEvent(
    { eventName: "signin_code_requested", screen: "signin", properties: { method } },
    anonymousId,
    nowMs,
    uiLocale,
  );
}

export function createSignInSucceededWithMethodEventFactory(
  method: AuthAnalyticsMethod,
): AuthAnalyticsEventFactory {
  return (anonymousId, nowMs, uiLocale) => createAuthAnalyticsEvent(
    { eventName: "signin_succeeded", screen: "signin", properties: { method } },
    anonymousId,
    nowMs,
    uiLocale,
  );
}

export function createSignInFailedWithMethodEventFactory(
  method: AuthAnalyticsMethod,
  reason: AuthSignInFailureReason,
): AuthAnalyticsEventFactory {
  return (anonymousId, nowMs, uiLocale) => createAuthAnalyticsEvent(
    { eventName: "signin_failed", screen: null, properties: { method, reason } },
    anonymousId,
    nowMs,
    uiLocale,
  );
}

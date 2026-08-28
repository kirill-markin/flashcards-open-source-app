/**
 * Hand-written mirror of the backend product analytics catalog
 * (`apps/backend/src/productAnalytics/catalog.ts`). The union is closed on `name`, so an event
 * whose name the server does not declare cannot be constructed. That closure is about names alone
 * and no longer covers the whole contract: `AnalyticsSurface` below still declares `onboarding`,
 * which the catalog dropped, so a well-typed event carrying it as its `screen` is rejected
 * `invalid_event`. No call site constructs that value, and until the enum drops it a value in this
 * file is not on its own proof that the server accepts it.
 *
 * `guest_upgrade_completed` and `catalog_deck_installed` are server-derived and deliberately
 * absent. `onboarding_step_completed`, `review_session_started` and `review_session_ended` were
 * removed from the catalog outright, so the server no longer declares them and rejects them as
 * unknown event names.
 *
 * `signin_failed` is declared but never tracked from here. The web sign-in surface is the auth
 * service's own login page on a different origin, reached by a full page navigation, so this app
 * observes neither a sign-in attempt nor its dismissal.
 */

export type AnalyticsSurface =
  | "review"
  | "catalog"
  | "deck_detail"
  | "onboarding"
  | "card_editor"
  | "cards"
  | "progress"
  | "settings"
  | "ai";

export type AnalyticsNetworkState = "wifi" | "cellular" | "offline" | "unknown";

export type AnalyticsLaunchType = "cold" | "warm";

export type AnalyticsSignInFailureReason =
  | "invalid_code"
  | "expired_code"
  | "rate_limited"
  | "offline"
  | "server_error"
  | "cancelled";

export type AnalyticsReviewAnswerFailureReason =
  | "offline"
  | "timeout"
  | "sync_conflict"
  | "server_error";

export type AnalyticsCardCreateEntryPoint =
  | "cards"
  | "deck_detail"
  | "review"
  | "ai"
  | "quick_action";

export type AnalyticsSyncFailureReason =
  | "offline"
  | "timeout"
  | "conflict"
  | "unauthorized"
  | "server_error"
  | "storage_full";

export type AnalyticsDropReason = "queue_overflow" | "ttl_expired" | "rejected";

/**
 * `screen` is a top-level event field on the wire, legal on every event and required only for
 * `screen_viewed`. Only `screen_viewed` declares it here; every other event is stamped with the
 * surface the user is on when it is tracked.
 */
export type AnalyticsEvent =
  | Readonly<{
    name: "app_opened";
    launchType: AnalyticsLaunchType;
  }>
  | Readonly<{
    name: "screen_viewed";
    screen: AnalyticsSurface;
  }>
  | Readonly<{
    name: "signin_failed";
    reason: AnalyticsSignInFailureReason;
  }>
  | Readonly<{
    name: "review_answer_failed";
    reason: AnalyticsReviewAnswerFailureReason;
  }>
  | Readonly<{
    name: "card_create_started";
    entryPoint: AnalyticsCardCreateEntryPoint;
  }>
  | Readonly<{
    name: "sync_failed";
    reason: AnalyticsSyncFailureReason;
  }>
  | Readonly<{
    name: "catalog_deck_install_started";
    packageSlug: string;
  }>
  | Readonly<{
    name: "analytics_events_dropped";
    reason: AnalyticsDropReason;
    count: number;
  }>;

export type AnalyticsEventProperties = Readonly<Record<string, string | number>>;

/** Wire shape of one event. Every key is sent explicitly, with `null` where there is no value. */
export type AnalyticsWireEvent = Readonly<{
  eventId: string;
  eventName: AnalyticsEvent["name"];
  clientOccurredAt: string;
  networkState: AnalyticsNetworkState | null;
  screen: AnalyticsSurface | null;
  properties: AnalyticsEventProperties | null;
  experimentAssignments: null;
}>;

export type AnalyticsWireContext = Readonly<{
  osVersion: string | null;
  deviceModel: string | null;
  deviceLocale: string | null;
  timezone: string | null;
}>;

export type AnalyticsWireBatch = Readonly<{
  clientSentAt: string;
  anonymousId: string | null;
  sessionId: string | null;
  context: AnalyticsWireContext;
  events: ReadonlyArray<AnalyticsWireEvent>;
}>;

export const analyticsCatalogSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u;

/** Catalog property names are snake_case on the wire; the union carries them as camelCase. */
export function buildAnalyticsEventProperties(event: AnalyticsEvent): AnalyticsEventProperties | null {
  switch (event.name) {
    case "app_opened":
      return { launch_type: event.launchType };
    case "screen_viewed":
      return null;
    case "signin_failed":
      return { reason: event.reason };
    case "review_answer_failed":
      return { reason: event.reason };
    case "card_create_started":
      return { entry_point: event.entryPoint };
    case "sync_failed":
      return { reason: event.reason };
    case "catalog_deck_install_started":
      return { package_slug: event.packageSlug };
    case "analytics_events_dropped":
      return { reason: event.reason, count: event.count };
  }
}

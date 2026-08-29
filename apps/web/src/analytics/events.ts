/**
 * Hand-written mirror of the backend product analytics catalog
 * (`apps/backend/src/productAnalytics/catalog.ts`). The union is closed on `name`, so an event
 * whose name the server does not declare cannot be constructed, and `AnalyticsSurface` below
 * carries the catalog's whole surface list, so a well-typed event's `screen` is a value the server
 * accepts as well. `onboarding` is gone from both.
 *
 * Ten events are server-derived and deliberately absent, because a client batch that carries one is
 * rejected `server_only_event`: `guest_upgrade_completed`, `review_answered`, `card_created`,
 * `card_updated`, `deck_created`, `deck_updated`, `friend_invitation_created`, `friendship_created`,
 * `ai_message_sent` and `catalog_deck_installed`. `onboarding_step_completed`,
 * `review_session_started` and `review_session_ended` were removed from the catalog outright, so
 * the server no longer declares them and rejects them as unknown event names.
 *
 * `prompt_answered` and `permission_prompt_answered` are client events the catalog declares and
 * this app cannot produce: the web client has neither the sign-in-after-review nudge nor the
 * notification pre-prompt, and a browser permission dialog is chrome whose outcome the page never
 * observes. That is a product difference from iOS and Android, not a gap.
 *
 * `signin_failed` is declared but never tracked from here. The web sign-in surface is the auth
 * service's own login page on a different origin, reached by a full page navigation, so this app
 * observes neither a sign-in attempt nor its dismissal.
 */

/**
 * Mirrors `productAnalyticsSurfaces` in catalog order. Two values are unreachable from this client
 * and are kept only so the mirror stays comparable to the catalog by eye: `notifications_pre_prompt`
 * and `signin_after_review_prompt`, the two prompts above that this app does not have.
 *
 * `signin` and `credential_recovery` are reachable, from `resolveSessionGateSurface` in `App.tsx`.
 * The email and code steps of signing in do live on the auth service's origin, but the catalog
 * counts the workspace choice as part of the same screen, and this app hosts that; the account-
 * deleted gate that takes over the app root is this client's `credential_recovery`.
 */
export type AnalyticsSurface =
  | "review"
  | "catalog"
  | "deck_detail"
  | "card_editor"
  | "cards"
  | "progress"
  | "settings"
  | "ai"
  | "decks"
  | "deck_editor"
  | "tags"
  | "signin"
  | "credential_recovery"
  | "notifications_pre_prompt"
  | "signin_after_review_prompt"
  | "catalog_import_signin"
  | "catalog_import_workspace"
  | "catalog_import_confirm"
  | "catalog_import_done"
  | "friend_invite"
  | "friend_invite_accept"
  | "share";

export type AnalyticsNetworkState = "wifi" | "cellular" | "offline" | "unknown";

/**
 * Deliberately narrower than the catalog's `launch_type`, which also accepts `unknown`. That third
 * value exists for a day reconstructed from stored activity long after the fact, which is written by
 * the server and cannot know how the app started; a live client always does, so it must never send
 * it. Ingest would accept it, so leaving it out of this union is the only thing that stops one being
 * constructed. Do not widen it to match the catalog.
 */
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
 * `screen` is a top-level event field on the wire, legal on every event and required for
 * `screen_viewed` and `review_card_revealed`. Those two declare it here; every other event is
 * stamped with the surface the user is on when it is tracked.
 */
export type AnalyticsEvent =
  | Readonly<{
    name: "app_opened";
    launchType: AnalyticsLaunchType;
  }>
  /**
   * One entry into a screen, and the same fact on every client.
   *
   * `screen_viewed` records a *change* of screen: an immediate repeat of the surface already being
   * viewed reports nothing. iOS collapses it in `Analytics.trackScreenViewed`
   * (`apps/ios/Flashcards/Flashcards/Analytics/AnalyticsSurfaceTracking.swift`) and Android in the
   * route effect in `FlashcardsApp.kt`, so any per-surface count is only comparable across clients
   * while web does too — and web has the most routes that collapse into one surface, every
   * `/settings/*` leaf among them. `trackScreenViewed` in `client.ts` is the one place web enforces
   * it. Leaving for a destination with no value in the enum ends the visit, so coming back is a
   * second view rather than a swallowed repeat.
   *
   * A presented screen — a dialog, a sheet, a gate over the app root — is an entry of its own when
   * the enum names it *and* it replaces the screen underneath; then leaving it is an entry back into
   * what it covered. Every presented screen in this app, decided by that one rule:
   * - `friend_invite` is named and takes over, so `FriendInviteCreateDialog` reports both edges.
   * - `card_editor` is named, and the review screen's `ReviewEditorModal` takes over the viewport
   *   with an opaque blurred `position: fixed; inset: 0` backdrop and hosts the same `CardFormFields`
   *   as `/cards/:cardId`, the route that maps to the same surface. So it reports both edges too,
   *   from `handleOpenEditor` and `handleCloseEditor` in `useReviewCardEditor.ts`, which is what iOS
   *   reports from the equivalent sheet in `CardsScreen.swift`.
   * - the review screen's feedback and mobile-app-promotion dialogs have no value here, so under the
   *   catalog's rule that a client whose screen has no value sends no `screen` at all they report
   *   nothing and everything under them stays filed against `review`.
   * - the AI sidebar is named but does not take over: it is a split pane that leaves the route's
   *   screen mounted and usable beside it, and it becomes a full-width overlay only under a CSS
   *   breakpoint, so a report from it would mean two different things at two window widths. It
   *   reports nothing, and `/chat` stays the entry into `ai` on web.
   */
  | Readonly<{
    name: "screen_viewed";
    screen: AnalyticsSurface;
  }>
  | Readonly<{
    name: "signin_failed";
    reason: AnalyticsSignInFailureReason;
  }>
  /**
   * The card flip. It never reaches the backend on its own, so only a client can report it, and it
   * is the denominator the server-derived `review_answered` is read against.
   */
  | Readonly<{
    name: "review_card_revealed";
    screen: AnalyticsSurface;
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
    case "review_card_revealed":
      return null;
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

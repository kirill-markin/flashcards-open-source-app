// The after-review prompt rules: which prompt may follow a saved review, and when. Served to
// authenticated apps as `reviewPrompts` in GET /me; web and admin import this file directly, so it
// stays dependency-free.
//
// Built-in defaults are kept in sync with this file by hand:
// - iOS: apps/ios/Flashcards/Flashcards/Review/Prompts/ReviewPromptConfigDefaults.swift
// - Android: apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/review/prompts/ReviewPromptConfigDefaults.kt
// Apps use the server values once they have them, but every release should ship the current
// defaults; a small temporary difference is acceptable.
// The admin Review prompts tab reads the order and every value from this file; only each prompt's
// plain-words `fixedRule` in apps/admin/src/reports/reviewPrompts/reviewPromptDefinitions.ts is
// synced by hand with the fixed code rules below.
//
// Evaluation runs only after a review is successfully saved, and only when the review surface can
// present a prompt; a busy surface skips that review with no retry. Walk `order`, skipping ids the
// platform lacks (web: no notifications, no rating; mobile: no web promo). The first prompt that is
// `enabled`, passes every condition present in its settings and passes its fixed code rules is
// shown. At most one prompt follows each saved review.
//
// Counters include the review just saved and span every workspace in the local store. Their day
// runs from 04:00 to 04:00 local time, so a late-night session stays one day:
// - totalReviews: review events;
// - reviewsToday: review events whose local day in the device's current time zone is today;
// - reviewDays: distinct local days with at least one review event.
// An absent setting is no condition. `cooldownDays` passes when this same prompt was never shown,
// or `now - lastShownAt(this prompt) >= cooldownDays * 24h`; it never counts from another prompt or
// another event, except that the three paywalls share one clock (see Paywalls below).
//
// A remote config with a `schemaVersion` other than 1, or with malformed values, is rejected whole:
// the app reports the error and keeps its last valid cached config or built-in defaults. An unknown
// prompt id is ignored; a prompt with a setting the app does not understand is treated as disabled.
//
// Fixed code rules, not configurable:
// - hard-reminder: the saved answer is Hard and at least 5 of the last 8 answers in this review
//   session are Hard.
// - Paywalls: free users only; on web, never guests (mobile guests do see them). The
//   `cooldownDays` of a paywall counts from the latest after-review showing of any of the three
//   (server `introShownAt`, `followUpShownAt`, `periodicShownAt`); paywalls opened from Settings,
//   the AI limit or premium features do not affect them.
//   - paywall-initial: once per account (server `introShownAt` is null).
//   - paywall-second: once per account (server `followUpShownAt` is null).
//   - paywall-periodic: repeats whenever its conditions pass.
// - notifications-pre-prompt (mobile): only while the OS notification permission is not granted.
//   "Continue" opens the OS permission dialog when the OS can still show it, otherwise the app's
//   page in system Settings ("Open Settings"); "Later" does nothing else.
// - rating-request (mobile): at most once per app version.
// - web-mobile-app-promo (web): only until the person has a review from a mobile device or an
//   external agent connection (MCP or the agent API); in-app AI chat reviews do not count.
// - guest-sign-in: guests only; it stops only when the person is no longer a guest.
// - automatic-feedback: feedback submissions do not affect its cooldown.

export type ReviewPromptId =
  | "hard-reminder"
  | "paywall-initial"
  | "paywall-second"
  | "paywall-periodic"
  | "notifications-pre-prompt"
  | "rating-request"
  | "web-mobile-app-promo"
  | "guest-sign-in"
  | "automatic-feedback";

// Every count is a non-negative integer.
export type ReviewPromptSettings = Readonly<{
  enabled: boolean;
  minTotalReviews?: number;
  minReviewsToday?: number;
  minReviewDays?: number;
  cooldownDays?: number;
}>;

export type ReviewPromptConfig = Readonly<{
  schemaVersion: 1;
  // Recorded on prompt analytics events as `review_prompt_config_version`, so it must fit that
  // property's pattern in apps/backend/src/productAnalytics/catalog.ts.
  version: string;
  order: ReadonlyArray<ReviewPromptId>;
  prompts: Readonly<Record<ReviewPromptId, ReviewPromptSettings>>;
}>;

export const reviewPromptConfig: ReviewPromptConfig = {
  schemaVersion: 1,
  version: "2026-10-28-2",
  order: [
    "web-mobile-app-promo",
    "guest-sign-in",
    "rating-request",
    "automatic-feedback",
    "paywall-initial",
    "paywall-second",
    "paywall-periodic",
    "notifications-pre-prompt",
    "hard-reminder",
  ],
  prompts: {
    "web-mobile-app-promo": { enabled: true, minReviewsToday: 3, cooldownDays: 1 },
    "guest-sign-in": { enabled: true, minReviewsToday: 5, cooldownDays: 3 },
    "rating-request": { enabled: true, minReviewsToday: 2, minReviewDays: 2, cooldownDays: 90 },
    "automatic-feedback": { enabled: true, minReviewsToday: 5, minReviewDays: 3, cooldownDays: 30 },
    "paywall-initial": { enabled: true, minReviewsToday: 2, minReviewDays: 3 },
    "paywall-second": { enabled: true, minReviewsToday: 2, minReviewDays: 5, cooldownDays: 2 },
    "paywall-periodic": { enabled: true, minReviewsToday: 2, minReviewDays: 15, cooldownDays: 7 },
    "notifications-pre-prompt": { enabled: true, minTotalReviews: 6, cooldownDays: 7 },
    "hard-reminder": { enabled: true, cooldownDays: 3 },
  },
};

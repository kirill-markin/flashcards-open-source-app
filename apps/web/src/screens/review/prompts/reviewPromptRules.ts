import type {
  ReviewPromptConfig,
  ReviewPromptId,
  ReviewPromptSettings,
} from "../../../../../backend/src/reviewPrompts/reviewPromptConfig";
import type { DailyReviewPoint } from "../../../types";

// The prompts this client has; the walk skips the other ids in the config order.
const webReviewPromptIds = [
  "hard-reminder",
  "paywall-initial",
  "paywall-second",
  "paywall-periodic",
  "web-mobile-app-promo",
  "guest-sign-in",
  "automatic-feedback",
] as const satisfies ReadonlyArray<ReviewPromptId>;

export type WebReviewPromptId = (typeof webReviewPromptIds)[number];

export type ReviewPromptCounters = Readonly<{
  totalReviews: number;
  reviewsToday: number;
  reviewDays: number;
}>;

const dayMillis = 24 * 60 * 60 * 1000;

function isWebReviewPromptId(promptId: ReviewPromptId): promptId is WebReviewPromptId {
  return (webReviewPromptIds as ReadonlyArray<ReviewPromptId>).includes(promptId);
}

export function listWebReviewPromptOrder(config: ReviewPromptConfig): ReadonlyArray<WebReviewPromptId> {
  return config.order.filter(isWebReviewPromptId);
}

export function hasReviewPromptCounterConditions(settings: ReviewPromptSettings): boolean {
  return settings.minTotalReviews !== undefined
    || settings.minReviewsToday !== undefined
    || settings.minReviewDays !== undefined;
}

export function passesReviewPromptCounterConditions(
  settings: ReviewPromptSettings,
  counters: ReviewPromptCounters,
): boolean {
  return (settings.minTotalReviews === undefined || counters.totalReviews >= settings.minTotalReviews)
    && (settings.minReviewsToday === undefined || counters.reviewsToday >= settings.minReviewsToday)
    && (settings.minReviewDays === undefined || counters.reviewDays >= settings.minReviewDays);
}

export function isReviewPromptCooldownElapsed(
  settings: ReviewPromptSettings,
  lastShownAtMillis: number | null,
  nowMillis: number,
): boolean {
  return settings.cooldownDays === undefined
    || lastShownAtMillis === null
    || nowMillis - lastShownAtMillis >= settings.cooldownDays * dayMillis;
}

export function parseReviewPromptShownAt(shownAt: string | null, fieldName: string): number | null {
  if (shownAt === null) {
    return null;
  }

  const shownAtMillis = new Date(shownAt).getTime();
  if (Number.isNaN(shownAtMillis)) {
    throw new Error(`Invalid review prompt state: ${fieldName} must be an ISO timestamp`);
  }

  return shownAtMillis;
}

export function buildReviewPromptCounters(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
  today: string,
): ReviewPromptCounters {
  return {
    totalReviews: dailyReviews.reduce((total, point) => total + point.reviewCount, 0),
    reviewsToday: dailyReviews.find((point) => point.date === today)?.reviewCount ?? 0,
    reviewDays: dailyReviews.filter((point) => point.reviewCount > 0).length,
  };
}

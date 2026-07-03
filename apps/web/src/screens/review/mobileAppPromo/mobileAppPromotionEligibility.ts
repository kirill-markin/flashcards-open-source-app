import type { MobileAppPromotionState } from "../../../localDb/mobileAppPromotion/mobileAppPromotion";
import { loadLocalProgressDailyReviews } from "../../../localDb/progress/progress";
import { buildProgressDateContext } from "../../../progress/progressDates";

export type MobileAppPromotionReviewActivity = Readonly<{
  today: string;
  timeZone: string;
  todayReviewCount: number;
}>;

export type MobileAppPromotionEligibilityInput = Readonly<{
  reviewActivity: Pick<MobileAppPromotionReviewActivity, "today" | "todayReviewCount">;
  promptState: MobileAppPromotionState;
  hasMobileReviewEvent: boolean;
}>;

export type MobileAppPromotionEligibilityResult = Readonly<{
  isEligible: boolean;
  reason:
    | "eligible"
    | "known_mobile_review_event"
    | "backend_mobile_review_event"
    | "today_review_count"
    | "shown_today";
}>;

export const mobileAppPromotionMinimumReviewCount: number = 5;

export function evaluateMobileAppPromotionEligibility(
  input: MobileAppPromotionEligibilityInput,
): MobileAppPromotionEligibilityResult {
  if (input.promptState.knownHasMobileReviewEvent) {
    return {
      isEligible: false,
      reason: "known_mobile_review_event",
    };
  }

  if (input.hasMobileReviewEvent) {
    return {
      isEligible: false,
      reason: "backend_mobile_review_event",
    };
  }

  if (input.reviewActivity.todayReviewCount < mobileAppPromotionMinimumReviewCount) {
    return {
      isEligible: false,
      reason: "today_review_count",
    };
  }

  if (input.promptState.lastPromptShownLocalDate === input.reviewActivity.today) {
    return {
      isEligible: false,
      reason: "shown_today",
    };
  }

  return {
    isEligible: true,
    reason: "eligible",
  };
}

export async function loadMobileAppPromotionReviewActivity(
  workspaceId: string,
  now: Date,
): Promise<MobileAppPromotionReviewActivity> {
  const dateContext = buildProgressDateContext(now);
  const todayReviews = await loadLocalProgressDailyReviews([workspaceId], {
    timeZone: dateContext.timeZone,
    from: dateContext.today,
    to: dateContext.today,
  });
  const todayReviewCount = todayReviews.find((point) => point.date === dateContext.today)?.reviewCount ?? 0;

  return {
    today: dateContext.today,
    timeZone: dateContext.timeZone,
    todayReviewCount,
  };
}

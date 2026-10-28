import type { ReviewPromptSettings } from "../../../../../backend/src/reviewPrompts/reviewPromptConfig";
import type { MobileAppPromotionState } from "../../../localDb/mobileAppPromotion/mobileAppPromotion";
import { isReviewPromptCooldownElapsed, parseReviewPromptShownAt } from "../prompts/reviewPromptRules";

/** The fixed rules and cooldown of the web promo; its config counter conditions are checked by the caller. */
export type MobileAppPromotionEligibilityInput = Readonly<{
  settings: ReviewPromptSettings;
  promptState: MobileAppPromotionState;
  hasMobileReviewEvent: boolean;
  nowMillis: number;
}>;

export type MobileAppPromotionEligibilityResult = Readonly<{
  isEligible: boolean;
  reason:
    | "eligible"
    | "known_mobile_review_event"
    | "backend_mobile_review_event"
    | "shown_cooldown";
}>;

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

  const lastShownAtMillis = parseReviewPromptShownAt(input.promptState.lastPromptShownAt, "lastPromptShownAt");
  if (isReviewPromptCooldownElapsed(input.settings, lastShownAtMillis, input.nowMillis) === false) {
    return {
      isEligible: false,
      reason: "shown_cooldown",
    };
  }

  return {
    isEligible: true,
    reason: "eligible",
  };
}

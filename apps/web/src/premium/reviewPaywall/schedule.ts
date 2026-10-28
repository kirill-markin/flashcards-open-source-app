import type { ReviewPromptSettings } from "../../../../backend/src/reviewPrompts/reviewPromptConfig";
import type { PaywallState, ReviewPaywallTrigger } from "../../apiContracts/paywallState";
import { isReviewPromptCooldownElapsed, parseReviewPromptShownAt } from "../../screens/review/prompts/reviewPromptRules";
import type { EntitlementSnapshot } from "../../types/entitlement";

export type ReviewPaywallPromptId = "paywall-initial" | "paywall-second" | "paywall-periodic";

// Wire names of the review paywall prompts: see the comment beside `reviewTrigger` in
// apps/backend/src/paywallState.ts.
const reviewPaywallTriggers: Readonly<Record<ReviewPaywallPromptId, ReviewPaywallTrigger>> = {
  "paywall-initial": "initial",
  "paywall-second": "day3",
  "paywall-periodic": "weekly",
};

export function isKnownFreeEntitlement(entitlement: EntitlementSnapshot | null): boolean {
  return entitlement !== null && entitlement.status === "none" && !entitlement.isTrial && entitlement.tierRank < 20;
}

function readReviewPaywallShownAt(state: PaywallState, promptId: ReviewPaywallPromptId): string | null {
  switch (promptId) {
    case "paywall-initial":
      return state.introShownAt;
    case "paywall-second":
      return state.followUpShownAt;
    case "paywall-periodic":
      return state.periodicShownAt;
  }
}

// Any after-review paywall showing restarts the cooldown of all three.
function readLatestReviewPaywallShownAtMillis(state: PaywallState): number | null {
  const shownAtMillis = [
    parseReviewPromptShownAt(state.introShownAt, "introShownAt"),
    parseReviewPromptShownAt(state.followUpShownAt, "followUpShownAt"),
    parseReviewPromptShownAt(state.periodicShownAt, "periodicShownAt"),
  ].filter((millis): millis is number => millis !== null);
  return shownAtMillis.length === 0 ? null : Math.max(...shownAtMillis);
}

/** The fixed rules and shared cooldown of one review paywall; its config counter conditions are checked by the caller. */
export function dueReviewPaywall(
  promptId: ReviewPaywallPromptId,
  settings: ReviewPromptSettings,
  state: PaywallState,
  nowMillis: number,
): ReviewPaywallTrigger | null {
  if (promptId !== "paywall-periodic" && readReviewPaywallShownAt(state, promptId) !== null) return null;
  return isReviewPromptCooldownElapsed(settings, readLatestReviewPaywallShownAtMillis(state), nowMillis)
    ? reviewPaywallTriggers[promptId]
    : null;
}

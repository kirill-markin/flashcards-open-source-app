import type { ReviewPromptSettings } from "../../../backend/src/reviewPrompts/reviewPromptConfig";
import type { FeedbackPromptState } from "../localDb/feedback/feedback";
import { isReviewPromptCooldownElapsed, parseReviewPromptShownAt } from "../screens/review/prompts/reviewPromptRules";

/** The cooldown of the automatic feedback prompt; its config counter conditions are checked by the caller. */
export type AutomaticFeedbackPromptEligibilityInput = Readonly<{
  settings: ReviewPromptSettings;
  promptState: FeedbackPromptState;
  nowMillis: number;
}>;

const dayMs = 24 * 60 * 60 * 1000;
export const feedbackStateStaleMs: number = dayMs;

function parseTimestampMillis(timestamp: string, fieldName: keyof FeedbackPromptState): number {
  const timestampMillis = new Date(timestamp).getTime();
  if (Number.isNaN(timestampMillis)) {
    throw new Error(`Invalid local feedback prompt state: ${fieldName} must be an ISO timestamp`);
  }

  return timestampMillis;
}

export function isFeedbackStateMissingOrStale(promptState: FeedbackPromptState, nowMillis: number): boolean {
  if (promptState.lastFeedbackStateFetchedAt === null) {
    return true;
  }

  return parseTimestampMillis(promptState.lastFeedbackStateFetchedAt, "lastFeedbackStateFetchedAt") + feedbackStateStaleMs <= nowMillis;
}

export function isAutomaticFeedbackPromptEligible(input: AutomaticFeedbackPromptEligibilityInput): boolean {
  return isReviewPromptCooldownElapsed(
    input.settings,
    parseReviewPromptShownAt(input.promptState.lastAutomaticFeedbackPromptShownAt, "lastAutomaticFeedbackPromptShownAt"),
    input.nowMillis,
  );
}

/** A stale local copy may miss an automatic showing on another device, so it is refreshed before showing. */
export function shouldRequestAutomaticFeedbackState(input: AutomaticFeedbackPromptEligibilityInput): boolean {
  return isAutomaticFeedbackPromptEligible(input) && isFeedbackStateMissingOrStale(input.promptState, input.nowMillis);
}

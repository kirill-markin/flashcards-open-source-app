import type { FeedbackPromptState } from "../localDb/feedback/feedback";
import {
  loadLocalProgressDailyReviews,
  loadLocalProgressSummary,
} from "../localDb/progress/progress";
import { buildProgressDateContext } from "../progress/progressDates";

export type AutomaticFeedbackPromptReviewActivity = Readonly<{
  today: string;
  timeZone: string;
  todayReviewCount: number;
  hasPreviousReviewDay: boolean;
}>;

export type AutomaticFeedbackPromptEligibilityInput = Readonly<{
  reviewActivity: Pick<AutomaticFeedbackPromptReviewActivity, "todayReviewCount" | "hasPreviousReviewDay">;
  promptState: FeedbackPromptState;
  nowMillis: number;
}>;

export type AutomaticFeedbackPromptEligibilityResult = Readonly<{
  isEligible: boolean;
  reason:
    | "eligible"
    | "today_review_count"
    | "previous_review_day"
    | "next_prompt_at"
    | "shown_cooldown"
    | "submitted_cooldown";
}>;

const dayMs = 24 * 60 * 60 * 1000;
export const automaticFeedbackPromptMinimumReviewCount: number = 15;
export const automaticFeedbackPromptCooldownMs: number = 30 * dayMs;
export const feedbackStateStaleMs: number = dayMs;

function parseTimestampMillis(timestamp: string, fieldName: keyof FeedbackPromptState): number {
  const timestampMillis = new Date(timestamp).getTime();
  if (Number.isNaN(timestampMillis)) {
    throw new Error(`Invalid local feedback prompt state: ${fieldName} must be an ISO timestamp`);
  }

  return timestampMillis;
}

function isTimestampNowOrPast(timestamp: string | null, fieldName: keyof FeedbackPromptState, nowMillis: number): boolean {
  if (timestamp === null) {
    return true;
  }

  return parseTimestampMillis(timestamp, fieldName) <= nowMillis;
}

function isCooldownExpired(
  timestamp: string | null,
  fieldName: keyof FeedbackPromptState,
  nowMillis: number,
): boolean {
  if (timestamp === null) {
    return true;
  }

  return parseTimestampMillis(timestamp, fieldName) + automaticFeedbackPromptCooldownMs <= nowMillis;
}

export function buildNextAutomaticFeedbackPromptAt(shownAt: Date): string {
  return new Date(shownAt.getTime() + automaticFeedbackPromptCooldownMs).toISOString();
}

export function isFeedbackStateMissingOrStale(promptState: FeedbackPromptState, nowMillis: number): boolean {
  if (promptState.lastFeedbackStateFetchedAt === null) {
    return true;
  }

  return parseTimestampMillis(promptState.lastFeedbackStateFetchedAt, "lastFeedbackStateFetchedAt") + feedbackStateStaleMs <= nowMillis;
}

export function evaluateAutomaticFeedbackPromptEligibility(
  input: AutomaticFeedbackPromptEligibilityInput,
): AutomaticFeedbackPromptEligibilityResult {
  if (input.reviewActivity.todayReviewCount < automaticFeedbackPromptMinimumReviewCount) {
    return {
      isEligible: false,
      reason: "today_review_count",
    };
  }

  if (input.reviewActivity.hasPreviousReviewDay === false) {
    return {
      isEligible: false,
      reason: "previous_review_day",
    };
  }

  if (
    isTimestampNowOrPast(
      input.promptState.nextAutomaticFeedbackPromptAt,
      "nextAutomaticFeedbackPromptAt",
      input.nowMillis,
    ) === false
  ) {
    return {
      isEligible: false,
      reason: "next_prompt_at",
    };
  }

  if (
    isCooldownExpired(
      input.promptState.lastAutomaticFeedbackPromptShownAt,
      "lastAutomaticFeedbackPromptShownAt",
      input.nowMillis,
    ) === false
  ) {
    return {
      isEligible: false,
      reason: "shown_cooldown",
    };
  }

  if (isCooldownExpired(input.promptState.lastFeedbackSubmittedAt, "lastFeedbackSubmittedAt", input.nowMillis) === false) {
    return {
      isEligible: false,
      reason: "submitted_cooldown",
    };
  }

  return {
    isEligible: true,
    reason: "eligible",
  };
}

export function shouldRequestAutomaticFeedbackState(input: AutomaticFeedbackPromptEligibilityInput): boolean {
  const eligibility = evaluateAutomaticFeedbackPromptEligibility(input);
  return eligibility.isEligible && isFeedbackStateMissingOrStale(input.promptState, input.nowMillis);
}

export async function loadAutomaticFeedbackPromptReviewActivity(
  workspaceId: string,
  now: Date,
): Promise<AutomaticFeedbackPromptReviewActivity> {
  const dateContext = buildProgressDateContext(now);
  const [
    summary,
    todayReviews,
  ] = await Promise.all([
    loadLocalProgressSummary([workspaceId], {
      timeZone: dateContext.timeZone,
      today: dateContext.today,
    }),
    loadLocalProgressDailyReviews([workspaceId], {
      timeZone: dateContext.timeZone,
      from: dateContext.today,
      to: dateContext.today,
    }),
  ]);
  const todayReviewCount = todayReviews.find((point) => point.date === dateContext.today)?.reviewCount ?? 0;
  const previousReviewDayCount = summary.activeReviewDays - (summary.hasReviewedToday ? 1 : 0);

  return {
    today: dateContext.today,
    timeZone: dateContext.timeZone,
    todayReviewCount,
    hasPreviousReviewDay: previousReviewDayCount > 0,
  };
}

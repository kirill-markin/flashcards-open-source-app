import type { TranslationMessages, useI18n } from "../../../i18n";
import type { Card, WorkspaceSchedulerSettings } from "../../../types";
import { computeReviewSchedule, type ReviewRating } from "../../../../../backend/src/scheduling";

type ReviewRatingTestId = "again" | "good" | "hard" | "easy";
type Translate = ReturnType<typeof useI18n>["t"];
type CountFormatter = ReturnType<typeof useI18n>["formatCount"];
type CountLabels = TranslationMessages["common"]["countLabels"];

export type ReviewButtonOption = Readonly<{
  intervalDescription: string;
  rating: ReviewRating;
  testId: ReviewRatingTestId;
  title: string;
}>;

const reviewAnswerOptions: ReadonlyArray<ReviewRating> = [0, 2, 1, 3];

function reviewRatingTitle(rating: ReviewRating, t: Translate): string {
  if (rating === 0) {
    return t("reviewScreen.ratings.again");
  }

  if (rating === 1) {
    return t("reviewScreen.ratings.hard");
  }

  if (rating === 2) {
    return t("reviewScreen.ratings.good");
  }

  return t("reviewScreen.ratings.easy");
}

function reviewRatingTestId(rating: ReviewRating): ReviewRatingTestId {
  if (rating === 0) {
    return "again";
  }

  if (rating === 1) {
    return "hard";
  }

  if (rating === 2) {
    return "good";
  }

  return "easy";
}

function formatReviewIntervalDescription(
  now: Date,
  dueAt: Date,
  t: Translate,
  formatCount: CountFormatter,
  countLabels: CountLabels,
): string {
  const durationMilliseconds = Math.max(dueAt.getTime() - now.getTime(), 0);
  const durationSeconds = Math.floor(durationMilliseconds / 1000);

  if (durationSeconds < 60) {
    return t("reviewScreen.interval.lessThanMinute");
  }

  const durationMinutes = Math.floor(durationSeconds / 60);
  if (durationMinutes < 60) {
    return t("reviewScreen.interval.inCount", {
      count: formatCount(durationMinutes, countLabels.minute),
    });
  }

  const durationHours = Math.floor(durationMinutes / 60);
  if (durationHours < 24) {
    return t("reviewScreen.interval.inCount", {
      count: formatCount(durationHours, countLabels.hour),
    });
  }

  const durationDays = Math.floor(durationHours / 24);
  return t("reviewScreen.interval.inCount", {
    count: formatCount(durationDays, countLabels.day),
  });
}

export function buildReviewButtonOptions(
  card: Card,
  schedulerSettings: WorkspaceSchedulerSettings,
  now: Date,
  t: Translate,
  formatCount: CountFormatter,
  countLabels: CountLabels,
): Array<ReviewButtonOption> {
  return reviewAnswerOptions.map((option) => {
    const schedule = computeReviewSchedule(
      {
        cardId: card.cardId,
        reps: card.reps,
        lapses: card.lapses,
        fsrsCardState: card.fsrsCardState,
        fsrsStepIndex: card.fsrsStepIndex,
        fsrsStability: card.fsrsStability,
        fsrsDifficulty: card.fsrsDifficulty,
        fsrsLastReviewedAt: card.fsrsLastReviewedAt === null ? null : new Date(card.fsrsLastReviewedAt),
        fsrsScheduledDays: card.fsrsScheduledDays,
      },
      {
        algorithm: schedulerSettings.algorithm,
        desiredRetention: schedulerSettings.desiredRetention,
        learningStepsMinutes: schedulerSettings.learningStepsMinutes,
        relearningStepsMinutes: schedulerSettings.relearningStepsMinutes,
        maximumIntervalDays: schedulerSettings.maximumIntervalDays,
        enableFuzz: schedulerSettings.enableFuzz,
      },
      option,
      now,
    );

    return {
      title: reviewRatingTitle(option, t),
      rating: option,
      testId: reviewRatingTestId(option),
      intervalDescription: formatReviewIntervalDescription(now, schedule.dueAt, t, formatCount, countLabels),
    };
  });
}

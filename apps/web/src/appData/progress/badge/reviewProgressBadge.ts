import { useMemo } from "react";
import type { ProgressSummarySnapshot, ProgressSummarySourceState, ReviewProgressBadgeState } from "../../../types";
import { createDefaultStreakFreeze } from "../../../progress/streakFreeze";
import { useProgressInvalidationState } from "../invalidation/progressInvalidation";
import { useProgressSource } from "../progressSource";
import { useAppData } from "../../context/provider";

const EMPTY_REVIEW_PROGRESS_BADGE_STATE: ReviewProgressBadgeState = {
  streakDays: 0,
  hasReviewedToday: false,
  streakFreeze: createDefaultStreakFreeze(),
  isInteractive: true,
};

const REVIEW_PROGRESS_BADGE_SECTIONS = {
  includeSummary: true,
  includeSeries: false,
  includeReviewSchedule: false,
  includeLeaderboard: false,
} as const;

export function buildReviewProgressBadgeStateFromSummarySnapshot(
  summarySnapshot: ProgressSummarySnapshot | null,
): ReviewProgressBadgeState {
  if (summarySnapshot === null) {
    return EMPTY_REVIEW_PROGRESS_BADGE_STATE;
  }

  return {
    streakDays: summarySnapshot.summary.currentStreakDays,
    hasReviewedToday: summarySnapshot.summary.hasReviewedToday,
    streakFreeze: summarySnapshot.summary.streakFreeze,
    isInteractive: true,
  };
}

export function buildReviewProgressBadgeState(
  progressSummarySourceState: ProgressSummarySourceState,
): ReviewProgressBadgeState {
  return buildReviewProgressBadgeStateFromSummarySnapshot(progressSummarySourceState.renderedSnapshot);
}

const REVIEW_PROGRESS_BADGE_OVERFLOW_THRESHOLD = 99;

export function formatReviewProgressBadgeValue(streakDays: number): string {
  if (streakDays > REVIEW_PROGRESS_BADGE_OVERFLOW_THRESHOLD) {
    return `${REVIEW_PROGRESS_BADGE_OVERFLOW_THRESHOLD}+`;
  }

  return streakDays.toString();
}

export function formatReviewProgressFreezeValue(
  streakFreeze: ReviewProgressBadgeState["streakFreeze"],
  formatNumber: (value: number) => string,
): string {
  return `${formatNumber(streakFreeze.availableCredits)}/${formatNumber(streakFreeze.capacity)}`;
}

export function useReviewProgressBadge(): ReviewProgressBadgeState {
  const {
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
  } = useAppData();
  const { progressLocalVersion, progressServerInvalidationVersion } = useProgressInvalidationState();
  const { progressSourceState } = useProgressSource({
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
    progressLocalVersion,
    progressScheduleLocalVersion: 0,
    progressServerInvalidationVersion,
    leaderboardAutoRefreshEnabled: true,
    canExposeTechnicalErrors: false,
    sections: REVIEW_PROGRESS_BADGE_SECTIONS,
  });

  return useMemo(
    () => buildReviewProgressBadgeState(progressSourceState.summary),
    [progressSourceState.summary],
  );
}

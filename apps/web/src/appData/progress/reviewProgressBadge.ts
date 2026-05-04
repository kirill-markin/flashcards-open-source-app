import { useMemo } from "react";
import type { ProgressSummarySnapshot, ProgressSummarySourceState, ReviewProgressBadgeState } from "../../types";
import { useProgressInvalidationState } from "./progressInvalidation";
import { useProgressSource } from "./progressSource";
import { useAppData } from "../provider";

const EMPTY_REVIEW_PROGRESS_BADGE_STATE: ReviewProgressBadgeState = {
  streakDays: 0,
  hasReviewedToday: false,
  isInteractive: true,
};

const REVIEW_PROGRESS_BADGE_SECTIONS = {
  includeSummary: true,
  includeSeries: false,
  includeReviewSchedule: false,
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
    sections: REVIEW_PROGRESS_BADGE_SECTIONS,
  });

  return useMemo(
    () => buildReviewProgressBadgeState(progressSourceState.summary),
    [progressSourceState.summary],
  );
}

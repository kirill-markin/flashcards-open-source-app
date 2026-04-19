import { useMemo } from "react";
import type { ProgressSummarySourceState, ReviewProgressBadgeState } from "../types";
import { useProgressInvalidationState } from "./progressInvalidation";
import { useProgressSource } from "./progressSource";
import { useAppData } from "./provider";

const EMPTY_REVIEW_PROGRESS_BADGE_STATE: ReviewProgressBadgeState = {
  streakDays: 0,
  hasReviewedToday: false,
  isInteractive: true,
};

const REVIEW_PROGRESS_BADGE_SECTIONS = {
  includeSummary: true,
  includeSeries: false,
} as const;

function buildReviewProgressBadgeState(progressSummarySourceState: ProgressSummarySourceState): ReviewProgressBadgeState {
  const summarySnapshot = progressSummarySourceState.renderedSnapshot;

  if (summarySnapshot === null) {
    return EMPTY_REVIEW_PROGRESS_BADGE_STATE;
  }

  return {
    streakDays: summarySnapshot.summary.currentStreakDays,
    hasReviewedToday: summarySnapshot.summary.hasReviewedToday,
    isInteractive: true,
  };
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
    progressServerInvalidationVersion,
    sections: REVIEW_PROGRESS_BADGE_SECTIONS,
  });

  return useMemo(
    () => buildReviewProgressBadgeState(progressSourceState.summary),
    [progressSourceState.summary],
  );
}

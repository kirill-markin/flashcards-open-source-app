import { useEffect, useMemo } from "react";
import type { ProgressLeaderboardSourceState, ReviewLeaderboardBadgeState } from "../../../types";
import { useAppData } from "../../context/provider";
import { useProgressInvalidationState } from "../invalidation/progressInvalidation";
import { resolveBestLeaderboardPlacement } from "../leaderboardPlacement";
import { useProgressSource } from "../progressSource";

const EMPTY_REVIEW_LEADERBOARD_BADGE_STATE: ReviewLeaderboardBadgeState = {
  rank: null,
  windowKey: null,
  isInteractive: true,
};

const REVIEW_LEADERBOARD_BADGE_SECTIONS = {
  includeSummary: false,
  includeSeries: false,
  includeReviewSchedule: false,
  includeLeaderboard: true,
} as const;

export function buildReviewLeaderboardBadgeState(
  progressLeaderboardSourceState: ProgressLeaderboardSourceState,
): ReviewLeaderboardBadgeState {
  const bestPlacement = resolveBestLeaderboardPlacement(progressLeaderboardSourceState.renderedSnapshot);
  if (bestPlacement === null) {
    return EMPTY_REVIEW_LEADERBOARD_BADGE_STATE;
  }

  return {
    rank: bestPlacement.rank,
    windowKey: bestPlacement.windowKey,
    isInteractive: true,
  };
}

export function useReviewLeaderboardBadge(): ReviewLeaderboardBadgeState {
  const {
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
  } = useAppData();
  const { progressLocalVersion, progressServerInvalidationVersion } = useProgressInvalidationState();
  const { progressSourceState, refreshProgress } = useProgressSource({
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
    progressLocalVersion,
    progressScheduleLocalVersion: 0,
    progressServerInvalidationVersion,
    leaderboardAutoRefreshEnabled: false,
    canExposeTechnicalErrors: false,
    sections: REVIEW_LEADERBOARD_BADGE_SECTIONS,
  });

  useEffect(() => {
    void refreshProgress();
  }, [refreshProgress]);

  return useMemo(
    () => buildReviewLeaderboardBadgeState(progressSourceState.leaderboard),
    [progressSourceState.leaderboard],
  );
}

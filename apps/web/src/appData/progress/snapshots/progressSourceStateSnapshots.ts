import type {
  ProgressLeaderboardSourceState,
  ProgressReviewScheduleSourceState,
  ProgressSeriesSourceState,
  ProgressSourceState,
  ProgressStreakLeaderboardSourceState,
  ProgressSummarySourceState,
} from "../../../types";
import { buildRenderedLeaderboard } from "./progressLeaderboardSnapshots";
import { buildRenderedReviewSchedule } from "./progressReviewScheduleSnapshots";
import { buildRenderedSeries } from "./progressSeriesSnapshots";
import { buildRenderedStreakLeaderboard } from "./progressStreakLeaderboardSnapshots";
import { buildRenderedSummary } from "./progressSummarySnapshots";

export function createEmptyProgressSummarySourceState(): ProgressSummarySourceState {
  return {
    scopeKey: null,
    referenceLocalDate: null,
    localFallback: null,
    localFallbackActiveDates: [],
    serverBase: null,
    hasPendingLocalReviews: false,
    renderedSeriesContext: null,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
    technicalError: null,
  };
}

export function createEmptyProgressSeriesSourceState(): ProgressSeriesSourceState {
  return {
    scopeKey: null,
    localFallback: null,
    localFallbackActiveDates: [],
    serverBase: null,
    pendingLocalOverlay: null,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
    technicalError: null,
  };
}

export function createEmptyProgressReviewScheduleSourceState(): ProgressReviewScheduleSourceState {
  return {
    scopeKey: null,
    localFallback: null,
    serverBase: null,
    progressScheduleLocalVersion: 0,
    serverBaseProgressScheduleLocalVersion: null,
    serverBaseLocalCardTotalDelta: 0,
    hasPendingLocalCardChanges: false,
    hasCompleteLocalCardState: false,
    pendingLocalCardTotalDelta: 0,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
    technicalError: null,
  };
}

export function createEmptyProgressLeaderboardSourceState(): ProgressLeaderboardSourceState {
  return {
    scopeKey: null,
    serverBase: null,
    localViewerCounts: null,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
    technicalError: null,
    isNetworkError: false,
    localViewerCountsErrorMessage: "",
    localViewerCountsTechnicalError: null,
  };
}

export function createEmptyProgressStreakLeaderboardSourceState(): ProgressStreakLeaderboardSourceState {
  return {
    scopeKey: null,
    serverBase: null,
    currentSummary: null,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
    technicalError: null,
    isNetworkError: false,
  };
}

export function createEmptyProgressSourceState(): ProgressSourceState {
  return {
    summary: createEmptyProgressSummarySourceState(),
    series: createEmptyProgressSeriesSourceState(),
    reviewSchedule: createEmptyProgressReviewScheduleSourceState(),
    leaderboard: createEmptyProgressLeaderboardSourceState(),
    streakLeaderboard: createEmptyProgressStreakLeaderboardSourceState(),
  };
}

export function createNextSummaryState(
  currentState: ProgressSummarySourceState,
  patch: Readonly<Partial<Omit<ProgressSummarySourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressSummarySourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: buildRenderedSummary(
      nextStateWithoutRenderedSnapshot.serverBase,
      nextStateWithoutRenderedSnapshot.localFallback,
      nextStateWithoutRenderedSnapshot.localFallbackActiveDates,
      nextStateWithoutRenderedSnapshot.hasPendingLocalReviews,
      nextStateWithoutRenderedSnapshot.renderedSeriesContext,
      nextStateWithoutRenderedSnapshot.referenceLocalDate,
      canRenderServerBase,
    ),
  };
}

export function createNextSeriesState(
  currentState: ProgressSeriesSourceState,
  patch: Readonly<Partial<Omit<ProgressSeriesSourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressSeriesSourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: buildRenderedSeries(
      nextStateWithoutRenderedSnapshot.serverBase,
      nextStateWithoutRenderedSnapshot.localFallback,
      nextStateWithoutRenderedSnapshot.localFallbackActiveDates,
      nextStateWithoutRenderedSnapshot.pendingLocalOverlay,
      canRenderServerBase,
    ),
  };
}

export function createNextLeaderboardState(
  currentState: ProgressLeaderboardSourceState,
  patch: Readonly<Partial<Omit<ProgressLeaderboardSourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressLeaderboardSourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: buildRenderedLeaderboard(
      nextStateWithoutRenderedSnapshot.serverBase,
      nextStateWithoutRenderedSnapshot.localViewerCounts,
      canRenderServerBase,
    ),
  };
}

export function createNextStreakLeaderboardState(
  currentState: ProgressStreakLeaderboardSourceState,
  patch: Readonly<Partial<Omit<ProgressStreakLeaderboardSourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressStreakLeaderboardSourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: nextStateWithoutRenderedSnapshot.scopeKey === null
      ? null
      : buildRenderedStreakLeaderboard(
        nextStateWithoutRenderedSnapshot.serverBase,
        nextStateWithoutRenderedSnapshot.currentSummary,
        canRenderServerBase,
      ),
  };
}

export function createNextReviewScheduleState(
  currentState: ProgressReviewScheduleSourceState,
  patch: Readonly<Partial<Omit<ProgressReviewScheduleSourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressReviewScheduleSourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: buildRenderedReviewSchedule(
      nextStateWithoutRenderedSnapshot.serverBase,
      nextStateWithoutRenderedSnapshot.localFallback,
      nextStateWithoutRenderedSnapshot.hasPendingLocalCardChanges,
      nextStateWithoutRenderedSnapshot.hasCompleteLocalCardState,
      nextStateWithoutRenderedSnapshot.pendingLocalCardTotalDelta,
      nextStateWithoutRenderedSnapshot.progressScheduleLocalVersion,
      nextStateWithoutRenderedSnapshot.serverBaseProgressScheduleLocalVersion,
      nextStateWithoutRenderedSnapshot.serverBaseLocalCardTotalDelta,
      canRenderServerBase,
    ),
  };
}

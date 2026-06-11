import type {
  ProgressLeaderboardSourceState,
  ProgressReviewScheduleSourceState,
  ProgressSeriesSourceState,
  ProgressSourceState,
  ProgressSummarySourceState,
} from "../../../types";
import { buildRenderedLeaderboard } from "./progressLeaderboardSnapshots";
import { buildRenderedReviewSchedule } from "./progressReviewScheduleSnapshots";
import { buildRenderedSeries } from "./progressSeriesSnapshots";
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
  };
}

export function createEmptyProgressSeriesSourceState(): ProgressSeriesSourceState {
  return {
    scopeKey: null,
    localFallback: null,
    serverBase: null,
    pendingLocalOverlay: null,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
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
    isNetworkError: false,
    localViewerCountsErrorMessage: "",
  };
}

export function createEmptyProgressSourceState(): ProgressSourceState {
  return {
    summary: createEmptyProgressSummarySourceState(),
    series: createEmptyProgressSeriesSourceState(),
    reviewSchedule: createEmptyProgressReviewScheduleSourceState(),
    leaderboard: createEmptyProgressLeaderboardSourceState(),
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

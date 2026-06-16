import type {
  ProgressChartData,
  ProgressLeaderboardLocalViewerCounts,
  ProgressLeaderboardSnapshot,
  ProgressReviewScheduleSnapshot,
  ProgressScopeKey,
  ProgressSeriesSnapshot,
  ProgressSeriesSourceState,
  ProgressSourceState,
  ProgressSummarySnapshot,
  ProgressSummarySourceState,
} from "../../../types";
import {
  areProgressSourceStatesEqual,
  createEmptyProgressLeaderboardSourceState,
  createEmptyProgressReviewScheduleSourceState,
  createEmptyProgressSeriesSourceState,
  createEmptyProgressSourceState,
  createEmptyProgressSummarySourceState,
  createProgressRenderedSeriesSummaryContext,
  createNextLeaderboardState,
  createNextReviewScheduleState,
  createNextSeriesState,
  createNextSummaryState,
  resolveProgressReviewScheduleLoadedServerBaseLocalCardTotalDelta,
  resolveProgressReviewScheduleServerBaseLocalCardTotalDelta,
} from "../snapshots/progressSnapshots";

export type ProgressSourceAction =
  | Readonly<{ type: "summary_scope_reset" }>
  | Readonly<{ type: "series_scope_reset"; canRenderServerBase: boolean }>
  | Readonly<{ type: "review_schedule_scope_reset" }>
  | Readonly<{
    type: "summary_scope_initialized";
    scopeKey: ProgressScopeKey;
    referenceLocalDate: string;
    serverBase: ProgressSummarySnapshot | null;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "series_scope_initialized";
    scopeKey: ProgressScopeKey;
    serverBase: ProgressSeriesSnapshot | null;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "review_schedule_scope_initialized";
    scopeKey: ProgressScopeKey;
    serverBase: ProgressReviewScheduleSnapshot | null;
    progressScheduleLocalVersion: number;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "summary_local_load_succeeded";
    scopeKey: ProgressScopeKey;
    localFallback: ProgressSummarySnapshot;
    localFallbackActiveDates: ReadonlyArray<string>;
    hasPendingLocalReviews: boolean;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "summary_local_load_failed";
    scopeKey: ProgressScopeKey;
    errorMessage: string;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "review_schedule_local_load_succeeded";
    scopeKey: ProgressScopeKey;
    localFallback: ProgressReviewScheduleSnapshot;
    hasPendingLocalCardChanges: boolean;
    hasCompleteLocalCardState: boolean;
    pendingLocalCardTotalDelta: number;
    progressScheduleLocalVersion: number;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "review_schedule_local_load_failed";
    scopeKey: ProgressScopeKey;
    errorMessage: string;
    progressScheduleLocalVersion: number;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "series_local_load_succeeded";
    scopeKey: ProgressScopeKey;
    localFallback: ProgressSeriesSnapshot;
    localFallbackActiveDates: ReadonlyArray<string>;
    pendingLocalOverlay: ProgressChartData;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "series_local_load_failed";
    scopeKey: ProgressScopeKey;
    errorMessage: string;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "summary_server_load_succeeded";
    scopeKey: ProgressScopeKey;
    serverBase: ProgressSummarySnapshot;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "summary_server_load_failed";
    scopeKey: ProgressScopeKey;
    errorMessage: string;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "series_server_load_succeeded";
    scopeKey: ProgressScopeKey;
    serverBase: ProgressSeriesSnapshot;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "series_server_load_failed";
    scopeKey: ProgressScopeKey;
    errorMessage: string;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "review_schedule_server_load_succeeded";
    scopeKey: ProgressScopeKey;
    serverBase: ProgressReviewScheduleSnapshot;
    progressScheduleLocalVersion: number;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "review_schedule_server_load_failed";
    scopeKey: ProgressScopeKey;
    errorMessage: string;
    progressScheduleLocalVersion: number;
    canRenderServerBase: boolean;
  }>
  | Readonly<{ type: "leaderboard_scope_reset" }>
  | Readonly<{
    type: "leaderboard_scope_initialized";
    scopeKey: ProgressScopeKey;
    serverBase: ProgressLeaderboardSnapshot | null;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "leaderboard_local_load_succeeded";
    scopeKey: ProgressScopeKey;
    localViewerCounts: ProgressLeaderboardLocalViewerCounts;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "leaderboard_local_load_failed";
    scopeKey: ProgressScopeKey;
    errorMessage: string;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "leaderboard_server_load_succeeded";
    scopeKey: ProgressScopeKey;
    serverBase: ProgressLeaderboardSnapshot;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "leaderboard_server_load_failed";
    scopeKey: ProgressScopeKey;
    errorMessage: string;
    isNetworkError: boolean;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "leaderboard_server_load_skipped";
    scopeKey: ProgressScopeKey;
    canRenderServerBase: boolean;
  }>
  | Readonly<{
    type: "refresh_started";
    summaryScopeKey: ProgressScopeKey | null;
    seriesScopeKey: ProgressScopeKey | null;
    reviewScheduleScopeKey: ProgressScopeKey | null;
    leaderboardScopeKey: ProgressScopeKey | null;
    progressScheduleLocalVersion: number;
    canRenderServerBase: boolean;
  }>
  | Readonly<{ type: "errors_cleared"; canRenderServerBase: boolean }>;

export function createInitialProgressSourceState(): ProgressSourceState {
  return createEmptyProgressSourceState();
}

function createSummaryStateWithRenderedSeriesContext(
  summaryState: ProgressSummarySourceState,
  seriesState: ProgressSeriesSourceState,
  canRenderServerBase: boolean,
): ProgressSummarySourceState {
  return createNextSummaryState(summaryState, {
    renderedSeriesContext: createProgressRenderedSeriesSummaryContext(
      seriesState.serverBase,
      seriesState.renderedSnapshot,
    ),
  }, canRenderServerBase);
}

function reduceProgressSourceState(
  state: ProgressSourceState,
  action: ProgressSourceAction,
): ProgressSourceState {
  switch (action.type) {
    case "summary_scope_reset":
      return {
        ...state,
        summary: createEmptyProgressSummarySourceState(),
      };
    case "series_scope_reset": {
      const nextSeriesState = createEmptyProgressSeriesSourceState();
      return {
        ...state,
        summary: createSummaryStateWithRenderedSeriesContext(
          state.summary,
          nextSeriesState,
          action.canRenderServerBase,
        ),
        series: nextSeriesState,
      };
    }
    case "review_schedule_scope_reset":
      return {
        ...state,
        reviewSchedule: createEmptyProgressReviewScheduleSourceState(),
      };
    case "summary_scope_initialized":
      return {
        ...state,
        summary: createNextSummaryState(state.summary, {
          scopeKey: action.scopeKey,
          referenceLocalDate: action.referenceLocalDate,
          localFallback: null,
          localFallbackActiveDates: [],
          serverBase: action.serverBase,
          hasPendingLocalReviews: false,
          renderedSeriesContext: null,
          isLoading: true,
          errorMessage: "",
        }, action.canRenderServerBase),
      };
    case "series_scope_initialized": {
      const nextSeriesState = createNextSeriesState(state.series, {
        scopeKey: action.scopeKey,
        localFallback: null,
        localFallbackActiveDates: [],
        serverBase: action.serverBase,
        pendingLocalOverlay: null,
        isLoading: true,
        errorMessage: "",
      }, action.canRenderServerBase);

      return {
        ...state,
        summary: createSummaryStateWithRenderedSeriesContext(
          state.summary,
          nextSeriesState,
          action.canRenderServerBase,
        ),
        series: nextSeriesState,
      };
    }
    case "review_schedule_scope_initialized":
      return {
        ...state,
        reviewSchedule: createNextReviewScheduleState(state.reviewSchedule, {
          scopeKey: action.scopeKey,
          localFallback: null,
          serverBase: action.serverBase,
          progressScheduleLocalVersion: action.progressScheduleLocalVersion,
          serverBaseProgressScheduleLocalVersion: action.serverBase === null
            ? null
            : action.progressScheduleLocalVersion,
          serverBaseLocalCardTotalDelta: 0,
          hasPendingLocalCardChanges: false,
          hasCompleteLocalCardState: false,
          pendingLocalCardTotalDelta: 0,
          isLoading: true,
          errorMessage: "",
        }, action.canRenderServerBase),
      };
    case "summary_local_load_succeeded":
      if (state.summary.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        summary: createNextSummaryState(state.summary, {
          scopeKey: action.scopeKey,
          localFallback: action.localFallback,
          localFallbackActiveDates: action.localFallbackActiveDates,
          hasPendingLocalReviews: action.hasPendingLocalReviews,
          isLoading: false,
        }, action.canRenderServerBase),
      };
    case "summary_local_load_failed":
      if (state.summary.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        summary: createNextSummaryState(state.summary, {
          scopeKey: action.scopeKey,
          localFallback: null,
          localFallbackActiveDates: [],
          hasPendingLocalReviews: false,
          isLoading: false,
          errorMessage: action.errorMessage,
        }, action.canRenderServerBase),
      };
    case "series_local_load_succeeded": {
      if (state.series.scopeKey !== action.scopeKey) {
        return state;
      }

      const nextSeriesState = createNextSeriesState(state.series, {
        scopeKey: action.scopeKey,
        localFallback: action.localFallback,
        localFallbackActiveDates: action.localFallbackActiveDates,
        pendingLocalOverlay: action.pendingLocalOverlay,
        isLoading: false,
      }, action.canRenderServerBase);

      return {
        ...state,
        summary: createSummaryStateWithRenderedSeriesContext(
          state.summary,
          nextSeriesState,
          action.canRenderServerBase,
        ),
        series: nextSeriesState,
      };
    }
    case "series_local_load_failed": {
      if (state.series.scopeKey !== action.scopeKey) {
        return state;
      }

      const nextSeriesState = createNextSeriesState(state.series, {
        scopeKey: action.scopeKey,
        localFallback: null,
        localFallbackActiveDates: [],
        pendingLocalOverlay: null,
        isLoading: false,
        errorMessage: action.errorMessage,
      }, action.canRenderServerBase);

      return {
        ...state,
        summary: createSummaryStateWithRenderedSeriesContext(
          state.summary,
          nextSeriesState,
          action.canRenderServerBase,
        ),
        series: nextSeriesState,
      };
    }
    case "review_schedule_local_load_succeeded":
      if (state.reviewSchedule.scopeKey !== action.scopeKey) {
        return state;
      }

      const serverBaseLocalCardTotalDelta = resolveProgressReviewScheduleServerBaseLocalCardTotalDelta(
        state.reviewSchedule,
        action.localFallback,
        action.hasCompleteLocalCardState,
        action.pendingLocalCardTotalDelta,
        action.progressScheduleLocalVersion,
      );

      return {
        ...state,
        reviewSchedule: createNextReviewScheduleState(state.reviewSchedule, {
          scopeKey: action.scopeKey,
          localFallback: action.localFallback,
          progressScheduleLocalVersion: action.progressScheduleLocalVersion,
          serverBaseLocalCardTotalDelta,
          hasPendingLocalCardChanges: action.hasPendingLocalCardChanges,
          hasCompleteLocalCardState: action.hasCompleteLocalCardState,
          pendingLocalCardTotalDelta: action.pendingLocalCardTotalDelta,
          isLoading: false,
        }, action.canRenderServerBase),
      };
    case "review_schedule_local_load_failed":
      if (state.reviewSchedule.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        reviewSchedule: createNextReviewScheduleState(state.reviewSchedule, {
          scopeKey: action.scopeKey,
          localFallback: null,
          progressScheduleLocalVersion: action.progressScheduleLocalVersion,
          hasPendingLocalCardChanges: false,
          hasCompleteLocalCardState: false,
          pendingLocalCardTotalDelta: 0,
          isLoading: false,
          errorMessage: action.errorMessage,
        }, action.canRenderServerBase),
      };
    case "summary_server_load_succeeded":
      if (state.summary.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        summary: createNextSummaryState(state.summary, {
          scopeKey: action.scopeKey,
          serverBase: action.serverBase,
          isLoading: false,
          errorMessage: "",
        }, action.canRenderServerBase),
      };
    case "summary_server_load_failed":
      if (state.summary.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        summary: createNextSummaryState(state.summary, {
          scopeKey: action.scopeKey,
          isLoading: false,
          errorMessage: action.errorMessage,
        }, action.canRenderServerBase),
      };
    case "series_server_load_succeeded": {
      if (state.series.scopeKey !== action.scopeKey) {
        return state;
      }

      const nextSeriesState = createNextSeriesState(state.series, {
        scopeKey: action.scopeKey,
        serverBase: action.serverBase,
        isLoading: false,
        errorMessage: "",
      }, action.canRenderServerBase);

      return {
        ...state,
        summary: createSummaryStateWithRenderedSeriesContext(
          state.summary,
          nextSeriesState,
          action.canRenderServerBase,
        ),
        series: nextSeriesState,
      };
    }
    case "series_server_load_failed": {
      if (state.series.scopeKey !== action.scopeKey) {
        return state;
      }

      const nextSeriesState = createNextSeriesState(state.series, {
        scopeKey: action.scopeKey,
        isLoading: false,
        errorMessage: action.errorMessage,
      }, action.canRenderServerBase);

      return {
        ...state,
        summary: createSummaryStateWithRenderedSeriesContext(
          state.summary,
          nextSeriesState,
          action.canRenderServerBase,
        ),
        series: nextSeriesState,
      };
    }
    case "review_schedule_server_load_succeeded":
      if (state.reviewSchedule.scopeKey !== action.scopeKey) {
        return state;
      }

      const loadedServerBaseLocalCardTotalDelta = resolveProgressReviewScheduleLoadedServerBaseLocalCardTotalDelta(
        state.reviewSchedule,
        action.serverBase,
      );

      return {
        ...state,
        reviewSchedule: createNextReviewScheduleState(state.reviewSchedule, {
          scopeKey: action.scopeKey,
          serverBase: action.serverBase,
          progressScheduleLocalVersion: action.progressScheduleLocalVersion,
          serverBaseProgressScheduleLocalVersion: action.progressScheduleLocalVersion,
          serverBaseLocalCardTotalDelta: loadedServerBaseLocalCardTotalDelta,
          isLoading: false,
          errorMessage: "",
        }, action.canRenderServerBase),
      };
    case "review_schedule_server_load_failed":
      if (state.reviewSchedule.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        reviewSchedule: createNextReviewScheduleState(state.reviewSchedule, {
          scopeKey: action.scopeKey,
          progressScheduleLocalVersion: action.progressScheduleLocalVersion,
          isLoading: false,
          errorMessage: action.errorMessage,
        }, action.canRenderServerBase),
      };
    case "leaderboard_scope_reset":
      return {
        ...state,
        leaderboard: createEmptyProgressLeaderboardSourceState(),
      };
    case "leaderboard_scope_initialized":
      return {
        ...state,
        // Unlike the sibling sections, local viewer counts are only an overlay,
        // so `isLoading` tracks the server load alone and stays false for
        // sessions that can never run one (guest/unverified).
        leaderboard: createNextLeaderboardState(state.leaderboard, {
          scopeKey: action.scopeKey,
          serverBase: action.serverBase,
          localViewerCounts: null,
          isLoading: action.canRenderServerBase,
          errorMessage: "",
          isNetworkError: false,
          localViewerCountsErrorMessage: "",
        }, action.canRenderServerBase),
      };
    case "leaderboard_local_load_succeeded":
      if (state.leaderboard.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        leaderboard: createNextLeaderboardState(state.leaderboard, {
          scopeKey: action.scopeKey,
          localViewerCounts: action.localViewerCounts,
          localViewerCountsErrorMessage: "",
        }, action.canRenderServerBase),
      };
    case "leaderboard_local_load_failed":
      if (state.leaderboard.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        leaderboard: createNextLeaderboardState(state.leaderboard, {
          scopeKey: action.scopeKey,
          localViewerCounts: null,
          localViewerCountsErrorMessage: action.errorMessage,
        }, action.canRenderServerBase),
      };
    case "leaderboard_server_load_succeeded":
      if (state.leaderboard.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        leaderboard: createNextLeaderboardState(state.leaderboard, {
          scopeKey: action.scopeKey,
          serverBase: action.serverBase,
          isLoading: false,
          errorMessage: "",
          isNetworkError: false,
        }, action.canRenderServerBase),
      };
    case "leaderboard_server_load_failed":
      if (state.leaderboard.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        leaderboard: createNextLeaderboardState(state.leaderboard, {
          scopeKey: action.scopeKey,
          isLoading: false,
          errorMessage: action.errorMessage,
          isNetworkError: action.isNetworkError,
        }, action.canRenderServerBase),
      };
    case "leaderboard_server_load_skipped":
      if (state.leaderboard.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        leaderboard: createNextLeaderboardState(state.leaderboard, {
          scopeKey: action.scopeKey,
          isLoading: false,
        }, action.canRenderServerBase),
      };
    case "refresh_started":
      return {
        summary: action.summaryScopeKey === null
          ? state.summary
          : createNextSummaryState(state.summary, {
            scopeKey: action.summaryScopeKey,
            isLoading: true,
            errorMessage: "",
          }, action.canRenderServerBase),
        series: action.seriesScopeKey === null
          ? state.series
          : createNextSeriesState(state.series, {
            scopeKey: action.seriesScopeKey,
            isLoading: true,
            errorMessage: "",
          }, action.canRenderServerBase),
        reviewSchedule: action.reviewScheduleScopeKey === null
          ? state.reviewSchedule
          : createNextReviewScheduleState(state.reviewSchedule, {
            scopeKey: action.reviewScheduleScopeKey,
            progressScheduleLocalVersion: action.progressScheduleLocalVersion,
            isLoading: true,
            errorMessage: "",
          }, action.canRenderServerBase),
        leaderboard: action.leaderboardScopeKey === null
          ? state.leaderboard
          : createNextLeaderboardState(state.leaderboard, {
            scopeKey: action.leaderboardScopeKey,
            isLoading: action.canRenderServerBase,
            errorMessage: "",
            isNetworkError: false,
          }, action.canRenderServerBase),
      };
    case "errors_cleared":
      return {
        summary: createNextSummaryState(state.summary, {
          errorMessage: "",
        }, action.canRenderServerBase),
        series: createNextSeriesState(state.series, {
          errorMessage: "",
        }, action.canRenderServerBase),
        reviewSchedule: createNextReviewScheduleState(state.reviewSchedule, {
          errorMessage: "",
        }, action.canRenderServerBase),
        leaderboard: createNextLeaderboardState(state.leaderboard, {
          errorMessage: "",
          isNetworkError: false,
          localViewerCountsErrorMessage: "",
        }, action.canRenderServerBase),
      };
  }
}

export function progressSourceReducer(
  state: ProgressSourceState,
  action: ProgressSourceAction,
): ProgressSourceState {
  const nextState = reduceProgressSourceState(state, action);
  return areProgressSourceStatesEqual(state, nextState) ? state : nextState;
}

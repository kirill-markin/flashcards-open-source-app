import type {
  ProgressChartData,
  ProgressReviewScheduleSnapshot,
  ProgressScopeKey,
  ProgressSeriesSnapshot,
  ProgressSourceState,
  ProgressSummarySnapshot,
} from "../../types";
import {
  areProgressSourceStatesEqual,
  createEmptyProgressReviewScheduleSourceState,
  createEmptyProgressSeriesSourceState,
  createEmptyProgressSourceState,
  createEmptyProgressSummarySourceState,
  createNextReviewScheduleState,
  createNextSeriesState,
  createNextSummaryState,
  resolveProgressReviewScheduleLoadedServerBaseLocalCardTotalDelta,
  resolveProgressReviewScheduleServerBaseLocalCardTotalDelta,
} from "./progressSnapshots";

export type ProgressSourceAction =
  | Readonly<{ type: "summary_scope_reset" }>
  | Readonly<{ type: "series_scope_reset" }>
  | Readonly<{ type: "review_schedule_scope_reset" }>
  | Readonly<{
    type: "summary_scope_initialized";
    scopeKey: ProgressScopeKey;
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
  | Readonly<{
    type: "refresh_started";
    summaryScopeKey: ProgressScopeKey | null;
    seriesScopeKey: ProgressScopeKey | null;
    reviewScheduleScopeKey: ProgressScopeKey | null;
    progressScheduleLocalVersion: number;
    canRenderServerBase: boolean;
  }>
  | Readonly<{ type: "errors_cleared"; canRenderServerBase: boolean }>;

export function createInitialProgressSourceState(): ProgressSourceState {
  return createEmptyProgressSourceState();
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
    case "series_scope_reset":
      return {
        ...state,
        series: createEmptyProgressSeriesSourceState(),
      };
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
          localFallback: null,
          serverBase: action.serverBase,
          hasPendingLocalReviews: false,
          isLoading: true,
          errorMessage: "",
        }, action.canRenderServerBase),
      };
    case "series_scope_initialized":
      return {
        ...state,
        series: createNextSeriesState(state.series, {
          scopeKey: action.scopeKey,
          localFallback: null,
          serverBase: action.serverBase,
          pendingLocalOverlay: null,
          isLoading: true,
          errorMessage: "",
        }, action.canRenderServerBase),
      };
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
          hasPendingLocalReviews: false,
          isLoading: false,
          errorMessage: action.errorMessage,
        }, action.canRenderServerBase),
      };
    case "series_local_load_succeeded":
      if (state.series.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        series: createNextSeriesState(state.series, {
          scopeKey: action.scopeKey,
          localFallback: action.localFallback,
          pendingLocalOverlay: action.pendingLocalOverlay,
          isLoading: false,
        }, action.canRenderServerBase),
      };
    case "series_local_load_failed":
      if (state.series.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        series: createNextSeriesState(state.series, {
          scopeKey: action.scopeKey,
          localFallback: null,
          pendingLocalOverlay: null,
          isLoading: false,
          errorMessage: action.errorMessage,
        }, action.canRenderServerBase),
      };
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
    case "series_server_load_succeeded":
      if (state.series.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        series: createNextSeriesState(state.series, {
          scopeKey: action.scopeKey,
          serverBase: action.serverBase,
          isLoading: false,
          errorMessage: "",
        }, action.canRenderServerBase),
      };
    case "series_server_load_failed":
      if (state.series.scopeKey !== action.scopeKey) {
        return state;
      }

      return {
        ...state,
        series: createNextSeriesState(state.series, {
          scopeKey: action.scopeKey,
          isLoading: false,
          errorMessage: action.errorMessage,
        }, action.canRenderServerBase),
      };
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

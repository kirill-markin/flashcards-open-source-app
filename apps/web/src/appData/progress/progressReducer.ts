import type {
  ProgressChartData,
  ProgressScopeKey,
  ProgressSeriesSnapshot,
  ProgressSourceState,
  ProgressSummarySnapshot,
} from "../../types";
import {
  areProgressSourceStatesEqual,
  createEmptyProgressSeriesSourceState,
  createEmptyProgressSourceState,
  createEmptyProgressSummarySourceState,
  createNextSeriesState,
  createNextSummaryState,
} from "./progressSnapshots";

export type ProgressSourceAction =
  | Readonly<{ type: "summary_scope_reset" }>
  | Readonly<{ type: "series_scope_reset" }>
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
    type: "refresh_started";
    summaryScopeKey: ProgressScopeKey | null;
    seriesScopeKey: ProgressScopeKey | null;
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
      };
    case "errors_cleared":
      return {
        summary: createNextSummaryState(state.summary, {
          errorMessage: "",
        }, action.canRenderServerBase),
        series: createNextSeriesState(state.series, {
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

import { useCallback, useEffect, useRef } from "react";
import { loadProgressSeries } from "../../../../api";
import {
  loadLocalProgressActiveDates,
  loadLocalProgressDailyReviews,
  loadPendingProgressDailyReviews,
} from "../../../../localDb/progress/progress";
import type {
  ProgressScopeKey,
  ProgressSeriesInput,
} from "../../../../types";
import {
  buildLocalFallbackSeries,
  createProgressChartData,
  createProgressSeriesSnapshot,
  normalizeProgressSeries,
} from "../../snapshots/progressSnapshots";
import {
  loadPersistedProgressSeries,
  storePersistedProgressSeries,
} from "../../storage/progressStorage";
import {
  captureProgressServerLoadError,
  getErrorMessage,
  type ProgressCanLoadServerBaseRef,
  type ProgressScopeKeyRef,
  type ProgressSourceDispatch,
} from "./progressSourcePipelineHelpers";

export type RefreshProgressSeries = (
  targetScopeKey: ProgressScopeKey,
  input: ProgressSeriesInput,
  nextRefreshKey: string,
) => Promise<void>;

export type ProgressSeriesSourcePipeline = Readonly<{
  refreshProgressSeries: RefreshProgressSeries;
}>;

type ProgressSeriesSourcePipelineParams = Readonly<{
  accessibleWorkspaceIds: ReadonlyArray<string>;
  activeWorkspaceId: string | null;
  canLoadServerBase: boolean;
  canLoadServerBaseRef: ProgressCanLoadServerBaseRef;
  currentScopeKeyRef: ProgressScopeKeyRef;
  dispatch: ProgressSourceDispatch;
  input: ProgressSeriesInput;
  installationId: string | null;
  manualRefreshVersion: number;
  progressLocalVersion: number;
  refreshKey: string | null;
  scopeKey: ProgressScopeKey | null;
}>;

export function useProgressSeriesSourcePipeline(
  params: ProgressSeriesSourcePipelineParams,
): ProgressSeriesSourcePipeline {
  const {
    accessibleWorkspaceIds,
    activeWorkspaceId,
    canLoadServerBase,
    canLoadServerBaseRef,
    currentScopeKeyRef,
    dispatch,
    input,
    installationId,
    manualRefreshVersion,
    progressLocalVersion,
    refreshKey,
    scopeKey,
  } = params;
  const localLoadSequenceRef = useRef<number>(0);
  const serverRefreshPromisesRef = useRef<Map<ProgressScopeKey, Promise<void>>>(new Map());
  const requestedRefreshKeysRef = useRef<Map<ProgressScopeKey, string>>(new Map());

  useEffect(() => {
    currentScopeKeyRef.current = scopeKey;

    if (scopeKey === null) {
      dispatch({
        type: "series_scope_reset",
        canRenderServerBase: canLoadServerBaseRef.current,
      });
      return;
    }

    const persistedSeries = canLoadServerBase
      ? loadPersistedProgressSeries(scopeKey)
      : null;

    dispatch({
      type: "series_scope_initialized",
      scopeKey,
      serverBase: persistedSeries === null ? null : createProgressSeriesSnapshot(persistedSeries, "server", false),
      canRenderServerBase: canLoadServerBaseRef.current,
    });
  }, [canLoadServerBase, canLoadServerBaseRef, currentScopeKeyRef, dispatch, scopeKey]);

  useEffect(() => {
    if (scopeKey === null) {
      return;
    }

    const currentSequence = localLoadSequenceRef.current + 1;
    localLoadSequenceRef.current = currentSequence;

    void Promise.all([
      loadLocalProgressDailyReviews(accessibleWorkspaceIds, input),
      loadLocalProgressActiveDates(accessibleWorkspaceIds, input.timeZone),
      loadPendingProgressDailyReviews(accessibleWorkspaceIds, input),
    ]).then(([localDailyReviews, localActiveDates, pendingLocalDailyReviews]) => {
      if (currentScopeKeyRef.current !== scopeKey || localLoadSequenceRef.current !== currentSequence) {
        return;
      }

      dispatch({
        type: "series_local_load_succeeded",
        scopeKey,
        localFallback: createProgressSeriesSnapshot(
          buildLocalFallbackSeries(input, localDailyReviews, localActiveDates),
          "local_only",
          true,
        ),
        localFallbackActiveDates: localActiveDates,
        pendingLocalOverlay: createProgressChartData(pendingLocalDailyReviews),
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    }).catch((error: unknown) => {
      if (currentScopeKeyRef.current !== scopeKey || localLoadSequenceRef.current !== currentSequence) {
        return;
      }

      dispatch({
        type: "series_local_load_failed",
        scopeKey,
        errorMessage: getErrorMessage(error),
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    });
  }, [
    accessibleWorkspaceIds,
    canLoadServerBase,
    canLoadServerBaseRef,
    currentScopeKeyRef,
    dispatch,
    input,
    manualRefreshVersion,
    progressLocalVersion,
    scopeKey,
  ]);

  const refreshProgressSeries = useCallback<RefreshProgressSeries>(async function refreshProgressSeries(
    targetScopeKey: ProgressScopeKey,
    refreshInput: ProgressSeriesInput,
    nextRefreshKey: string,
  ): Promise<void> {
    requestedRefreshKeysRef.current.set(targetScopeKey, nextRefreshKey);

    const inFlightRefresh = serverRefreshPromisesRef.current.get(targetScopeKey);
    if (inFlightRefresh !== undefined) {
      return inFlightRefresh;
    }

    const refreshPromise = (async (): Promise<void> => {
      try {
        while (true) {
          const requestedRefreshKey = requestedRefreshKeysRef.current.get(targetScopeKey);

          if (requestedRefreshKey === undefined) {
            throw new Error(`Missing requested progress series refresh key for scope ${targetScopeKey}`);
          }

          if (currentScopeKeyRef.current !== targetScopeKey || canLoadServerBaseRef.current === false) {
            requestedRefreshKeysRef.current.delete(targetScopeKey);
            return;
          }

          try {
            const serverSeries = normalizeProgressSeries(await loadProgressSeries(refreshInput));
            const isCurrentRefreshRequest: boolean = requestedRefreshKeysRef.current.get(targetScopeKey)
              === requestedRefreshKey;

            if (
              currentScopeKeyRef.current === targetScopeKey
              && canLoadServerBaseRef.current
              && isCurrentRefreshRequest
            ) {
              storePersistedProgressSeries(targetScopeKey, serverSeries);
              dispatch({
                type: "series_server_load_succeeded",
                scopeKey: targetScopeKey,
                serverBase: createProgressSeriesSnapshot(serverSeries, "server", false),
                canRenderServerBase: canLoadServerBaseRef.current,
              });
            }
          } catch (error: unknown) {
            const isCurrentRefreshRequest: boolean = requestedRefreshKeysRef.current.get(targetScopeKey)
              === requestedRefreshKey;

            if (
              currentScopeKeyRef.current === targetScopeKey
              && canLoadServerBaseRef.current
              && isCurrentRefreshRequest
            ) {
              dispatch({
                type: "series_server_load_failed",
                scopeKey: targetScopeKey,
                errorMessage: getErrorMessage(error),
                canRenderServerBase: canLoadServerBaseRef.current,
              });
              captureProgressServerLoadError(error, {
                operation: "progress_series_server_load",
                workspaceId: activeWorkspaceId,
                installationId,
              });
            }
          }

          if (requestedRefreshKeysRef.current.get(targetScopeKey) === requestedRefreshKey) {
            requestedRefreshKeysRef.current.delete(targetScopeKey);
            return;
          }
        }
      } finally {
        serverRefreshPromisesRef.current.delete(targetScopeKey);
      }
    })();

    serverRefreshPromisesRef.current.set(targetScopeKey, refreshPromise);
    return refreshPromise;
  }, [activeWorkspaceId, canLoadServerBaseRef, currentScopeKeyRef, dispatch, installationId]);

  useEffect(() => {
    if (scopeKey === null || refreshKey === null) {
      return;
    }

    if (requestedRefreshKeysRef.current.get(scopeKey) === refreshKey) {
      return;
    }

    void refreshProgressSeries(scopeKey, input, refreshKey);
  }, [input, refreshKey, refreshProgressSeries, scopeKey]);

  return {
    refreshProgressSeries,
  };
}

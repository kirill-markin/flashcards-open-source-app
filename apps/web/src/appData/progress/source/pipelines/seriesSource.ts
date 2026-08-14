import { useCallback, useEffect, useRef } from "react";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
} from "../../../../appError/AppErrorContext";
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
  captureProgressLocalLoadError,
  captureProgressServerLoadError,
  getErrorMessage,
  normalizeProgressSourceError,
  runRecoveryGuardedProgressLocalRead,
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
  canExposeTechnicalErrors: boolean;
  currentScopeKeyRef: ProgressScopeKeyRef;
  dispatch: ProgressSourceDispatch;
  input: ProgressSeriesInput;
  installationId: string | null;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
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
    canExposeTechnicalErrors,
    currentScopeKeyRef,
    dispatch,
    input,
    installationId,
    indexedDbOpenRecoveryState,
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

    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

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
  }, [canLoadServerBase, canLoadServerBaseRef, currentScopeKeyRef, dispatch, indexedDbOpenRecoveryState, scopeKey]);

  useEffect(() => {
    if (scopeKey === null || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const currentSequence = localLoadSequenceRef.current + 1;
    localLoadSequenceRef.current = currentSequence;

    void Promise.all([
      runRecoveryGuardedProgressLocalRead(
        () => loadLocalProgressDailyReviews(accessibleWorkspaceIds, input),
        indexedDbOpenRecoveryState,
      ),
      runRecoveryGuardedProgressLocalRead(
        () => loadLocalProgressActiveDates(accessibleWorkspaceIds, input.timeZone),
        indexedDbOpenRecoveryState,
      ),
      runRecoveryGuardedProgressLocalRead(
        () => loadPendingProgressDailyReviews(accessibleWorkspaceIds, input),
        indexedDbOpenRecoveryState,
      ),
    ]).then(([localDailyReviews, localActiveDates, pendingLocalDailyReviews]) => {
      if (
        indexedDbOpenRecoveryState.hasFailed()
        || currentScopeKeyRef.current !== scopeKey
        || localLoadSequenceRef.current !== currentSequence
      ) {
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
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }

      if (currentScopeKeyRef.current !== scopeKey || localLoadSequenceRef.current !== currentSequence) {
        return;
      }

      const technicalError = normalizeProgressSourceError(error);
      const wasCaptured = canExposeTechnicalErrors
        && captureProgressLocalLoadError(technicalError, {
          operation: "progress_series_local_load",
          workspaceId: activeWorkspaceId,
          installationId,
        });

      dispatch({
        type: "series_local_load_failed",
        scopeKey,
        errorMessage: getErrorMessage(technicalError),
        technicalError: wasCaptured ? technicalError : null,
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    });
  }, [
    accessibleWorkspaceIds,
    canLoadServerBase,
    canLoadServerBaseRef,
    canExposeTechnicalErrors,
    currentScopeKeyRef,
    dispatch,
    input,
    indexedDbOpenRecoveryState,
    manualRefreshVersion,
    progressLocalVersion,
    scopeKey,
  ]);

  const refreshProgressSeries = useCallback<RefreshProgressSeries>(async function refreshProgressSeries(
    targetScopeKey: ProgressScopeKey,
    refreshInput: ProgressSeriesInput,
    nextRefreshKey: string,
  ): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

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
            if (indexedDbOpenRecoveryState.hasFailed()) {
              return;
            }
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
            if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
              return;
            }

            const isCurrentRefreshRequest: boolean = requestedRefreshKeysRef.current.get(targetScopeKey)
              === requestedRefreshKey;

            if (
              currentScopeKeyRef.current === targetScopeKey
              && canLoadServerBaseRef.current
              && isCurrentRefreshRequest
            ) {
              const technicalError = normalizeProgressSourceError(error);
              const wasCaptured = canExposeTechnicalErrors
                && captureProgressServerLoadError(technicalError, {
                  operation: "progress_series_server_load",
                  workspaceId: activeWorkspaceId,
                  installationId,
                });

              dispatch({
                type: "series_server_load_failed",
                scopeKey: targetScopeKey,
                errorMessage: getErrorMessage(technicalError),
                technicalError: wasCaptured ? technicalError : null,
                canRenderServerBase: canLoadServerBaseRef.current,
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
  }, [activeWorkspaceId, canExposeTechnicalErrors, canLoadServerBaseRef, currentScopeKeyRef, dispatch, indexedDbOpenRecoveryState, installationId]);

  useEffect(() => {
    if (scopeKey === null || refreshKey === null || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    if (requestedRefreshKeysRef.current.get(scopeKey) === refreshKey) {
      return;
    }

    void refreshProgressSeries(scopeKey, input, refreshKey);
  }, [indexedDbOpenRecoveryState, input, refreshKey, refreshProgressSeries, scopeKey]);

  return {
    refreshProgressSeries,
  };
}

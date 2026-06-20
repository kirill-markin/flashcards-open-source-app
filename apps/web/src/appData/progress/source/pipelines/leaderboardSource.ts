import { useCallback, useEffect, useRef } from "react";
import {
  ApiNetworkError,
  loadProgressLeaderboard,
} from "../../../../api";
import {
  loadLocalLeaderboardViewerCounts,
} from "../../../../localDb/progress/progress";
import type {
  ProgressLeaderboard,
  ProgressScopeKey,
} from "../../../../types";
import {
  createProgressLeaderboardSnapshot,
} from "../../snapshots/progressSnapshots";
import {
  loadPersistedProgressLeaderboard,
  storePersistedProgressLeaderboard,
} from "../../storage/progressStorage";
import {
  captureProgressLocalLoadError,
  captureProgressServerLoadError,
  getErrorMessage,
  normalizeProgressSourceError,
  type ProgressCanLoadServerBaseRef,
  type ProgressScopeKeyRef,
  type ProgressSourceDispatch,
} from "./progressSourcePipelineHelpers";

export type RefreshProgressLeaderboard = (
  targetScopeKey: ProgressScopeKey,
  nextRefreshKey: string,
  bypassFreshnessGate: boolean,
) => Promise<void>;

export type ProgressLeaderboardSourcePipeline = Readonly<{
  refreshProgressLeaderboard: RefreshProgressLeaderboard;
}>;

type ProgressLeaderboardRefreshRequest = Readonly<{
  refreshKey: string;
  bypassFreshnessGate: boolean;
}>;

type ProgressLeaderboardSourcePipelineParams = Readonly<{
  accessibleWorkspaceIds: ReadonlyArray<string>;
  activeWorkspaceId: string | null;
  autoRefreshEnabled: boolean;
  canLoadServerBase: boolean;
  canLoadServerBaseRef: ProgressCanLoadServerBaseRef;
  canExposeTechnicalErrors: boolean;
  currentScopeKeyRef: ProgressScopeKeyRef;
  dispatch: ProgressSourceDispatch;
  installationId: string | null;
  manualRefreshVersion: number;
  progressLocalVersion: number;
  refreshKey: string | null;
  scopeKey: ProgressScopeKey | null;
}>;

/**
 * The compact leaderboard snapshot regenerates hourly on the server, so
 * automatic refreshes are skipped while every cached window's
 * `nextRefreshAfter` is still in the future. Manual Progress refreshes bypass
 * this gate, and non-ready payloads (no windows) are never considered fresh so
 * participation changes propagate on the next automatic load.
 */
function isProgressLeaderboardFresh(leaderboard: ProgressLeaderboard | null, nowTimestamp: number): boolean {
  if (leaderboard === null || leaderboard.windows.length === 0) {
    return false;
  }

  return leaderboard.windows.every((window) => {
    const nextRefreshAfterTimestamp = Date.parse(window.nextRefreshAfter);
    return Number.isNaN(nextRefreshAfterTimestamp) === false && nextRefreshAfterTimestamp > nowTimestamp;
  });
}

export function useProgressLeaderboardSourcePipeline(
  params: ProgressLeaderboardSourcePipelineParams,
): ProgressLeaderboardSourcePipeline {
  const {
    accessibleWorkspaceIds,
    activeWorkspaceId,
    autoRefreshEnabled,
    canLoadServerBase,
    canLoadServerBaseRef,
    canExposeTechnicalErrors,
    currentScopeKeyRef,
    dispatch,
    installationId,
    manualRefreshVersion,
    progressLocalVersion,
    refreshKey,
    scopeKey,
  } = params;
  const localLoadSequenceRef = useRef<number>(0);
  const serverRefreshPromisesRef = useRef<Map<ProgressScopeKey, Promise<void>>>(new Map());
  const requestedRefreshRequestsRef = useRef<Map<ProgressScopeKey, ProgressLeaderboardRefreshRequest>>(new Map());

  useEffect(() => {
    currentScopeKeyRef.current = scopeKey;

    if (scopeKey === null) {
      dispatch({ type: "leaderboard_scope_reset" });
      return;
    }

    const persistedLeaderboard = canLoadServerBase
      ? loadPersistedProgressLeaderboard(scopeKey)
      : null;

    dispatch({
      type: "leaderboard_scope_initialized",
      scopeKey,
      serverBase: persistedLeaderboard === null ? null : createProgressLeaderboardSnapshot(persistedLeaderboard, false),
      canRenderServerBase: canLoadServerBaseRef.current,
    });
  }, [canLoadServerBase, canLoadServerBaseRef, currentScopeKeyRef, dispatch, scopeKey]);

  useEffect(() => {
    if (scopeKey === null) {
      return;
    }

    // The viewer counts only overlay a rendered server snapshot, so skip the
    // review-event scan entirely while the session cannot load one; the effect
    // re-runs when `canLoadServerBase` flips after sign-in.
    if (canLoadServerBase === false) {
      return;
    }

    const currentSequence = localLoadSequenceRef.current + 1;
    localLoadSequenceRef.current = currentSequence;

    void loadLocalLeaderboardViewerCounts(accessibleWorkspaceIds, new Date()).then((localViewerCounts) => {
      if (
        currentScopeKeyRef.current !== scopeKey
        || localLoadSequenceRef.current !== currentSequence
      ) {
        return;
      }

      dispatch({
        type: "leaderboard_local_load_succeeded",
        scopeKey,
        localViewerCounts,
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    }).catch((error: unknown) => {
      if (
        currentScopeKeyRef.current !== scopeKey
        || localLoadSequenceRef.current !== currentSequence
      ) {
        return;
      }

      const technicalError = normalizeProgressSourceError(error);
      const wasCaptured = canExposeTechnicalErrors
        && captureProgressLocalLoadError(technicalError, {
          operation: "progress_leaderboard_local_load",
          workspaceId: activeWorkspaceId,
          installationId,
        });

      dispatch({
        type: "leaderboard_local_load_failed",
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
    manualRefreshVersion,
    progressLocalVersion,
    scopeKey,
  ]);

  const refreshProgressLeaderboard = useCallback<RefreshProgressLeaderboard>(async function refreshProgressLeaderboard(
    targetScopeKey: ProgressScopeKey,
    nextRefreshKey: string,
    bypassFreshnessGate: boolean,
  ): Promise<void> {
    requestedRefreshRequestsRef.current.set(targetScopeKey, {
      refreshKey: nextRefreshKey,
      bypassFreshnessGate,
    });

    const inFlightRefresh = serverRefreshPromisesRef.current.get(targetScopeKey);
    if (inFlightRefresh !== undefined) {
      return inFlightRefresh;
    }

    const refreshPromise = (async (): Promise<void> => {
      try {
        while (true) {
          const requestedRefresh = requestedRefreshRequestsRef.current.get(targetScopeKey);

          if (requestedRefresh === undefined) {
            throw new Error(`Missing requested progress leaderboard refresh key for scope ${targetScopeKey}`);
          }

          if (currentScopeKeyRef.current !== targetScopeKey || canLoadServerBaseRef.current === false) {
            requestedRefreshRequestsRef.current.delete(targetScopeKey);
            return;
          }

          if (
            requestedRefresh.bypassFreshnessGate === false
            && isProgressLeaderboardFresh(loadPersistedProgressLeaderboard(targetScopeKey), Date.now())
          ) {
            if (requestedRefreshRequestsRef.current.get(targetScopeKey)?.refreshKey === requestedRefresh.refreshKey) {
              dispatch({
                type: "leaderboard_server_load_skipped",
                scopeKey: targetScopeKey,
                canRenderServerBase: canLoadServerBaseRef.current,
              });
              requestedRefreshRequestsRef.current.delete(targetScopeKey);
              return;
            }

            continue;
          }

          try {
            const serverLeaderboard = await loadProgressLeaderboard();
            const isCurrentRefreshRequest: boolean = requestedRefreshRequestsRef.current
              .get(targetScopeKey)?.refreshKey === requestedRefresh.refreshKey;

            if (
              currentScopeKeyRef.current === targetScopeKey
              && canLoadServerBaseRef.current
              && isCurrentRefreshRequest
            ) {
              storePersistedProgressLeaderboard(targetScopeKey, serverLeaderboard);
              dispatch({
                type: "leaderboard_server_load_succeeded",
                scopeKey: targetScopeKey,
                serverBase: createProgressLeaderboardSnapshot(serverLeaderboard, false),
                canRenderServerBase: canLoadServerBaseRef.current,
              });
            }
          } catch (error: unknown) {
            const isCurrentRefreshRequest: boolean = requestedRefreshRequestsRef.current
              .get(targetScopeKey)?.refreshKey === requestedRefresh.refreshKey;

            if (
              currentScopeKeyRef.current === targetScopeKey
              && canLoadServerBaseRef.current
              && isCurrentRefreshRequest
            ) {
              const technicalError = normalizeProgressSourceError(error);
              const wasCaptured = canExposeTechnicalErrors
                && captureProgressServerLoadError(technicalError, {
                  operation: "progress_leaderboard_server_load",
                  workspaceId: activeWorkspaceId,
                  installationId,
                });

              dispatch({
                type: "leaderboard_server_load_failed",
                scopeKey: targetScopeKey,
                errorMessage: getErrorMessage(technicalError),
                technicalError: wasCaptured ? technicalError : null,
                isNetworkError: technicalError instanceof ApiNetworkError,
                canRenderServerBase: canLoadServerBaseRef.current,
              });
            }
          }

          if (requestedRefreshRequestsRef.current.get(targetScopeKey)?.refreshKey === requestedRefresh.refreshKey) {
            requestedRefreshRequestsRef.current.delete(targetScopeKey);
            return;
          }
        }
      } finally {
        serverRefreshPromisesRef.current.delete(targetScopeKey);
      }
    })();

    serverRefreshPromisesRef.current.set(targetScopeKey, refreshPromise);
    return refreshPromise;
  }, [activeWorkspaceId, canExposeTechnicalErrors, canLoadServerBaseRef, currentScopeKeyRef, dispatch, installationId]);

  useEffect(() => {
    if (autoRefreshEnabled === false) {
      return;
    }

    if (scopeKey === null || refreshKey === null) {
      return;
    }

    if (requestedRefreshRequestsRef.current.get(scopeKey)?.refreshKey === refreshKey) {
      return;
    }

    void refreshProgressLeaderboard(scopeKey, refreshKey, false);
  }, [
    autoRefreshEnabled,
    refreshKey,
    refreshProgressLeaderboard,
    scopeKey,
  ]);

  return {
    refreshProgressLeaderboard,
  };
}

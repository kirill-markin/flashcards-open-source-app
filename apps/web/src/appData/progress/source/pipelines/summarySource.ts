import { useCallback, useEffect, useRef } from "react";
import { loadProgressSummary } from "../../../../api";
import {
  hasPendingProgressReviewEvents,
  loadLocalProgressActiveDates,
  loadLocalProgressSummary,
} from "../../../../localDb/progress/progress";
import type {
  ProgressScopeKey,
  ProgressSummaryInput,
} from "../../../../types";
import {
  createProgressSummarySnapshot,
} from "../../snapshots/progressSnapshots";
import {
  loadPersistedProgressSummary,
  storePersistedProgressSummary,
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

export type RefreshProgressSummary = (
  targetScopeKey: ProgressScopeKey,
  input: ProgressSummaryInput,
  nextRefreshKey: string,
) => Promise<void>;

export type ProgressSummarySourcePipeline = Readonly<{
  refreshProgressSummary: RefreshProgressSummary;
}>;

type ProgressSummarySourcePipelineParams = Readonly<{
  accessibleWorkspaceIds: ReadonlyArray<string>;
  activeWorkspaceId: string | null;
  canLoadServerBase: boolean;
  canLoadServerBaseRef: ProgressCanLoadServerBaseRef;
  canExposeTechnicalErrors: boolean;
  currentScopeKeyRef: ProgressScopeKeyRef;
  dispatch: ProgressSourceDispatch;
  input: ProgressSummaryInput;
  installationId: string | null;
  manualRefreshVersion: number;
  progressLocalVersion: number;
  refreshKey: string | null;
  scopeKey: ProgressScopeKey | null;
}>;

export function useProgressSummarySourcePipeline(
  params: ProgressSummarySourcePipelineParams,
): ProgressSummarySourcePipeline {
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
      dispatch({ type: "summary_scope_reset" });
      return;
    }

    const persistedSummary = canLoadServerBase
      ? loadPersistedProgressSummary(scopeKey)
      : null;

    dispatch({
      type: "summary_scope_initialized",
      scopeKey,
      referenceLocalDate: input.today,
      serverBase: persistedSummary === null ? null : createProgressSummarySnapshot(persistedSummary, "server", false),
      canRenderServerBase: canLoadServerBaseRef.current,
    });
  }, [canLoadServerBase, canLoadServerBaseRef, currentScopeKeyRef, dispatch, input.today, scopeKey]);

  useEffect(() => {
    if (scopeKey === null) {
      return;
    }

    const currentSequence = localLoadSequenceRef.current + 1;
    localLoadSequenceRef.current = currentSequence;

    void Promise.all([
      loadLocalProgressSummary(accessibleWorkspaceIds, input),
      loadLocalProgressActiveDates(accessibleWorkspaceIds, input.timeZone),
      hasPendingProgressReviewEvents(accessibleWorkspaceIds),
    ]).then(([localSummary, localFallbackActiveDates, hasPendingLocalReviews]) => {
      if (currentScopeKeyRef.current !== scopeKey || localLoadSequenceRef.current !== currentSequence) {
        return;
      }

      dispatch({
        type: "summary_local_load_succeeded",
        scopeKey,
        localFallback: createProgressSummarySnapshot({
          timeZone: input.timeZone,
          generatedAt: null,
          reviewHistoryWatermarks: [],
          summary: localSummary,
        }, "local_only", true),
        localFallbackActiveDates,
        hasPendingLocalReviews,
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    }).catch((error: unknown) => {
      if (currentScopeKeyRef.current !== scopeKey || localLoadSequenceRef.current !== currentSequence) {
        return;
      }

      const technicalError = normalizeProgressSourceError(error);
      const wasCaptured = canExposeTechnicalErrors
        && captureProgressLocalLoadError(technicalError, {
          operation: "progress_summary_local_load",
          workspaceId: activeWorkspaceId,
          installationId,
        });

      dispatch({
        type: "summary_local_load_failed",
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
    manualRefreshVersion,
    progressLocalVersion,
    scopeKey,
  ]);

  const refreshProgressSummary = useCallback<RefreshProgressSummary>(async function refreshProgressSummary(
    targetScopeKey: ProgressScopeKey,
    refreshInput: ProgressSummaryInput,
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
            throw new Error(`Missing requested progress summary refresh key for scope ${targetScopeKey}`);
          }

          if (currentScopeKeyRef.current !== targetScopeKey || canLoadServerBaseRef.current === false) {
            requestedRefreshKeysRef.current.delete(targetScopeKey);
            return;
          }

          try {
            const serverSummary = await loadProgressSummary(refreshInput);
            const isCurrentRefreshRequest: boolean = requestedRefreshKeysRef.current.get(targetScopeKey)
              === requestedRefreshKey;

            if (
              currentScopeKeyRef.current === targetScopeKey
              && canLoadServerBaseRef.current
              && isCurrentRefreshRequest
            ) {
              storePersistedProgressSummary(targetScopeKey, serverSummary);
              dispatch({
                type: "summary_server_load_succeeded",
                scopeKey: targetScopeKey,
                serverBase: createProgressSummarySnapshot(serverSummary, "server", false),
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
              const technicalError = normalizeProgressSourceError(error);
              const wasCaptured = canExposeTechnicalErrors
                && captureProgressServerLoadError(technicalError, {
                  operation: "progress_summary_server_load",
                  workspaceId: activeWorkspaceId,
                  installationId,
                });

              dispatch({
                type: "summary_server_load_failed",
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
  }, [activeWorkspaceId, canExposeTechnicalErrors, canLoadServerBaseRef, currentScopeKeyRef, dispatch, installationId]);

  useEffect(() => {
    if (scopeKey === null || refreshKey === null) {
      return;
    }

    if (requestedRefreshKeysRef.current.get(scopeKey) === refreshKey) {
      return;
    }

    void refreshProgressSummary(scopeKey, input, refreshKey);
  }, [input, refreshKey, refreshProgressSummary, scopeKey]);

  return {
    refreshProgressSummary,
  };
}

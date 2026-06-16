import { useCallback, useEffect, useRef } from "react";
import { loadProgressReviewSchedule } from "../../../../api";
import {
  calculatePendingProgressReviewScheduleCardTotalDelta,
  hasCompleteLocalProgressReviewScheduleCoverage,
  hasPendingProgressReviewScheduleCardChanges,
  loadLocalProgressReviewSchedule,
} from "../../../../localDb/reviews/reviewSchedule";
import type {
  ProgressReviewScheduleInput,
  ProgressScopeKey,
} from "../../../../types";
import {
  createProgressReviewScheduleSnapshot,
} from "../../snapshots/progressSnapshots";
import {
  loadPersistedProgressReviewSchedule,
  storePersistedProgressReviewSchedule,
} from "../../storage/progressStorage";
import {
  captureProgressServerLoadError,
  getErrorMessage,
  type ProgressCanLoadServerBaseRef,
  type ProgressNumberRef,
  type ProgressScopeKeyRef,
  type ProgressSourceDispatch,
} from "./progressSourcePipelineHelpers";

export type RefreshProgressReviewSchedule = (
  targetScopeKey: ProgressScopeKey,
  input: ProgressReviewScheduleInput,
  nextRefreshKey: string,
  nextProgressScheduleLocalVersion: number,
) => Promise<void>;

export type ProgressReviewScheduleSourcePipeline = Readonly<{
  refreshProgressReviewSchedule: RefreshProgressReviewSchedule;
}>;

type ProgressReviewScheduleRefreshRequest = Readonly<{
  refreshKey: string;
  progressScheduleLocalVersion: number;
}>;

type ProgressReviewScheduleSourcePipelineParams = Readonly<{
  accessibleWorkspaceIds: ReadonlyArray<string>;
  activeWorkspaceId: string | null;
  canLoadServerBase: boolean;
  canLoadServerBaseRef: ProgressCanLoadServerBaseRef;
  currentScopeKeyRef: ProgressScopeKeyRef;
  dispatch: ProgressSourceDispatch;
  input: ProgressReviewScheduleInput;
  installationId: string | null;
  manualRefreshVersion: number;
  progressScheduleLocalVersion: number;
  progressScheduleLocalVersionRef: ProgressNumberRef;
  refreshKey: string | null;
  scopeKey: ProgressScopeKey | null;
}>;

export function useProgressReviewScheduleSourcePipeline(
  params: ProgressReviewScheduleSourcePipelineParams,
): ProgressReviewScheduleSourcePipeline {
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
    progressScheduleLocalVersion,
    progressScheduleLocalVersionRef,
    refreshKey,
    scopeKey,
  } = params;
  const localLoadSequenceRef = useRef<number>(0);
  const serverRefreshPromisesRef = useRef<Map<ProgressScopeKey, Promise<void>>>(new Map());
  const requestedRefreshRequestsRef = useRef<Map<ProgressScopeKey, ProgressReviewScheduleRefreshRequest>>(new Map());

  useEffect(() => {
    currentScopeKeyRef.current = scopeKey;

    if (scopeKey === null) {
      dispatch({ type: "review_schedule_scope_reset" });
      return;
    }

    const persistedReviewSchedule = canLoadServerBase
      ? loadPersistedProgressReviewSchedule(scopeKey, input.timeZone)
      : null;

    dispatch({
      type: "review_schedule_scope_initialized",
      scopeKey,
      serverBase: persistedReviewSchedule === null
        ? null
        : createProgressReviewScheduleSnapshot(persistedReviewSchedule, "server", false),
      progressScheduleLocalVersion: progressScheduleLocalVersionRef.current,
      canRenderServerBase: canLoadServerBaseRef.current,
    });
  }, [
    canLoadServerBase,
    canLoadServerBaseRef,
    currentScopeKeyRef,
    dispatch,
    input.timeZone,
    progressScheduleLocalVersionRef,
    scopeKey,
  ]);

  useEffect(() => {
    if (scopeKey === null) {
      return;
    }

    const currentSequence = localLoadSequenceRef.current + 1;
    localLoadSequenceRef.current = currentSequence;

    void Promise.all([
      loadLocalProgressReviewSchedule(accessibleWorkspaceIds, input),
      hasPendingProgressReviewScheduleCardChanges(accessibleWorkspaceIds),
      hasCompleteLocalProgressReviewScheduleCoverage(accessibleWorkspaceIds),
      calculatePendingProgressReviewScheduleCardTotalDelta(accessibleWorkspaceIds),
    ]).then(([
      localReviewSchedule,
      hasPendingLocalCardChanges,
      hasCompleteLocalCardState,
      pendingLocalCardTotalDelta,
    ]) => {
      if (
        currentScopeKeyRef.current !== scopeKey
        || localLoadSequenceRef.current !== currentSequence
      ) {
        return;
      }

      dispatch({
        type: "review_schedule_local_load_succeeded",
        scopeKey,
        localFallback: createProgressReviewScheduleSnapshot(localReviewSchedule, "local_only", true),
        hasPendingLocalCardChanges,
        hasCompleteLocalCardState,
        pendingLocalCardTotalDelta,
        progressScheduleLocalVersion,
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    }).catch((error: unknown) => {
      if (
        currentScopeKeyRef.current !== scopeKey
        || localLoadSequenceRef.current !== currentSequence
      ) {
        return;
      }

      dispatch({
        type: "review_schedule_local_load_failed",
        scopeKey,
        errorMessage: getErrorMessage(error),
        progressScheduleLocalVersion,
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
    progressScheduleLocalVersion,
    scopeKey,
  ]);

  const refreshProgressReviewSchedule = useCallback<RefreshProgressReviewSchedule>(async function refreshProgressReviewSchedule(
    targetScopeKey: ProgressScopeKey,
    refreshInput: ProgressReviewScheduleInput,
    nextRefreshKey: string,
    nextProgressScheduleLocalVersion: number,
  ): Promise<void> {
    requestedRefreshRequestsRef.current.set(targetScopeKey, {
      refreshKey: nextRefreshKey,
      progressScheduleLocalVersion: nextProgressScheduleLocalVersion,
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
            throw new Error(`Missing requested progress review schedule refresh key for scope ${targetScopeKey}`);
          }

          if (currentScopeKeyRef.current !== targetScopeKey || canLoadServerBaseRef.current === false) {
            requestedRefreshRequestsRef.current.delete(targetScopeKey);
            return;
          }

          try {
            const serverReviewSchedule = await loadProgressReviewSchedule(refreshInput);
            const isCurrentRefreshRequest: boolean = requestedRefreshRequestsRef.current
              .get(targetScopeKey)?.refreshKey === requestedRefresh.refreshKey;

            if (
              currentScopeKeyRef.current === targetScopeKey
              && canLoadServerBaseRef.current
              && isCurrentRefreshRequest
            ) {
              storePersistedProgressReviewSchedule(targetScopeKey, serverReviewSchedule, refreshInput.timeZone);
              dispatch({
                type: "review_schedule_server_load_succeeded",
                scopeKey: targetScopeKey,
                serverBase: createProgressReviewScheduleSnapshot(serverReviewSchedule, "server", false),
                progressScheduleLocalVersion: requestedRefresh.progressScheduleLocalVersion,
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
              dispatch({
                type: "review_schedule_server_load_failed",
                scopeKey: targetScopeKey,
                errorMessage: getErrorMessage(error),
                progressScheduleLocalVersion: requestedRefresh.progressScheduleLocalVersion,
                canRenderServerBase: canLoadServerBaseRef.current,
              });
              captureProgressServerLoadError(error, {
                operation: "progress_review_schedule_server_load",
                workspaceId: activeWorkspaceId,
                installationId,
              });
            }
          }

          if (
            requestedRefreshRequestsRef.current.get(targetScopeKey)?.refreshKey
              === requestedRefresh.refreshKey
          ) {
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
  }, [activeWorkspaceId, canLoadServerBaseRef, currentScopeKeyRef, dispatch, installationId]);

  useEffect(() => {
    if (scopeKey === null || refreshKey === null) {
      return;
    }

    if (requestedRefreshRequestsRef.current.get(scopeKey)?.refreshKey === refreshKey) {
      return;
    }

    void refreshProgressReviewSchedule(
      scopeKey,
      input,
      refreshKey,
      progressScheduleLocalVersion,
    );
  }, [
    input,
    progressScheduleLocalVersion,
    refreshKey,
    refreshProgressReviewSchedule,
    scopeKey,
  ]);

  return {
    refreshProgressReviewSchedule,
  };
}

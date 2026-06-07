import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ApiNetworkError,
  loadProgressReviewSchedule,
  loadProgressSeries,
  loadProgressSummary,
} from "../../../api";
import { captureApiContractError } from "../../../observability/apiContractObservation";
import {
  captureWebException,
  type ProgressServerLoadFailureDetails,
  type WebObservationScope,
} from "../../../observability/webObservability";
import {
  hasPendingProgressReviewEvents,
  loadLocalProgressActiveDates,
  loadLocalProgressDailyReviews,
  loadLocalProgressSummary,
  loadPendingProgressDailyReviews,
} from "../../../localDb/progress/progress";
import {
  calculatePendingProgressReviewScheduleCardTotalDelta,
  hasCompleteLocalProgressReviewScheduleCoverage,
  hasPendingProgressReviewScheduleCardChanges,
  loadLocalProgressReviewSchedule,
} from "../../../localDb/reviews/reviewSchedule";
import type {
  CloudSettings,
  ProgressReviewScheduleInput,
  ProgressScopeKey,
  ProgressSeriesInput,
  ProgressSourceState,
  ProgressSummaryInput,
  WorkspaceSummary,
} from "../../../types";
import {
  buildProgressReviewScheduleInputForDateContext,
  buildProgressSeriesInputForDateContext,
  buildProgressSummaryInputForDateContext,
} from "../../../progress/progressDates";
import type { SessionVerificationState } from "../../session/workspaceSessionTypes";
import { useProgressTimeContext } from "../time/progressTimeContext";
import {
  createInitialProgressSourceState,
  progressSourceReducer,
} from "../state/progressReducer";
import {
  buildProgressRefreshKey,
  buildProgressReviewScheduleRefreshKey,
  canLoadProgressServerBase,
  collectAccessibleWorkspaceIds,
  resolveProgressRefreshKey,
  resolveProgressReviewScheduleRefreshKey,
  resolveProgressReviewScheduleScopeKey,
  resolveProgressSeriesScopeKey,
  resolveProgressSummaryScopeKey,
  type ProgressSourceSections,
} from "../state/progressScope";
import {
  buildLocalFallbackSeries,
  createProgressChartData,
  createProgressReviewScheduleSnapshot,
  createProgressSeriesSnapshot,
  createProgressSummarySnapshot,
  normalizeProgressSeries,
} from "../snapshots/progressSnapshots";
import {
  loadPersistedProgressReviewSchedule,
  loadPersistedProgressSeries,
  loadPersistedProgressSummary,
  storePersistedProgressReviewSchedule,
  storePersistedProgressSeries,
  storePersistedProgressSummary,
} from "../storage/progressStorage";

type UseProgressSourceParams = Readonly<{
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  cloudSettings: CloudSettings | null;
  sessionVerificationState: SessionVerificationState;
  progressLocalVersion: number;
  progressScheduleLocalVersion: number;
  progressServerInvalidationVersion: number;
  sections: ProgressSourceSections;
}>;

type UseProgressSourceResult = Readonly<{
  progressSourceState: ProgressSourceState;
  refreshProgress: () => Promise<void>;
}>;

type ProgressReviewScheduleRefreshRequest = Readonly<{
  refreshKey: string;
  progressScheduleLocalVersion: number;
}>;

type ProgressServerLoadOperation = ProgressServerLoadFailureDetails["operation"];

type ProgressServerLoadObservationContext = Readonly<{
  operation: ProgressServerLoadOperation;
  workspaceId: string | null;
  installationId: string | null;
}>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildProgressNetworkErrorScope(
  error: ApiNetworkError,
  context: ProgressServerLoadObservationContext,
): WebObservationScope {
  return {
    app: "web",
    feature: "progress",
    userId: null,
    workspaceId: context.workspaceId,
    installationId: context.installationId,
    route: getCurrentRoute(),
    requestId: error.requestId,
    statusCode: error.statusCode,
    code: error.code,
  };
}

function captureProgressNetworkError(error: unknown, context: ProgressServerLoadObservationContext): void {
  if (error instanceof ApiNetworkError === false) {
    return;
  }

  captureWebException({
    action: "progress_server_load_failed",
    error,
    scope: buildProgressNetworkErrorScope(error, context),
    details: {
      operation: context.operation,
      workspaceId: context.workspaceId,
    },
  });
}

function captureProgressServerLoadError(error: unknown, context: ProgressServerLoadObservationContext): void {
  captureApiContractError(error, {
    feature: "progress",
    sourceAction: context.operation,
    userId: null,
    workspaceId: context.workspaceId,
    installationId: context.installationId,
  });
  captureProgressNetworkError(error, context);
}

export function useProgressSource(params: UseProgressSourceParams): UseProgressSourceResult {
  const {
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
    progressLocalVersion,
    progressScheduleLocalVersion,
    progressServerInvalidationVersion,
    sections,
  } = params;
  const { includeSummary, includeSeries, includeReviewSchedule } = sections;
  const [progressSourceState, dispatch] = useReducer(progressSourceReducer, createInitialProgressSourceState());
  const timeContext = useProgressTimeContext();
  const [manualRefreshVersion, setManualRefreshVersion] = useState<number>(0);
  const manualRefreshVersionRef = useRef<number>(0);
  const currentSummaryScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const currentSeriesScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const currentReviewScheduleScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const canLoadServerBaseRef = useRef<boolean>(false);
  const summaryLocalLoadSequenceRef = useRef<number>(0);
  const seriesLocalLoadSequenceRef = useRef<number>(0);
  const reviewScheduleLocalLoadSequenceRef = useRef<number>(0);
  const summaryServerRefreshPromisesRef = useRef<Map<ProgressScopeKey, Promise<void>>>(new Map());
  const seriesServerRefreshPromisesRef = useRef<Map<ProgressScopeKey, Promise<void>>>(new Map());
  const reviewScheduleServerRefreshPromisesRef = useRef<Map<ProgressScopeKey, Promise<void>>>(new Map());
  const requestedSummaryRefreshKeysRef = useRef<Map<ProgressScopeKey, string>>(new Map());
  const requestedSeriesRefreshKeysRef = useRef<Map<ProgressScopeKey, string>>(new Map());
  const requestedReviewScheduleRefreshRequestsRef = useRef<Map<ProgressScopeKey, ProgressReviewScheduleRefreshRequest>>(new Map());
  const progressScheduleLocalVersionRef = useRef<number>(0);

  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const accessibleWorkspaceIds = useMemo(
    () => collectAccessibleWorkspaceIds(activeWorkspaceId, availableWorkspaces),
    [activeWorkspaceId, availableWorkspaces],
  );
  const summaryInput = useMemo<ProgressSummaryInput>(
    () => buildProgressSummaryInputForDateContext(timeContext),
    [timeContext],
  );
  const seriesInput = useMemo<ProgressSeriesInput>(
    () => buildProgressSeriesInputForDateContext(timeContext),
    [timeContext],
  );
  const reviewScheduleInput = useMemo<ProgressReviewScheduleInput>(
    () => buildProgressReviewScheduleInputForDateContext(timeContext),
    [timeContext],
  );
  const summaryScopeKey = resolveProgressSummaryScopeKey(includeSummary, accessibleWorkspaceIds, summaryInput);
  const seriesScopeKey = resolveProgressSeriesScopeKey(includeSeries, accessibleWorkspaceIds, seriesInput);
  const reviewScheduleScopeKey = resolveProgressReviewScheduleScopeKey(
    includeReviewSchedule,
    accessibleWorkspaceIds,
    reviewScheduleInput,
  );
  const canLoadServerBase = canLoadProgressServerBase(sessionVerificationState, cloudSettings);
  const summaryRefreshKey = resolveProgressRefreshKey(
    summaryScopeKey,
    canLoadServerBase,
    progressServerInvalidationVersion,
    manualRefreshVersion,
  );
  const seriesRefreshKey = resolveProgressRefreshKey(
    seriesScopeKey,
    canLoadServerBase,
    progressServerInvalidationVersion,
    manualRefreshVersion,
  );
  const reviewScheduleRefreshKey = resolveProgressReviewScheduleRefreshKey(
    reviewScheduleScopeKey,
    canLoadServerBase,
    progressServerInvalidationVersion,
    progressScheduleLocalVersion,
    manualRefreshVersion,
  );

  canLoadServerBaseRef.current = canLoadServerBase;
  progressScheduleLocalVersionRef.current = progressScheduleLocalVersion;

  useEffect(() => {
    currentSummaryScopeKeyRef.current = summaryScopeKey;

    if (summaryScopeKey === null) {
      dispatch({ type: "summary_scope_reset" });
      return;
    }

    const persistedSummary = canLoadServerBase
      ? loadPersistedProgressSummary(summaryScopeKey)
      : null;

    dispatch({
      type: "summary_scope_initialized",
      scopeKey: summaryScopeKey,
      referenceLocalDate: summaryInput.today,
      serverBase: persistedSummary === null ? null : createProgressSummarySnapshot(persistedSummary, "server", false),
      canRenderServerBase: canLoadServerBaseRef.current,
    });
  }, [canLoadServerBase, summaryInput.today, summaryScopeKey]);

  useEffect(() => {
    currentSeriesScopeKeyRef.current = seriesScopeKey;

    if (seriesScopeKey === null) {
      dispatch({
        type: "series_scope_reset",
        canRenderServerBase: canLoadServerBaseRef.current,
      });
      return;
    }

    const persistedSeries = canLoadServerBase
      ? loadPersistedProgressSeries(seriesScopeKey)
      : null;

    dispatch({
      type: "series_scope_initialized",
      scopeKey: seriesScopeKey,
      serverBase: persistedSeries === null ? null : createProgressSeriesSnapshot(persistedSeries, "server", false),
      canRenderServerBase: canLoadServerBaseRef.current,
    });
  }, [canLoadServerBase, seriesScopeKey]);

  useEffect(() => {
    currentReviewScheduleScopeKeyRef.current = reviewScheduleScopeKey;

    if (reviewScheduleScopeKey === null) {
      dispatch({ type: "review_schedule_scope_reset" });
      return;
    }

    const persistedReviewSchedule = canLoadServerBase
      ? loadPersistedProgressReviewSchedule(reviewScheduleScopeKey, reviewScheduleInput.timeZone)
      : null;

    dispatch({
      type: "review_schedule_scope_initialized",
      scopeKey: reviewScheduleScopeKey,
      serverBase: persistedReviewSchedule === null
        ? null
        : createProgressReviewScheduleSnapshot(persistedReviewSchedule, "server", false),
      progressScheduleLocalVersion: progressScheduleLocalVersionRef.current,
      canRenderServerBase: canLoadServerBaseRef.current,
    });
  }, [canLoadServerBase, reviewScheduleInput.timeZone, reviewScheduleScopeKey]);

  useEffect(() => {
    if (summaryScopeKey === null) {
      return;
    }

    const currentSequence = summaryLocalLoadSequenceRef.current + 1;
    summaryLocalLoadSequenceRef.current = currentSequence;

    void Promise.all([
      loadLocalProgressSummary(accessibleWorkspaceIds, summaryInput),
      loadLocalProgressActiveDates(accessibleWorkspaceIds, summaryInput.timeZone),
      hasPendingProgressReviewEvents(accessibleWorkspaceIds),
    ]).then(([localSummary, localFallbackActiveDates, hasPendingLocalReviews]) => {
      if (currentSummaryScopeKeyRef.current !== summaryScopeKey || summaryLocalLoadSequenceRef.current !== currentSequence) {
        return;
      }

      dispatch({
        type: "summary_local_load_succeeded",
        scopeKey: summaryScopeKey,
        localFallback: createProgressSummarySnapshot({
          timeZone: summaryInput.timeZone,
          generatedAt: null,
          reviewHistoryWatermarks: [],
          summary: localSummary,
        }, "local_only", true),
        localFallbackActiveDates,
        hasPendingLocalReviews,
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    }).catch((error: unknown) => {
      if (currentSummaryScopeKeyRef.current !== summaryScopeKey || summaryLocalLoadSequenceRef.current !== currentSequence) {
        return;
      }

      dispatch({
        type: "summary_local_load_failed",
        scopeKey: summaryScopeKey,
        errorMessage: getErrorMessage(error),
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    });
  }, [
    accessibleWorkspaceIds,
    canLoadServerBase,
    manualRefreshVersion,
    progressLocalVersion,
    summaryInput,
    summaryScopeKey,
  ]);

  useEffect(() => {
    if (seriesScopeKey === null) {
      return;
    }

    const currentSequence = seriesLocalLoadSequenceRef.current + 1;
    seriesLocalLoadSequenceRef.current = currentSequence;

    void Promise.all([
      loadLocalProgressDailyReviews(accessibleWorkspaceIds, seriesInput),
      loadPendingProgressDailyReviews(accessibleWorkspaceIds, seriesInput),
    ]).then(([localDailyReviews, pendingLocalDailyReviews]) => {
      if (currentSeriesScopeKeyRef.current !== seriesScopeKey || seriesLocalLoadSequenceRef.current !== currentSequence) {
        return;
      }

      dispatch({
        type: "series_local_load_succeeded",
        scopeKey: seriesScopeKey,
        localFallback: createProgressSeriesSnapshot(buildLocalFallbackSeries(seriesInput, localDailyReviews), "local_only", true),
        pendingLocalOverlay: createProgressChartData(pendingLocalDailyReviews),
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    }).catch((error: unknown) => {
      if (currentSeriesScopeKeyRef.current !== seriesScopeKey || seriesLocalLoadSequenceRef.current !== currentSequence) {
        return;
      }

      dispatch({
        type: "series_local_load_failed",
        scopeKey: seriesScopeKey,
        errorMessage: getErrorMessage(error),
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    });
  }, [
    accessibleWorkspaceIds,
    canLoadServerBase,
    manualRefreshVersion,
    progressLocalVersion,
    seriesInput,
    seriesScopeKey,
  ]);

  useEffect(() => {
    if (reviewScheduleScopeKey === null) {
      return;
    }

    const currentSequence = reviewScheduleLocalLoadSequenceRef.current + 1;
    reviewScheduleLocalLoadSequenceRef.current = currentSequence;

    void Promise.all([
      loadLocalProgressReviewSchedule(accessibleWorkspaceIds, reviewScheduleInput),
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
        currentReviewScheduleScopeKeyRef.current !== reviewScheduleScopeKey
        || reviewScheduleLocalLoadSequenceRef.current !== currentSequence
      ) {
        return;
      }

      dispatch({
        type: "review_schedule_local_load_succeeded",
        scopeKey: reviewScheduleScopeKey,
        localFallback: createProgressReviewScheduleSnapshot(localReviewSchedule, "local_only", true),
        hasPendingLocalCardChanges,
        hasCompleteLocalCardState,
        pendingLocalCardTotalDelta,
        progressScheduleLocalVersion,
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    }).catch((error: unknown) => {
      if (
        currentReviewScheduleScopeKeyRef.current !== reviewScheduleScopeKey
        || reviewScheduleLocalLoadSequenceRef.current !== currentSequence
      ) {
        return;
      }

      dispatch({
        type: "review_schedule_local_load_failed",
        scopeKey: reviewScheduleScopeKey,
        errorMessage: getErrorMessage(error),
        progressScheduleLocalVersion,
        canRenderServerBase: canLoadServerBaseRef.current,
      });
    });
  }, [
    accessibleWorkspaceIds,
    canLoadServerBase,
    manualRefreshVersion,
    progressScheduleLocalVersion,
    reviewScheduleInput,
    reviewScheduleScopeKey,
  ]);

  const refreshProgressSummary = useCallback(async function refreshProgressSummary(
    targetScopeKey: ProgressScopeKey,
    input: ProgressSummaryInput,
    nextRefreshKey: string,
  ): Promise<void> {
    requestedSummaryRefreshKeysRef.current.set(targetScopeKey, nextRefreshKey);

    const inFlightRefresh = summaryServerRefreshPromisesRef.current.get(targetScopeKey);
    if (inFlightRefresh !== undefined) {
      return inFlightRefresh;
    }

    const refreshPromise = (async (): Promise<void> => {
      try {
        while (true) {
          const requestedRefreshKey = requestedSummaryRefreshKeysRef.current.get(targetScopeKey);

          if (requestedRefreshKey === undefined) {
            throw new Error(`Missing requested progress summary refresh key for scope ${targetScopeKey}`);
          }

          if (currentSummaryScopeKeyRef.current !== targetScopeKey || canLoadServerBaseRef.current === false) {
            requestedSummaryRefreshKeysRef.current.delete(targetScopeKey);
            return;
          }

          try {
            const serverSummary = await loadProgressSummary(input);
            const isCurrentRefreshRequest: boolean = requestedSummaryRefreshKeysRef.current.get(targetScopeKey)
              === requestedRefreshKey;

            if (
              currentSummaryScopeKeyRef.current === targetScopeKey
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
            const isCurrentRefreshRequest: boolean = requestedSummaryRefreshKeysRef.current.get(targetScopeKey)
              === requestedRefreshKey;

            if (
              currentSummaryScopeKeyRef.current === targetScopeKey
              && canLoadServerBaseRef.current
              && isCurrentRefreshRequest
            ) {
              dispatch({
                type: "summary_server_load_failed",
                scopeKey: targetScopeKey,
                errorMessage: getErrorMessage(error),
                canRenderServerBase: canLoadServerBaseRef.current,
              });
              captureProgressServerLoadError(error, {
                operation: "progress_summary_server_load",
                workspaceId: activeWorkspaceId,
                installationId: cloudSettings?.installationId ?? null,
              });
            }
          }

          if (requestedSummaryRefreshKeysRef.current.get(targetScopeKey) === requestedRefreshKey) {
            requestedSummaryRefreshKeysRef.current.delete(targetScopeKey);
            return;
          }
        }
      } finally {
        summaryServerRefreshPromisesRef.current.delete(targetScopeKey);
      }
    })();

    summaryServerRefreshPromisesRef.current.set(targetScopeKey, refreshPromise);
    return refreshPromise;
  }, [activeWorkspaceId, cloudSettings?.installationId]);

  const refreshProgressSeries = useCallback(async function refreshProgressSeries(
    targetScopeKey: ProgressScopeKey,
    input: ProgressSeriesInput,
    nextRefreshKey: string,
  ): Promise<void> {
    requestedSeriesRefreshKeysRef.current.set(targetScopeKey, nextRefreshKey);

    const inFlightRefresh = seriesServerRefreshPromisesRef.current.get(targetScopeKey);
    if (inFlightRefresh !== undefined) {
      return inFlightRefresh;
    }

    const refreshPromise = (async (): Promise<void> => {
      try {
        while (true) {
          const requestedRefreshKey = requestedSeriesRefreshKeysRef.current.get(targetScopeKey);

          if (requestedRefreshKey === undefined) {
            throw new Error(`Missing requested progress series refresh key for scope ${targetScopeKey}`);
          }

          if (currentSeriesScopeKeyRef.current !== targetScopeKey || canLoadServerBaseRef.current === false) {
            requestedSeriesRefreshKeysRef.current.delete(targetScopeKey);
            return;
          }

          try {
            const serverSeries = normalizeProgressSeries(await loadProgressSeries(input));
            const isCurrentRefreshRequest: boolean = requestedSeriesRefreshKeysRef.current.get(targetScopeKey)
              === requestedRefreshKey;

            if (
              currentSeriesScopeKeyRef.current === targetScopeKey
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
            const isCurrentRefreshRequest: boolean = requestedSeriesRefreshKeysRef.current.get(targetScopeKey)
              === requestedRefreshKey;

            if (
              currentSeriesScopeKeyRef.current === targetScopeKey
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
                installationId: cloudSettings?.installationId ?? null,
              });
            }
          }

          if (requestedSeriesRefreshKeysRef.current.get(targetScopeKey) === requestedRefreshKey) {
            requestedSeriesRefreshKeysRef.current.delete(targetScopeKey);
            return;
          }
        }
      } finally {
        seriesServerRefreshPromisesRef.current.delete(targetScopeKey);
      }
    })();

    seriesServerRefreshPromisesRef.current.set(targetScopeKey, refreshPromise);
    return refreshPromise;
  }, [activeWorkspaceId, cloudSettings?.installationId]);

  const refreshProgressReviewSchedule = useCallback(async function refreshProgressReviewSchedule(
    targetScopeKey: ProgressScopeKey,
    input: ProgressReviewScheduleInput,
    nextRefreshKey: string,
    nextProgressScheduleLocalVersion: number,
  ): Promise<void> {
    requestedReviewScheduleRefreshRequestsRef.current.set(targetScopeKey, {
      refreshKey: nextRefreshKey,
      progressScheduleLocalVersion: nextProgressScheduleLocalVersion,
    });

    const inFlightRefresh = reviewScheduleServerRefreshPromisesRef.current.get(targetScopeKey);
    if (inFlightRefresh !== undefined) {
      return inFlightRefresh;
    }

    const refreshPromise = (async (): Promise<void> => {
      try {
        while (true) {
          const requestedRefresh = requestedReviewScheduleRefreshRequestsRef.current.get(targetScopeKey);

          if (requestedRefresh === undefined) {
            throw new Error(`Missing requested progress review schedule refresh key for scope ${targetScopeKey}`);
          }

          if (currentReviewScheduleScopeKeyRef.current !== targetScopeKey || canLoadServerBaseRef.current === false) {
            requestedReviewScheduleRefreshRequestsRef.current.delete(targetScopeKey);
            return;
          }

          try {
            const serverReviewSchedule = await loadProgressReviewSchedule(input);
            const isCurrentRefreshRequest: boolean = requestedReviewScheduleRefreshRequestsRef.current
              .get(targetScopeKey)?.refreshKey === requestedRefresh.refreshKey;

            if (
              currentReviewScheduleScopeKeyRef.current === targetScopeKey
              && canLoadServerBaseRef.current
              && isCurrentRefreshRequest
            ) {
              storePersistedProgressReviewSchedule(targetScopeKey, serverReviewSchedule, input.timeZone);
              dispatch({
                type: "review_schedule_server_load_succeeded",
                scopeKey: targetScopeKey,
                serverBase: createProgressReviewScheduleSnapshot(serverReviewSchedule, "server", false),
                progressScheduleLocalVersion: requestedRefresh.progressScheduleLocalVersion,
                canRenderServerBase: canLoadServerBaseRef.current,
              });
            }
          } catch (error: unknown) {
            const isCurrentRefreshRequest: boolean = requestedReviewScheduleRefreshRequestsRef.current
              .get(targetScopeKey)?.refreshKey === requestedRefresh.refreshKey;

            if (
              currentReviewScheduleScopeKeyRef.current === targetScopeKey
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
                installationId: cloudSettings?.installationId ?? null,
              });
            }
          }

          if (
            requestedReviewScheduleRefreshRequestsRef.current.get(targetScopeKey)?.refreshKey
              === requestedRefresh.refreshKey
          ) {
            requestedReviewScheduleRefreshRequestsRef.current.delete(targetScopeKey);
            return;
          }
        }
      } finally {
        reviewScheduleServerRefreshPromisesRef.current.delete(targetScopeKey);
      }
    })();

    reviewScheduleServerRefreshPromisesRef.current.set(targetScopeKey, refreshPromise);
    return refreshPromise;
  }, [activeWorkspaceId, cloudSettings?.installationId]);

  useEffect(() => {
    if (summaryScopeKey === null || summaryRefreshKey === null) {
      return;
    }

    if (requestedSummaryRefreshKeysRef.current.get(summaryScopeKey) === summaryRefreshKey) {
      return;
    }

    void refreshProgressSummary(summaryScopeKey, summaryInput, summaryRefreshKey);
  }, [refreshProgressSummary, summaryInput, summaryRefreshKey, summaryScopeKey]);

  useEffect(() => {
    if (seriesScopeKey === null || seriesRefreshKey === null) {
      return;
    }

    if (requestedSeriesRefreshKeysRef.current.get(seriesScopeKey) === seriesRefreshKey) {
      return;
    }

    void refreshProgressSeries(seriesScopeKey, seriesInput, seriesRefreshKey);
  }, [refreshProgressSeries, seriesInput, seriesRefreshKey, seriesScopeKey]);

  useEffect(() => {
    if (reviewScheduleScopeKey === null || reviewScheduleRefreshKey === null) {
      return;
    }

    if (
      requestedReviewScheduleRefreshRequestsRef.current.get(reviewScheduleScopeKey)?.refreshKey
        === reviewScheduleRefreshKey
    ) {
      return;
    }

    void refreshProgressReviewSchedule(
      reviewScheduleScopeKey,
      reviewScheduleInput,
      reviewScheduleRefreshKey,
      progressScheduleLocalVersion,
    );
  }, [
    progressScheduleLocalVersion,
    refreshProgressReviewSchedule,
    reviewScheduleInput,
    reviewScheduleRefreshKey,
    reviewScheduleScopeKey,
  ]);

  const refreshProgress = useCallback(async function refreshProgress(): Promise<void> {
    if (summaryScopeKey === null && seriesScopeKey === null && reviewScheduleScopeKey === null) {
      dispatch({
        type: "errors_cleared",
        canRenderServerBase: canLoadServerBase,
      });
      return;
    }

    const nextManualRefreshVersion = manualRefreshVersionRef.current + 1;
    manualRefreshVersionRef.current = nextManualRefreshVersion;
    dispatch({
      type: "refresh_started",
      summaryScopeKey,
      seriesScopeKey,
      reviewScheduleScopeKey,
      progressScheduleLocalVersion,
      canRenderServerBase: canLoadServerBase,
    });
    setManualRefreshVersion(nextManualRefreshVersion);

    if (canLoadServerBase === false) {
      return;
    }

    const refreshPromises: Array<Promise<void>> = [];

    if (summaryScopeKey !== null) {
      refreshPromises.push(refreshProgressSummary(
        summaryScopeKey,
        summaryInput,
        buildProgressRefreshKey(summaryScopeKey, progressServerInvalidationVersion, nextManualRefreshVersion),
      ));
    }

    if (seriesScopeKey !== null) {
      refreshPromises.push(refreshProgressSeries(
        seriesScopeKey,
        seriesInput,
        buildProgressRefreshKey(seriesScopeKey, progressServerInvalidationVersion, nextManualRefreshVersion),
      ));
    }

    if (reviewScheduleScopeKey !== null) {
      refreshPromises.push(refreshProgressReviewSchedule(
        reviewScheduleScopeKey,
        reviewScheduleInput,
        buildProgressReviewScheduleRefreshKey(
          reviewScheduleScopeKey,
          progressServerInvalidationVersion,
          progressScheduleLocalVersion,
          nextManualRefreshVersion,
        ),
        progressScheduleLocalVersion,
      ));
    }

    await Promise.all(refreshPromises);
  }, [
    canLoadServerBase,
    progressScheduleLocalVersion,
    progressServerInvalidationVersion,
    refreshProgressReviewSchedule,
    refreshProgressSeries,
    refreshProgressSummary,
    reviewScheduleInput,
    reviewScheduleScopeKey,
    seriesInput,
    seriesScopeKey,
    summaryInput,
    summaryScopeKey,
  ]);

  return {
    progressSourceState,
    refreshProgress,
  };
}

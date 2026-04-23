import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { loadProgressSeries, loadProgressSummary } from "../../api";
import {
  hasPendingProgressReviewEvents,
  loadLocalProgressDailyReviews,
  loadLocalProgressSummary,
  loadPendingProgressDailyReviews,
} from "../../localDb/progress";
import type {
  CloudSettings,
  ProgressScopeKey,
  ProgressSeriesInput,
  ProgressSourceState,
  ProgressSummaryInput,
  WorkspaceSummary,
} from "../../types";
import {
  buildProgressSeriesInputForDateContext,
  buildProgressSummaryInputForDateContext,
} from "../../progress/progressDates";
import type { SessionVerificationState } from "../warmStart";
import { useProgressTimeContext } from "../progressTimeContext";
import {
  createInitialProgressSourceState,
  progressSourceReducer,
} from "./progressReducer";
import {
  buildProgressRefreshKey,
  canLoadProgressServerBase,
  collectAccessibleWorkspaceIds,
  resolveProgressRefreshKey,
  resolveProgressSeriesScopeKey,
  resolveProgressSummaryScopeKey,
  type ProgressSourceSections,
} from "./progressScope";
import {
  buildLocalFallbackSeries,
  createProgressChartData,
  createProgressSeriesSnapshot,
  createProgressSummarySnapshot,
  normalizeProgressSeries,
} from "./progressSnapshots";
import {
  loadPersistedProgressSeries,
  loadPersistedProgressSummary,
  storePersistedProgressSeries,
  storePersistedProgressSummary,
} from "./progressStorage";

type UseProgressSourceParams = Readonly<{
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  cloudSettings: CloudSettings | null;
  sessionVerificationState: SessionVerificationState;
  progressLocalVersion: number;
  progressServerInvalidationVersion: number;
  sections: ProgressSourceSections;
}>;

type UseProgressSourceResult = Readonly<{
  progressSourceState: ProgressSourceState;
  refreshProgress: () => Promise<void>;
}>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProgressSource(params: UseProgressSourceParams): UseProgressSourceResult {
  const {
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
    progressLocalVersion,
    progressServerInvalidationVersion,
    sections,
  } = params;
  const { includeSummary, includeSeries } = sections;
  const [progressSourceState, dispatch] = useReducer(progressSourceReducer, createInitialProgressSourceState());
  const timeContext = useProgressTimeContext();
  const [manualRefreshVersion, setManualRefreshVersion] = useState<number>(0);
  const manualRefreshVersionRef = useRef<number>(0);
  const currentSummaryScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const currentSeriesScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const canLoadServerBaseRef = useRef<boolean>(false);
  const summaryLocalLoadSequenceRef = useRef<number>(0);
  const seriesLocalLoadSequenceRef = useRef<number>(0);
  const summaryServerRefreshPromisesRef = useRef<Map<ProgressScopeKey, Promise<void>>>(new Map());
  const seriesServerRefreshPromisesRef = useRef<Map<ProgressScopeKey, Promise<void>>>(new Map());
  const requestedSummaryRefreshKeysRef = useRef<Map<ProgressScopeKey, string>>(new Map());
  const requestedSeriesRefreshKeysRef = useRef<Map<ProgressScopeKey, string>>(new Map());

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
  const summaryScopeKey = resolveProgressSummaryScopeKey(includeSummary, accessibleWorkspaceIds, summaryInput);
  const seriesScopeKey = resolveProgressSeriesScopeKey(includeSeries, accessibleWorkspaceIds, seriesInput);
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

  canLoadServerBaseRef.current = canLoadServerBase;

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
      serverBase: persistedSummary === null ? null : createProgressSummarySnapshot(persistedSummary, "server", false),
      canRenderServerBase: canLoadServerBaseRef.current,
    });
  }, [canLoadServerBase, summaryScopeKey]);

  useEffect(() => {
    currentSeriesScopeKeyRef.current = seriesScopeKey;

    if (seriesScopeKey === null) {
      dispatch({ type: "series_scope_reset" });
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
    if (summaryScopeKey === null) {
      return;
    }

    const currentSequence = summaryLocalLoadSequenceRef.current + 1;
    summaryLocalLoadSequenceRef.current = currentSequence;

    void Promise.all([
      loadLocalProgressSummary(accessibleWorkspaceIds, summaryInput),
      hasPendingProgressReviewEvents(accessibleWorkspaceIds),
    ]).then(([localSummary, hasPendingLocalReviews]) => {
      if (currentSummaryScopeKeyRef.current !== summaryScopeKey || summaryLocalLoadSequenceRef.current !== currentSequence) {
        return;
      }

      dispatch({
        type: "summary_local_load_succeeded",
        scopeKey: summaryScopeKey,
        localFallback: createProgressSummarySnapshot({
          timeZone: summaryInput.timeZone,
          generatedAt: null,
          summary: localSummary,
        }, "local_only", true),
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
  }, []);

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
  }, []);

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

  const refreshProgress = useCallback(async function refreshProgress(): Promise<void> {
    if (summaryScopeKey === null && seriesScopeKey === null) {
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

    await Promise.all(refreshPromises);
  }, [
    canLoadServerBase,
    progressServerInvalidationVersion,
    refreshProgressSeries,
    refreshProgressSummary,
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

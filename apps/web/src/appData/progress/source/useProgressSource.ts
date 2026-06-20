import {
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
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
  resolveProgressLeaderboardScopeKey,
  resolveProgressRefreshKey,
  resolveProgressReviewScheduleRefreshKey,
  resolveProgressReviewScheduleScopeKey,
  resolveProgressSeriesScopeKey,
  resolveProgressSummaryScopeKey,
  type ProgressSourceSections,
} from "../state/progressScope";
import { useProgressLeaderboardSourcePipeline } from "./pipelines/leaderboardSource";
import { useProgressReviewScheduleSourcePipeline } from "./pipelines/reviewScheduleSource";
import { useProgressSeriesSourcePipeline } from "./pipelines/seriesSource";
import { useProgressSummarySourcePipeline } from "./pipelines/summarySource";

type UseProgressSourceParams = Readonly<{
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  cloudSettings: CloudSettings | null;
  sessionVerificationState: SessionVerificationState;
  progressLocalVersion: number;
  progressScheduleLocalVersion: number;
  progressServerInvalidationVersion: number;
  leaderboardAutoRefreshEnabled: boolean;
  canExposeTechnicalErrors: boolean;
  sections: ProgressSourceSections;
}>;

type UseProgressSourceResult = Readonly<{
  progressSourceState: ProgressSourceState;
  refreshProgress: () => Promise<void>;
}>;

export function useProgressSource(params: UseProgressSourceParams): UseProgressSourceResult {
  const {
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
    progressLocalVersion,
    progressScheduleLocalVersion,
    progressServerInvalidationVersion,
    leaderboardAutoRefreshEnabled,
    canExposeTechnicalErrors,
    sections,
  } = params;
  const { includeSummary, includeSeries, includeReviewSchedule, includeLeaderboard } = sections;
  const [progressSourceState, dispatch] = useReducer(progressSourceReducer, createInitialProgressSourceState());
  const timeContext = useProgressTimeContext();
  const [manualRefreshVersion, setManualRefreshVersion] = useState<number>(0);
  const manualRefreshVersionRef = useRef<number>(0);
  const currentSummaryScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const currentSeriesScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const currentReviewScheduleScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const currentLeaderboardScopeKeyRef = useRef<ProgressScopeKey | null>(null);
  const canLoadServerBaseRef = useRef<boolean>(false);
  const progressScheduleLocalVersionRef = useRef<number>(0);

  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const installationId = cloudSettings?.installationId ?? null;
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
  const leaderboardScopeKey = resolveProgressLeaderboardScopeKey(includeLeaderboard, accessibleWorkspaceIds);
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
  const leaderboardRefreshKey = resolveProgressRefreshKey(
    leaderboardScopeKey,
    canLoadServerBase,
    progressServerInvalidationVersion,
    manualRefreshVersion,
  );

  canLoadServerBaseRef.current = canLoadServerBase;
  progressScheduleLocalVersionRef.current = progressScheduleLocalVersion;

  const { refreshProgressSummary } = useProgressSummarySourcePipeline({
    accessibleWorkspaceIds,
    activeWorkspaceId,
    canLoadServerBase,
    canLoadServerBaseRef,
    canExposeTechnicalErrors,
    currentScopeKeyRef: currentSummaryScopeKeyRef,
    dispatch,
    input: summaryInput,
    installationId,
    manualRefreshVersion,
    progressLocalVersion,
    refreshKey: summaryRefreshKey,
    scopeKey: summaryScopeKey,
  });
  const { refreshProgressSeries } = useProgressSeriesSourcePipeline({
    accessibleWorkspaceIds,
    activeWorkspaceId,
    canLoadServerBase,
    canLoadServerBaseRef,
    canExposeTechnicalErrors,
    currentScopeKeyRef: currentSeriesScopeKeyRef,
    dispatch,
    input: seriesInput,
    installationId,
    manualRefreshVersion,
    progressLocalVersion,
    refreshKey: seriesRefreshKey,
    scopeKey: seriesScopeKey,
  });
  const { refreshProgressReviewSchedule } = useProgressReviewScheduleSourcePipeline({
    accessibleWorkspaceIds,
    activeWorkspaceId,
    canLoadServerBase,
    canLoadServerBaseRef,
    canExposeTechnicalErrors,
    currentScopeKeyRef: currentReviewScheduleScopeKeyRef,
    dispatch,
    input: reviewScheduleInput,
    installationId,
    manualRefreshVersion,
    progressScheduleLocalVersion,
    progressScheduleLocalVersionRef,
    refreshKey: reviewScheduleRefreshKey,
    scopeKey: reviewScheduleScopeKey,
  });
  const { refreshProgressLeaderboard } = useProgressLeaderboardSourcePipeline({
    accessibleWorkspaceIds,
    activeWorkspaceId,
    autoRefreshEnabled: leaderboardAutoRefreshEnabled,
    canLoadServerBase,
    canLoadServerBaseRef,
    canExposeTechnicalErrors,
    currentScopeKeyRef: currentLeaderboardScopeKeyRef,
    dispatch,
    installationId,
    manualRefreshVersion,
    progressLocalVersion,
    refreshKey: leaderboardRefreshKey,
    scopeKey: leaderboardScopeKey,
  });

  const refreshProgress = useCallback(async function refreshProgress(): Promise<void> {
    if (
      summaryScopeKey === null
      && seriesScopeKey === null
      && reviewScheduleScopeKey === null
      && leaderboardScopeKey === null
    ) {
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
      leaderboardScopeKey,
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

    if (leaderboardScopeKey !== null) {
      refreshPromises.push(refreshProgressLeaderboard(
        leaderboardScopeKey,
        buildProgressRefreshKey(leaderboardScopeKey, progressServerInvalidationVersion, nextManualRefreshVersion),
        true,
      ));
    }

    await Promise.all(refreshPromises);
  }, [
    canLoadServerBase,
    leaderboardScopeKey,
    progressScheduleLocalVersion,
    progressServerInvalidationVersion,
    refreshProgressLeaderboard,
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

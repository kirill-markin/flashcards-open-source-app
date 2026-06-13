import type {
  DailyReviewPoint,
  ProgressChartData,
  ProgressLeaderboardLocalViewerCounts,
  ProgressLeaderboardMetric,
  ProgressLeaderboardRankingRow,
  ProgressLeaderboardRow,
  ProgressLeaderboardSnapshot,
  ProgressLeaderboardSourceState,
  ProgressLeaderboardViewer,
  ProgressLeaderboardWindow,
  ProgressReviewHistoryWatermark,
  ProgressReviewSchedule,
  ProgressReviewScheduleBucket,
  ProgressReviewScheduleSnapshot,
  ProgressReviewScheduleSourceState,
  ProgressRenderedSeriesSummaryContext,
  ProgressSeries,
  ProgressSeriesSnapshot,
  ProgressSeriesSourceState,
  ProgressSourceState,
  ProgressSummary,
  ProgressSummaryPayload,
  ProgressSummarySnapshot,
  ProgressSummarySourceState,
} from "../../../types";
import { progressLeaderboardWindowKeys } from "../../../types";

function areDailyReviewsEqual(
  left: ReadonlyArray<DailyReviewPoint>,
  right: ReadonlyArray<DailyReviewPoint>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftDay = left[index];
    const rightDay = right[index];

    if (leftDay?.date !== rightDay?.date || leftDay?.reviewCount !== rightDay?.reviewCount) {
      return false;
    }
  }

  return true;
}

function areProgressChartDataEqual(left: ProgressChartData | null, right: ProgressChartData | null): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return areDailyReviewsEqual(left.dailyReviews, right.dailyReviews);
}

export function areProgressSummariesEqual(left: ProgressSummary, right: ProgressSummary): boolean {
  return left.currentStreakDays === right.currentStreakDays
    && left.hasReviewedToday === right.hasReviewedToday
    && left.lastReviewedOn === right.lastReviewedOn
    && left.activeReviewDays === right.activeReviewDays;
}

export function areProgressReviewHistoryWatermarksEqual(
  left: ReadonlyArray<ProgressReviewHistoryWatermark>,
  right: ReadonlyArray<ProgressReviewHistoryWatermark>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftWatermark = left[index];
    const rightWatermark = right[index];

    if (
      leftWatermark?.workspaceId !== rightWatermark?.workspaceId
      || leftWatermark?.reviewSequenceId !== rightWatermark?.reviewSequenceId
    ) {
      return false;
    }
  }

  return true;
}

function areStringArraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function areProgressSummaryPayloadsEqual(
  left: ProgressSummaryPayload | null,
  right: ProgressSummaryPayload | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return left.timeZone === right.timeZone
    && left.generatedAt === right.generatedAt
    && areProgressReviewHistoryWatermarksEqual(left.reviewHistoryWatermarks, right.reviewHistoryWatermarks)
    && areProgressSummariesEqual(left.summary, right.summary);
}

function areProgressSummarySnapshotsEqual(
  left: ProgressSummarySnapshot | null,
  right: ProgressSummarySnapshot | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return areProgressSummaryPayloadsEqual(left, right)
    && left.source === right.source
    && left.isApproximate === right.isApproximate;
}

function areProgressRenderedSeriesSummaryContextsEqual(
  left: ProgressRenderedSeriesSummaryContext | null,
  right: ProgressRenderedSeriesSummaryContext | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  const watermarksAreEqual = left.serverBaseReviewHistoryWatermarks === null
    ? right.serverBaseReviewHistoryWatermarks === null
    : right.serverBaseReviewHistoryWatermarks !== null
      && areProgressReviewHistoryWatermarksEqual(
        left.serverBaseReviewHistoryWatermarks,
        right.serverBaseReviewHistoryWatermarks,
      );

  return areProgressSummariesEqual(left.lowerBoundSummary, right.lowerBoundSummary)
    && areStringArraysEqual(left.activeDates, right.activeDates)
    && areStringArraysEqual(left.activeDatesMissingFromServerBase, right.activeDatesMissingFromServerBase)
    && watermarksAreEqual;
}

function areProgressSeriesEqual(left: ProgressSeries | null, right: ProgressSeries | null): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return left.timeZone === right.timeZone
    && left.from === right.from
    && left.to === right.to
    && left.generatedAt === right.generatedAt
    && areProgressReviewHistoryWatermarksEqual(left.reviewHistoryWatermarks, right.reviewHistoryWatermarks)
    && areDailyReviewsEqual(left.dailyReviews, right.dailyReviews);
}

function areProgressSeriesSnapshotsEqual(
  left: ProgressSeriesSnapshot | null,
  right: ProgressSeriesSnapshot | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return areProgressSeriesEqual(left, right)
    && left.source === right.source
    && left.isApproximate === right.isApproximate;
}

function areProgressReviewScheduleBucketsEqual(
  left: ReadonlyArray<ProgressReviewScheduleBucket>,
  right: ReadonlyArray<ProgressReviewScheduleBucket>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftBucket = left[index];
    const rightBucket = right[index];

    if (leftBucket?.key !== rightBucket?.key || leftBucket?.count !== rightBucket?.count) {
      return false;
    }
  }

  return true;
}

function areProgressReviewSchedulesEqual(
  left: ProgressReviewSchedule | null,
  right: ProgressReviewSchedule | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return left.timeZone === right.timeZone
    && left.generatedAt === right.generatedAt
    && areProgressReviewHistoryWatermarksEqual(left.reviewHistoryWatermarks, right.reviewHistoryWatermarks)
    && left.totalCards === right.totalCards
    && areProgressReviewScheduleBucketsEqual(left.buckets, right.buckets);
}

function areProgressReviewScheduleSnapshotsEqual(
  left: ProgressReviewScheduleSnapshot | null,
  right: ProgressReviewScheduleSnapshot | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return areProgressReviewSchedulesEqual(left, right)
    && left.source === right.source
    && left.isApproximate === right.isApproximate;
}

function areProgressLeaderboardMetricsEqual(
  left: ProgressLeaderboardMetric,
  right: ProgressLeaderboardMetric,
): boolean {
  return left.metricVersion === right.metricVersion
    && left.title === right.title
    && left.description === right.description;
}

function areProgressLeaderboardViewersEqual(
  left: ProgressLeaderboardViewer,
  right: ProgressLeaderboardViewer,
): boolean {
  return left.publicProfileId === right.publicProfileId
    && left.displayName === right.displayName
    && left.rank === right.rank
    && left.qualifiedReviewCount === right.qualifiedReviewCount;
}

function areProgressLeaderboardRowsEqual(
  left: ProgressLeaderboardRow,
  right: ProgressLeaderboardRow,
): boolean {
  if (left.kind === "gap" || right.kind === "gap") {
    return left.kind === right.kind;
  }

  return left.kind === right.kind
    && left.publicProfileId === right.publicProfileId
    && left.anonymousDisplayName === right.anonymousDisplayName
    && left.qualifiedReviewCount === right.qualifiedReviewCount
    && left.rank === right.rank;
}

function areProgressLeaderboardRowArraysEqual(
  left: ReadonlyArray<ProgressLeaderboardRow>,
  right: ReadonlyArray<ProgressLeaderboardRow>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftRow = left[index];
    const rightRow = right[index];

    if (leftRow === undefined || rightRow === undefined || areProgressLeaderboardRowsEqual(leftRow, rightRow) === false) {
      return false;
    }
  }

  return true;
}

function areProgressLeaderboardRankingRowsEqual(
  left: ProgressLeaderboardRankingRow,
  right: ProgressLeaderboardRankingRow,
): boolean {
  return left.kind === right.kind
    && left.publicProfileId === right.publicProfileId
    && left.anonymousDisplayName === right.anonymousDisplayName
    && left.qualifiedReviewCount === right.qualifiedReviewCount
    && left.rank === right.rank;
}

function areProgressLeaderboardRankingRowArraysEqual(
  left: ReadonlyArray<ProgressLeaderboardRankingRow>,
  right: ReadonlyArray<ProgressLeaderboardRankingRow>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftRow = left[index];
    const rightRow = right[index];

    if (leftRow === undefined || rightRow === undefined || areProgressLeaderboardRankingRowsEqual(leftRow, rightRow) === false) {
      return false;
    }
  }

  return true;
}

function areProgressLeaderboardWindowsEqual(
  left: ProgressLeaderboardWindow,
  right: ProgressLeaderboardWindow,
): boolean {
  return left.windowKey === right.windowKey
    && left.snapshotId === right.snapshotId
    && left.snapshotGeneratedAt === right.snapshotGeneratedAt
    && left.asOfServerHour === right.asOfServerHour
    && left.nextRefreshAfter === right.nextRefreshAfter
    && left.participantCount === right.participantCount
    && areProgressLeaderboardViewersEqual(left.viewer, right.viewer)
    && areProgressLeaderboardRowArraysEqual(left.rows, right.rows)
    && areProgressLeaderboardRankingRowArraysEqual(left.rankingRows, right.rankingRows);
}

function areProgressLeaderboardWindowArraysEqual(
  left: ReadonlyArray<ProgressLeaderboardWindow>,
  right: ReadonlyArray<ProgressLeaderboardWindow>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftWindow = left[index];
    const rightWindow = right[index];

    if (
      leftWindow === undefined
      || rightWindow === undefined
      || areProgressLeaderboardWindowsEqual(leftWindow, rightWindow) === false
    ) {
      return false;
    }
  }

  return true;
}

function areProgressLeaderboardSnapshotsEqual(
  left: ProgressLeaderboardSnapshot | null,
  right: ProgressLeaderboardSnapshot | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return left.status === right.status
    && left.defaultWindowKey === right.defaultWindowKey
    && left.source === right.source
    && left.isApproximate === right.isApproximate
    && areProgressLeaderboardMetricsEqual(left.metric, right.metric)
    && areProgressLeaderboardWindowArraysEqual(left.windows, right.windows);
}

function areProgressLeaderboardLocalViewerCountsEqual(
  left: ProgressLeaderboardLocalViewerCounts | null,
  right: ProgressLeaderboardLocalViewerCounts | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return progressLeaderboardWindowKeys.every((windowKey) => left[windowKey] === right[windowKey]);
}

function areProgressLeaderboardSourceStatesEqual(
  left: ProgressLeaderboardSourceState,
  right: ProgressLeaderboardSourceState,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.isLoading === right.isLoading
    && left.errorMessage === right.errorMessage
    && left.isNetworkError === right.isNetworkError
    && left.localViewerCountsErrorMessage === right.localViewerCountsErrorMessage
    && areProgressLeaderboardSnapshotsEqual(left.serverBase, right.serverBase)
    && areProgressLeaderboardLocalViewerCountsEqual(left.localViewerCounts, right.localViewerCounts)
    && areProgressLeaderboardSnapshotsEqual(left.renderedSnapshot, right.renderedSnapshot);
}

function areProgressSummarySourceStatesEqual(
  left: ProgressSummarySourceState,
  right: ProgressSummarySourceState,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.referenceLocalDate === right.referenceLocalDate
    && left.hasPendingLocalReviews === right.hasPendingLocalReviews
    && left.isLoading === right.isLoading
    && left.errorMessage === right.errorMessage
    && areStringArraysEqual(left.localFallbackActiveDates, right.localFallbackActiveDates)
    && areProgressRenderedSeriesSummaryContextsEqual(left.renderedSeriesContext, right.renderedSeriesContext)
    && areProgressSummarySnapshotsEqual(left.localFallback, right.localFallback)
    && areProgressSummarySnapshotsEqual(left.serverBase, right.serverBase)
    && areProgressSummarySnapshotsEqual(left.renderedSnapshot, right.renderedSnapshot);
}

function areProgressSeriesSourceStatesEqual(
  left: ProgressSeriesSourceState,
  right: ProgressSeriesSourceState,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.isLoading === right.isLoading
    && left.errorMessage === right.errorMessage
    && areProgressSeriesSnapshotsEqual(left.localFallback, right.localFallback)
    && areProgressSeriesSnapshotsEqual(left.serverBase, right.serverBase)
    && areProgressChartDataEqual(left.pendingLocalOverlay, right.pendingLocalOverlay)
    && areProgressSeriesSnapshotsEqual(left.renderedSnapshot, right.renderedSnapshot);
}

function areProgressReviewScheduleSourceStatesEqual(
  left: ProgressReviewScheduleSourceState,
  right: ProgressReviewScheduleSourceState,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.progressScheduleLocalVersion === right.progressScheduleLocalVersion
    && left.serverBaseProgressScheduleLocalVersion === right.serverBaseProgressScheduleLocalVersion
    && left.serverBaseLocalCardTotalDelta === right.serverBaseLocalCardTotalDelta
    && left.hasPendingLocalCardChanges === right.hasPendingLocalCardChanges
    && left.hasCompleteLocalCardState === right.hasCompleteLocalCardState
    && left.pendingLocalCardTotalDelta === right.pendingLocalCardTotalDelta
    && left.isLoading === right.isLoading
    && left.errorMessage === right.errorMessage
    && areProgressReviewScheduleSnapshotsEqual(left.localFallback, right.localFallback)
    && areProgressReviewScheduleSnapshotsEqual(left.serverBase, right.serverBase)
    && areProgressReviewScheduleSnapshotsEqual(left.renderedSnapshot, right.renderedSnapshot);
}

export function areProgressSourceStatesEqual(left: ProgressSourceState, right: ProgressSourceState): boolean {
  return areProgressSummarySourceStatesEqual(left.summary, right.summary)
    && areProgressSeriesSourceStatesEqual(left.series, right.series)
    && areProgressReviewScheduleSourceStatesEqual(left.reviewSchedule, right.reviewSchedule)
    && areProgressLeaderboardSourceStatesEqual(left.leaderboard, right.leaderboard);
}

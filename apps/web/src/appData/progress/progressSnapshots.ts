import type {
  DailyReviewPoint,
  ProgressChartData,
  ProgressSeries,
  ProgressSeriesInput,
  ProgressSeriesSnapshot,
  ProgressSeriesSourceState,
  ProgressSourceState,
  ProgressSummary,
  ProgressSummaryPayload,
  ProgressSummarySnapshot,
  ProgressSummarySourceState,
} from "../../types";
import { shiftLocalDate } from "../../progress/progressDates";

export function createProgressChartData(dailyReviews: ReadonlyArray<DailyReviewPoint>): ProgressChartData {
  return {
    dailyReviews,
  };
}

function buildDailyReviewCountMap(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const day of dailyReviews) {
    counts.set(day.date, day.reviewCount);
  }

  return counts;
}

function expandProgressDailyReviews(
  input: ProgressSeriesInput,
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
): ReadonlyArray<DailyReviewPoint> {
  const dailyReviewCountMap = buildDailyReviewCountMap(dailyReviews);
  const expandedDailyReviews: Array<DailyReviewPoint> = [];

  for (let currentDate = input.from; currentDate <= input.to; currentDate = shiftLocalDate(currentDate, 1)) {
    expandedDailyReviews.push({
      date: currentDate,
      reviewCount: dailyReviewCountMap.get(currentDate) ?? 0,
    });
  }

  return expandedDailyReviews;
}

export function normalizeProgressSeries(series: ProgressSeries): ProgressSeries {
  const input: ProgressSeriesInput = {
    timeZone: series.timeZone,
    from: series.from,
    to: series.to,
  };

  return {
    timeZone: series.timeZone,
    from: series.from,
    to: series.to,
    generatedAt: series.generatedAt,
    dailyReviews: expandProgressDailyReviews(input, series.dailyReviews),
  };
}

export function createProgressSummarySnapshot(
  payload: ProgressSummaryPayload,
  source: ProgressSummarySnapshot["source"],
  isApproximate: boolean,
): ProgressSummarySnapshot {
  return {
    timeZone: payload.timeZone,
    generatedAt: payload.generatedAt,
    summary: payload.summary,
    source,
    isApproximate,
  };
}

export function createProgressSeriesSnapshot(
  series: ProgressSeries,
  source: ProgressSeriesSnapshot["source"],
  isApproximate: boolean,
): ProgressSeriesSnapshot {
  const normalizedSeries = normalizeProgressSeries(series);

  return {
    ...normalizedSeries,
    chartData: createProgressChartData(normalizedSeries.dailyReviews),
    source,
    isApproximate,
  };
}

export function buildLocalFallbackSeries(
  input: ProgressSeriesInput,
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
): ProgressSeries {
  return {
    timeZone: input.timeZone,
    from: input.from,
    to: input.to,
    generatedAt: null,
    dailyReviews: expandProgressDailyReviews(input, dailyReviews),
  };
}

function mergeProgressSeriesWithOverlay(
  serverBase: ProgressSeries,
  overlay: ProgressChartData | null,
): ProgressSeries {
  if (overlay === null || overlay.dailyReviews.length === 0) {
    return normalizeProgressSeries(serverBase);
  }

  const pendingReviewCounts = buildDailyReviewCountMap(overlay.dailyReviews);
  const normalizedServerBase = normalizeProgressSeries(serverBase);
  let hasOverlay = false;
  const dailyReviews = normalizedServerBase.dailyReviews.map((day) => {
    const pendingReviewCount = pendingReviewCounts.get(day.date) ?? 0;

    if (pendingReviewCount === 0) {
      return day;
    }

    hasOverlay = true;
    return {
      date: day.date,
      reviewCount: day.reviewCount + pendingReviewCount,
    };
  });

  if (hasOverlay === false) {
    return normalizedServerBase;
  }

  return {
    ...normalizedServerBase,
    dailyReviews,
  };
}

function hasPendingOverlayActivity(overlay: ProgressChartData | null): boolean {
  return overlay?.dailyReviews.some((day) => day.reviewCount > 0) ?? false;
}

function buildRenderedSummary(
  serverBase: ProgressSummarySnapshot | null,
  localFallback: ProgressSummarySnapshot | null,
  hasPendingLocalReviews: boolean,
  canRenderServerBase: boolean,
): ProgressSummarySnapshot | null {
  if (canRenderServerBase && serverBase !== null && hasPendingLocalReviews === false) {
    return serverBase;
  }

  return localFallback;
}

function buildRenderedSeries(
  serverBase: ProgressSeriesSnapshot | null,
  localFallback: ProgressSeriesSnapshot | null,
  pendingLocalOverlay: ProgressChartData | null,
  canRenderServerBase: boolean,
): ProgressSeriesSnapshot | null {
  if (canRenderServerBase && serverBase !== null) {
    const mergedSeries = mergeProgressSeriesWithOverlay(serverBase, pendingLocalOverlay);
    return createProgressSeriesSnapshot(mergedSeries, "server", hasPendingOverlayActivity(pendingLocalOverlay));
  }

  return localFallback;
}

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

function areProgressSummariesEqual(left: ProgressSummary, right: ProgressSummary): boolean {
  return left.currentStreakDays === right.currentStreakDays
    && left.hasReviewedToday === right.hasReviewedToday
    && left.lastReviewedOn === right.lastReviewedOn
    && left.activeReviewDays === right.activeReviewDays;
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

function areProgressSummarySourceStatesEqual(
  left: ProgressSummarySourceState,
  right: ProgressSummarySourceState,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.hasPendingLocalReviews === right.hasPendingLocalReviews
    && left.isLoading === right.isLoading
    && left.errorMessage === right.errorMessage
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

export function areProgressSourceStatesEqual(left: ProgressSourceState, right: ProgressSourceState): boolean {
  return areProgressSummarySourceStatesEqual(left.summary, right.summary)
    && areProgressSeriesSourceStatesEqual(left.series, right.series);
}

export function createEmptyProgressSummarySourceState(): ProgressSummarySourceState {
  return {
    scopeKey: null,
    localFallback: null,
    serverBase: null,
    hasPendingLocalReviews: false,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
  };
}

export function createEmptyProgressSeriesSourceState(): ProgressSeriesSourceState {
  return {
    scopeKey: null,
    localFallback: null,
    serverBase: null,
    pendingLocalOverlay: null,
    renderedSnapshot: null,
    isLoading: false,
    errorMessage: "",
  };
}

export function createEmptyProgressSourceState(): ProgressSourceState {
  return {
    summary: createEmptyProgressSummarySourceState(),
    series: createEmptyProgressSeriesSourceState(),
  };
}

export function createNextSummaryState(
  currentState: ProgressSummarySourceState,
  patch: Readonly<Partial<Omit<ProgressSummarySourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressSummarySourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: buildRenderedSummary(
      nextStateWithoutRenderedSnapshot.serverBase,
      nextStateWithoutRenderedSnapshot.localFallback,
      nextStateWithoutRenderedSnapshot.hasPendingLocalReviews,
      canRenderServerBase,
    ),
  };
}

export function createNextSeriesState(
  currentState: ProgressSeriesSourceState,
  patch: Readonly<Partial<Omit<ProgressSeriesSourceState, "renderedSnapshot">>>,
  canRenderServerBase: boolean,
): ProgressSeriesSourceState {
  const nextStateWithoutRenderedSnapshot = {
    ...currentState,
    ...patch,
  };

  return {
    ...nextStateWithoutRenderedSnapshot,
    renderedSnapshot: buildRenderedSeries(
      nextStateWithoutRenderedSnapshot.serverBase,
      nextStateWithoutRenderedSnapshot.localFallback,
      nextStateWithoutRenderedSnapshot.pendingLocalOverlay,
      canRenderServerBase,
    ),
  };
}

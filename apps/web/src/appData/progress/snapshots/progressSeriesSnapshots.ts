import type {
  DailyReviewPoint,
  ProgressChartData,
  ProgressSeries,
  ProgressSeriesInput,
  ProgressSeriesSnapshot,
} from "../../../types";
import { shiftLocalDate } from "../../../progress/progressDates";

export function createProgressChartData(dailyReviews: ReadonlyArray<DailyReviewPoint>): ProgressChartData {
  return {
    dailyReviews,
  };
}

export function buildDailyReviewCountMap(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const day of dailyReviews) {
    counts.set(day.date, day.reviewCount);
  }

  return counts;
}

function createEmptyDailyReviewPoint(date: string): DailyReviewPoint {
  return {
    date,
    reviewCount: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
  };
}

function buildDailyReviewPointMap(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
): Map<string, DailyReviewPoint> {
  const dailyReviewsByDate = new Map<string, DailyReviewPoint>();

  for (const day of dailyReviews) {
    dailyReviewsByDate.set(day.date, day);
  }

  return dailyReviewsByDate;
}

function addDailyReviewPoints(left: DailyReviewPoint, right: DailyReviewPoint): DailyReviewPoint {
  if (left.date !== right.date) {
    throw new Error(`Cannot merge progress days with different dates: ${left.date}, ${right.date}`);
  }

  return {
    date: left.date,
    reviewCount: left.reviewCount + right.reviewCount,
    againCount: left.againCount + right.againCount,
    hardCount: left.hardCount + right.hardCount,
    goodCount: left.goodCount + right.goodCount,
    easyCount: left.easyCount + right.easyCount,
  };
}

function expandProgressDailyReviews(
  input: ProgressSeriesInput,
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
): ReadonlyArray<DailyReviewPoint> {
  const dailyReviewPointMap = buildDailyReviewPointMap(dailyReviews);
  const expandedDailyReviews: Array<DailyReviewPoint> = [];

  for (let currentDate = input.from; currentDate <= input.to; currentDate = shiftLocalDate(currentDate, 1)) {
    expandedDailyReviews.push(dailyReviewPointMap.get(currentDate) ?? createEmptyDailyReviewPoint(currentDate));
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
    reviewHistoryWatermarks: series.reviewHistoryWatermarks,
    dailyReviews: expandProgressDailyReviews(input, series.dailyReviews),
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
    reviewHistoryWatermarks: [],
    dailyReviews: expandProgressDailyReviews(input, dailyReviews),
  };
}

type ProgressSeriesMergeResult = Readonly<{
  series: ProgressSeries;
  hasOverlay: boolean;
}>;

function mergeProgressSeriesWithOverlay(
  serverBase: ProgressSeries,
  overlay: ProgressChartData | null,
  localFallback: ProgressSeriesSnapshot | null,
): ProgressSeriesMergeResult {
  const pendingReviewCounts = buildDailyReviewPointMap(overlay?.dailyReviews ?? []);
  const localFallbackReviewCounts = localFallback === null
    ? new Map<string, DailyReviewPoint>()
    : buildDailyReviewPointMap(localFallback.dailyReviews);
  const normalizedServerBase = normalizeProgressSeries(serverBase);
  let hasOverlay = false;
  const dailyReviews = normalizedServerBase.dailyReviews.map((day) => {
    const pendingReviewCount = pendingReviewCounts.get(day.date) ?? createEmptyDailyReviewPoint(day.date);
    const localFallbackReviewCount = localFallbackReviewCounts.get(day.date) ?? createEmptyDailyReviewPoint(day.date);
    const dayWithPendingOverlay = addDailyReviewPoints(day, pendingReviewCount);
    const reviewCount = Math.max(dayWithPendingOverlay.reviewCount, localFallbackReviewCount.reviewCount);

    if (reviewCount === day.reviewCount) {
      return day;
    }

    hasOverlay = true;
    return localFallbackReviewCount.reviewCount > dayWithPendingOverlay.reviewCount
      ? localFallbackReviewCount
      : dayWithPendingOverlay;
  });

  if (hasOverlay === false) {
    return {
      series: normalizedServerBase,
      hasOverlay: false,
    };
  }

  return {
    series: {
      ...normalizedServerBase,
      dailyReviews,
    },
    hasOverlay: true,
  };
}

export function buildRenderedSeries(
  serverBase: ProgressSeriesSnapshot | null,
  localFallback: ProgressSeriesSnapshot | null,
  pendingLocalOverlay: ProgressChartData | null,
  canRenderServerBase: boolean,
): ProgressSeriesSnapshot | null {
  if (canRenderServerBase && serverBase !== null) {
    const mergeResult = mergeProgressSeriesWithOverlay(serverBase, pendingLocalOverlay, localFallback);
    return createProgressSeriesSnapshot(
      mergeResult.series,
      "server",
      mergeResult.hasOverlay,
    );
  }

  return localFallback;
}

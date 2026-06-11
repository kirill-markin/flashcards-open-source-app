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
  const pendingReviewCounts = buildDailyReviewCountMap(overlay?.dailyReviews ?? []);
  const localFallbackReviewCounts = localFallback === null
    ? new Map<string, number>()
    : buildDailyReviewCountMap(localFallback.dailyReviews);
  const normalizedServerBase = normalizeProgressSeries(serverBase);
  let hasOverlay = false;
  const dailyReviews = normalizedServerBase.dailyReviews.map((day) => {
    const pendingReviewCount = pendingReviewCounts.get(day.date) ?? 0;
    const localFallbackReviewCount = localFallbackReviewCounts.get(day.date) ?? 0;
    const reviewCountWithPendingOverlay = day.reviewCount + pendingReviewCount;
    const reviewCount = Math.max(reviewCountWithPendingOverlay, localFallbackReviewCount);

    if (reviewCount === day.reviewCount) {
      return day;
    }

    hasOverlay = true;
    return {
      date: day.date,
      reviewCount,
    };
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

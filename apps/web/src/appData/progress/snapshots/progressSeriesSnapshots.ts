import type {
  DailyReviewPoint,
  ProgressChartData,
  ProgressSeries,
  ProgressSeriesInput,
  ProgressSeriesSnapshot,
  StreakDay,
  StreakDayState,
} from "../../../types";
import { shiftLocalDate } from "../../../progress/progressDates";
import {
  evaluateProgressStreakFreeze,
} from "../../../progress/streakFreeze";

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

function createProgressSeriesDateRange(input: ProgressSeriesInput): ReadonlyArray<string> {
  const dates: Array<string> = [];

  for (let currentDate = input.from; currentDate <= input.to; currentDate = shiftLocalDate(currentDate, 1)) {
    dates.push(currentDate);
  }

  return dates;
}

function createStreakDayStateMap(streakDays: ReadonlyArray<StreakDay>): ReadonlyMap<string, StreakDayState> {
  const stateMap = new Map<string, StreakDayState>();

  for (const streakDay of streakDays) {
    if (stateMap.has(streakDay.date)) {
      throw new Error(`Progress series streakDays must not contain duplicate date: ${streakDay.date}`);
    }

    stateMap.set(streakDay.date, streakDay.state);
  }

  return stateMap;
}

function expandProgressStreakDays(
  input: ProgressSeriesInput,
  streakDays: ReadonlyArray<StreakDay>,
): ReadonlyArray<StreakDay> {
  const streakDayStateMap = createStreakDayStateMap(streakDays);

  return createProgressSeriesDateRange(input).map((date): StreakDay => {
    const state = streakDayStateMap.get(date);
    if (state === undefined) {
      throw new Error(`Progress series streakDays must include date: ${date}`);
    }

    return {
      date,
      state,
    };
  });
}

function activeDatesFromDailyReviews(dailyReviews: ReadonlyArray<DailyReviewPoint>): ReadonlyArray<string> {
  const activeDates = dailyReviews
    .filter((day) => day.reviewCount > 0)
    .map((day) => day.date);

  return uniqueSortedLocalDates(activeDates);
}

function uniqueSortedLocalDates(localDates: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(localDates)]
    .sort((leftDate, rightDate) => leftDate.localeCompare(rightDate));
}

function createProgressStreakDays(
  input: ProgressSeriesInput,
  activeReviewLocalDates: ReadonlyArray<string>,
): ReadonlyArray<StreakDay> {
  const activeDates = uniqueSortedLocalDates(activeReviewLocalDates);
  const activeDateSet = new Set(activeDates);
  const evaluatedStreakDayStates = createStreakDayStateMap(
    evaluateProgressStreakFreeze(activeDates, input.to).streakDays,
  );

  return createProgressSeriesDateRange(input).map((date): StreakDay => {
    const state: StreakDayState = activeDateSet.has(date)
      ? "reviewed"
      : evaluatedStreakDayStates.get(date) ?? (date >= input.to ? "pending" : "missed");

    return {
      date,
      state,
    };
  });
}

function areStreakDaysEqual(
  left: ReadonlyArray<StreakDay>,
  right: ReadonlyArray<StreakDay>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftDay = left[index];
    const rightDay = right[index];

    if (leftDay?.date !== rightDay?.date || leftDay?.state !== rightDay?.state) {
      return false;
    }
  }

  return true;
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
    streakDays: expandProgressStreakDays(input, series.streakDays),
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
  activeReviewLocalDates: ReadonlyArray<string>,
): ProgressSeries {
  const activeDates = [
    ...activeReviewLocalDates,
    ...activeDatesFromDailyReviews(dailyReviews),
  ];

  return {
    timeZone: input.timeZone,
    from: input.from,
    to: input.to,
    generatedAt: null,
    reviewHistoryWatermarks: [],
    dailyReviews: expandProgressDailyReviews(input, dailyReviews),
    streakDays: createProgressStreakDays(input, activeDates),
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
  localFallbackActiveDates: ReadonlyArray<string>,
): ProgressSeriesMergeResult {
  const pendingReviewCounts = buildDailyReviewPointMap(overlay?.dailyReviews ?? []);
  const localFallbackReviewCounts = localFallback === null
    ? new Map<string, DailyReviewPoint>()
    : buildDailyReviewPointMap(localFallback.dailyReviews);
  const normalizedServerBase = normalizeProgressSeries(serverBase);
  let hasOverlay = false;
  const reviewedOverlayDates = new Set<string>();
  const dailyReviews = normalizedServerBase.dailyReviews.map((day) => {
    const pendingReviewCount = pendingReviewCounts.get(day.date) ?? createEmptyDailyReviewPoint(day.date);
    const localFallbackReviewCount = localFallbackReviewCounts.get(day.date) ?? createEmptyDailyReviewPoint(day.date);
    const dayWithPendingOverlay = addDailyReviewPoints(day, pendingReviewCount);
    const reviewCount = Math.max(dayWithPendingOverlay.reviewCount, localFallbackReviewCount.reviewCount);

    if (reviewCount === day.reviewCount) {
      return day;
    }

    if (reviewCount > 0) {
      reviewedOverlayDates.add(day.date);
    }

    hasOverlay = true;
    return localFallbackReviewCount.reviewCount > dayWithPendingOverlay.reviewCount
      ? localFallbackReviewCount
      : dayWithPendingOverlay;
  });

  const mergedStreakDays = mergeProgressStreakDaysWithOverlay(
    normalizedServerBase,
    localFallbackActiveDates,
    reviewedOverlayDates,
  );
  const hasStreakDayOverlay = areStreakDaysEqual(mergedStreakDays, normalizedServerBase.streakDays) === false;

  if (hasOverlay === false && hasStreakDayOverlay === false) {
    return {
      series: normalizedServerBase,
      hasOverlay: false,
    };
  }

  return {
    series: {
      ...normalizedServerBase,
      dailyReviews,
      streakDays: mergedStreakDays,
    },
    hasOverlay: hasOverlay || hasStreakDayOverlay,
  };
}

function mergeProgressStreakDaysWithOverlay(
  normalizedServerBase: ProgressSeries,
  localFallbackActiveDates: ReadonlyArray<string>,
  reviewedOverlayDates: ReadonlySet<string>,
): ReadonlyArray<StreakDay> {
  const referenceLocalDate = normalizedServerBase.to;
  const hasLocalReviewOnReferenceDate = reviewedOverlayDates.has(referenceLocalDate)
    || localFallbackActiveDates.includes(referenceLocalDate);

  return normalizedServerBase.streakDays.map((day): StreakDay => {
    if (day.date !== referenceLocalDate || hasLocalReviewOnReferenceDate === false) {
      return day;
    }

    return {
      date: day.date,
      state: "reviewed",
    };
  });
}

export function buildRenderedSeries(
  serverBase: ProgressSeriesSnapshot | null,
  localFallback: ProgressSeriesSnapshot | null,
  localFallbackActiveDates: ReadonlyArray<string>,
  pendingLocalOverlay: ProgressChartData | null,
  canRenderServerBase: boolean,
): ProgressSeriesSnapshot | null {
  if (canRenderServerBase && serverBase !== null) {
    const mergeResult = mergeProgressSeriesWithOverlay(
      serverBase,
      pendingLocalOverlay,
      localFallback,
      localFallbackActiveDates,
    );
    return createProgressSeriesSnapshot(
      mergeResult.series,
      "server",
      mergeResult.hasOverlay,
    );
  }

  return localFallback;
}

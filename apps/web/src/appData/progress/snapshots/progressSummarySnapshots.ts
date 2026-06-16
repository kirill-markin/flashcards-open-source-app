import type {
  ProgressRenderedSeriesSummaryContext,
  ProgressSeries,
  ProgressSeriesSnapshot,
  ProgressSummary,
  ProgressSummaryPayload,
  ProgressSummarySnapshot,
} from "../../../types";
import {
  addReviewedDayToStreakFreeze,
  createDefaultStreakFreeze,
  evaluateProgressStreakFreeze,
} from "../../../progress/streakFreeze";
import {
  areProgressSummariesEqual,
} from "./progressSnapshotEquality";
import {
  buildDailyReviewCountMap,
  normalizeProgressSeries,
} from "./progressSeriesSnapshots";

export function createProgressSummarySnapshot(
  payload: ProgressSummaryPayload,
  source: ProgressSummarySnapshot["source"],
  isApproximate: boolean,
): ProgressSummarySnapshot {
  return {
    timeZone: payload.timeZone,
    generatedAt: payload.generatedAt,
    reviewHistoryWatermarks: payload.reviewHistoryWatermarks,
    summary: payload.summary,
    source,
    isApproximate,
  };
}

function maxLocalDate(
  first: string | null,
  second: string | null,
): string | null {
  if (first === null) {
    return second;
  }

  if (second === null) {
    return first;
  }

  return first >= second ? first : second;
}

function createEmptyProgressSummary(): ProgressSummary {
  return {
    currentStreakDays: 0,
    longestStreakDays: 0,
    hasReviewedToday: false,
    lastReviewedOn: null,
    activeReviewDays: 0,
    streakFreeze: createDefaultStreakFreeze(),
  };
}

function sortLocalDates(localDates: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...localDates].sort((leftDate, rightDate) => leftDate.localeCompare(rightDate));
}

function uniqueSortedLocalDates(localDates: ReadonlyArray<string>): ReadonlyArray<string> {
  return sortLocalDates([...new Set(localDates)]);
}

function activeDatesFromSeries(series: ProgressSeries): ReadonlyArray<string> {
  return uniqueSortedLocalDates(
    series.dailyReviews
      .filter((day) => day.reviewCount > 0)
      .map((day) => day.date),
  );
}

function summaryLowerBoundFromActiveDates(
  activeDates: ReadonlyArray<string>,
  today: string,
): ProgressSummary {
  const sortedActiveDates = uniqueSortedLocalDates(activeDates);

  if (sortedActiveDates.length === 0) {
    return createEmptyProgressSummary();
  }

  const activeDateSet = new Set(sortedActiveDates);
  const streakFreezeEvaluation = evaluateProgressStreakFreeze(sortedActiveDates, today);
  const hasReviewedToday = activeDateSet.has(today);

  return {
    currentStreakDays: streakFreezeEvaluation.currentStreakDays,
    longestStreakDays: streakFreezeEvaluation.longestStreakDays,
    hasReviewedToday,
    lastReviewedOn: sortedActiveDates.at(-1) ?? null,
    activeReviewDays: sortedActiveDates.length,
    streakFreeze: streakFreezeEvaluation.streakFreeze,
  };
}

function validateProgressSeriesPairInputs(
  serverBase: ProgressSeries,
  renderedSeries: ProgressSeries,
): void {
  if (
    serverBase.timeZone === renderedSeries.timeZone
    && serverBase.from === renderedSeries.from
    && serverBase.to === renderedSeries.to
  ) {
    return;
  }

  throw new Error(
    `Progress series summary context inputs must share the same range. serverBase=${serverBase.timeZone} ${serverBase.from}...${serverBase.to}, renderedSeries=${renderedSeries.timeZone} ${renderedSeries.from}...${renderedSeries.to}.`,
  );
}

function activeDatesMissingFromServerBase(
  serverBase: ProgressSeries,
  renderedSeries: ProgressSeries,
): ReadonlyArray<string> {
  validateProgressSeriesPairInputs(serverBase, renderedSeries);

  const normalizedServerBase = normalizeProgressSeries(serverBase);
  const normalizedRenderedSeries = normalizeProgressSeries(renderedSeries);
  const serverReviewCounts = buildDailyReviewCountMap(normalizedServerBase.dailyReviews);

  return normalizedRenderedSeries.dailyReviews
    .filter((day) => day.reviewCount > 0 && (serverReviewCounts.get(day.date) ?? 0) === 0)
    .map((day) => day.date);
}

export function createProgressRenderedSeriesSummaryContext(
  serverBase: ProgressSeriesSnapshot | null,
  renderedSeries: ProgressSeriesSnapshot | null,
): ProgressRenderedSeriesSummaryContext | null {
  if (renderedSeries === null) {
    return null;
  }

  const activeDates = activeDatesFromSeries(renderedSeries);
  const activeDatesMissingFromServerBaseResult = serverBase === null
    ? []
    : activeDatesMissingFromServerBase(serverBase, renderedSeries);

  return {
    lowerBoundSummary: summaryLowerBoundFromActiveDates(activeDates, renderedSeries.to),
    activeDates,
    activeDatesMissingFromServerBase: activeDatesMissingFromServerBaseResult,
  };
}

function hasLocalReferenceReview(
  localFallbackActiveDates: ReadonlyArray<string>,
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null,
  referenceLocalDate: string,
): boolean {
  if (localFallbackActiveDates.includes(referenceLocalDate)) {
    return true;
  }

  return renderedSeriesContext?.activeDatesMissingFromServerBase.includes(referenceLocalDate) ?? false;
}

function hasProgressSummaryOverlay(
  mergedPayload: ProgressSummaryPayload,
  serverBase: ProgressSummarySnapshot,
): boolean {
  return areProgressSummariesEqual(mergedPayload.summary, serverBase.summary) === false;
}

function mergeProgressSummary(
  serverBase: ProgressSummarySnapshot,
  localFallbackActiveDates: ReadonlyArray<string>,
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null,
  referenceLocalDate: string,
): ProgressSummaryPayload {
  const hasReferenceReviewOverlay = serverBase.summary.hasReviewedToday === false && hasLocalReferenceReview(
    localFallbackActiveDates,
    renderedSeriesContext,
    referenceLocalDate,
  );
  const currentStreakDays = hasReferenceReviewOverlay
    ? Math.max(1, serverBase.summary.currentStreakDays + 1)
    : serverBase.summary.currentStreakDays;
  const summary = hasReferenceReviewOverlay
    ? {
      ...serverBase.summary,
      currentStreakDays,
      longestStreakDays: Math.max(serverBase.summary.longestStreakDays, currentStreakDays),
      hasReviewedToday: true,
      lastReviewedOn: maxLocalDate(serverBase.summary.lastReviewedOn, referenceLocalDate),
      activeReviewDays: serverBase.summary.activeReviewDays + 1,
      streakFreeze: addReviewedDayToStreakFreeze(serverBase.summary.streakFreeze),
    }
    : serverBase.summary;

  return {
    timeZone: serverBase.timeZone,
    generatedAt: serverBase.generatedAt,
    reviewHistoryWatermarks: serverBase.reviewHistoryWatermarks,
    summary,
  };
}

export function buildRenderedSummary(
  serverBase: ProgressSummarySnapshot | null,
  localFallback: ProgressSummarySnapshot | null,
  localFallbackActiveDates: ReadonlyArray<string>,
  hasPendingLocalReviews: boolean,
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null,
  referenceLocalDate: string | null,
  canRenderServerBase: boolean,
): ProgressSummarySnapshot | null {
  if (canRenderServerBase && serverBase !== null) {
    if (referenceLocalDate === null) {
      throw new Error("Progress summary reference local date is required when rendering a server summary.");
    }

    const mergedPayload = mergeProgressSummary(
      serverBase,
      localFallbackActiveDates,
      renderedSeriesContext,
      referenceLocalDate,
    );

    if (hasPendingLocalReviews || hasProgressSummaryOverlay(mergedPayload, serverBase)) {
      return createProgressSummarySnapshot(
        mergedPayload,
        "server",
        true,
      );
    }

    return serverBase;
  }

  return localFallback;
}

import type {
  ProgressRenderedSeriesSummaryContext,
  ProgressReviewHistoryWatermark,
  ProgressSeries,
  ProgressSeriesSnapshot,
  ProgressSummary,
  ProgressSummaryPayload,
  ProgressSummarySnapshot,
} from "../../../types";
import { shiftLocalDate } from "../../../progress/progressDates";
import {
  areProgressReviewHistoryWatermarksEqual,
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
    hasReviewedToday: false,
    lastReviewedOn: null,
    activeReviewDays: 0,
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
  const hasReviewedToday = activeDateSet.has(today);
  let currentDate = hasReviewedToday ? today : shiftLocalDate(today, -1);
  let currentStreakDays = 0;

  while (activeDateSet.has(currentDate)) {
    currentStreakDays += 1;
    currentDate = shiftLocalDate(currentDate, -1);
  }

  return {
    currentStreakDays,
    hasReviewedToday,
    lastReviewedOn: sortedActiveDates.at(-1) ?? null,
    activeReviewDays: sortedActiveDates.length,
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
    serverBaseReviewHistoryWatermarks: serverBase?.reviewHistoryWatermarks ?? null,
  };
}

function serverAndSeriesShareReviewHistoryBase(
  serverBaseReviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark>,
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null,
): boolean {
  const seriesBaseReviewHistoryWatermarks = renderedSeriesContext?.serverBaseReviewHistoryWatermarks;

  if (seriesBaseReviewHistoryWatermarks === null || seriesBaseReviewHistoryWatermarks === undefined) {
    return false;
  }

  return areProgressReviewHistoryWatermarksEqual(
    serverBaseReviewHistoryWatermarks,
    seriesBaseReviewHistoryWatermarks,
  );
}

function localFallbackActiveReviewDayDeltaCandidates(
  localFallbackActiveDates: ReadonlyArray<string>,
  serverBase: ProgressSummary,
): ReadonlyArray<string> {
  const serverLastReviewedOn = serverBase.lastReviewedOn;

  if (serverLastReviewedOn === null) {
    return localFallbackActiveDates;
  }

  return localFallbackActiveDates.filter((localDate) => localDate > serverLastReviewedOn);
}

function activeReviewDayDeltaCandidates(
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null,
  localFallbackActiveDates: ReadonlyArray<string>,
  serverBase: ProgressSummary,
  hasSharedServerAndSeriesReviewHistoryBase: boolean,
): ReadonlyArray<string> {
  const renderedSeriesCandidates = renderedSeriesContext === null
    ? []
    : hasSharedServerAndSeriesReviewHistoryBase
      ? renderedSeriesContext.activeDatesMissingFromServerBase
      : renderedSeriesContext.activeDates;

  return uniqueSortedLocalDates([
    ...renderedSeriesCandidates,
    ...localFallbackActiveReviewDayDeltaCandidates(localFallbackActiveDates, serverBase),
  ]);
}

function shouldApplyActiveReviewDayDelta(
  localDate: string,
  serverBase: ProgressSummary,
  hasSharedServerAndSeriesReviewHistoryBase: boolean,
  referenceLocalDate: string,
): boolean {
  if (localDate === referenceLocalDate && serverBase.hasReviewedToday) {
    return false;
  }

  if (hasSharedServerAndSeriesReviewHistoryBase) {
    return true;
  }

  if (serverBase.lastReviewedOn === null) {
    return true;
  }

  return localDate > serverBase.lastReviewedOn;
}

function activeReviewDayDelta(
  deltaCandidates: ReadonlyArray<string>,
  serverBase: ProgressSummary,
  hasSharedServerAndSeriesReviewHistoryBase: boolean,
  referenceLocalDate: string,
): number {
  return deltaCandidates.filter((localDate) => shouldApplyActiveReviewDayDelta(
    localDate,
    serverBase,
    hasSharedServerAndSeriesReviewHistoryBase,
    referenceLocalDate,
  )).length;
}

function currentStreakDaysWithLocalDelta(
  serverBase: ProgressSummary,
  localFallbackActiveDates: ReadonlyArray<string>,
  renderedSeriesActiveDates: ReadonlyArray<string>,
  referenceLocalDate: string,
): number {
  if (serverBase.hasReviewedToday || serverBase.currentStreakDays === 0) {
    return serverBase.currentStreakDays;
  }

  if (serverBase.lastReviewedOn === null) {
    return serverBase.currentStreakDays;
  }

  const activeDateSet = new Set([
    ...localFallbackActiveDates,
    ...renderedSeriesActiveDates,
  ]);
  let currentDate = shiftLocalDate(serverBase.lastReviewedOn, 1);
  let continuousLocalDelta = 0;

  while (currentDate <= referenceLocalDate && activeDateSet.has(currentDate)) {
    continuousLocalDelta += 1;
    currentDate = shiftLocalDate(currentDate, 1);
  }

  return serverBase.currentStreakDays + continuousLocalDelta;
}

function hasProgressSummaryOverlay(
  mergedPayload: ProgressSummaryPayload,
  serverBase: ProgressSummarySnapshot,
): boolean {
  return areProgressSummariesEqual(mergedPayload.summary, serverBase.summary) === false;
}

function mergeProgressSummary(
  serverBase: ProgressSummarySnapshot,
  localFallback: ProgressSummarySnapshot | null,
  localFallbackActiveDates: ReadonlyArray<string>,
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null,
  referenceLocalDate: string,
): ProgressSummaryPayload {
  const localFallbackSummary = localFallback?.summary ?? createEmptyProgressSummary();
  const renderedSeriesLowerBound = renderedSeriesContext?.lowerBoundSummary;
  const hasSharedServerAndSeriesReviewHistoryBase = serverAndSeriesShareReviewHistoryBase(
    serverBase.reviewHistoryWatermarks,
    renderedSeriesContext,
  );
  const serverActiveReviewDaysWithLocalDelta = serverBase.summary.activeReviewDays + activeReviewDayDelta(
    activeReviewDayDeltaCandidates(
      renderedSeriesContext,
      localFallbackActiveDates,
      serverBase.summary,
      hasSharedServerAndSeriesReviewHistoryBase,
    ),
    serverBase.summary,
    hasSharedServerAndSeriesReviewHistoryBase,
    referenceLocalDate,
  );
  const serverCurrentStreakDaysWithLocalDelta = currentStreakDaysWithLocalDelta(
    serverBase.summary,
    localFallbackActiveDates,
    renderedSeriesContext?.activeDates ?? [],
    referenceLocalDate,
  );

  return {
    timeZone: serverBase.timeZone,
    generatedAt: serverBase.generatedAt,
    reviewHistoryWatermarks: serverBase.reviewHistoryWatermarks,
    summary: {
      currentStreakDays: Math.max(
        serverCurrentStreakDaysWithLocalDelta,
        localFallbackSummary.currentStreakDays,
        renderedSeriesLowerBound?.currentStreakDays ?? 0,
      ),
      hasReviewedToday: serverBase.summary.hasReviewedToday
        || localFallbackSummary.hasReviewedToday
        || (renderedSeriesLowerBound?.hasReviewedToday ?? false),
      lastReviewedOn: maxLocalDate(
        maxLocalDate(
          serverBase.summary.lastReviewedOn,
          localFallbackSummary.lastReviewedOn,
        ),
        renderedSeriesLowerBound?.lastReviewedOn ?? null,
      ),
      activeReviewDays: Math.max(
        serverActiveReviewDaysWithLocalDelta,
        localFallbackSummary.activeReviewDays,
        renderedSeriesLowerBound?.activeReviewDays ?? 0,
      ),
    },
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
      localFallback,
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

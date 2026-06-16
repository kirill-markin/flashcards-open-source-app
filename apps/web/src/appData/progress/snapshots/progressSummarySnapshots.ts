import type {
  ProgressRenderedSeriesSummaryContext,
  ProgressReviewHistoryWatermark,
  ProgressSeries,
  ProgressSeriesSnapshot,
  ProgressSummary,
  ProgressSummaryPayload,
  ProgressSummarySnapshot,
  StreakFreeze,
} from "../../../types";
import {
  addReviewedDayToStreakFreeze,
  createDefaultStreakFreeze,
  evaluateProgressStreakFreeze,
  evaluateProgressStreakFreezeFromCarryState,
  streakFreezePolicy,
  type StreakFreezeCarryState,
} from "../../../progress/streakFreeze";
import { shiftLocalDate } from "../../../progress/progressDates";
import {
  areProgressReviewHistoryWatermarksEqual,
  areProgressSummariesEqual,
} from "./progressSnapshotEquality";
import {
  buildDailyReviewCountMap,
  createExactRenderedSeriesStreakFreeze,
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
  const exactStreakFreeze = serverBase === null
    ? null
    : createExactRenderedSeriesStreakFreeze(serverBase, renderedSeries);

  return {
    lowerBoundSummary: summaryLowerBoundFromActiveDates(activeDates, renderedSeries.to),
    exactStreakFreeze,
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

function currentStreakDaysWithLocalDelta(
  serverBase: ProgressSummary,
  appliedActiveReviewDayDeltaCandidates: ReadonlyArray<string>,
  referenceLocalDate: string,
): number {
  if (serverBase.hasReviewedToday) {
    return serverBase.currentStreakDays;
  }

  if (appliedActiveReviewDayDeltaCandidates.includes(referenceLocalDate) === false) {
    return serverBase.currentStreakDays;
  }

  if (serverBase.currentStreakDays <= 0) {
    return 1;
  }

  return serverBase.currentStreakDays + 1;
}

function countCompletedNonReviewedDaysAfterLastReview(
  lastReviewedOn: string,
  referenceLocalDate: string,
): number {
  let completedDays = 0;

  for (
    let localDate = shiftLocalDate(lastReviewedOn, 1);
    localDate < referenceLocalDate;
    localDate = shiftLocalDate(localDate, 1)
  ) {
    completedDays += 1;
  }

  return completedDays;
}

function reverseFrozenDayBalanceUnits(balanceUnits: number): number | null {
  const reversedBalanceUnits = balanceUnits
    + streakFreezePolicy.unitsPerCredit
    - streakFreezePolicy.earnedUnitsPerStreakDay;
  const maximumBalanceUnits = streakFreezePolicy.maxCapacity * streakFreezePolicy.unitsPerCredit;

  return reversedBalanceUnits > maximumBalanceUnits
    ? null
    : reversedBalanceUnits;
}

function createCarryStateAtLastReviewedDate(
  serverBase: ProgressSummary,
  referenceLocalDate: string,
): StreakFreezeCarryState | null {
  if (serverBase.lastReviewedOn === null || serverBase.lastReviewedOn >= referenceLocalDate) {
    return null;
  }

  const completedNonReviewedDays = countCompletedNonReviewedDaysAfterLastReview(
    serverBase.lastReviewedOn,
    referenceLocalDate,
  );
  if (serverBase.currentStreakDays <= completedNonReviewedDays) {
    return null;
  }

  let balanceUnits = serverBase.streakFreeze.balanceUnits;
  for (let index = 0; index < completedNonReviewedDays; index += 1) {
    const reversedBalanceUnits = reverseFrozenDayBalanceUnits(balanceUnits);
    if (reversedBalanceUnits === null) {
      return null;
    }

    balanceUnits = reversedBalanceUnits;
  }

  const currentStreakDays = serverBase.currentStreakDays - completedNonReviewedDays;

  return {
    balanceUnits,
    currentStreakDays,
    longestStreakDays: Math.max(serverBase.longestStreakDays, currentStreakDays),
    hasActiveSegment: true,
    lastEvaluatedDate: serverBase.lastReviewedOn,
  };
}

function exactServerSummaryWithLocalDelta(
  serverBase: ProgressSummary,
  appliedActiveReviewDayDeltaCandidates: ReadonlyArray<string>,
  referenceLocalDate: string,
): ProgressSummary | null {
  if (appliedActiveReviewDayDeltaCandidates.length === 0) {
    return serverBase;
  }

  const carryState = createCarryStateAtLastReviewedDate(serverBase, referenceLocalDate);
  if (carryState === null) {
    return null;
  }

  const activeDates = appliedActiveReviewDayDeltaCandidates.filter((localDate) => (
    carryState.lastEvaluatedDate !== null && localDate > carryState.lastEvaluatedDate
  ));
  if (activeDates.length !== appliedActiveReviewDayDeltaCandidates.length) {
    return null;
  }

  const evaluation = evaluateProgressStreakFreezeFromCarryState(
    activeDates,
    referenceLocalDate,
    carryState,
  );

  return {
    ...serverBase,
    currentStreakDays: evaluation.currentStreakDays,
    longestStreakDays: Math.max(serverBase.longestStreakDays, evaluation.longestStreakDays),
    hasReviewedToday: serverBase.hasReviewedToday || activeDates.includes(referenceLocalDate),
    lastReviewedOn: maxLocalDate(serverBase.lastReviewedOn, activeDates.at(-1) ?? null),
    activeReviewDays: serverBase.activeReviewDays + activeDates.length,
    streakFreeze: evaluation.streakFreeze,
  };
}

function streakFreezeWithLocalDelta(
  serverBase: ProgressSummary,
  appliedActiveReviewDayDeltaCandidates: ReadonlyArray<string>,
  referenceLocalDate: string,
  exactStreakFreeze: StreakFreeze | null,
  exactServerSummary: ProgressSummary | null,
): StreakFreeze {
  if (appliedActiveReviewDayDeltaCandidates.length === 0) {
    return serverBase.streakFreeze;
  }

  if (exactStreakFreeze !== null) {
    return exactStreakFreeze;
  }

  if (exactServerSummary !== null) {
    return exactServerSummary.streakFreeze;
  }

  if (serverBase.hasReviewedToday) {
    return serverBase.streakFreeze;
  }

  if (
    appliedActiveReviewDayDeltaCandidates.length === 1
    && appliedActiveReviewDayDeltaCandidates[0] === referenceLocalDate
  ) {
    return addReviewedDayToStreakFreeze(serverBase.streakFreeze);
  }

  return serverBase.streakFreeze;
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
  const exactStreakFreeze = hasSharedServerAndSeriesReviewHistoryBase
    ? renderedSeriesContext?.exactStreakFreeze ?? null
    : null;
  const reviewDayDeltaCandidates = activeReviewDayDeltaCandidates(
    renderedSeriesContext,
    localFallbackActiveDates,
    serverBase.summary,
    hasSharedServerAndSeriesReviewHistoryBase,
  );
  const appliedActiveReviewDayDeltaCandidates = reviewDayDeltaCandidates.filter((localDate) => (
    shouldApplyActiveReviewDayDelta(
      localDate,
      serverBase.summary,
      hasSharedServerAndSeriesReviewHistoryBase,
      referenceLocalDate,
    )
  ));
  const serverActiveReviewDaysWithLocalDelta = serverBase.summary.activeReviewDays
    + appliedActiveReviewDayDeltaCandidates.length;
  const exactServerSummary = exactServerSummaryWithLocalDelta(
    serverBase.summary,
    appliedActiveReviewDayDeltaCandidates,
    referenceLocalDate,
  );
  const serverCurrentStreakDaysWithLocalDelta = currentStreakDaysWithLocalDelta(
    serverBase.summary,
    appliedActiveReviewDayDeltaCandidates,
    referenceLocalDate,
  );
  const serverSummaryWithLocalDelta: ProgressSummary = {
    ...serverBase.summary,
    currentStreakDays: exactServerSummary?.currentStreakDays ?? serverCurrentStreakDaysWithLocalDelta,
    longestStreakDays: Math.max(
      serverBase.summary.longestStreakDays,
      exactServerSummary?.longestStreakDays ?? serverCurrentStreakDaysWithLocalDelta,
    ),
    streakFreeze: streakFreezeWithLocalDelta(
      serverBase.summary,
      appliedActiveReviewDayDeltaCandidates,
      referenceLocalDate,
      exactStreakFreeze,
      exactServerSummary,
    ),
  };
  const mergedCurrentStreakDays = Math.max(
    serverSummaryWithLocalDelta.currentStreakDays,
    localFallbackSummary.currentStreakDays,
    renderedSeriesLowerBound?.currentStreakDays ?? 0,
  );

  return {
    timeZone: serverBase.timeZone,
    generatedAt: serverBase.generatedAt,
    reviewHistoryWatermarks: serverBase.reviewHistoryWatermarks,
    summary: {
      currentStreakDays: mergedCurrentStreakDays,
      longestStreakDays: Math.max(
        serverSummaryWithLocalDelta.longestStreakDays,
        localFallbackSummary.longestStreakDays,
        renderedSeriesLowerBound?.longestStreakDays ?? 0,
        mergedCurrentStreakDays,
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
      streakFreeze: serverSummaryWithLocalDelta.streakFreeze,
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

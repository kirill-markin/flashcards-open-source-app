import type {
  DailyReviewPoint,
  ProgressChartData,
  ProgressSeries,
  ProgressSeriesInput,
  ProgressSeriesSnapshot,
  StreakDay,
  StreakDayState,
  StreakFreeze,
} from "../../../types";
import { shiftLocalDate } from "../../../progress/progressDates";
import {
  createDefaultStreakFreeze,
  evaluateProgressStreakFreeze,
  evaluateProgressStreakFreezeFromCarryState,
  streakFreezePolicy,
  type StreakFreezeCarryState,
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

function activeDatesInRange(
  input: ProgressSeriesInput,
  activeReviewLocalDates: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return uniqueSortedLocalDates(activeReviewLocalDates.filter((date) => (
    date >= input.from && date <= input.to
  )));
}

function createProgressStreakDaysFromCarryState(
  input: ProgressSeriesInput,
  activeReviewLocalDates: ReadonlyArray<string>,
  carryState: StreakFreezeCarryState,
): ReadonlyArray<StreakDay> {
  return createProgressStreakCarryEvaluation(input, activeReviewLocalDates, carryState).streakDays;
}

type ProgressStreakCarryEvaluation = Readonly<{
  streakDays: ReadonlyArray<StreakDay>;
  streakFreeze: StreakFreeze;
}>;

function createProgressStreakCarryEvaluation(
  input: ProgressSeriesInput,
  activeReviewLocalDates: ReadonlyArray<string>,
  carryState: StreakFreezeCarryState,
): ProgressStreakCarryEvaluation {
  const activeDates = uniqueSortedLocalDates(activeReviewLocalDates.filter((date) => (
    date <= input.to && (carryState.lastEvaluatedDate === null || date > carryState.lastEvaluatedDate)
  )));
  const activeDateSet = new Set(activeDates);
  const evaluation = evaluateProgressStreakFreezeFromCarryState(activeDates, input.to, carryState);
  const evaluatedStreakDayStates = createStreakDayStateMap(evaluation.streakDays);

  return {
    streakFreeze: evaluation.streakFreeze,
    streakDays: createProgressSeriesDateRange(input).map((date): StreakDay => {
      const state: StreakDayState = activeDateSet.has(date)
        ? "reviewed"
        : evaluatedStreakDayStates.get(date) ?? (date >= input.to ? "pending" : "missed");

      return {
        date,
        state,
      };
    }),
  };
}

function createPossibleCarryStatesBeforeDate(firstDate: string): ReadonlyArray<StreakFreezeCarryState> {
  const lastEvaluatedDate = shiftLocalDate(firstDate, -1);
  const maximumBalanceUnits = streakFreezePolicy.maxCapacity * streakFreezePolicy.unitsPerCredit;
  const inactiveCarryState: StreakFreezeCarryState = {
    balanceUnits: createDefaultStreakFreeze().balanceUnits,
    currentStreakDays: 0,
    longestStreakDays: 0,
    hasActiveSegment: false,
    lastEvaluatedDate,
  };
  const activeCarryStates: Array<StreakFreezeCarryState> = [];

  for (let balanceUnits = 0; balanceUnits <= maximumBalanceUnits; balanceUnits += 1) {
    activeCarryStates.push({
      balanceUnits,
      currentStreakDays: 1,
      longestStreakDays: 1,
      hasActiveSegment: true,
      lastEvaluatedDate,
    });
  }

  return [
    inactiveCarryState,
    ...activeCarryStates,
  ];
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

function selectUniqueStreakDays(
  candidateStreakDays: ReadonlyArray<ReadonlyArray<StreakDay>>,
): ReadonlyArray<StreakDay> | null {
  const firstCandidate = candidateStreakDays[0];
  if (firstCandidate === undefined) {
    return null;
  }

  if (candidateStreakDays.every((candidate) => areStreakDaysEqual(candidate, firstCandidate)) === false) {
    return null;
  }

  return firstCandidate;
}

function areStreakFreezesEqual(left: StreakFreeze, right: StreakFreeze): boolean {
  return left.availableCredits === right.availableCredits
    && left.capacity === right.capacity
    && left.balanceUnits === right.balanceUnits
    && left.unitsPerCredit === right.unitsPerCredit
    && left.nextCreditProgressUnits === right.nextCreditProgressUnits
    && left.nextCreditRequiredUnits === right.nextCreditRequiredUnits;
}

function selectUniqueStreakFreeze(streakFreezes: ReadonlyArray<StreakFreeze>): StreakFreeze | null {
  const firstStreakFreeze = streakFreezes[0];
  if (firstStreakFreeze === undefined) {
    return null;
  }

  if (streakFreezes.every((streakFreeze) => areStreakFreezesEqual(streakFreeze, firstStreakFreeze)) === false) {
    return null;
  }

  return firstStreakFreeze;
}

function validateProgressSeriesPairInputs(serverBase: ProgressSeries, renderedSeries: ProgressSeries): void {
  if (
    serverBase.timeZone === renderedSeries.timeZone
    && serverBase.from === renderedSeries.from
    && serverBase.to === renderedSeries.to
  ) {
    return;
  }

  throw new Error(
    `Progress series overlay inputs must share the same range. serverBase=${serverBase.timeZone} ${serverBase.from}...${serverBase.to}, renderedSeries=${renderedSeries.timeZone} ${renderedSeries.from}...${renderedSeries.to}.`,
  );
}

export function createExactRenderedSeriesStreakFreeze(
  serverBase: ProgressSeries,
  renderedSeries: ProgressSeries,
): StreakFreeze | null {
  validateProgressSeriesPairInputs(serverBase, renderedSeries);

  const normalizedServerBase = normalizeProgressSeries(serverBase);
  const normalizedRenderedSeries = normalizeProgressSeries(renderedSeries);
  const input: ProgressSeriesInput = {
    timeZone: normalizedServerBase.timeZone,
    from: normalizedServerBase.from,
    to: normalizedServerBase.to,
  };
  const serverActiveDates = activeDatesInRange(input, activeDatesFromDailyReviews(normalizedServerBase.dailyReviews));
  const renderedActiveDates = activeDatesInRange(input, activeDatesFromDailyReviews(normalizedRenderedSeries.dailyReviews));
  const candidateOverlayEvaluations = createPossibleCarryStatesBeforeDate(input.from)
    .filter((carryState) => areStreakDaysEqual(
      createProgressStreakCarryEvaluation(input, serverActiveDates, carryState).streakDays,
      normalizedServerBase.streakDays,
    ))
    .map((carryState) => createProgressStreakCarryEvaluation(input, renderedActiveDates, carryState))
    .filter((evaluation) => areStreakDaysEqual(evaluation.streakDays, normalizedRenderedSeries.streakDays));

  return selectUniqueStreakFreeze(candidateOverlayEvaluations.map((evaluation) => evaluation.streakFreeze));
}

function createExactOverlayStreakDays(
  normalizedServerBase: ProgressSeries,
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
  localFallbackActiveDates: ReadonlyArray<string>,
): ReadonlyArray<StreakDay> | null {
  const visibleInput: ProgressSeriesInput = {
    timeZone: normalizedServerBase.timeZone,
    from: normalizedServerBase.from,
    to: normalizedServerBase.to,
  };
  const overlayActiveDates = uniqueSortedLocalDates([
    ...localFallbackActiveDates,
    ...activeDatesFromDailyReviews(dailyReviews),
  ]);
  const evaluationInput: ProgressSeriesInput = {
    ...visibleInput,
    from: findStreakOverlayEvaluationStartDate(visibleInput, overlayActiveDates),
  };
  const serverActiveDates = activeDatesInRange(
    evaluationInput,
    activeDatesFromDailyReviews(normalizedServerBase.dailyReviews),
  );
  const overlayActiveDatesInEvaluation = activeDatesInRange(evaluationInput, overlayActiveDates);
  const candidateOverlayStreakDays = createPossibleCarryStatesBeforeDate(evaluationInput.from)
    .filter((carryState) => areStreakDaysEqual(
      filterStreakDaysToInput(
        visibleInput,
        createProgressStreakDaysFromCarryState(evaluationInput, serverActiveDates, carryState),
      ),
      normalizedServerBase.streakDays,
    ))
    .map((carryState) => filterStreakDaysToInput(
      visibleInput,
      createProgressStreakDaysFromCarryState(evaluationInput, overlayActiveDatesInEvaluation, carryState),
    ));

  return selectUniqueStreakDays(candidateOverlayStreakDays);
}

function findStreakOverlayEvaluationStartDate(
  input: ProgressSeriesInput,
  overlayActiveDates: ReadonlyArray<string>,
): string {
  return overlayActiveDates.find((date) => date < input.from) ?? input.from;
}

function filterStreakDaysToInput(
  input: ProgressSeriesInput,
  streakDays: ReadonlyArray<StreakDay>,
): ReadonlyArray<StreakDay> {
  return streakDays.filter((day) => day.date >= input.from && day.date <= input.to);
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
    dailyReviews,
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
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
  localFallbackActiveDates: ReadonlyArray<string>,
  reviewedOverlayDates: ReadonlySet<string>,
): ReadonlyArray<StreakDay> {
  const exactOverlayStreakDays = createExactOverlayStreakDays(
    normalizedServerBase,
    dailyReviews,
    localFallbackActiveDates,
  );
  if (exactOverlayStreakDays !== null) {
    return exactOverlayStreakDays;
  }

  const earliestReviewedOverlayDate = findEarliestLocalDate(reviewedOverlayDates);
  const recomputeStartDate = findStreakRecomputeStartDate(
    normalizedServerBase.streakDays,
    earliestReviewedOverlayDate,
  ) ?? (
    earliestReviewedOverlayDate === null
      ? findEarliestLocalDateBefore(localFallbackActiveDates, normalizedServerBase.from)
      : null
  );
  const recomputedStreakDayMap = recomputeStartDate === null
    ? new Map<string, StreakDay>()
    : createStreakDayMap(createProgressStreakDays({
      timeZone: normalizedServerBase.timeZone,
      from: recomputeStartDate,
      to: normalizedServerBase.to,
    }, [
      ...localFallbackActiveDates,
      ...activeDatesFromDailyReviews(dailyReviews),
    ].filter((date) => date >= recomputeStartDate)));

  return normalizedServerBase.streakDays.map((day): StreakDay => {
    const recomputedDay = recomputedStreakDayMap.get(day.date);
    if (recomputedDay !== undefined) {
      return recomputedDay;
    }

    if (reviewedOverlayDates.has(day.date) === false) {
      return day;
    }

    return {
      date: day.date,
      state: "reviewed",
    };
  });
}

function createStreakDayMap(streakDays: ReadonlyArray<StreakDay>): ReadonlyMap<string, StreakDay> {
  return new Map(streakDays.map((day) => [day.date, day]));
}

function findEarliestLocalDate(localDates: ReadonlySet<string>): string | null {
  let earliestLocalDate: string | null = null;

  for (const localDate of localDates) {
    if (earliestLocalDate === null || localDate < earliestLocalDate) {
      earliestLocalDate = localDate;
    }
  }

  return earliestLocalDate;
}

function findEarliestLocalDateBefore(
  localDates: ReadonlyArray<string>,
  endExclusiveDate: string,
): string | null {
  let earliestLocalDate: string | null = null;

  for (const localDate of localDates) {
    if (localDate >= endExclusiveDate) {
      continue;
    }

    if (earliestLocalDate === null || localDate < earliestLocalDate) {
      earliestLocalDate = localDate;
    }
  }

  return earliestLocalDate;
}

function findStreakRecomputeStartDate(
  serverBaseStreakDays: ReadonlyArray<StreakDay>,
  earliestReviewedOverlayDate: string | null,
): string | null {
  if (earliestReviewedOverlayDate === null) {
    return null;
  }

  let latestMissedDateBeforeOverlay: string | null = null;

  for (const day of serverBaseStreakDays) {
    if (day.date >= earliestReviewedOverlayDate) {
      break;
    }

    if (day.state === "missed") {
      latestMissedDateBeforeOverlay = day.date;
    }
  }

  return latestMissedDateBeforeOverlay === null
    ? null
    : shiftLocalDate(latestMissedDateBeforeOverlay, 1);
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

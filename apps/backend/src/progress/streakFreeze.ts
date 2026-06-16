export const streakFreezePolicy: StreakFreezePolicy = {
  startCapacity: 2,
  maxCapacity: 2,
  unitsPerCredit: 10,
  earnedUnitsPerStreakDay: 1,
};

export const streakDayStates = [
  "reviewed",
  "frozen",
  "missed",
  "pending",
] as const;

export type StreakDayState = typeof streakDayStates[number];

export type StreakFreezePolicy = Readonly<{
  startCapacity: number;
  maxCapacity: number;
  unitsPerCredit: number;
  earnedUnitsPerStreakDay: number;
}>;

export type StreakFreeze = Readonly<{
  availableCredits: number;
  capacity: number;
  balanceUnits: number;
  unitsPerCredit: number;
  earnedUnitsPerStreakDay: number;
  nextCreditProgressUnits: number;
  nextCreditRequiredUnits: number;
}>;

export type StreakDay = Readonly<{
  date: string;
  state: StreakDayState;
}>;

export type StreakFreezeEvaluation = Readonly<{
  currentStreakDays: number;
  longestStreakDays: number;
  streakFreeze: StreakFreeze;
  streakDays: ReadonlyArray<StreakDay>;
}>;

type StreakComputationState = Readonly<{
  balanceUnits: number;
  currentStreakDays: number;
  longestStreakDays: number;
  hasActiveSegment: boolean;
  lastEvaluatedDate: string | null;
}>;

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseLocalDatePart(value: string, start: number, end: number): number {
  return Number.parseInt(value.slice(start, end), 10);
}

function assertLocalDate(value: string, fieldName: string): void {
  if (!localDatePattern.test(value)) {
    throw new Error(`${fieldName} must be a YYYY-MM-DD date`);
  }

  const year = parseLocalDatePart(value, 0, 4);
  const month = parseLocalDatePart(value, 5, 7);
  const day = parseLocalDatePart(value, 8, 10);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} must be a YYYY-MM-DD date`);
  }
}

function createUtcDateFromLocalDate(value: string): Date {
  const year = parseLocalDatePart(value, 0, 4);
  const month = parseLocalDatePart(value, 5, 7);
  const day = parseLocalDatePart(value, 8, 10);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDateAsLocalDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftLocalDate(value: string, offsetDays: number): string {
  const date = createUtcDateFromLocalDate(value);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatUtcDateAsLocalDate(date);
}

function validateStreakFreezePolicy(policy: StreakFreezePolicy): void {
  if (!Number.isInteger(policy.startCapacity) || policy.startCapacity < 0) {
    throw new Error("streak freeze startCapacity must be a non-negative integer");
  }

  if (!Number.isInteger(policy.maxCapacity) || policy.maxCapacity < 0) {
    throw new Error("streak freeze maxCapacity must be a non-negative integer");
  }

  if (!Number.isInteger(policy.unitsPerCredit) || policy.unitsPerCredit <= 0) {
    throw new Error("streak freeze unitsPerCredit must be a positive integer");
  }

  if (!Number.isInteger(policy.earnedUnitsPerStreakDay) || policy.earnedUnitsPerStreakDay < 0) {
    throw new Error("streak freeze earnedUnitsPerStreakDay must be a non-negative integer");
  }
}

function assertSortedActiveReviewLocalDates(sortedActiveReviewLocalDates: ReadonlyArray<string>): void {
  let previousDate: string | null = null;

  for (const reviewDate of sortedActiveReviewLocalDates) {
    assertLocalDate(reviewDate, "active review local date");
    if (previousDate !== null && previousDate >= reviewDate) {
      throw new Error("active review local dates must be sorted ascending without duplicates");
    }

    previousDate = reviewDate;
  }
}

function getMaximumBalanceUnits(policy: StreakFreezePolicy): number {
  return policy.maxCapacity * policy.unitsPerCredit;
}

function getInitialBalanceUnits(policy: StreakFreezePolicy): number {
  return Math.min(policy.startCapacity, policy.maxCapacity) * policy.unitsPerCredit;
}

function clampBalanceUnits(balanceUnits: number, policy: StreakFreezePolicy): number {
  return Math.min(balanceUnits, getMaximumBalanceUnits(policy));
}

function addStreakDayEarnedUnits(balanceUnits: number, policy: StreakFreezePolicy): number {
  return clampBalanceUnits(balanceUnits + policy.earnedUnitsPerStreakDay, policy);
}

function getAvailableCredits(balanceUnits: number, policy: StreakFreezePolicy): number {
  return Math.min(policy.maxCapacity, Math.floor(balanceUnits / policy.unitsPerCredit));
}

function createStreakFreeze(balanceUnits: number, policy: StreakFreezePolicy): StreakFreeze {
  const clampedBalanceUnits = clampBalanceUnits(balanceUnits, policy);
  const availableCredits = getAvailableCredits(clampedBalanceUnits, policy);

  return {
    availableCredits,
    capacity: policy.maxCapacity,
    balanceUnits: clampedBalanceUnits,
    unitsPerCredit: policy.unitsPerCredit,
    earnedUnitsPerStreakDay: policy.earnedUnitsPerStreakDay,
    nextCreditProgressUnits: availableCredits >= policy.maxCapacity ? 0 : clampedBalanceUnits % policy.unitsPerCredit,
    nextCreditRequiredUnits: policy.unitsPerCredit,
  };
}

function createInitialState(policy: StreakFreezePolicy): StreakComputationState {
  return {
    balanceUnits: getInitialBalanceUnits(policy),
    currentStreakDays: 0,
    longestStreakDays: 0,
    hasActiveSegment: false,
    lastEvaluatedDate: null,
  };
}

function addReviewedDay(
  state: StreakComputationState,
  date: string,
  policy: StreakFreezePolicy,
  statesByDate: Map<string, StreakDayState>,
): StreakComputationState {
  const balanceUnits = addStreakDayEarnedUnits(
    state.hasActiveSegment ? state.balanceUnits : getInitialBalanceUnits(policy),
    policy,
  );
  const currentStreakDays = state.hasActiveSegment ? state.currentStreakDays + 1 : 1;
  statesByDate.set(date, "reviewed");

  return {
    balanceUnits,
    currentStreakDays,
    longestStreakDays: Math.max(state.longestStreakDays, currentStreakDays),
    hasActiveSegment: true,
    lastEvaluatedDate: date,
  };
}

function addFrozenDay(
  state: StreakComputationState,
  date: string,
  policy: StreakFreezePolicy,
  statesByDate: Map<string, StreakDayState>,
): StreakComputationState {
  const balanceUnitsAfterSpend = state.balanceUnits - policy.unitsPerCredit;
  const balanceUnits = addStreakDayEarnedUnits(balanceUnitsAfterSpend, policy);
  const currentStreakDays = state.currentStreakDays + 1;
  statesByDate.set(date, "frozen");

  return {
    balanceUnits,
    currentStreakDays,
    longestStreakDays: Math.max(state.longestStreakDays, currentStreakDays),
    hasActiveSegment: true,
    lastEvaluatedDate: date,
  };
}

function addMissedDay(
  state: StreakComputationState,
  date: string,
  policy: StreakFreezePolicy,
  statesByDate: Map<string, StreakDayState>,
): StreakComputationState {
  statesByDate.set(date, "missed");

  return {
    balanceUnits: getInitialBalanceUnits(policy),
    currentStreakDays: 0,
    longestStreakDays: state.longestStreakDays,
    hasActiveSegment: false,
    lastEvaluatedDate: date,
  };
}

function addPendingDay(
  state: StreakComputationState,
  date: string,
  statesByDate: Map<string, StreakDayState>,
): StreakComputationState {
  statesByDate.set(date, "pending");

  return {
    ...state,
    lastEvaluatedDate: date,
  };
}

function addNonReviewedCompletedDay(
  state: StreakComputationState,
  date: string,
  policy: StreakFreezePolicy,
  statesByDate: Map<string, StreakDayState>,
): StreakComputationState {
  if (state.hasActiveSegment && getAvailableCredits(state.balanceUnits, policy) > 0) {
    return addFrozenDay(state, date, policy, statesByDate);
  }

  return addMissedDay(state, date, policy, statesByDate);
}

function addNonReviewedDaysBeforeReview(
  state: StreakComputationState,
  nextReviewDate: string,
  policy: StreakFreezePolicy,
  statesByDate: Map<string, StreakDayState>,
): StreakComputationState {
  let currentState = state;
  let currentDate = currentState.lastEvaluatedDate === null
    ? nextReviewDate
    : shiftLocalDate(currentState.lastEvaluatedDate, 1);

  while (currentState.lastEvaluatedDate !== null && currentDate < nextReviewDate) {
    currentState = addNonReviewedCompletedDay(currentState, currentDate, policy, statesByDate);
    currentDate = shiftLocalDate(currentDate, 1);
  }

  return currentState;
}

function addTrailingDaysThroughToday(
  state: StreakComputationState,
  today: string,
  policy: StreakFreezePolicy,
  statesByDate: Map<string, StreakDayState>,
): StreakComputationState {
  let currentState = state;
  let currentDate = currentState.lastEvaluatedDate === null
    ? today
    : shiftLocalDate(currentState.lastEvaluatedDate, 1);

  while (currentDate <= today) {
    currentState = currentDate === today
      ? addPendingDay(currentState, currentDate, statesByDate)
      : addNonReviewedCompletedDay(currentState, currentDate, policy, statesByDate);
    currentDate = shiftLocalDate(currentDate, 1);
  }

  return currentState;
}

function createStreakDays(statesByDate: ReadonlyMap<string, StreakDayState>): ReadonlyArray<StreakDay> {
  return [...statesByDate.entries()]
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([date, state]) => ({
      date,
      state,
    }));
}

export function evaluateStreakFreeze(
  sortedActiveReviewLocalDates: ReadonlyArray<string>,
  today: string,
  policy: StreakFreezePolicy,
): StreakFreezeEvaluation {
  validateStreakFreezePolicy(policy);
  assertLocalDate(today, "today");
  assertSortedActiveReviewLocalDates(sortedActiveReviewLocalDates);

  const statesByDate = new Map<string, StreakDayState>();
  const activeReviewLocalDatesThroughToday = sortedActiveReviewLocalDates.filter((reviewDate) => reviewDate <= today);
  const stateAfterReviews = activeReviewLocalDatesThroughToday.reduce<StreakComputationState>(
    (state, reviewDate) => addReviewedDay(
      addNonReviewedDaysBeforeReview(state, reviewDate, policy, statesByDate),
      reviewDate,
      policy,
      statesByDate,
    ),
    createInitialState(policy),
  );
  const finalState = addTrailingDaysThroughToday(stateAfterReviews, today, policy, statesByDate);

  return {
    currentStreakDays: finalState.currentStreakDays,
    longestStreakDays: finalState.longestStreakDays,
    streakFreeze: createStreakFreeze(finalState.balanceUnits, policy),
    streakDays: createStreakDays(statesByDate),
  };
}

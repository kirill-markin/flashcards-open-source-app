import { shiftLocalDate } from "./progressDates";

// Reference definition of review pace. iOS (WidgetShared/ProgressPace.swift) and Android
// (ReviewPace.kt) port this function; keep the three in step.
//
// Last 7 local days (today and the 6 before) against the daily average of the 28 days before
// them, rest days counting 0. A young account's baseline averages only the days on or after its
// first review. There is no baseline when history since the first review is under 14 days or the
// baseline window holds under 14 reviews. The ring is the same number drawn as laps.
export const reviewPaceWindowDayCount: number = 7;
export const reviewPaceBaselineDayCount: number = 28;
export const reviewPaceMinimumHistoryDayCount: number = 14;
export const reviewPaceMinimumBaselineReviewCount: number = 14;
export const reviewPaceMaximumPercentChange: number = 999;
export const reviewPaceMaximumRingLaps: number = 2;

export type ReviewPaceDay = Readonly<{
  date: string;
  reviewCount: number;
}>;

export type ReviewPaceBaseline = Readonly<{
  usualReviewsPerDay: number;
  // Rounded, signed, at most 999. 0 means no arrow.
  percentChange: number;
  // Last 7 total ÷ (usual per day × 7), stopped at two laps.
  ringProgress: number;
}>;

export type ReviewPace = Readonly<{
  last7DaysReviewCount: number;
  last7DaysAveragePerDay: number;
  baseline: ReviewPaceBaseline | null;
}>;

function countLocalDaysInclusive(from: string, to: string): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toTime - fromTime) / millisecondsPerDay) + 1;
}

function sumReviewsInRange(days: ReadonlyArray<ReviewPaceDay>, from: string, to: string): number {
  return days.reduce((total, day) => (
    day.date >= from && day.date <= to ? total + day.reviewCount : total
  ), 0);
}

function findFirstReviewDate(days: ReadonlyArray<ReviewPaceDay>, today: string): string | null {
  return days.reduce<string | null>((first, day) => {
    if (day.reviewCount <= 0 || day.date > today) {
      return first;
    }

    return first === null || day.date < first ? day.date : first;
  }, null);
}

/**
 * `days` is a per-local-day series covering at least the 35 days ending `today`; missing days count
 * as 0. The earliest reviewed day in the series stands for the first review, so pass the longest
 * series the client already has.
 */
export function calculateReviewPace(days: ReadonlyArray<ReviewPaceDay>, today: string): ReviewPace {
  const windowStart = shiftLocalDate(today, 1 - reviewPaceWindowDayCount);
  const baselineEnd = shiftLocalDate(windowStart, -1);
  const baselineStart = shiftLocalDate(windowStart, -reviewPaceBaselineDayCount);
  const last7DaysReviewCount = sumReviewsInRange(days, windowStart, today);
  const last7DaysAveragePerDay = last7DaysReviewCount / reviewPaceWindowDayCount;
  const firstReviewDate = findFirstReviewDate(days, today);

  if (
    firstReviewDate === null
    || countLocalDaysInclusive(firstReviewDate, today) < reviewPaceMinimumHistoryDayCount
  ) {
    return { last7DaysReviewCount, last7DaysAveragePerDay, baseline: null };
  }

  const effectiveBaselineStart = firstReviewDate > baselineStart ? firstReviewDate : baselineStart;
  const baselineDayCount = countLocalDaysInclusive(effectiveBaselineStart, baselineEnd);
  const baselineReviewCount = sumReviewsInRange(days, effectiveBaselineStart, baselineEnd);
  if (baselineDayCount <= 0 || baselineReviewCount < reviewPaceMinimumBaselineReviewCount) {
    return { last7DaysReviewCount, last7DaysAveragePerDay, baseline: null };
  }

  const usualReviewsPerDay = baselineReviewCount / baselineDayCount;
  const ratio = last7DaysAveragePerDay / usualReviewsPerDay;
  return {
    last7DaysReviewCount,
    last7DaysAveragePerDay,
    baseline: {
      usualReviewsPerDay,
      percentChange: Math.min(Math.round((ratio - 1) * 100), reviewPaceMaximumPercentChange),
      ringProgress: Math.min(ratio, reviewPaceMaximumRingLaps),
    },
  };
}

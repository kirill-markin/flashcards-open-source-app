export type ReviewRating = 0 | 1 | 2 | 3;

export type ReviewSchedule = Readonly<{
  dueAt: Date;
  reps: number;
  lapses: number;
}>;

const GOOD_INTERVALS_DAYS: ReadonlyArray<number> = [1, 3, 7, 14, 30, 60];
const EASY_INTERVALS_DAYS: ReadonlyArray<number> = [3, 7, 14, 30, 60, 90];

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function getIntervalDays(intervals: ReadonlyArray<number>, reps: number): number {
  const index = Math.min(Math.max(reps - 1, 0), intervals.length - 1);
  return intervals[index];
}

export function computeReviewSchedule(
  currentReps: number,
  currentLapses: number,
  rating: ReviewRating,
  now: Date,
): ReviewSchedule {
  if (rating === 0) {
    return {
      dueAt: addMinutes(now, 10),
      reps: currentReps,
      lapses: currentLapses + 1,
    };
  }

  if (rating === 1) {
    return {
      dueAt: addHours(now, 12),
      reps: currentReps,
      lapses: currentLapses,
    };
  }

  const reps = currentReps + 1;
  const days = rating === 2
    ? getIntervalDays(GOOD_INTERVALS_DAYS, reps)
    : getIntervalDays(EASY_INTERVALS_DAYS, reps);

  return {
    dueAt: addDays(now, days),
    reps,
    lapses: currentLapses,
  };
}

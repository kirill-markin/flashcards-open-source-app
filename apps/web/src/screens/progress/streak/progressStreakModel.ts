import type { LocaleWeekContext } from "../../../i18n";
import { parseLocalDate, shiftLocalDate } from "../../../progress/progressDates";
import type { DailyReviewPoint, StreakDay as ProgressStreakDay, StreakDayState } from "../../../types";

const streakWeekCount = 5;
const streakWeekLength = 7;

type DateFormatter = (value: Date | number | string, options?: Readonly<Intl.DateTimeFormatOptions>) => string;

export type StreakDay = Readonly<{
  date: string;
  reviewCount: number;
  state: StreakDayState;
  isFuture: boolean;
  isToday: boolean;
  weekdayLabel: string;
  dayLabel: string;
  title: string;
}>;

function formatLocalDateForDisplay(value: string, formatDate: DateFormatter): string {
  return formatDate(parseLocalDate(value), {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatWeekdayLabel(value: string, formatDate: DateFormatter): string {
  return formatDate(parseLocalDate(value), {
    timeZone: "UTC",
    weekday: "narrow",
  });
}

function formatDayLabel(value: string, formatDate: DateFormatter): string {
  return formatDate(parseLocalDate(value), {
    timeZone: "UTC",
    day: "numeric",
  });
}

function createDailyReviewCountMap(dailyReviews: ReadonlyArray<DailyReviewPoint>): ReadonlyMap<string, number> {
  const reviewCounts = new Map<string, number>();

  for (const day of dailyReviews) {
    reviewCounts.set(day.date, day.reviewCount);
  }

  return reviewCounts;
}

function createStreakDayStateMap(streakDays: ReadonlyArray<ProgressStreakDay>): ReadonlyMap<string, StreakDayState> {
  const states = new Map<string, StreakDayState>();

  for (const streakDay of streakDays) {
    states.set(streakDay.date, streakDay.state);
  }

  return states;
}

function resolveStreakDayState(
  date: string,
  today: string,
  stateMap: ReadonlyMap<string, StreakDayState>,
): StreakDayState {
  if (date > today) {
    return "pending";
  }

  const state = stateMap.get(date);
  if (state === undefined) {
    throw new Error(`Missing progress streak day state for ${date}`);
  }

  return state;
}

function getDayOfWeek(value: string): number {
  return parseLocalDate(value).getUTCDay();
}

function getStartOfWeek(value: string, weekContext: LocaleWeekContext): string {
  const dayOfWeek = getDayOfWeek(value);
  const offsetFromWeekStart = (dayOfWeek - weekContext.firstDayOfWeek + streakWeekLength) % streakWeekLength;

  return shiftLocalDate(value, -offsetFromWeekStart);
}

export function buildStreakWeeks(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
  streakDays: ReadonlyArray<ProgressStreakDay>,
  today: string,
  formatDate: DateFormatter,
  weekContext: LocaleWeekContext,
): ReadonlyArray<ReadonlyArray<StreakDay>> {
  const currentWeekStart = getStartOfWeek(today, weekContext);
  const streakWindowStart = shiftLocalDate(currentWeekStart, -((streakWeekCount - 1) * streakWeekLength));
  const reviewCounts = createDailyReviewCountMap(dailyReviews);
  const streakDayStates = createStreakDayStateMap(streakDays);
  const streakWeeks: Array<ReadonlyArray<StreakDay>> = [];

  for (let weekIndex = 0; weekIndex < streakWeekCount; weekIndex += 1) {
    const weekStart = shiftLocalDate(streakWindowStart, weekIndex * streakWeekLength);
    const weekDays: Array<StreakDay> = [];

    for (let dayOffset = 0; dayOffset < streakWeekLength; dayOffset += 1) {
      const date = shiftLocalDate(weekStart, dayOffset);
      weekDays.push({
        date,
        reviewCount: reviewCounts.get(date) ?? 0,
        state: resolveStreakDayState(date, today, streakDayStates),
        isFuture: date > today,
        isToday: date === today,
        weekdayLabel: formatWeekdayLabel(date, formatDate),
        dayLabel: formatDayLabel(date, formatDate),
        title: formatLocalDateForDisplay(date, formatDate),
      });
    }

    streakWeeks.push(weekDays);
  }

  return streakWeeks;
}

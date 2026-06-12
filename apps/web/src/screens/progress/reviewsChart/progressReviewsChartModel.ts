import type { Locale, LocaleDirection, LocaleWeekContext } from "../../../i18n";
import { parseLocalDate, shiftLocalDate } from "../../../progress/progressDates";
import type { DailyReviewPoint } from "../../../types";

const chartGuideLineCount = 3;
const chartWeekLength = 7;

type DateFormatter = (value: Date | number | string, options?: Readonly<Intl.DateTimeFormatOptions>) => string;
type NumberFormatter = (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string;
type ChartNavigationDirection = "previous" | "next";

export type ChartDay = Readonly<{
  date: string;
  reviewCount: number;
  isToday: boolean;
  weekdayLabel: string;
  dayLabel: string;
  monthLabel: string;
  showMonthLabel: boolean;
  barHeightPercentage: number;
  title: string;
}>;

export type ChartPage = Readonly<{
  days: ReadonlyArray<ChartDay>;
  startDate: string;
  endDate: string;
  startLocalDate: string;
  upperBound: number;
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

function formatMonthLabel(value: string, formatDate: DateFormatter): string {
  return formatDate(parseLocalDate(value), {
    timeZone: "UTC",
    month: "short",
  });
}

function createDailyReviewCountMap(dailyReviews: ReadonlyArray<DailyReviewPoint>): ReadonlyMap<string, number> {
  const reviewCounts = new Map<string, number>();

  for (const day of dailyReviews) {
    reviewCounts.set(day.date, day.reviewCount);
  }

  return reviewCounts;
}

function getDayOfWeek(value: string): number {
  return parseLocalDate(value).getUTCDay();
}

function getStartOfWeek(value: string, weekContext: LocaleWeekContext): string {
  const dayOfWeek = getDayOfWeek(value);
  const offsetFromWeekStart = (dayOfWeek - weekContext.firstDayOfWeek + chartWeekLength) % chartWeekLength;

  return shiftLocalDate(value, -offsetFromWeekStart);
}

function calculateMaxReviewCount(dailyReviews: ReadonlyArray<DailyReviewPoint>): number {
  return dailyReviews.reduce((maxReviewCount, day) => Math.max(maxReviewCount, day.reviewCount), 0);
}

function calculateChartUpperBound(maxReviewCount: number): number {
  if (maxReviewCount <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(maxReviewCount * 1.1));
}

function calculateBarHeightPercentage(reviewCount: number, upperBound: number): number {
  if (reviewCount === 0 || upperBound === 0) {
    return 0;
  }

  return (reviewCount / upperBound) * 100;
}

function buildChartPage(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
  today: string,
  formatDate: DateFormatter,
): ChartPage {
  const upperBound = calculateChartUpperBound(calculateMaxReviewCount(dailyReviews));

  return {
    days: dailyReviews.map((day, dayIndex): ChartDay => ({
      date: day.date,
      reviewCount: day.reviewCount,
      isToday: day.date === today,
      weekdayLabel: formatWeekdayLabel(day.date, formatDate),
      dayLabel: formatDayLabel(day.date, formatDate),
      monthLabel: formatMonthLabel(day.date, formatDate),
      showMonthLabel: dayIndex === 0 || dailyReviews[dayIndex - 1]?.date.slice(0, 7) !== day.date.slice(0, 7),
      barHeightPercentage: calculateBarHeightPercentage(day.reviewCount, upperBound),
      title: formatLocalDateForDisplay(day.date, formatDate),
    })),
    startDate: dailyReviews[0]?.date ?? "",
    endDate: dailyReviews[dailyReviews.length - 1]?.date ?? "",
    startLocalDate: dailyReviews[0]?.date ?? "",
    upperBound,
  };
}

function padPageDaysToFullWeek(
  pageDays: ReadonlyArray<DailyReviewPoint>,
  weekStart: string,
): ReadonlyArray<DailyReviewPoint> {
  const reviewCounts = createDailyReviewCountMap(pageDays);
  const fullWeek: Array<DailyReviewPoint> = [];

  for (let dayOffset = 0; dayOffset < chartWeekLength; dayOffset += 1) {
    const date = shiftLocalDate(weekStart, dayOffset);
    fullWeek.push({
      date,
      reviewCount: reviewCounts.get(date) ?? 0,
    });
  }

  return fullWeek;
}

export function buildChartPages(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
  today: string,
  formatDate: DateFormatter,
  weekContext: LocaleWeekContext,
): ReadonlyArray<ChartPage> {
  if (dailyReviews.length === 0) {
    return [];
  }

  const chartPages: Array<ChartPage> = [];
  let currentPageDays: Array<DailyReviewPoint> = [];
  let currentWeekStart: string | null = null;

  for (const day of dailyReviews) {
    const weekStart = getStartOfWeek(day.date, weekContext);

    if (currentWeekStart !== null && currentWeekStart !== weekStart) {
      chartPages.push(buildChartPage(padPageDaysToFullWeek(currentPageDays, currentWeekStart), today, formatDate));
      currentPageDays = [day];
      currentWeekStart = weekStart;
      continue;
    }

    currentPageDays.push(day);
    currentWeekStart = weekStart;
  }

  if (currentPageDays.length > 0 && currentWeekStart !== null) {
    chartPages.push(buildChartPage(padPageDaysToFullWeek(currentPageDays, currentWeekStart), today, formatDate));
  }

  return chartPages;
}

export function buildChartGuideLabels(upperBound: number, formatNumber: NumberFormatter): ReadonlyArray<string> {
  const labels: string[] = [];

  for (let index = 0; index < chartGuideLineCount; index += 1) {
    if (index === 0) {
      labels.push(formatNumber(upperBound));
      continue;
    }

    if (index === chartGuideLineCount - 1) {
      labels.push(formatNumber(0));
      continue;
    }

    labels.push("");
  }

  return labels;
}

export function formatChartRangeLabel(startDate: string, endDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).formatRange(parseLocalDate(startDate), parseLocalDate(endDate));
}

export function resolveChartNavigationArrow(
  localeDirection: LocaleDirection,
  navigationDirection: ChartNavigationDirection,
): string {
  if (navigationDirection === "previous") {
    return localeDirection === "rtl" ? ">" : "<";
  }

  return localeDirection === "rtl" ? "<" : ">";
}

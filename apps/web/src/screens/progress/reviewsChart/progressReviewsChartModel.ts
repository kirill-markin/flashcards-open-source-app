import type { Locale, LocaleDirection, LocaleWeekContext } from "../../../i18n";
import type { TranslationKey, TranslationValues } from "../../../i18n";
import { parseLocalDate, shiftLocalDate } from "../../../progress/progressDates";
import type { DailyReviewPoint } from "../../../types";

const chartGuideLineCount = 3;
const chartWeekLength = 7;
const progressReviewsChartRatingKeys = ["again", "hard", "good", "easy"] as const;

type DateFormatter = (value: Date | number | string, options?: Readonly<Intl.DateTimeFormatOptions>) => string;
type NumberFormatter = (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string;
type Translate = (key: TranslationKey, values?: TranslationValues) => string;
type ChartNavigationDirection = "previous" | "next";

export type ProgressReviewsChartRatingKey = typeof progressReviewsChartRatingKeys[number];

export type ProgressReviewsChartSelection =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "day"; date: string }>
  | Readonly<{ kind: "rating"; ratingKey: ProgressReviewsChartRatingKey }>;

export type ChartRatingSegment = Readonly<{
  ratingKey: ProgressReviewsChartRatingKey;
  count: number;
  color: string;
  heightPercentage: number;
}>;

export type ChartRatingLegendItem = Readonly<{
  ratingKey: ProgressReviewsChartRatingKey;
  label: string;
  count: number;
  valueLabel: string;
  color: string;
  isSelected: boolean;
  isDimmed: boolean;
  isDisabled: boolean;
}>;

export type ChartDay = Readonly<{
  date: string;
  reviewCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  displayReviewCount: number;
  isToday: boolean;
  weekdayLabel: string;
  dayLabel: string;
  monthLabel: string;
  showMonthLabel: boolean;
  barHeightPercentage: number;
  segments: ReadonlyArray<ChartRatingSegment>;
  title: string;
}>;

export type ChartPage = Readonly<{
  days: ReadonlyArray<ChartDay>;
  startDate: string;
  endDate: string;
  startLocalDate: string;
  upperBound: number;
}>;

export const progressReviewsChartRatingColors: Readonly<Record<ProgressReviewsChartRatingKey, string>> = {
  again: "#D7263D",
  hard: "#E69F00",
  good: "#2BB673",
  easy: "#3F7CC8",
};

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

function getDailyReviewRatingCount(
  dailyReviewPoint: DailyReviewPoint,
  ratingKey: ProgressReviewsChartRatingKey,
): number {
  if (ratingKey === "again") {
    return dailyReviewPoint.againCount;
  }

  if (ratingKey === "hard") {
    return dailyReviewPoint.hardCount;
  }

  if (ratingKey === "good") {
    return dailyReviewPoint.goodCount;
  }

  return dailyReviewPoint.easyCount;
}

function getRatingLabel(ratingKey: ProgressReviewsChartRatingKey, t: Translate): string {
  if (ratingKey === "again") {
    return t("reviewScreen.ratings.again");
  }

  if (ratingKey === "hard") {
    return t("reviewScreen.ratings.hard");
  }

  if (ratingKey === "good") {
    return t("reviewScreen.ratings.good");
  }

  return t("reviewScreen.ratings.easy");
}

function createDailyReviewPointMap(dailyReviews: ReadonlyArray<DailyReviewPoint>): ReadonlyMap<string, DailyReviewPoint> {
  const dailyReviewPoints = new Map<string, DailyReviewPoint>();

  for (const day of dailyReviews) {
    dailyReviewPoints.set(day.date, day);
  }

  return dailyReviewPoints;
}

function getDayOfWeek(value: string): number {
  return parseLocalDate(value).getUTCDay();
}

function getStartOfWeek(value: string, weekContext: LocaleWeekContext): string {
  const dayOfWeek = getDayOfWeek(value);
  const offsetFromWeekStart = (dayOfWeek - weekContext.firstDayOfWeek + chartWeekLength) % chartWeekLength;

  return shiftLocalDate(value, -offsetFromWeekStart);
}

function calculateDailyReviewPointDisplayCount(
  dailyReviewPoint: DailyReviewPoint,
  selectedRatingKey: ProgressReviewsChartRatingKey | null,
): number {
  if (selectedRatingKey === null) {
    return dailyReviewPoint.reviewCount;
  }

  return getDailyReviewRatingCount(dailyReviewPoint, selectedRatingKey);
}

function calculateMaxReviewCount(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
  selectedRatingKey: ProgressReviewsChartRatingKey | null,
): number {
  return dailyReviews.reduce(
    (maxReviewCount, day) => Math.max(maxReviewCount, calculateDailyReviewPointDisplayCount(day, selectedRatingKey)),
    0,
  );
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

function buildRatingSegments(
  dailyReviewPoint: DailyReviewPoint,
  displayReviewCount: number,
  selectedRatingKey: ProgressReviewsChartRatingKey | null,
): ReadonlyArray<ChartRatingSegment> {
  const ratingKeys = selectedRatingKey === null ? progressReviewsChartRatingKeys : [selectedRatingKey];

  return ratingKeys
    .map((ratingKey): ChartRatingSegment => {
      const count = getDailyReviewRatingCount(dailyReviewPoint, ratingKey);
      return {
        ratingKey,
        count,
        color: progressReviewsChartRatingColors[ratingKey],
        heightPercentage: displayReviewCount <= 0 ? 0 : (count / displayReviewCount) * 100,
      };
    })
    .filter((segment) => segment.count > 0);
}

function buildChartPage(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
  today: string,
  formatDate: DateFormatter,
  selectedRatingKey: ProgressReviewsChartRatingKey | null,
): ChartPage {
  const upperBound = calculateChartUpperBound(calculateMaxReviewCount(dailyReviews, selectedRatingKey));

  return {
    days: dailyReviews.map((day, dayIndex): ChartDay => {
      const displayReviewCount = calculateDailyReviewPointDisplayCount(day, selectedRatingKey);
      return {
        date: day.date,
        reviewCount: day.reviewCount,
        againCount: day.againCount,
        hardCount: day.hardCount,
        goodCount: day.goodCount,
        easyCount: day.easyCount,
        displayReviewCount,
        isToday: day.date === today,
        weekdayLabel: formatWeekdayLabel(day.date, formatDate),
        dayLabel: formatDayLabel(day.date, formatDate),
        monthLabel: formatMonthLabel(day.date, formatDate),
        showMonthLabel: dayIndex === 0 || dailyReviews[dayIndex - 1]?.date.slice(0, 7) !== day.date.slice(0, 7),
        barHeightPercentage: calculateBarHeightPercentage(displayReviewCount, upperBound),
        segments: buildRatingSegments(day, displayReviewCount, selectedRatingKey),
        title: formatLocalDateForDisplay(day.date, formatDate),
      };
    }),
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
  const reviewCounts = createDailyReviewPointMap(pageDays);
  const fullWeek: Array<DailyReviewPoint> = [];

  for (let dayOffset = 0; dayOffset < chartWeekLength; dayOffset += 1) {
    const date = shiftLocalDate(weekStart, dayOffset);
    fullWeek.push(reviewCounts.get(date) ?? {
      date,
      reviewCount: 0,
      againCount: 0,
      hardCount: 0,
      goodCount: 0,
      easyCount: 0,
    });
  }

  return fullWeek;
}

export function buildChartPages(
  dailyReviews: ReadonlyArray<DailyReviewPoint>,
  today: string,
  formatDate: DateFormatter,
  weekContext: LocaleWeekContext,
  selectedRatingKey: ProgressReviewsChartRatingKey | null,
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
      chartPages.push(buildChartPage(
        padPageDaysToFullWeek(currentPageDays, currentWeekStart),
        today,
        formatDate,
        selectedRatingKey,
      ));
      currentPageDays = [day];
      currentWeekStart = weekStart;
      continue;
    }

    currentPageDays.push(day);
    currentWeekStart = weekStart;
  }

  if (currentPageDays.length > 0 && currentWeekStart !== null) {
    chartPages.push(buildChartPage(
      padPageDaysToFullWeek(currentPageDays, currentWeekStart),
      today,
      formatDate,
      selectedRatingKey,
    ));
  }

  return chartPages;
}

function createLegendSourceDays(
  visiblePage: ChartPage | null,
  selection: ProgressReviewsChartSelection,
): ReadonlyArray<ChartDay> {
  if (visiblePage === null) {
    return [];
  }

  if (selection.kind !== "day") {
    return visiblePage.days;
  }

  return visiblePage.days.filter((day) => day.date === selection.date);
}

function calculateLegendRatingCount(
  sourceDays: ReadonlyArray<ChartDay>,
  ratingKey: ProgressReviewsChartRatingKey,
): number {
  return sourceDays.reduce((count, day) => count + getDailyReviewRatingCount(day, ratingKey), 0);
}

function formatRatingPercentage(count: number, totalCount: number, formatNumber: NumberFormatter): string {
  if (count <= 0 || totalCount <= 0) {
    return formatNumber(0, {
      style: "percent",
      maximumFractionDigits: 0,
    });
  }

  return formatNumber(count / totalCount, {
    style: "percent",
    maximumFractionDigits: 0,
  });
}

export function buildChartRatingLegendItems(
  visiblePage: ChartPage | null,
  selection: ProgressReviewsChartSelection,
  t: Translate,
  formatNumber: NumberFormatter,
): ReadonlyArray<ChartRatingLegendItem> {
  const sourceDays = createLegendSourceDays(visiblePage, selection);
  const totalCount = sourceDays.reduce((count, day) => count + day.reviewCount, 0);

  return progressReviewsChartRatingKeys.map((ratingKey): ChartRatingLegendItem => {
    const count = calculateLegendRatingCount(sourceDays, ratingKey);
    const countLabel = formatNumber(count);
    const percentageLabel = formatRatingPercentage(count, totalCount, formatNumber);
    const isSelected = selection.kind === "rating" && selection.ratingKey === ratingKey;
    return {
      ratingKey,
      label: getRatingLabel(ratingKey, t),
      count,
      valueLabel: `${countLabel} (${percentageLabel})`,
      color: progressReviewsChartRatingColors[ratingKey],
      isSelected,
      isDimmed: selection.kind === "rating" && isSelected === false,
      isDisabled: count === 0,
    };
  });
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

export function formatChartDayLabel(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parseLocalDate(date));
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

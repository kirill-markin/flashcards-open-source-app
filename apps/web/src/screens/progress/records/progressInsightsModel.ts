import { shiftLocalDate } from "../../../progress/progressDates";
import type { ReviewPace } from "../../../progress/reviewPace";
import type { ProgressInsights, ProgressSummary } from "../../../types";
import type { ProgressRecordView } from "./ProgressRecordsSection";

type NumberFormatter = (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string;

export type ProgressRecordsView = Readonly<{
  records: ReadonlyArray<ProgressRecordView>;
  recentRecords: ReadonlyArray<ProgressRecordView>;
}>;

type ProgressRecordsLabels = Readonly<{
  bestDay: string;
  bestWeek: string;
  longestStreak: string;
  totalReviews: string;
  cardsMet: string;
  relearned: string;
}>;

type ProgressRecordsFormatters = Readonly<{
  formatNumber: NumberFormatter;
  formatStreakDays: (days: number) => string;
  formatDay: (date: string) => string;
  formatRange: (startDate: string, endDate: string) => string;
}>;

// Rounded minutes for a number of seconds, never "≈ 0 min" for real work.
export function roundStudyMinutes(seconds: number): number {
  return seconds <= 0 ? 0 : Math.max(1, Math.round(seconds / 60));
}

export function calculateLast7DaysStudySeconds(insights: ProgressInsights | null): number | null {
  if (insights === null || insights.studySecondsByDay === null) {
    return null;
  }

  return insights.studySecondsByDay.reduce((total, day) => total + day.seconds, 0);
}

// The one multiplication a client does with server timing: due cards × seconds per due card.
export function estimateDueMinutes(dueCount: number, insights: ProgressInsights | null): number | null {
  if (dueCount <= 0 || insights === null || insights.secondsPerDueCard === null) {
    return null;
  }

  return roundStudyMinutes(dueCount * insights.secondsPerDueCard);
}

export function formatReviewPaceSuffix(pace: ReviewPace, formatNumber: NumberFormatter): string {
  if (pace.baseline === null) {
    return "";
  }

  const percentLabel = formatNumber(Math.abs(pace.baseline.percentChange) / 100, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const arrow = pace.baseline.percentChange > 0 ? "↑ " : pace.baseline.percentChange < 0 ? "↓ " : "";
  return ` ${arrow}${percentLabel}`;
}

/**
 * Bests exclude today on the server, so today's local count and the current 7 days compete here
 * without counting today twice.
 */
export function buildProgressRecordsView(
  insights: ProgressInsights,
  summary: ProgressSummary,
  pace: ReviewPace | null,
  todayReviewCount: number,
  today: string,
  labels: ProgressRecordsLabels,
  formatters: ProgressRecordsFormatters,
): ProgressRecordsView {
  const serverBestDay = insights.bestDayBeforeToday;
  const bestDay = todayReviewCount > 0 && (serverBestDay === null || todayReviewCount > serverBestDay.reviewCount)
    ? { date: today, reviewCount: todayReviewCount }
    : serverBestDay;
  const currentWeekCount = pace?.last7DaysReviewCount ?? 0;
  const serverBestWeek = insights.bestWeekBeforeToday;
  const bestWeek = currentWeekCount > 0 && (serverBestWeek === null || currentWeekCount > serverBestWeek.reviewCount)
    ? { endDate: today, reviewCount: currentWeekCount }
    : serverBestWeek;
  const records: Array<ProgressRecordView> = [];

  if (bestDay !== null) {
    records.push({
      key: "best-day",
      label: labels.bestDay,
      valueLabel: formatters.formatNumber(bestDay.reviewCount),
      detailLabel: formatters.formatDay(bestDay.date),
    });
  }

  if (bestWeek !== null) {
    records.push({
      key: "best-week",
      label: labels.bestWeek,
      valueLabel: formatters.formatNumber(bestWeek.reviewCount),
      detailLabel: formatters.formatRange(shiftLocalDate(bestWeek.endDate, -6), bestWeek.endDate),
    });
  }

  records.push(
    {
      key: "longest-streak",
      label: labels.longestStreak,
      valueLabel: formatters.formatStreakDays(summary.longestStreakDays),
      detailLabel: null,
    },
    {
      key: "total-reviews",
      label: labels.totalReviews,
      valueLabel: formatters.formatNumber(insights.totalReviews),
      detailLabel: null,
    },
  );

  return {
    records,
    recentRecords: [
      {
        key: "cards-met",
        label: labels.cardsMet,
        valueLabel: formatters.formatNumber(insights.cardsMetLast7Days),
        detailLabel: null,
      },
      {
        key: "relearned",
        label: labels.relearned,
        valueLabel: formatters.formatNumber(insights.relearnedLast7Days),
        detailLabel: null,
      },
    ],
  };
}

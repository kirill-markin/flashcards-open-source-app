import { useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { useAppData } from "../appData";
import {
  buildReviewProgressBadgeStateFromSummarySnapshot,
  formatReviewProgressBadgeValue,
} from "../appData/reviewProgressBadge";
import { useProgressInvalidationState } from "../appData/progressInvalidation";
import { parseLocalDate, shiftLocalDate, useProgressSource } from "../appData/progressSource";
import { resolveLocaleWeekContext, useI18n } from "../i18n";
import type { DailyReviewPoint, ProgressSeriesSnapshot } from "../types";

const streakWeekCount = 5;
const streakWeekLength = 7;
const chartGuideLineCount = 3;

type DateFormatter = ReturnType<typeof useI18n>["formatDate"];
type NumberFormatter = ReturnType<typeof useI18n>["formatNumber"];
type WeekContext = ReturnType<typeof resolveLocaleWeekContext>;
type DailyReview = ProgressSeriesSnapshot["dailyReviews"][number];
type StreakDay = Readonly<{
  date: string;
  reviewCount: number;
  isFuture: boolean;
  isToday: boolean;
  weekdayLabel: string;
  dayLabel: string;
  title: string;
}>;
type ChartDay = Readonly<{
  date: string;
  reviewCount: number;
  isToday: boolean;
  dayLabel: string;
  monthLabel: string;
  showDayLabel: boolean;
  showMonthLabel: boolean;
  barHeightPercentage: number;
  title: string;
}>;

const futureStreakDayStyle: Readonly<CSSProperties> = {
  borderStyle: "dashed",
  background: "transparent",
  opacity: 0.64,
};

const futureStreakMarkerStyle: Readonly<CSSProperties> = {
  background: "transparent",
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.12)",
  color: "var(--text-tertiary)",
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

function sortDailyReviews(dailyReviews: ProgressSeriesSnapshot["dailyReviews"]): ReadonlyArray<DailyReview> {
  return [...dailyReviews].sort((leftDay, rightDay) => leftDay.date.localeCompare(rightDay.date));
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

function getStartOfWeek(value: string, weekContext: WeekContext): string {
  const dayOfWeek = getDayOfWeek(value);
  const offsetFromWeekStart = (dayOfWeek - weekContext.firstDayOfWeek + streakWeekLength) % streakWeekLength;

  return shiftLocalDate(value, -offsetFromWeekStart);
}

function isStartOfWeek(value: string, weekContext: WeekContext): boolean {
  return getDayOfWeek(value) === weekContext.firstDayOfWeek;
}

export function buildStreakWeeks(
  dailyReviews: ReadonlyArray<DailyReview>,
  today: string,
  formatDate: DateFormatter,
  weekContext: WeekContext,
): ReadonlyArray<ReadonlyArray<StreakDay>> {
  const currentWeekStart = getStartOfWeek(today, weekContext);
  const streakWindowStart = shiftLocalDate(currentWeekStart, -((streakWeekCount - 1) * streakWeekLength));
  const reviewCounts = createDailyReviewCountMap(dailyReviews);
  const streakWeeks: Array<ReadonlyArray<StreakDay>> = [];

  for (let weekIndex = 0; weekIndex < streakWeekCount; weekIndex += 1) {
    const weekStart = shiftLocalDate(streakWindowStart, weekIndex * streakWeekLength);
    const weekDays: Array<StreakDay> = [];

    for (let dayOffset = 0; dayOffset < streakWeekLength; dayOffset += 1) {
      const date = shiftLocalDate(weekStart, dayOffset);
      weekDays.push({
        date,
        reviewCount: reviewCounts.get(date) ?? 0,
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

function calculateMaxReviewCount(dailyReviews: ReadonlyArray<DailyReview>): number {
  return dailyReviews.reduce((maxReviewCount, day) => Math.max(maxReviewCount, day.reviewCount), 0);
}

function calculateBarHeightPercentage(reviewCount: number, maxReviewCount: number): number {
  if (reviewCount === 0 || maxReviewCount === 0) {
    return 0;
  }

  return (reviewCount / maxReviewCount) * 100;
}

function buildChartDays(
  dailyReviews: ReadonlyArray<DailyReview>,
  today: string,
  maxReviewCount: number,
  formatDate: DateFormatter,
  weekContext: WeekContext,
): ReadonlyArray<ChartDay> {
  let lastLabeledMonth: string | null = null;

  return dailyReviews.map((day): ChartDay => {
    const showDayLabel = isStartOfWeek(day.date, weekContext) || day.date === today;
    const currentMonth = day.date.slice(0, 7);
    const showMonthLabel = showDayLabel && (lastLabeledMonth === null || currentMonth !== lastLabeledMonth || day.date === today);

    if (showDayLabel) {
      lastLabeledMonth = currentMonth;
    }

    return {
      date: day.date,
      reviewCount: day.reviewCount,
      isToday: day.date === today,
      dayLabel: formatDayLabel(day.date, formatDate),
      monthLabel: formatMonthLabel(day.date, formatDate),
      showDayLabel,
      showMonthLabel,
      barHeightPercentage: calculateBarHeightPercentage(day.reviewCount, maxReviewCount),
      title: formatLocalDateForDisplay(day.date, formatDate),
    };
  });
}

function buildChartGuideLabels(maxReviewCount: number, formatNumber: NumberFormatter): ReadonlyArray<string> {
  const labels: string[] = [];

  for (let index = 0; index < chartGuideLineCount; index += 1) {
    if (index === 0) {
      labels.push(formatNumber(maxReviewCount));
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

export function ProgressScreen(): ReactElement {
  const {
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
  } = useAppData();
  const { progressLocalVersion, progressServerInvalidationVersion } = useProgressInvalidationState();
  const { progressSourceState, refreshProgress } = useProgressSource({
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
    progressLocalVersion,
    progressServerInvalidationVersion,
    sections: {
      includeSummary: true,
      includeSeries: true,
    },
  });
  const { locale, matchedBrowserLanguageTag, t, formatDate, formatNumber } = useI18n();
  const todayChartColumnRef = useRef<HTMLDivElement | null>(null);
  const progressSummary = progressSourceState.summary.renderedSnapshot;
  const progress = progressSourceState.series.renderedSnapshot;
  const isLoading = progressSourceState.summary.isLoading || progressSourceState.series.isLoading;
  const errorMessage = progressSourceState.summary.errorMessage !== ""
    ? progressSourceState.summary.errorMessage
    : progressSourceState.series.errorMessage;
  const reviewProgressBadge = buildReviewProgressBadgeStateFromSummarySnapshot(progressSummary);

  useEffect(() => {
    const chartColumn = todayChartColumnRef.current;

    if (chartColumn === null) {
      return;
    }

    chartColumn.scrollIntoView({
      block: "nearest",
      inline: "end",
    });
  }, [progress]);

  const dailyReviews = progress === null ? [] : sortDailyReviews(progress.dailyReviews);
  const today = progress === null ? "" : progress.to;
  const weekContext = resolveLocaleWeekContext(matchedBrowserLanguageTag ?? locale, locale);
  const streakWeeks = progress === null ? [] : buildStreakWeeks(dailyReviews, today, formatDate, weekContext);
  const maxReviewCount = progress === null ? 0 : calculateMaxReviewCount(dailyReviews);
  const chartDays = progress === null ? [] : buildChartDays(dailyReviews, today, maxReviewCount, formatDate, weekContext);
  const chartGuideLabels = buildChartGuideLabels(maxReviewCount, formatNumber);
  const reviewProgressBadgeTodayStatus = reviewProgressBadge.hasReviewedToday
    ? t("reviewScreen.progressBadge.reviewedToday")
    : t("reviewScreen.progressBadge.notReviewedToday");
  const reviewProgressBadgeAriaLabel = t("reviewScreen.progressBadge.ariaLabel", {
    streak: formatNumber(reviewProgressBadge.streakDays),
    todayStatus: reviewProgressBadgeTodayStatus,
  });

  return (
    <main className="container">
      <section className="panel progress-panel">
        <div className="screen-head">
          <div>
            <h1 className="title">{t("progressScreen.title")}</h1>
            <p className="subtitle">{t("progressScreen.subtitle")}</p>
          </div>

          <button className="ghost-btn" type="button" onClick={() => void refreshProgress()}>
            {t("common.refresh")}
          </button>
        </div>

        {isLoading && progress === null ? <p className="subtitle">{t("loading.progress")}</p> : null}

        {errorMessage !== "" ? (
          <>
            <p className="error-banner">{errorMessage}</p>
          </>
        ) : null}

        {progress !== null ? (
          <div className="progress-layout">
            <section className="content-card progress-section">
              <div className="progress-section-head">
                <h2 className="progress-section-title">{t("progressScreen.streakTitle")}</h2>
              </div>

              {progressSummary !== null ? (
                <div className="progress-streak-summary">
                  <div className="progress-streak-summary-copy">
                    <span className="progress-streak-summary-label">{t("reviewScreen.progressBadge.title")}</span>
                    <p className="progress-streak-summary-status">{reviewProgressBadgeTodayStatus}</p>
                  </div>
                  <span
                    className={`badge review-progress-badge${reviewProgressBadge.hasReviewedToday ? " review-progress-badge-active" : ""}`}
                    aria-label={reviewProgressBadgeAriaLabel}
                    title={reviewProgressBadgeAriaLabel}
                  >
                    <span className="review-progress-badge-icon" aria-hidden="true">🔥</span>
                    <span className="review-progress-badge-value">
                      {formatReviewProgressBadgeValue(reviewProgressBadge.streakDays)}
                    </span>
                  </span>
                </div>
              ) : null}

              <div className="progress-streak-weeks">
                {streakWeeks.map((week, weekIndex) => (
                  <div key={`streak-week-${weekIndex}`} className="progress-streak-week">
                    {week.map((day) => {
                      const dayClassName = [
                        "progress-streak-day",
                        day.reviewCount > 0 ? "progress-streak-day-complete" : "",
                        day.isToday && day.reviewCount === 0 ? "progress-streak-day-today" : "",
                      ]
                        .filter((className) => className !== "")
                        .join(" ");

                      return (
                        <div
                          key={day.date}
                          className={dayClassName}
                          title={day.title}
                          data-streak-state={day.isFuture ? "future" : "active"}
                          style={day.isFuture ? futureStreakDayStyle : undefined}
                        >
                          <span className="progress-streak-weekday">{day.weekdayLabel}</span>
                          <span
                            className="progress-streak-marker"
                            aria-hidden="true"
                            style={day.isFuture ? futureStreakMarkerStyle : undefined}
                          >
                            {day.reviewCount > 0 ? "🔥" : day.isFuture ? "" : day.dayLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>

            <section className="content-card progress-section">
              <div className="progress-section-head">
                <h2 className="progress-section-title">{t("progressScreen.reviewsTitle")}</h2>
              </div>

              <div className="progress-chart-shell">
                <div className="progress-chart-y-axis" aria-hidden="true">
                  {chartGuideLabels.map((label, index) => (
                    <span key={`progress-guide-label-${index}`} className="progress-chart-y-label">
                      {label}
                    </span>
                  ))}
                </div>

                <div className="progress-chart-scroll">
                  <div className="progress-chart-plot">
                    <div className="progress-chart-guides" aria-hidden="true">
                      {chartGuideLabels.map((_, index) => (
                        <span key={`progress-guide-line-${index}`} className="progress-chart-guide-line" />
                      ))}
                    </div>

                    <div className="progress-chart-columns">
                      {chartDays.map((day) => {
                        const columnClassName = [
                          "progress-chart-column",
                          day.isToday && day.reviewCount === 0 ? "progress-chart-column-today" : "",
                        ]
                          .filter((className) => className !== "")
                          .join(" ");
                        const barClassName = [
                          "progress-chart-bar",
                          day.reviewCount > 0 ? "progress-chart-bar-active" : "",
                        ]
                          .filter((className) => className !== "")
                          .join(" ");

                        return (
                          <div
                            key={day.date}
                            ref={day.isToday ? todayChartColumnRef : undefined}
                            className={columnClassName}
                            title={day.title}
                          >
                            <div className="progress-chart-bar-shell">
                              <span
                                className={barClassName}
                                style={{
                                  height: `${day.barHeightPercentage}%`,
                                }}
                                aria-hidden="true"
                              />
                            </div>
                            <div className="progress-chart-labels" aria-hidden="true">
                              <span className="progress-chart-month">
                                {day.showMonthLabel ? day.monthLabel : ""}
                              </span>
                              <span className="progress-chart-day">{day.showDayLabel ? day.dayLabel : ""}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

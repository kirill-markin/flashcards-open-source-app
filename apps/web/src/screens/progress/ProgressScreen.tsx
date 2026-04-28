import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { useAppData } from "../../appData";
import {
  buildReviewProgressBadgeStateFromSummarySnapshot,
  formatReviewProgressBadgeValue,
} from "../../appData/reviewProgressBadge";
import { useProgressInvalidationState } from "../../appData/progressInvalidation";
import { useProgressSource } from "../../appData/progressSource";
import { resolveLocaleWeekContext, useI18n, type LocaleDirection } from "../../i18n";
import { parseLocalDate, shiftLocalDate } from "../../progress/progressDates";
import type { DailyReviewPoint, ProgressSeriesSnapshot } from "../../types";
import { ReviewProgressBadgeIcon } from "../shared/ReviewProgressBadgeIcon";

const streakWeekCount = 5;
const streakWeekLength = 7;
const chartGuideLineCount = 3;

type LocaleValue = ReturnType<typeof useI18n>["locale"];
type DateFormatter = ReturnType<typeof useI18n>["formatDate"];
type NumberFormatter = ReturnType<typeof useI18n>["formatNumber"];
type WeekContext = ReturnType<typeof resolveLocaleWeekContext>;
type DailyReview = ProgressSeriesSnapshot["dailyReviews"][number];
type ChartNavigationDirection = "previous" | "next";
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
  weekdayLabel: string;
  dayLabel: string;
  monthLabel: string;
  showMonthLabel: boolean;
  barHeightPercentage: number;
  title: string;
}>;
type ChartPage = Readonly<{
  days: ReadonlyArray<ChartDay>;
  startDate: string;
  endDate: string;
  startLocalDate: string;
  upperBound: number;
  hasReviewActivity: boolean;
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
  dailyReviews: ReadonlyArray<DailyReview>,
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
    hasReviewActivity: dailyReviews.some((day) => day.reviewCount > 0),
  };
}

function buildChartPages(
  dailyReviews: ReadonlyArray<DailyReview>,
  today: string,
  formatDate: DateFormatter,
  weekContext: WeekContext,
): ReadonlyArray<ChartPage> {
  if (dailyReviews.length === 0) {
    return [];
  }

  const chartPages: Array<ChartPage> = [];
  let currentPageDays: Array<DailyReview> = [];
  let currentWeekStart: string | null = null;

  for (const day of dailyReviews) {
    const weekStart = getStartOfWeek(day.date, weekContext);

    if (currentWeekStart !== null && currentWeekStart !== weekStart) {
      chartPages.push(buildChartPage(currentPageDays, today, formatDate));
      currentPageDays = [day];
      currentWeekStart = weekStart;
      continue;
    }

    currentPageDays.push(day);
    currentWeekStart = weekStart;
  }

  if (currentPageDays.length > 0) {
    chartPages.push(buildChartPage(currentPageDays, today, formatDate));
  }

  return chartPages;
}

function buildChartGuideLabels(upperBound: number, formatNumber: NumberFormatter): ReadonlyArray<string> {
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

function formatChartRangeLabel(startDate: string, endDate: string, locale: LocaleValue): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).formatRange(parseLocalDate(startDate), parseLocalDate(endDate));
}

function resolveChartNavigationArrow(
  localeDirection: LocaleDirection,
  navigationDirection: ChartNavigationDirection,
): string {
  if (navigationDirection === "previous") {
    return localeDirection === "rtl" ? ">" : "<";
  }

  return localeDirection === "rtl" ? "<" : ">";
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
  const { locale, matchedBrowserLanguageTag, direction, t, formatDate, formatNumber } = useI18n();
  const [selectedPageStartLocalDate, setSelectedPageStartLocalDate] = useState<string | null>(null);
  const progressSummary = progressSourceState.summary.renderedSnapshot;
  const progress = progressSourceState.series.renderedSnapshot;
  const isLoading = progressSourceState.summary.isLoading || progressSourceState.series.isLoading;
  const errorMessage = progressSourceState.summary.errorMessage !== ""
    ? progressSourceState.summary.errorMessage
    : progressSourceState.series.errorMessage;
  const reviewProgressBadge = buildReviewProgressBadgeStateFromSummarySnapshot(progressSummary);

  useEffect(() => {
    setSelectedPageStartLocalDate(null);
  }, [progressSourceState.series.renderedSnapshot]);

  const dailyReviews = progress === null ? [] : sortDailyReviews(progress.dailyReviews);
  const today = progress === null ? "" : progress.to;
  const weekContext = resolveLocaleWeekContext(matchedBrowserLanguageTag ?? locale, locale);
  const streakWeeks = progress === null ? [] : buildStreakWeeks(dailyReviews, today, formatDate, weekContext);
  const chartPages = progress === null ? [] : buildChartPages(dailyReviews, today, formatDate, weekContext);
  const selectedPageIndex = chartPages.findIndex((page) => page.startLocalDate === selectedPageStartLocalDate);
  const visiblePage = chartPages.length === 0
    ? null
    : selectedPageStartLocalDate === null || selectedPageIndex === -1
      ? chartPages[chartPages.length - 1]
      : chartPages[selectedPageIndex];
  const resolvedSelectedPageIndex = visiblePage === null
    ? 0
    : chartPages.findIndex((page) => page.startLocalDate === visiblePage.startLocalDate);
  const chartGuideLabels = buildChartGuideLabels(visiblePage?.upperBound ?? 1, formatNumber);
  const pageRangeLabel = visiblePage === null
    ? ""
    : formatChartRangeLabel(visiblePage.startDate, visiblePage.endDate, locale);
  const reviewProgressBadgeTodayStatus = reviewProgressBadge.hasReviewedToday
    ? t("reviewScreen.progressBadge.reviewedToday")
    : t("reviewScreen.progressBadge.notReviewedToday");
  const reviewProgressBadgeAriaLabel = t("reviewScreen.progressBadge.ariaLabel", {
    streak: formatNumber(reviewProgressBadge.streakDays),
    todayStatus: reviewProgressBadgeTodayStatus,
  });
  const previousWeekArrow = resolveChartNavigationArrow(direction, "previous");
  const nextWeekArrow = resolveChartNavigationArrow(direction, "next");

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
                    className={`badge review-progress-badge progress-streak-summary-badge${reviewProgressBadge.hasReviewedToday ? " review-progress-badge-active" : ""}`}
                    aria-label={reviewProgressBadgeAriaLabel}
                    title={reviewProgressBadgeAriaLabel}
                  >
                    <ReviewProgressBadgeIcon />
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
                            {day.reviewCount > 0 ? (
                              <span className="progress-streak-marker-flame">
                                <ReviewProgressBadgeIcon />
                              </span>
                            ) : day.isFuture ? null : (
                              <span className="progress-streak-marker-day-value">{day.dayLabel}</span>
                            )}
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
                <div className="progress-chart-heading">
                  <h2 className="progress-section-title">{t("progressScreen.reviewsTitle")}</h2>
                  {visiblePage !== null ? (
                    <p className="progress-chart-range" data-testid="progress-chart-range">
                      {pageRangeLabel}
                    </p>
                  ) : null}
                </div>

                {chartPages.length > 1 ? (
                  <div className="progress-chart-nav">
                    <button
                      type="button"
                      className="ghost-btn progress-chart-nav-btn"
                      onClick={() => setSelectedPageStartLocalDate(chartPages[resolvedSelectedPageIndex - 1]?.startLocalDate ?? null)}
                      disabled={resolvedSelectedPageIndex <= 0}
                      aria-label={t("progressScreen.previousWeek")}
                      data-testid="progress-chart-previous-week"
                    >
                      <span className="progress-chart-nav-icon" aria-hidden="true">
                        {previousWeekArrow}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ghost-btn progress-chart-nav-btn"
                      onClick={() => setSelectedPageStartLocalDate(chartPages[resolvedSelectedPageIndex + 1]?.startLocalDate ?? null)}
                      disabled={resolvedSelectedPageIndex >= chartPages.length - 1}
                      aria-label={t("progressScreen.nextWeek")}
                      data-testid="progress-chart-next-week"
                    >
                      <span className="progress-chart-nav-icon" aria-hidden="true">
                        {nextWeekArrow}
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>

              {visiblePage !== null && visiblePage.hasReviewActivity === false ? (
                <p className="progress-chart-empty">{t("progressScreen.emptyWeek")}</p>
              ) : (
                <div className="progress-chart-shell">
                  <div className="progress-chart-y-axis" aria-hidden="true">
                    {chartGuideLabels.map((label, index) => (
                      <span
                        key={`progress-guide-label-${index}`}
                        className="progress-chart-y-label"
                        data-testid={index === 0 ? "progress-chart-y-label-max" : undefined}
                      >
                        {label}
                      </span>
                    ))}
                  </div>

                  <div className="progress-chart-plot">
                    <div className="progress-chart-guides" aria-hidden="true">
                      {chartGuideLabels.map((_, index) => (
                        <span key={`progress-guide-line-${index}`} className="progress-chart-guide-line" />
                      ))}
                    </div>

                    <div
                      className="progress-chart-columns"
                      style={visiblePage === null ? undefined : { gridTemplateColumns: `repeat(${visiblePage.days.length}, minmax(0, 1fr))` }}
                    >
                      {(visiblePage?.days ?? []).map((day) => {
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
                                data-testid={`progress-chart-bar-${day.date}`}
                              />
                            </div>
                            <div className="progress-chart-labels" aria-hidden="true">
                              <span className="progress-chart-month">
                                {day.showMonthLabel ? day.monthLabel : ""}
                              </span>
                              <span className="progress-chart-day">{day.dayLabel}</span>
                              <span className="progress-chart-weekday">{day.weekdayLabel}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

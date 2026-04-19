import { useEffect, useRef, type ReactElement } from "react";
import { useAppData } from "../appData";
import { useProgressInvalidationState } from "../appData/progressInvalidation";
import { parseLocalDate, useProgressSource } from "../appData/progressSource";
import { useI18n } from "../i18n";
import type { ProgressSeriesSnapshot } from "../types";

const streakDayCount = 35;
const streakWeekLength = 7;
const chartGuideLineCount = 3;

type DateFormatter = ReturnType<typeof useI18n>["formatDate"];
type NumberFormatter = ReturnType<typeof useI18n>["formatNumber"];
type DailyReview = ProgressSeriesSnapshot["dailyReviews"][number];
type StreakDay = Readonly<{
  date: string;
  reviewCount: number;
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
  showMonthLabel: boolean;
  barHeightPercentage: number;
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

function formatMonthLabel(value: string, formatDate: DateFormatter): string {
  return formatDate(parseLocalDate(value), {
    timeZone: "UTC",
    month: "short",
  });
}

function isFirstDayOfMonth(value: string): boolean {
  const parts = value.split("-");
  return parts[2] === "01";
}

function sortDailyReviews(dailyReviews: ProgressSeriesSnapshot["dailyReviews"]): ReadonlyArray<DailyReview> {
  return [...dailyReviews].sort((leftDay, rightDay) => leftDay.date.localeCompare(rightDay.date));
}

function buildStreakWeeks(
  dailyReviews: ReadonlyArray<DailyReview>,
  today: string,
  formatDate: DateFormatter,
): ReadonlyArray<ReadonlyArray<StreakDay>> {
  const streakDays = dailyReviews.slice(-streakDayCount).map((day): StreakDay => ({
    date: day.date,
    reviewCount: day.reviewCount,
    isToday: day.date === today,
    weekdayLabel: formatWeekdayLabel(day.date, formatDate),
    dayLabel: formatDayLabel(day.date, formatDate),
    title: formatLocalDateForDisplay(day.date, formatDate),
  }));
  const streakWeeks: Array<ReadonlyArray<StreakDay>> = [];

  for (let index = 0; index < streakDays.length; index += streakWeekLength) {
    streakWeeks.push(streakDays.slice(index, index + streakWeekLength));
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
): ReadonlyArray<ChartDay> {
  return dailyReviews.map((day): ChartDay => ({
    date: day.date,
    reviewCount: day.reviewCount,
    isToday: day.date === today,
    dayLabel: formatDayLabel(day.date, formatDate),
    monthLabel: formatMonthLabel(day.date, formatDate),
    showMonthLabel: isFirstDayOfMonth(day.date) || day.date === today,
    barHeightPercentage: calculateBarHeightPercentage(day.reviewCount, maxReviewCount),
    title: formatLocalDateForDisplay(day.date, formatDate),
  }));
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
  const { t, formatDate, formatNumber } = useI18n();
  const todayChartColumnRef = useRef<HTMLDivElement | null>(null);
  const progress = progressSourceState.series.renderedSnapshot;
  const isLoading = progressSourceState.summary.isLoading || progressSourceState.series.isLoading;
  const errorMessage = progressSourceState.summary.errorMessage !== ""
    ? progressSourceState.summary.errorMessage
    : progressSourceState.series.errorMessage;

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
  const streakWeeks = progress === null ? [] : buildStreakWeeks(dailyReviews, today, formatDate);
  const maxReviewCount = progress === null ? 0 : calculateMaxReviewCount(dailyReviews);
  const chartDays = progress === null ? [] : buildChartDays(dailyReviews, today, maxReviewCount, formatDate);
  const chartGuideLabels = buildChartGuideLabels(maxReviewCount, formatNumber);

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

              <div className="progress-streak-weeks">
                {streakWeeks.map((week, weekIndex) => (
                  <div key={`streak-week-${weekIndex}`} className="progress-streak-week">
                    {week.map((day) => {
                      const dayClassName = [
                        "progress-streak-day",
                        day.reviewCount > 0 ? "progress-streak-day-complete" : "",
                        day.isToday ? "progress-streak-day-today" : "",
                      ]
                        .filter((className) => className !== "")
                        .join(" ");

                      return (
                        <div key={day.date} className={dayClassName} title={day.title}>
                          <span className="progress-streak-weekday">{day.weekdayLabel}</span>
                          <span className="progress-streak-marker" aria-hidden="true">
                            {day.reviewCount > 0 ? "✓" : day.dayLabel}
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
                          day.isToday ? "progress-chart-column-today" : "",
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
                              <span className="progress-chart-day">{day.dayLabel}</span>
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

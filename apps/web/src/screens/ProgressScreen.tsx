import { useEffect, useRef, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import { loadProgressSeries } from "../api";
import { useI18n } from "../i18n";
import { loadPendingProgressDailyReviews } from "../localDb/reviews";
import type { ProgressSeries, ProgressSeriesInput } from "../types";

const progressRangeDayCount = 140;
const progressRangeStartOffsetDays = 1 - progressRangeDayCount;
const streakDayCount = 35;
const streakWeekLength = 7;
const chartGuideLineCount = 3;

type DateFormatter = ReturnType<typeof useI18n>["formatDate"];
type NumberFormatter = ReturnType<typeof useI18n>["formatNumber"];
type DailyReview = ProgressSeries["dailyReviews"][number];
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

function getRequiredDatePart(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  partType: "year" | "month" | "day",
): string {
  const partValue = parts.find((part) => part.type === partType)?.value;

  if (partValue === undefined || partValue === "") {
    throw new Error(`Browser timezone date is missing ${partType}`);
  }

  return partValue;
}

function getBrowserTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    throw new Error("Browser timezone is unavailable");
  }

  return timeZone;
}

function formatDateAsLocalDate(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = getRequiredDatePart(parts, "year");
  const month = getRequiredDatePart(parts, "month");
  const day = getRequiredDatePart(parts, "day");

  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string): Date {
  const [rawYear, rawMonth, rawDay] = value.split("-");
  const year = Number.parseInt(rawYear ?? "", 10);
  const month = Number.parseInt(rawMonth ?? "", 10);
  const day = Number.parseInt(rawDay ?? "", 10);

  if (Number.isInteger(year) === false || Number.isInteger(month) === false || Number.isInteger(day) === false) {
    throw new Error(`Invalid local date: ${value}`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function shiftLocalDate(value: string, offsetDays: number): string {
  const nextDate = parseLocalDate(value);
  nextDate.setUTCDate(nextDate.getUTCDate() + offsetDays);
  return nextDate.toISOString().slice(0, 10);
}

function buildProgressSeriesInput(now: Date): ProgressSeriesInput {
  const timeZone = getBrowserTimeZone();
  const to = formatDateAsLocalDate(now, timeZone);
  const from = shiftLocalDate(to, progressRangeStartOffsetDays);

  return {
    timeZone,
    from,
    to,
  };
}

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

function sortDailyReviews(dailyReviews: ProgressSeries["dailyReviews"]): ReadonlyArray<DailyReview> {
  return [...dailyReviews].sort((leftDay, rightDay) => leftDay.date.localeCompare(rightDay.date));
}

function collectAccessibleWorkspaceIds(
  activeWorkspaceId: string | null,
  availableWorkspaceIds: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const workspaceIds = new Set<string>(availableWorkspaceIds);

  if (activeWorkspaceId !== null) {
    workspaceIds.add(activeWorkspaceId);
  }

  return [...workspaceIds];
}

function buildDailyReviewCountMap(dailyReviews: ProgressSeries["dailyReviews"]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const day of dailyReviews) {
    counts.set(day.date, day.reviewCount);
  }

  return counts;
}

function mergeProgressWithPendingLocalReviews(
  progress: ProgressSeries,
  pendingLocalDailyReviews: ProgressSeries["dailyReviews"],
): ProgressSeries {
  const pendingReviewCounts = buildDailyReviewCountMap(pendingLocalDailyReviews);
  let hasPendingOverlay = false;
  const dailyReviews: ProgressSeries["dailyReviews"] = progress.dailyReviews.map((day) => {
    const pendingReviewCount = pendingReviewCounts.get(day.date) ?? 0;

    if (pendingReviewCount === 0) {
      return day;
    }

    hasPendingOverlay = true;

    return {
      date: day.date,
      reviewCount: day.reviewCount + pendingReviewCount,
    };
  });

  if (hasPendingOverlay === false) {
    return progress;
  }

  return {
    ...progress,
    dailyReviews,
  };
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
  const { activeWorkspace, availableWorkspaces, localReadVersion } = useAppData();
  const { t, formatDate, formatNumber } = useI18n();
  const [progress, setProgress] = useState<ProgressSeries | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [reloadSequence, setReloadSequence] = useState<number>(0);
  const todayChartColumnRef = useRef<HTMLDivElement | null>(null);
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const accessibleWorkspaceIds = collectAccessibleWorkspaceIds(
    activeWorkspaceId,
    availableWorkspaces.map((workspace) => workspace.workspaceId),
  );
  const accessibleWorkspaceIdsKey = accessibleWorkspaceIds.join(",");

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const input = buildProgressSeriesInput(new Date());
        const [serverProgress, pendingLocalDailyReviews] = await Promise.all([
          loadProgressSeries(input),
          loadPendingProgressDailyReviews(accessibleWorkspaceIds, input),
        ]);
        const nextProgress = mergeProgressWithPendingLocalReviews(serverProgress, pendingLocalDailyReviews);

        if (isCancelled) {
          return;
        }

        setProgress(nextProgress);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setProgress(null);
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadScreenData();

    return () => {
      isCancelled = true;
    };
  }, [accessibleWorkspaceIdsKey, localReadVersion, reloadSequence]);

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
        </div>

        {isLoading ? <p className="subtitle">{t("loading.progress")}</p> : null}

        {!isLoading && errorMessage !== "" ? (
          <>
            <p className="error-banner">{errorMessage}</p>
            <button
              className="primary-btn"
              type="button"
              onClick={() => setReloadSequence((currentSequence) => currentSequence + 1)}
            >
              {t("common.retry")}
            </button>
          </>
        ) : null}

        {!isLoading && errorMessage === "" && progress !== null ? (
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

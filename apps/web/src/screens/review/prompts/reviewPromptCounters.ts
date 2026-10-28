import {
  countLocalReviewEventsReviewedBetween,
  loadLocalProgressDailyReviews,
  loadLocalRecentReviewDays,
} from "../../../localDb/progress/progress";
import { buildProgressDateContext, parseLocalDate, shiftLocalDate } from "../../../progress/progressDates";
import type { ReviewPromptCounters } from "./reviewPromptRules";

// The counters' day runs from this local hour to the same hour next day, so a late-night session
// stays one day.
const reviewPromptDayStartHour: number = 4;
const hourMillis: number = 3_600_000;

function getRequiredWallClockPart(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  partType: "year" | "month" | "day" | "hour" | "minute" | "second",
): number {
  const partValue = parts.find((part) => part.type === partType)?.value;

  if (partValue === undefined || partValue === "") {
    throw new Error(`Review prompt day is missing ${partType}`);
  }

  return Number.parseInt(partValue, 10);
}

function createWallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

// The formatter's local wall clock at `date`, expressed as if it were UTC.
function readWallClockMillis(date: Date, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(date);

  return Date.UTC(
    getRequiredWallClockPart(parts, "year"),
    getRequiredWallClockPart(parts, "month") - 1,
    getRequiredWallClockPart(parts, "day"),
    getRequiredWallClockPart(parts, "hour"),
    getRequiredWallClockPart(parts, "minute"),
    getRequiredWallClockPart(parts, "second"),
  );
}

// Uses the local wall clock, so the boundary stays at 04:00 on daylight-saving days.
function formatReviewPromptDay(date: Date, formatter: Intl.DateTimeFormat): string {
  return new Date(readWallClockMillis(date, formatter) - reviewPromptDayStartHour * hourMillis)
    .toISOString()
    .slice(0, 10);
}

function resolveReviewPromptDayStart(reviewPromptDay: string, formatter: Intl.DateTimeFormat): string {
  const wallClockMillis = parseLocalDate(reviewPromptDay).getTime() + reviewPromptDayStartHour * hourMillis;
  let instantMillis = wallClockMillis;
  // The second pass applies the offset in effect at the boundary itself.
  for (let pass = 0; pass < 2; pass += 1) {
    instantMillis = wallClockMillis - (readWallClockMillis(new Date(instantMillis), formatter) - instantMillis);
  }

  return new Date(instantMillis).toISOString();
}

/**
 * `reviewDays` stops at `reviewDayLimit`, the largest `minReviewDays` any active prompt compares
 * against, so it is exact for every such comparison.
 */
export async function loadReviewPromptCounters(
  workspaceIds: ReadonlyArray<string>,
  now: Date,
  reviewDayLimit: number,
): Promise<ReviewPromptCounters> {
  const dateContext = buildProgressDateContext(now);
  const formatters = new Map<string, Intl.DateTimeFormat>();
  const getFormatter = (timeZone: string): Intl.DateTimeFormat => {
    let formatter = formatters.get(timeZone);
    if (formatter === undefined) {
      formatter = createWallClockFormatter(timeZone);
      formatters.set(timeZone, formatter);
    }
    return formatter;
  };
  const browserFormatter = getFormatter(dateContext.timeZone);
  const today = formatReviewPromptDay(now, browserFormatter);

  const [dailyReviews, reviewsToday, reviewDays] = await Promise.all([
    loadLocalProgressDailyReviews(workspaceIds, {
      timeZone: dateContext.timeZone,
      from: "0001-01-01",
      to: dateContext.today,
    }),
    countLocalReviewEventsReviewedBetween(
      workspaceIds,
      resolveReviewPromptDayStart(today, browserFormatter),
      resolveReviewPromptDayStart(shiftLocalDate(today, 1), browserFormatter),
    ),
    loadLocalRecentReviewDays(
      workspaceIds,
      (reviewEvent): string => {
        const reviewedAt = new Date(reviewEvent.reviewedAtClient);
        if (Number.isNaN(reviewedAt.getTime())) {
          throw new Error(`Invalid reviewedAtClient timestamp: ${reviewEvent.reviewedAtClient}`);
        }
        return formatReviewPromptDay(reviewedAt, getFormatter(reviewEvent.reviewedTimeZone ?? dateContext.timeZone));
      },
      reviewDayLimit,
    ),
  ]);

  return {
    totalReviews: dailyReviews.reduce((total, point) => total + point.reviewCount, 0),
    reviewsToday,
    reviewDays: Math.min(reviewDayLimit, reviewDays.size),
  };
}

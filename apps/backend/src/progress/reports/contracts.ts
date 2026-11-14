import { HttpError } from "../../shared/errors";
import type { StreakDay, StreakFreeze } from "../streakFreeze";
import { validateIanaTimeZone } from "../timeZone";

export type ProgressSummaryInput = Readonly<{
  timeZone: string;
}>;

export type ProgressReviewScheduleInput = Readonly<{
  timeZone: string;
}>;

export type ProgressSummaryRequest = Readonly<{
  userId: string;
}> & ProgressSummaryInput;

export type ProgressReviewScheduleRequest = Readonly<{
  userId: string;
}> & ProgressReviewScheduleInput;

export type ProgressSeriesInput = Readonly<{
  timeZone: string;
  from: string;
  to: string;
}>;

export type ProgressSeriesRequest = Readonly<{
  userId: string;
}> & ProgressSeriesInput;

export type DailyReviewPoint = Readonly<{
  date: string;
  reviewCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
}>;

export const reviewScheduleBucketKeys = [
  "new",
  "today",
  "days1To7",
  "days8To30",
  "days31To90",
  "days91To360",
  "years1To2",
  "later",
] as const;

export type ReviewScheduleBucketKey = typeof reviewScheduleBucketKeys[number];

export type ReviewScheduleBucket = Readonly<{
  key: ReviewScheduleBucketKey;
  count: number;
}>;

export type ProgressSummary = Readonly<{
  currentStreakDays: number;
  longestStreakDays: number;
  hasReviewedToday: boolean;
  lastReviewedOn: string | null;
  activeReviewDays: number;
  streakFreeze: StreakFreeze;
}>;

export type ProgressReviewHistoryWatermark = Readonly<{
  workspaceId: string;
  reviewSequenceId: number;
}>;

export type ProgressReviewHistoryWatermarkPayload = Readonly<{
  reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark>;
}>;

export type ProgressBestDay = Readonly<{
  date: string;
  reviewCount: number;
}>;

export type ProgressBestWeek = Readonly<{
  endDate: string;
  reviewCount: number;
}>;

export type ProgressStudySecondsDay = Readonly<{
  date: string;
  seconds: number;
}>;

// Server-only Progress facts that need lifetime or per-card history, which a
// client's local review log cannot be trusted to hold. "Last 7 days" and
// "week" mean the rolling 7 local days ending today. Bests exclude today so a
// client can compare its own local count for today without counting it twice.
export type ProgressInsights = Readonly<{
  totalReviews: number;
  bestDayBeforeToday: ProgressBestDay | null;
  bestWeekBeforeToday: ProgressBestWeek | null;
  cardsMetLast7Days: number;
  relearnedLast7Days: number;
  // Null under the timing sample (see loaders/insights.ts).
  secondsPerDueCard: number | null;
  studySecondsByDay: ReadonlyArray<ProgressStudySecondsDay> | null;
}>;

export type ProgressSummaryResponse = Readonly<{
  timeZone: string;
  summary: ProgressSummary;
  // Always sent by this backend; clients treat it as optional.
  insights: ProgressInsights;
  generatedAt: string;
}> & ProgressReviewHistoryWatermarkPayload;

export type ProgressSeries = Readonly<{
  timeZone: string;
  from: string;
  to: string;
  dailyReviews: ReadonlyArray<DailyReviewPoint>;
  streakDays: ReadonlyArray<StreakDay>;
  generatedAt: string;
}> & ProgressReviewHistoryWatermarkPayload;

export type ProgressReviewSchedule = Readonly<{
  timeZone: string;
  generatedAt: string;
  totalCards: number;
  buckets: ReadonlyArray<ReviewScheduleBucket>;
}> & ProgressReviewHistoryWatermarkPayload;

const maximumInclusiveProgressRangeDays = 366;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function throwProgressValidationError(message: string, code: string): never {
  throw new HttpError(400, message, code);
}

function validateTimeZone(value: string): string {
  const validation = validateIanaTimeZone(value);
  if (validation.ok) {
    return validation.timeZone;
  }

  if (validation.issue === "required") {
    throwProgressValidationError("timeZone is required", "PROGRESS_TIMEZONE_REQUIRED");
  }

  throwProgressValidationError(
    "timeZone must be a valid IANA timezone",
    "PROGRESS_TIMEZONE_INVALID",
  );
}

function validateProgressSummaryInput(input: ProgressSummaryInput): ProgressSummaryInput {
  return {
    timeZone: validateTimeZone(input.timeZone),
  };
}

function validateProgressReviewScheduleInput(input: ProgressReviewScheduleInput): ProgressReviewScheduleInput {
  return {
    timeZone: validateTimeZone(input.timeZone),
  };
}

function parseLocalDatePart(value: string, start: number, end: number): number {
  return Number.parseInt(value.slice(start, end), 10);
}

function validateLocalDate(value: string, fieldName: "from" | "to"): string {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throwProgressValidationError(`${fieldName} is required`, `PROGRESS_${fieldName.toUpperCase()}_REQUIRED`);
  }

  if (!localDatePattern.test(trimmedValue)) {
    throwProgressValidationError(
      `${fieldName} must be a YYYY-MM-DD date`,
      `PROGRESS_${fieldName.toUpperCase()}_INVALID`,
    );
  }

  const year = parseLocalDatePart(trimmedValue, 0, 4);
  const month = parseLocalDatePart(trimmedValue, 5, 7);
  const day = parseLocalDatePart(trimmedValue, 8, 10);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    throwProgressValidationError(
      `${fieldName} must be a YYYY-MM-DD date`,
      `PROGRESS_${fieldName.toUpperCase()}_INVALID`,
    );
  }

  return trimmedValue;
}

export function createUtcDateFromLocalDate(value: string): Date {
  const year = parseLocalDatePart(value, 0, 4);
  const month = parseLocalDatePart(value, 5, 7);
  const day = parseLocalDatePart(value, 8, 10);
  return new Date(Date.UTC(year, month - 1, day));
}

function calculateInclusiveRangeDayCount(from: string, to: string): number {
  const fromDate = createUtcDateFromLocalDate(from);
  const toDate = createUtcDateFromLocalDate(to);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((toDate.getTime() - fromDate.getTime()) / millisecondsPerDay) + 1;
}

function validateProgressSeriesInput(input: ProgressSeriesInput): ProgressSeriesInput {
  const timeZone = validateTimeZone(input.timeZone);
  const from = validateLocalDate(input.from, "from");
  const to = validateLocalDate(input.to, "to");

  if (from > to) {
    throwProgressValidationError("from must be less than or equal to to", "PROGRESS_RANGE_INVALID");
  }

  const inclusiveDayCount = calculateInclusiveRangeDayCount(from, to);
  if (inclusiveDayCount > maximumInclusiveProgressRangeDays) {
    throwProgressValidationError(
      `Date range must include at most ${maximumInclusiveProgressRangeDays} days`,
      "PROGRESS_RANGE_TOO_LARGE",
    );
  }

  return {
    timeZone,
    from,
    to,
  };
}

export function parseProgressSummaryInputFromRequest(request: Request): ProgressSummaryInput {
  const url = new URL(request.url);
  const rawTimeZone = url.searchParams.get("timeZone");

  if (rawTimeZone === null) {
    throwProgressValidationError("timeZone is required", "PROGRESS_TIMEZONE_REQUIRED");
  }

  return validateProgressSummaryInput({
    timeZone: rawTimeZone,
  });
}

export function parseProgressReviewScheduleInputFromRequest(request: Request): ProgressReviewScheduleInput {
  const url = new URL(request.url);
  const rawTimeZone = url.searchParams.get("timeZone");

  if (rawTimeZone === null) {
    throwProgressValidationError("timeZone is required", "PROGRESS_TIMEZONE_REQUIRED");
  }

  return validateProgressReviewScheduleInput({
    timeZone: rawTimeZone,
  });
}

export function parseProgressSeriesInputFromRequest(request: Request): ProgressSeriesInput {
  const url = new URL(request.url);
  const rawTimeZone = url.searchParams.get("timeZone");
  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");

  if (rawTimeZone === null) {
    throwProgressValidationError("timeZone is required", "PROGRESS_TIMEZONE_REQUIRED");
  }

  if (rawFrom === null) {
    throwProgressValidationError("from is required", "PROGRESS_FROM_REQUIRED");
  }

  if (rawTo === null) {
    throwProgressValidationError("to is required", "PROGRESS_TO_REQUIRED");
  }

  return validateProgressSeriesInput({
    timeZone: rawTimeZone,
    from: rawFrom,
    to: rawTo,
  });
}

import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type SqlValue,
} from "./db";
import { unsafeTransaction } from "./dbUnsafe";
import { HttpError } from "./errors";
import { listUserWorkspaceIdsInExecutor } from "./workspaces/queries";

export type ProgressSummaryInput = Readonly<{
  timeZone: string;
}>;

export type ProgressSummaryRequest = Readonly<{
  userId: string;
}> & ProgressSummaryInput;

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
}>;

export type ProgressSummary = Readonly<{
  currentStreakDays: number;
  hasReviewedToday: boolean;
  lastReviewedOn: string | null;
  activeReviewDays: number;
}>;

export type ProgressSummaryResponse = Readonly<{
  timeZone: string;
  summary: ProgressSummary;
  generatedAt: string;
}>;

export type ProgressSeries = Readonly<{
  timeZone: string;
  from: string;
  to: string;
  dailyReviews: ReadonlyArray<DailyReviewPoint>;
  generatedAt: string;
}>;

type DailyReviewCountRow = Readonly<{
  review_date: string;
  review_count: string | number;
}>;

type ReviewDateRow = Readonly<{
  review_date: string;
}>;

type WorkspaceProgressSummaryRequest = Readonly<{
  workspaceId: string;
  timeZone: string;
}>;

type WorkspaceProgressSeriesRequest = Readonly<{
  workspaceId: string;
}> & ProgressSeriesInput;

type CurrentStreakInfo = Readonly<{
  streakDayCount: number;
}>;

const maximumInclusiveProgressRangeDays = 366;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function throwProgressValidationError(message: string, code: string): never {
  throw new HttpError(400, message, code);
}

function validateTimeZone(value: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throwProgressValidationError("timeZone is required", "PROGRESS_TIMEZONE_REQUIRED");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmedValue });
  } catch {
    throwProgressValidationError(
      "timeZone must be a valid IANA timezone",
      "PROGRESS_TIMEZONE_INVALID",
    );
  }

  return trimmedValue;
}

function validateProgressSummaryInput(input: ProgressSummaryInput): ProgressSummaryInput {
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

function createUtcDateFromLocalDate(value: string): Date {
  const year = parseLocalDatePart(value, 0, 4);
  const month = parseLocalDatePart(value, 5, 7);
  const day = parseLocalDatePart(value, 8, 10);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDateAsLocalDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getRequiredDatePart(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  partType: "year" | "month" | "day",
): string {
  const value = parts.find((part) => part.type === partType)?.value;
  if (value === undefined || value === "") {
    throw new Error(`Timezone date is missing ${partType}`);
  }

  return value;
}

function formatDateAsTimeZoneLocalDate(value: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const year = getRequiredDatePart(parts, "year");
  const month = getRequiredDatePart(parts, "month");
  const day = getRequiredDatePart(parts, "day");

  return `${year}-${month}-${day}`;
}

function shiftLocalDate(value: string, offsetDays: number): string {
  const date = createUtcDateFromLocalDate(value);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatUtcDateAsLocalDate(date);
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

function createInclusiveLocalDateRange(from: string, to: string): ReadonlyArray<string> {
  const dates: Array<string> = [];
  const currentDate = createUtcDateFromLocalDate(from);
  const endDate = createUtcDateFromLocalDate(to);

  while (currentDate.getTime() <= endDate.getTime()) {
    dates.push(formatUtcDateAsLocalDate(currentDate));
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return dates;
}

function normalizeReviewCount(value: string | number, reviewDate: string): number {
  const normalizedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(normalizedValue) || normalizedValue < 0) {
    throw new Error(`Invalid review count returned for ${reviewDate}`);
  }

  return normalizedValue;
}

function accumulateDailyReviewCounts(
  aggregate: Map<string, number>,
  rows: ReadonlyArray<DailyReviewCountRow>,
): void {
  for (const row of rows) {
    const reviewDate = row.review_date;
    const reviewCount = normalizeReviewCount(row.review_count, reviewDate);
    aggregate.set(reviewDate, (aggregate.get(reviewDate) ?? 0) + reviewCount);
  }
}

function accumulateReviewDates(
  aggregate: Set<string>,
  rows: ReadonlyArray<ReviewDateRow>,
): void {
  for (const row of rows) {
    aggregate.add(row.review_date);
  }
}

function createDailyReviews(
  range: ReadonlyArray<string>,
  aggregate: ReadonlyMap<string, number>,
): ReadonlyArray<DailyReviewPoint> {
  return range.map((date) => ({
    date,
    reviewCount: aggregate.get(date) ?? 0,
  }));
}

async function loadDailyReviewCountRowsInExecutor(
  executor: DatabaseExecutor,
  request: WorkspaceProgressSeriesRequest,
): Promise<ReadonlyArray<DailyReviewCountRow>> {
  const queryParams: ReadonlyArray<SqlValue> = [
    request.workspaceId,
    request.timeZone,
    request.from,
    request.to,
  ];
  const result = await executor.query<DailyReviewCountRow>(
    [
      "SELECT",
      "to_char(timezone($2, review_events.reviewed_at_client)::date, 'YYYY-MM-DD') AS review_date,",
      "COUNT(*)::int AS review_count",
      "FROM content.review_events AS review_events",
      "WHERE review_events.workspace_id = $1",
      "AND review_events.reviewed_at_client >= (($3::date)::timestamp AT TIME ZONE $2)",
      "AND review_events.reviewed_at_client < (((($4::date) + 1)::timestamp) AT TIME ZONE $2)",
      "GROUP BY review_date",
      "ORDER BY review_date ASC",
    ].join(" "),
    queryParams,
  );

  return result.rows;
}

async function loadAllReviewDateRowsInExecutor(
  executor: DatabaseExecutor,
  request: WorkspaceProgressSummaryRequest,
): Promise<ReadonlyArray<ReviewDateRow>> {
  const queryParams: ReadonlyArray<SqlValue> = [
    request.workspaceId,
    request.timeZone,
  ];
  const result = await executor.query<ReviewDateRow>(
    [
      "SELECT",
      "to_char(review_local_dates.review_local_date, 'YYYY-MM-DD') AS review_date",
      "FROM (",
      "SELECT DISTINCT timezone($2, review_events.reviewed_at_client)::date AS review_local_date",
      "FROM content.review_events AS review_events",
      "WHERE review_events.workspace_id = $1",
      ") AS review_local_dates",
      "ORDER BY review_local_dates.review_local_date DESC",
    ].join(" "),
    queryParams,
  );

  return result.rows;
}

function calculateCurrentStreakInfo(
  reviewDates: ReadonlySet<string>,
  timeZone: string,
  now: Date,
): CurrentStreakInfo {
  const today = formatDateAsTimeZoneLocalDate(now, timeZone);
  let currentDate = reviewDates.has(today) ? today : shiftLocalDate(today, -1);
  let streakDayCount = 0;

  while (reviewDates.has(currentDate)) {
    streakDayCount += 1;
    currentDate = shiftLocalDate(currentDate, -1);
  }

  return {
    streakDayCount,
  };
}

function findLatestReviewedOn(
  currentLatest: string | null,
  candidateLatest: string | null,
): string | null {
  if (candidateLatest === null) {
    return currentLatest;
  }

  if (currentLatest === null) {
    return candidateLatest;
  }

  return currentLatest.localeCompare(candidateLatest) >= 0 ? currentLatest : candidateLatest;
}

function createProgressSummary(
  activeReviewDayCount: number,
  currentStreakDays: number,
  hasReviewedToday: boolean,
  lastReviewedOn: string | null,
): ProgressSummary {
  return {
    currentStreakDays,
    hasReviewedToday,
    lastReviewedOn,
    activeReviewDays: activeReviewDayCount,
  };
}

async function buildUserProgressSummaryInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSummaryRequest,
  generatedAtDate: Date,
): Promise<ProgressSummaryResponse> {
  const validatedInput = validateProgressSummaryInput(request);
  const reviewDates = new Set<string>();
  await applyUserDatabaseScopeInExecutor(executor, { userId: request.userId });
  // Human progress stays intentionally user-wide across every workspace the
  // user can still access; AI workspace routing does not change that contract.
  const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, request.userId);
  let lastReviewedOn: string | null = null;

  for (const workspaceId of workspaceIds) {
    await applyWorkspaceDatabaseScopeInExecutor(executor, {
      userId: request.userId,
      workspaceId,
    });
    const rows = await loadAllReviewDateRowsInExecutor(executor, {
      workspaceId,
      timeZone: validatedInput.timeZone,
    });
    accumulateReviewDates(reviewDates, rows);
    lastReviewedOn = findLatestReviewedOn(lastReviewedOn, rows[0]?.review_date ?? null);
  }

  const today = formatDateAsTimeZoneLocalDate(generatedAtDate, validatedInput.timeZone);
  // Future-dated rows can appear when a client clock is ahead, so today must
  // be checked against the full normalized date set instead of the latest date.
  const hasReviewedToday = reviewDates.has(today);
  const currentStreakInfo = calculateCurrentStreakInfo(reviewDates, validatedInput.timeZone, generatedAtDate);

  return {
    timeZone: validatedInput.timeZone,
    summary: createProgressSummary(
      reviewDates.size,
      currentStreakInfo.streakDayCount,
      hasReviewedToday,
      lastReviewedOn,
    ),
    generatedAt: generatedAtDate.toISOString(),
  };
}

async function buildUserProgressSeriesInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSeriesRequest,
  generatedAtDate: Date,
): Promise<ProgressSeries> {
  const validatedInput = validateProgressSeriesInput(request);
  const dailyReviewCounts = new Map<string, number>();
  await applyUserDatabaseScopeInExecutor(executor, { userId: request.userId });
  const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, request.userId);

  for (const workspaceId of workspaceIds) {
    // review_events reads are workspace-scoped by RLS, so aggregate one
    // workspace at a time after resolving the user's accessible memberships.
    await applyWorkspaceDatabaseScopeInExecutor(executor, {
      userId: request.userId,
      workspaceId,
    });
    const rows = await loadDailyReviewCountRowsInExecutor(executor, {
      workspaceId,
      timeZone: validatedInput.timeZone,
      from: validatedInput.from,
      to: validatedInput.to,
    });
    accumulateDailyReviewCounts(dailyReviewCounts, rows);
  }

  return {
    timeZone: validatedInput.timeZone,
    from: validatedInput.from,
    to: validatedInput.to,
    dailyReviews: createDailyReviews(
      createInclusiveLocalDateRange(validatedInput.from, validatedInput.to),
      dailyReviewCounts,
    ),
    generatedAt: generatedAtDate.toISOString(),
  };
}

export async function loadUserProgressSummaryInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSummaryRequest,
): Promise<ProgressSummaryResponse> {
  return buildUserProgressSummaryInExecutor(executor, request, new Date());
}

export async function loadUserProgressSeriesInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSeriesRequest,
): Promise<ProgressSeries> {
  return buildUserProgressSeriesInExecutor(executor, request, new Date());
}

export async function loadUserProgressSummary(request: ProgressSummaryRequest): Promise<ProgressSummaryResponse> {
  return unsafeTransaction(async (executor) => loadUserProgressSummaryInExecutor(executor, request));
}

export async function loadUserProgressSeries(request: ProgressSeriesRequest): Promise<ProgressSeries> {
  return unsafeTransaction(async (executor) => loadUserProgressSeriesInExecutor(executor, request));
}

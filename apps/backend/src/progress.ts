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

export type ProgressReviewSchedule = Readonly<{
  timeZone: string;
  generatedAt: string;
  totalCards: number;
  buckets: ReadonlyArray<ReviewScheduleBucket>;
}>;

type DailyReviewCountRow = Readonly<{
  review_date: string;
  review_count: string | number;
}>;

type ReviewDateRow = Readonly<{
  review_date: string;
}>;

type ReviewScheduleCountRow = Readonly<{
  new_count: string | number;
  today_count: string | number;
  days_1_to_7_count: string | number;
  days_8_to_30_count: string | number;
  days_31_to_90_count: string | number;
  days_91_to_360_count: string | number;
  years_1_to_2_count: string | number;
  later_count: string | number;
}>;

type ReviewScheduleBucketCounts = Readonly<Record<ReviewScheduleBucketKey, number>>;

const reviewScheduleSqlColumnByBucketKey: Readonly<Record<ReviewScheduleBucketKey, keyof ReviewScheduleCountRow>> = {
  new: "new_count",
  today: "today_count",
  days1To7: "days_1_to_7_count",
  days8To30: "days_8_to_30_count",
  days31To90: "days_31_to_90_count",
  days91To360: "days_91_to_360_count",
  years1To2: "years_1_to_2_count",
  later: "later_count",
};

type WorkspaceProgressSummaryRequest = Readonly<{
  workspaceId: string;
  timeZone: string;
}>;

type WorkspaceProgressReviewScheduleRequest = Readonly<{
  workspaceId: string;
  timeZone: string;
  generatedAt: Date;
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

function normalizeNonNegativeIntegerFromQuery(value: string | number, fieldName: string): number {
  const normalizedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(normalizedValue) || normalizedValue < 0) {
    throw new Error(`Invalid non-negative integer returned for ${fieldName}`);
  }

  return normalizedValue;
}

function createEmptyReviewScheduleBucketCounts(): ReviewScheduleBucketCounts {
  return Object.fromEntries(
    reviewScheduleBucketKeys.map((key) => [key, 0]),
  ) as ReviewScheduleBucketCounts;
}

function addReviewScheduleCountRow(
  counts: ReviewScheduleBucketCounts,
  row: ReviewScheduleCountRow,
): ReviewScheduleBucketCounts {
  return Object.fromEntries(
    reviewScheduleBucketKeys.map((key) => {
      const column = reviewScheduleSqlColumnByBucketKey[key];
      return [key, counts[key] + normalizeNonNegativeIntegerFromQuery(row[column], column)];
    }),
  ) as ReviewScheduleBucketCounts;
}

function createReviewScheduleBuckets(
  counts: ReviewScheduleBucketCounts,
): ReadonlyArray<ReviewScheduleBucket> {
  return reviewScheduleBucketKeys.map((key) => ({
    key,
    count: counts[key],
  }));
}

function calculateReviewScheduleTotalCards(counts: ReviewScheduleBucketCounts): number {
  return reviewScheduleBucketKeys.reduce(
    (total, key) => total + counts[key],
    0,
  );
}

function accumulateDailyReviewCounts(
  aggregate: Map<string, number>,
  rows: ReadonlyArray<DailyReviewCountRow>,
): void {
  for (const row of rows) {
    const reviewDate = row.review_date;
    const reviewCount = normalizeNonNegativeIntegerFromQuery(row.review_count, reviewDate);
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

async function loadReviewScheduleCountRowInExecutor(
  executor: DatabaseExecutor,
  request: WorkspaceProgressReviewScheduleRequest,
): Promise<ReviewScheduleCountRow> {
  const queryParams: ReadonlyArray<SqlValue> = [
    request.workspaceId,
    request.timeZone,
    request.generatedAt,
  ];
  const result = await executor.query<ReviewScheduleCountRow>(
    [
      "WITH schedule_boundaries AS (",
      "SELECT",
      "((timezone($2, $3::timestamptz)::date + 1)::timestamp AT TIME ZONE $2) AS tomorrow_start,",
      "((timezone($2, $3::timestamptz)::date + 8)::timestamp AT TIME ZONE $2) AS days_8_start,",
      "((timezone($2, $3::timestamptz)::date + 31)::timestamp AT TIME ZONE $2) AS days_31_start,",
      "((timezone($2, $3::timestamptz)::date + 91)::timestamp AT TIME ZONE $2) AS days_91_start,",
      "((timezone($2, $3::timestamptz)::date + 361)::timestamp AT TIME ZONE $2) AS days_361_start,",
      "((timezone($2, $3::timestamptz)::date + 721)::timestamp AT TIME ZONE $2) AS days_721_start",
      ")",
      "SELECT",
      "COUNT(*) FILTER (WHERE cards.due_at IS NULL)::int AS new_count,",
      "COUNT(*) FILTER (WHERE cards.due_at IS NOT NULL AND cards.due_at < schedule_boundaries.tomorrow_start)::int AS today_count,",
      "COUNT(*) FILTER (WHERE cards.due_at >= schedule_boundaries.tomorrow_start AND cards.due_at < schedule_boundaries.days_8_start)::int AS days_1_to_7_count,",
      "COUNT(*) FILTER (WHERE cards.due_at >= schedule_boundaries.days_8_start AND cards.due_at < schedule_boundaries.days_31_start)::int AS days_8_to_30_count,",
      "COUNT(*) FILTER (WHERE cards.due_at >= schedule_boundaries.days_31_start AND cards.due_at < schedule_boundaries.days_91_start)::int AS days_31_to_90_count,",
      "COUNT(*) FILTER (WHERE cards.due_at >= schedule_boundaries.days_91_start AND cards.due_at < schedule_boundaries.days_361_start)::int AS days_91_to_360_count,",
      "COUNT(*) FILTER (WHERE cards.due_at >= schedule_boundaries.days_361_start AND cards.due_at < schedule_boundaries.days_721_start)::int AS years_1_to_2_count,",
      "COUNT(*) FILTER (WHERE cards.due_at >= schedule_boundaries.days_721_start)::int AS later_count",
      "FROM content.cards AS cards",
      "CROSS JOIN schedule_boundaries",
      "WHERE cards.workspace_id = $1 AND cards.deleted_at IS NULL",
    ].join(" "),
    queryParams,
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Review schedule query did not return a row");
  }

  return row;
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
      timeZone: request.timeZone,
    });
    accumulateReviewDates(reviewDates, rows);
    lastReviewedOn = findLatestReviewedOn(lastReviewedOn, rows[0]?.review_date ?? null);
  }

  const today = formatDateAsTimeZoneLocalDate(generatedAtDate, request.timeZone);
  // Future-dated rows can appear when a client clock is ahead, so today must
  // be checked against the full normalized date set instead of the latest date.
  const hasReviewedToday = reviewDates.has(today);
  const currentStreakInfo = calculateCurrentStreakInfo(reviewDates, request.timeZone, generatedAtDate);

  return {
    timeZone: request.timeZone,
    summary: createProgressSummary(
      reviewDates.size,
      currentStreakInfo.streakDayCount,
      hasReviewedToday,
      lastReviewedOn,
    ),
    generatedAt: generatedAtDate.toISOString(),
  };
}

async function buildUserProgressReviewScheduleInExecutor(
  executor: DatabaseExecutor,
  request: ProgressReviewScheduleRequest,
  generatedAtDate: Date,
): Promise<ProgressReviewSchedule> {
  let counts = createEmptyReviewScheduleBucketCounts();
  await applyUserDatabaseScopeInExecutor(executor, { userId: request.userId });
  const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, request.userId);

  for (const workspaceId of workspaceIds) {
    await applyWorkspaceDatabaseScopeInExecutor(executor, {
      userId: request.userId,
      workspaceId,
    });
    const row = await loadReviewScheduleCountRowInExecutor(executor, {
      workspaceId,
      timeZone: request.timeZone,
      generatedAt: generatedAtDate,
    });
    counts = addReviewScheduleCountRow(counts, row);
  }

  return {
    timeZone: request.timeZone,
    generatedAt: generatedAtDate.toISOString(),
    totalCards: calculateReviewScheduleTotalCards(counts),
    buckets: createReviewScheduleBuckets(counts),
  };
}

async function buildUserProgressSeriesInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSeriesRequest,
  generatedAtDate: Date,
): Promise<ProgressSeries> {
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
      timeZone: request.timeZone,
      from: request.from,
      to: request.to,
    });
    accumulateDailyReviewCounts(dailyReviewCounts, rows);
  }

  return {
    timeZone: request.timeZone,
    from: request.from,
    to: request.to,
    dailyReviews: createDailyReviews(
      createInclusiveLocalDateRange(request.from, request.to),
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

export async function loadUserProgressReviewScheduleInExecutor(
  executor: DatabaseExecutor,
  request: ProgressReviewScheduleRequest,
): Promise<ProgressReviewSchedule> {
  return buildUserProgressReviewScheduleInExecutor(executor, request, new Date());
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

export async function loadUserProgressReviewSchedule(
  request: ProgressReviewScheduleRequest,
): Promise<ProgressReviewSchedule> {
  return unsafeTransaction(async (executor) => loadUserProgressReviewScheduleInExecutor(executor, request));
}

export async function loadUserProgressSeries(request: ProgressSeriesRequest): Promise<ProgressSeries> {
  return unsafeTransaction(async (executor) => loadUserProgressSeriesInExecutor(executor, request));
}

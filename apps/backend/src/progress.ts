import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type SqlValue,
} from "./db";
import { unsafeTransaction } from "./dbUnsafe";
import { HttpError } from "./errors";
import { listUserWorkspaceIdsInExecutor } from "./workspaces/queries";

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

export type ProgressSeries = Readonly<{
  timeZone: string;
  from: string;
  to: string;
  dailyReviews: ReadonlyArray<DailyReviewPoint>;
}>;

type DailyReviewCountRow = Readonly<{
  review_date: string;
  review_count: string | number;
}>;

type WorkspaceProgressSeriesRequest = Readonly<{
  workspaceId: string;
}> & ProgressSeriesInput;

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

export async function loadUserProgressSeriesInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSeriesRequest,
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
  };
}

export async function loadUserProgressSeries(request: ProgressSeriesRequest): Promise<ProgressSeries> {
  return unsafeTransaction(async (executor) => loadUserProgressSeriesInExecutor(executor, request));
}

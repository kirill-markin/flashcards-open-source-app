import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type SqlValue,
} from "../database";
import { withTransientDatabaseRetry } from "../database/transient";
import { unsafeRepeatableReadTransaction } from "../database/unsafe";
import { createBackendRuntimeObservationScope } from "../observability/sentry";
import { HttpError } from "../shared/errors";
import { listUserWorkspaceIdsInExecutor } from "../workspaces/queries";
import {
  loadUserActiveReviewLocalDatesInExecutor,
  materializeMissingActiveReviewDaysForUserInExecutor,
  rememberProgressTimeZoneInExecutor,
} from "./activeReviewDays";
import {
  evaluateStreakFreeze,
  streakFreezePolicy,
  type StreakDay,
  type StreakDayState,
  type StreakFreeze,
} from "./streakFreeze";
import {
  formatDateAsTimeZoneLocalDate,
  validateIanaTimeZone,
} from "./timeZone";

// The compact Progress-tab community leaderboard lives in the community module
// (next to the snapshot writer) but is re-exported here so every /me/progress/*
// loader is imported from one place by the route layer.
export {
  loadLeaderboardProfile,
  loadLeaderboardProfileInExecutor,
  type LeaderboardProfile,
  type LeaderboardProfileRequest,
} from "../community/leaderboard/leaderboardProfile";
export {
  loadProgressLeaderboard,
  loadProgressLeaderboardInExecutor,
  type ProgressLeaderboard,
  type ProgressLeaderboardRequest,
} from "../community/leaderboard/progress/progressLeaderboard";
export {
  loadStreakLeaderboard,
  loadStreakLeaderboardInExecutor,
  type StreakLeaderboard,
  type StreakLeaderboardRequest,
} from "../community/leaderboard/streak/streakLeaderboard";

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

export type ProgressSummaryResponse = Readonly<{
  timeZone: string;
  summary: ProgressSummary;
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

type DailyReviewCountRow = Readonly<{
  review_date: string;
  review_count: string | number;
  again_count: string | number;
  hard_count: string | number;
  good_count: string | number;
  easy_count: string | number;
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

type ReviewHistoryWatermarkRow = Readonly<{
  workspace_id: string;
  review_sequence_id: string | number;
}>;

type ReviewScheduleBucketCounts = Readonly<Record<ReviewScheduleBucketKey, number>>;

type DailyReviewCounts = Readonly<{
  reviewCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
}>;

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

type WorkspaceProgressReviewScheduleRequest = Readonly<{
  workspaceId: string;
  timeZone: string;
  generatedAt: Date;
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

function createUtcDateFromLocalDate(value: string): Date {
  const year = parseLocalDatePart(value, 0, 4);
  const month = parseLocalDatePart(value, 5, 7);
  const day = parseLocalDatePart(value, 8, 10);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDateAsLocalDate(value: Date): string {
  return value.toISOString().slice(0, 10);
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

function parseReviewSequenceId(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return Number.NaN;
  }

  return Number.parseInt(trimmedValue, 10);
}

function normalizeReviewSequenceId(value: string | number, workspaceId: string): number {
  const normalizedValue = parseReviewSequenceId(value);
  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < 0) {
    throw new Error(
      `Invalid review_sequence returned for progress watermark: workspaceId=${workspaceId}, value=${String(value)}`,
    );
  }

  return normalizedValue;
}

function mapReviewHistoryWatermarkRow(row: ReviewHistoryWatermarkRow): ProgressReviewHistoryWatermark {
  const workspaceId = row.workspace_id.trim();
  if (workspaceId === "") {
    throw new Error("Invalid workspace_id returned for progress watermark");
  }

  return {
    workspaceId,
    reviewSequenceId: normalizeReviewSequenceId(row.review_sequence_id, workspaceId),
  };
}

function createSortedWorkspaceIds(workspaceIds: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(workspaceIds)].sort((left, right) => left.localeCompare(right));
}

function assertWatermarkRowsCoverWorkspaceIds(
  workspaceIds: ReadonlyArray<string>,
  rows: ReadonlyArray<ReviewHistoryWatermarkRow>,
): void {
  const expectedWorkspaceIds = createSortedWorkspaceIds(workspaceIds);
  const actualWorkspaceIds = createSortedWorkspaceIds(rows.map((row) => row.workspace_id));
  const hasMismatchedWorkspaceIds = expectedWorkspaceIds.length !== actualWorkspaceIds.length
    || expectedWorkspaceIds.some((workspaceId, index) => workspaceId !== actualWorkspaceIds[index]);

  if (hasMismatchedWorkspaceIds) {
    throw new Error(
      [
        "Review-history watermark query did not return one row per workspace",
        `expectedWorkspaceIds=${expectedWorkspaceIds.join(",")}`,
        `returnedWorkspaceIds=${actualWorkspaceIds.join(",")}`,
      ].join("; "),
    );
  }
}

function sortReviewHistoryWatermarks(
  watermarks: ReadonlyArray<ProgressReviewHistoryWatermark>,
): ReadonlyArray<ProgressReviewHistoryWatermark> {
  return [...watermarks].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
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

function createEmptyDailyReviewCounts(): DailyReviewCounts {
  return {
    reviewCount: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
  };
}

function addDailyReviewCounts(
  left: DailyReviewCounts,
  right: DailyReviewCounts,
): DailyReviewCounts {
  return {
    reviewCount: left.reviewCount + right.reviewCount,
    againCount: left.againCount + right.againCount,
    hardCount: left.hardCount + right.hardCount,
    goodCount: left.goodCount + right.goodCount,
    easyCount: left.easyCount + right.easyCount,
  };
}

function mapDailyReviewCountRow(row: DailyReviewCountRow): DailyReviewCounts {
  return {
    reviewCount: normalizeNonNegativeIntegerFromQuery(row.review_count, `${row.review_date}.review_count`),
    againCount: normalizeNonNegativeIntegerFromQuery(row.again_count, `${row.review_date}.again_count`),
    hardCount: normalizeNonNegativeIntegerFromQuery(row.hard_count, `${row.review_date}.hard_count`),
    goodCount: normalizeNonNegativeIntegerFromQuery(row.good_count, `${row.review_date}.good_count`),
    easyCount: normalizeNonNegativeIntegerFromQuery(row.easy_count, `${row.review_date}.easy_count`),
  };
}

function addDailyReviewCountRows(
  aggregate: ReadonlyMap<string, DailyReviewCounts>,
  rows: ReadonlyArray<DailyReviewCountRow>,
): ReadonlyMap<string, DailyReviewCounts> {
  const nextAggregate = new Map(aggregate);

  for (const row of rows) {
    const reviewDate = row.review_date;
    nextAggregate.set(
      reviewDate,
      addDailyReviewCounts(
        nextAggregate.get(reviewDate) ?? createEmptyDailyReviewCounts(),
        mapDailyReviewCountRow(row),
      ),
    );
  }

  return nextAggregate;
}

function createDailyReviews(
  range: ReadonlyArray<string>,
  aggregate: ReadonlyMap<string, DailyReviewCounts>,
): ReadonlyArray<DailyReviewPoint> {
  return range.map((date) => {
    const counts = aggregate.get(date) ?? createEmptyDailyReviewCounts();
    return {
      date,
      reviewCount: counts.reviewCount,
      againCount: counts.againCount,
      hardCount: counts.hardCount,
      goodCount: counts.goodCount,
      easyCount: counts.easyCount,
    };
  });
}

function createStreakDays(
  range: ReadonlyArray<string>,
  activeReviewDates: ReadonlySet<string>,
  evaluatedStreakDays: ReadonlyArray<StreakDay>,
  today: string,
): ReadonlyArray<StreakDay> {
  const evaluatedStatesByDate: ReadonlyMap<string, StreakDayState> = new Map(
    evaluatedStreakDays.map((day) => [day.date, day.state]),
  );

  return range.map((date) => {
    const state: StreakDayState = activeReviewDates.has(date)
      ? "reviewed"
      : evaluatedStatesByDate.get(date) ?? (date >= today ? "pending" : "missed");

    return {
      date,
      state,
    };
  });
}

async function loadReviewHistoryWatermarksInExecutor(
  executor: DatabaseExecutor,
  workspaceIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<ProgressReviewHistoryWatermark>> {
  if (workspaceIds.length === 0) {
    return [];
  }

  const result = await executor.query<ReviewHistoryWatermarkRow>(
    [
      "WITH requested_workspaces AS (",
      "SELECT requested_workspace_ids.workspace_id",
      "FROM unnest($1::uuid[]) AS requested_workspace_ids(workspace_id)",
      "WHERE security.current_workspace_access_allowed(requested_workspace_ids.workspace_id)",
      ")",
      "SELECT",
      "requested_workspaces.workspace_id::text AS workspace_id,",
      "COALESCE(MAX(review_events.review_sequence), 0) AS review_sequence_id",
      "FROM requested_workspaces",
      "LEFT JOIN content.review_events AS review_events",
      "ON review_events.workspace_id = requested_workspaces.workspace_id",
      "GROUP BY requested_workspaces.workspace_id",
      "ORDER BY requested_workspaces.workspace_id ASC",
    ].join(" "),
    [workspaceIds],
  );

  assertWatermarkRowsCoverWorkspaceIds(workspaceIds, result.rows);
  return result.rows.map(mapReviewHistoryWatermarkRow);
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
      "COUNT(*)::int AS review_count,",
      "COUNT(*) FILTER (WHERE review_events.rating = 0)::int AS again_count,",
      "COUNT(*) FILTER (WHERE review_events.rating = 1)::int AS hard_count,",
      "COUNT(*) FILTER (WHERE review_events.rating = 2)::int AS good_count,",
      "COUNT(*) FILTER (WHERE review_events.rating = 3)::int AS easy_count",
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

function createProgressSummary(
  activeReviewDayCount: number,
  currentStreakDays: number,
  longestStreakDays: number,
  hasReviewedToday: boolean,
  lastReviewedOn: string | null,
  streakFreeze: StreakFreeze,
): ProgressSummary {
  return {
    currentStreakDays,
    longestStreakDays,
    hasReviewedToday,
    lastReviewedOn,
    activeReviewDays: activeReviewDayCount,
    streakFreeze,
  };
}

async function buildUserProgressSummaryInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSummaryRequest,
  generatedAtDate: Date,
): Promise<ProgressSummaryResponse> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: request.userId });
  // Personal Progress active streak days are user-wide materialized days.
  // The workspace loop only bounds raw review_event and watermark reads by RLS.
  const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, request.userId);
  await rememberProgressTimeZoneInExecutor(executor, request.userId, request.timeZone);
  let reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark> = [];

  for (const workspaceId of workspaceIds) {
    await applyWorkspaceDatabaseScopeInExecutor(executor, {
      userId: request.userId,
      workspaceId,
    });
    await materializeMissingActiveReviewDaysForUserInExecutor(
      executor,
      request.userId,
      workspaceId,
      request.timeZone,
    );
    reviewHistoryWatermarks = reviewHistoryWatermarks.concat(
      await loadReviewHistoryWatermarksInExecutor(executor, [workspaceId]),
    );
  }

  const activeReviewLocalDates = await loadUserActiveReviewLocalDatesInExecutor(executor, request.userId);
  const activeReviewDateSet = new Set(activeReviewLocalDates);
  const lastReviewedOn = activeReviewLocalDates.at(-1) ?? null;
  const today = formatDateAsTimeZoneLocalDate(generatedAtDate, request.timeZone);
  // Future-dated rows can appear when a client clock is ahead, so today must
  // be checked against the full normalized date set instead of the latest date.
  const hasReviewedToday = activeReviewDateSet.has(today);
  const streakFreezeEvaluation = evaluateStreakFreeze(
    activeReviewLocalDates,
    today,
    streakFreezePolicy,
  );

  return {
    timeZone: request.timeZone,
    summary: createProgressSummary(
      activeReviewLocalDates.length,
      streakFreezeEvaluation.currentStreakDays,
      streakFreezeEvaluation.longestStreakDays,
      hasReviewedToday,
      lastReviewedOn,
      streakFreezeEvaluation.streakFreeze,
    ),
    generatedAt: generatedAtDate.toISOString(),
    reviewHistoryWatermarks: sortReviewHistoryWatermarks(reviewHistoryWatermarks),
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
  let reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark> = [];

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
    reviewHistoryWatermarks = reviewHistoryWatermarks.concat(
      await loadReviewHistoryWatermarksInExecutor(executor, [workspaceId]),
    );
  }

  return {
    timeZone: request.timeZone,
    generatedAt: generatedAtDate.toISOString(),
    totalCards: calculateReviewScheduleTotalCards(counts),
    buckets: createReviewScheduleBuckets(counts),
    reviewHistoryWatermarks: sortReviewHistoryWatermarks(reviewHistoryWatermarks),
  };
}

async function buildUserProgressSeriesInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSeriesRequest,
  generatedAtDate: Date,
): Promise<ProgressSeries> {
  let dailyReviewCounts: ReadonlyMap<string, DailyReviewCounts> = new Map<string, DailyReviewCounts>();
  await applyUserDatabaseScopeInExecutor(executor, { userId: request.userId });
  // Daily review counts stay on the bounded raw range query, while streak
  // state comes from the user-wide materialized active-day table below.
  const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, request.userId);
  await rememberProgressTimeZoneInExecutor(executor, request.userId, request.timeZone);
  let reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark> = [];

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
    dailyReviewCounts = addDailyReviewCountRows(dailyReviewCounts, rows);
    await materializeMissingActiveReviewDaysForUserInExecutor(
      executor,
      request.userId,
      workspaceId,
      request.timeZone,
    );
    reviewHistoryWatermarks = reviewHistoryWatermarks.concat(
      await loadReviewHistoryWatermarksInExecutor(executor, [workspaceId]),
    );
  }

  const range = createInclusiveLocalDateRange(request.from, request.to);
  const activeReviewLocalDates = await loadUserActiveReviewLocalDatesInExecutor(executor, request.userId);
  const activeReviewDateSet = new Set(activeReviewLocalDates);
  const today = formatDateAsTimeZoneLocalDate(generatedAtDate, request.timeZone);
  const streakFreezeEvaluation = evaluateStreakFreeze(
    activeReviewLocalDates,
    today,
    streakFreezePolicy,
  );

  return {
    timeZone: request.timeZone,
    from: request.from,
    to: request.to,
    dailyReviews: createDailyReviews(
      range,
      dailyReviewCounts,
    ),
    streakDays: createStreakDays(
      range,
      activeReviewDateSet,
      streakFreezeEvaluation.streakDays,
      today,
    ),
    generatedAt: generatedAtDate.toISOString(),
    reviewHistoryWatermarks: sortReviewHistoryWatermarks(reviewHistoryWatermarks),
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
  return withTransientDatabaseRetry(
    () => unsafeRepeatableReadTransaction(
      async (executor) => loadUserProgressSummaryInExecutor(executor, request),
    ),
    createBackendRuntimeObservationScope,
  );
}

export async function loadUserProgressReviewSchedule(
  request: ProgressReviewScheduleRequest,
): Promise<ProgressReviewSchedule> {
  return unsafeRepeatableReadTransaction(
    async (executor) => loadUserProgressReviewScheduleInExecutor(executor, request),
  );
}

export async function loadUserProgressSeries(request: ProgressSeriesRequest): Promise<ProgressSeries> {
  return withTransientDatabaseRetry(
    () => unsafeRepeatableReadTransaction(
      async (executor) => loadUserProgressSeriesInExecutor(executor, request),
    ),
    createBackendRuntimeObservationScope,
  );
}

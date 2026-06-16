import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import { streakFreezePolicy } from "./streakFreeze";

type QueryResultRow = pg.QueryResultRow;

export type DailyReviewCountRow = Readonly<{
  review_date: string;
  review_count: string | number;
  again_count: string | number;
  hard_count: string | number;
  good_count: string | number;
  easy_count: string | number;
}>;

export type ReviewDateRow = Readonly<{
  review_date: string;
}>;

export type ReviewScheduleCountRow = Readonly<{
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

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
}>;

export type ProgressExecutorFixture = Readonly<{
  workspaceIdsByUser: Readonly<Record<string, ReadonlyArray<string>>>;
  reviewRowsByRequest: Readonly<Record<string, ReadonlyArray<DailyReviewCountRow>>>;
  allReviewDateRowsByRequest: Readonly<Record<string, ReadonlyArray<ReviewDateRow>>>;
  reviewScheduleRowsByRequest: Readonly<Record<string, ReadonlyArray<ReviewScheduleCountRow>>>;
  reviewSequenceIdsByWorkspaceId: Readonly<Record<string, string | number>>;
}>;

export type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

type ScopeState = Readonly<{
  userId: string | null;
  workspaceId: string | null;
}>;

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

export function formatDateAsTimeZoneLocalDate(value: Date, timeZone: string): string {
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

export function shiftLocalDate(value: string, offsetDays: number): string {
  const [rawYear, rawMonth, rawDay] = value.split("-");
  const year = Number.parseInt(rawYear ?? "", 10);
  const month = Number.parseInt(rawMonth ?? "", 10);
  const day = Number.parseInt(rawDay ?? "", 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid local date: ${value}`);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function createReviewDateRows(from: string, to: string): ReadonlyArray<ReviewDateRow> {
  const rows: Array<ReviewDateRow> = [];
  let currentDate = from;

  while (currentDate <= to) {
    rows.push({ review_date: currentDate });
    currentDate = shiftLocalDate(currentDate, 1);
  }

  return rows;
}

export function createDailyReviewCountRows(from: string, to: string): ReadonlyArray<DailyReviewCountRow> {
  return createReviewDateRows(from, to).map((row) => ({
    review_date: row.review_date,
    review_count: 1,
    again_count: 0,
    hard_count: 0,
    good_count: 1,
    easy_count: 0,
  }));
}

export function createReviewScheduleCountRow(
  counts: Readonly<{
    newCount: string | number;
    todayCount: string | number;
    days1To7Count: string | number;
    days8To30Count: string | number;
    days31To90Count: string | number;
    days91To360Count: string | number;
    years1To2Count: string | number;
    laterCount: string | number;
  }>,
): ReviewScheduleCountRow {
  return {
    new_count: counts.newCount,
    today_count: counts.todayCount,
    days_1_to_7_count: counts.days1To7Count,
    days_8_to_30_count: counts.days8To30Count,
    days_31_to_90_count: counts.days31To90Count,
    days_91_to_360_count: counts.days91To360Count,
    years_1_to_2_count: counts.years1To2Count,
    later_count: counts.laterCount,
  };
}

export function createEmptyReviewScheduleCountRow(): ReviewScheduleCountRow {
  return createReviewScheduleCountRow({
    newCount: 0,
    todayCount: 0,
    days1To7Count: 0,
    days8To30Count: 0,
    days31To90Count: 0,
    days91To360Count: 0,
    years1To2Count: 0,
    laterCount: 0,
  });
}

export function createFullStreakFreeze(): Readonly<{
  availableCredits: number;
  capacity: number;
  balanceUnits: number;
  unitsPerCredit: number;
  earnedUnitsPerStreakDay: number;
  nextCreditProgressUnits: number;
  nextCreditRequiredUnits: number;
}> {
  return {
    availableCredits: 2,
    capacity: 2,
    balanceUnits: 20,
    unitsPerCredit: 10,
    earnedUnitsPerStreakDay: streakFreezePolicy.earnedUnitsPerStreakDay,
    nextCreditProgressUnits: 0,
    nextCreditRequiredUnits: 10,
  };
}

export function createStreakFreezeAfterOneFrozenDay(): Readonly<{
  availableCredits: number;
  capacity: number;
  balanceUnits: number;
  unitsPerCredit: number;
  earnedUnitsPerStreakDay: number;
  nextCreditProgressUnits: number;
  nextCreditRequiredUnits: number;
}> {
  return {
    availableCredits: 1,
    capacity: 2,
    balanceUnits: 11,
    unitsPerCredit: 10,
    earnedUnitsPerStreakDay: streakFreezePolicy.earnedUnitsPerStreakDay,
    nextCreditProgressUnits: 1,
    nextCreditRequiredUnits: 10,
  };
}

export function createInclusiveLocalDateRange(from: string, to: string): ReadonlyArray<string> {
  const dates: Array<string> = [];
  let currentDate = from;

  while (currentDate <= to) {
    dates.push(currentDate);
    currentDate = shiftLocalDate(currentDate, 1);
  }

  return dates;
}

function createQueryResult<Row extends QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    rows: [...rows],
    fields: [],
  };
}

function isStringArray(value: SqlValue | undefined): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function createProgressExecutor(
  fixture: ProgressExecutorFixture,
): Readonly<{
  executor: DatabaseExecutor;
  recordedQueries: ReadonlyArray<RecordedQuery>;
}> {
  const recordedQueries: Array<RecordedQuery> = [];
  let scope: ScopeState = {
    userId: null,
    workspaceId: null,
  };

  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });

      if (text.includes("set_config('app.user_id', $1, true)")) {
        const userId = typeof params[0] === "string" ? params[0] : String(params[0]);
        const workspaceIdValue = typeof params[1] === "string" ? params[1] : String(params[1]);
        scope = {
          userId,
          workspaceId: workspaceIdValue === "" ? null : workspaceIdValue,
        };
        return createQueryResult<QueryResultRow>([]) as pg.QueryResult<Row>;
      }

      if (
        text.includes("SELECT memberships.workspace_id")
        && text.includes("FROM org.workspace_memberships memberships")
      ) {
        const userId = typeof params[0] === "string" ? params[0] : String(params[0]);
        if (scope.userId !== userId || scope.workspaceId !== null) {
          throw new Error("Workspace membership query requires user scope without a workspace");
        }

        return createQueryResult<WorkspaceMembershipRow>(
          (fixture.workspaceIdsByUser[userId] ?? []).map((workspaceId) => ({ workspace_id: workspaceId })),
        ) as unknown as pg.QueryResult<Row>;
      }

      if (
        text.includes("COALESCE(MAX(review_events.review_sequence), 0) AS review_sequence_id")
        && text.includes("FROM unnest($1::uuid[]) AS requested_workspace_ids(workspace_id)")
      ) {
        const workspaceIdsParam = params[0];
        if (!isStringArray(workspaceIdsParam)) {
          throw new Error("Review-history watermark query requires workspace id array parameter");
        }

        if (scope.userId === null || scope.workspaceId === null) {
          throw new Error("Review-history watermark query requires workspace scope");
        }

        const rows = workspaceIdsParam.map((workspaceId) => {
          if (workspaceId !== scope.workspaceId) {
            throw new Error("Review-history watermark query requires matching workspace scope");
          }

          const reviewSequenceId = fixture.reviewSequenceIdsByWorkspaceId[workspaceId];
          if (reviewSequenceId === undefined) {
            throw new Error(`Missing review-history watermark fixture for ${workspaceId}`);
          }

          return {
            workspace_id: workspaceId,
            review_sequence_id: reviewSequenceId,
          };
        }).sort((left, right) => left.workspace_id.localeCompare(right.workspace_id));

        return createQueryResult<ReviewHistoryWatermarkRow>(rows) as unknown as pg.QueryResult<Row>;
      }

      if (
        text.includes("FROM content.review_events AS review_events")
        && text.includes("COUNT(*)::int AS review_count")
      ) {
        const workspaceId = typeof params[0] === "string" ? params[0] : String(params[0]);
        const timeZone = typeof params[1] === "string" ? params[1] : String(params[1]);
        const from = typeof params[2] === "string" ? params[2] : String(params[2]);
        const to = typeof params[3] === "string" ? params[3] : String(params[3]);
        if (scope.userId === null || scope.workspaceId !== workspaceId) {
          throw new Error("Review history query requires matching workspace scope");
        }

        const key = `${workspaceId}|${timeZone}|${from}|${to}`;
        return createQueryResult<DailyReviewCountRow>(
          fixture.reviewRowsByRequest[key] ?? [],
        ) as unknown as pg.QueryResult<Row>;
      }

      if (
        text.includes("SELECT DISTINCT timezone($2, review_events.reviewed_at_client)::date AS review_local_date")
        && text.includes("ORDER BY review_local_dates.review_local_date DESC")
      ) {
        const workspaceId = typeof params[0] === "string" ? params[0] : String(params[0]);
        const timeZone = typeof params[1] === "string" ? params[1] : String(params[1]);
        if (scope.userId === null || scope.workspaceId !== workspaceId) {
          throw new Error("All review date query requires matching workspace scope");
        }

        const key = `${workspaceId}|${timeZone}`;
        return createQueryResult<ReviewDateRow>(
          fixture.allReviewDateRowsByRequest[key] ?? [],
        ) as unknown as pg.QueryResult<Row>;
      }

      if (
        text.includes("FROM content.cards AS cards")
        && text.includes("COUNT(*) FILTER (WHERE cards.due_at IS NULL)::int AS new_count")
      ) {
        const workspaceId = typeof params[0] === "string" ? params[0] : String(params[0]);
        const timeZone = typeof params[1] === "string" ? params[1] : String(params[1]);
        if (scope.userId === null || scope.workspaceId !== workspaceId) {
          throw new Error("Review schedule query requires matching workspace scope");
        }

        if (!(params[2] instanceof Date)) {
          throw new Error("Review schedule query requires generatedAt as a Date parameter");
        }

        const key = `${workspaceId}|${timeZone}`;
        const rows = fixture.reviewScheduleRowsByRequest[key];
        if (rows === undefined) {
          throw new Error(`Missing review schedule fixture rows for ${key}`);
        }

        return createQueryResult<ReviewScheduleCountRow>(rows) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected progress query: ${text}`);
    },
  };

  return {
    executor,
    recordedQueries,
  };
}

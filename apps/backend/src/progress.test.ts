import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type pg from "pg";
import { HttpError } from "./errors";
import { loadOpenApiDocument } from "./openapi";
import {
  loadUserProgressReviewScheduleInExecutor,
  loadUserProgressSeriesInExecutor,
  loadUserProgressSummaryInExecutor,
  parseProgressReviewScheduleInputFromRequest,
  reviewScheduleBucketKeys,
} from "./progress";
import type { DatabaseExecutor, SqlValue } from "./db";

type QueryResultRow = pg.QueryResultRow;

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

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
}>;

type ProgressExecutorFixture = Readonly<{
  workspaceIdsByUser: Readonly<Record<string, ReadonlyArray<string>>>;
  reviewRowsByRequest: Readonly<Record<string, ReadonlyArray<DailyReviewCountRow>>>;
  allReviewDateRowsByRequest: Readonly<Record<string, ReadonlyArray<ReviewDateRow>>>;
  reviewScheduleRowsByRequest: Readonly<Record<string, ReadonlyArray<ReviewScheduleCountRow>>>;
}>;

type RecordedQuery = Readonly<{
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

function createReviewDateRows(from: string, to: string): ReadonlyArray<ReviewDateRow> {
  const rows: Array<ReviewDateRow> = [];
  let currentDate = from;

  while (currentDate <= to) {
    rows.push({ review_date: currentDate });
    currentDate = shiftLocalDate(currentDate, 1);
  }

  return rows;
}

function createDailyReviewCountRows(from: string, to: string): ReadonlyArray<DailyReviewCountRow> {
  return createReviewDateRows(from, to).map((row) => ({
    review_date: row.review_date,
    review_count: 1,
  }));
}

function createReviewScheduleCountRow(
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

function createEmptyReviewScheduleCountRow(): ReviewScheduleCountRow {
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

function createInclusiveLocalDateRange(from: string, to: string): ReadonlyArray<string> {
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

function createProgressExecutor(
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

function isHttpErrorWithCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof HttpError);
  assert.equal(error.code, code);
  return true;
}

test("parseProgressReviewScheduleInputFromRequest validates the required timezone", () => {
  assert.deepEqual(
    parseProgressReviewScheduleInputFromRequest(
      new Request("http://localhost/me/progress/review-schedule?timeZone=%20Europe/Madrid%20"),
    ),
    { timeZone: "Europe/Madrid" },
  );

  assert.throws(
    () => parseProgressReviewScheduleInputFromRequest(
      new Request("http://localhost/me/progress/review-schedule"),
    ),
    (error) => isHttpErrorWithCode(error, "PROGRESS_TIMEZONE_REQUIRED"),
  );
  assert.throws(
    () => parseProgressReviewScheduleInputFromRequest(
      new Request("http://localhost/me/progress/review-schedule?timeZone=Mars/Olympus"),
    ),
    (error) => isHttpErrorWithCode(error, "PROGRESS_TIMEZONE_INVALID"),
  );
});

test("loadUserProgressSeriesInExecutor returns a zero-filled series for an empty history", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    allReviewDateRowsByRequest: {},
    reviewScheduleRowsByRequest: {},
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-13",
  });

  assert.deepEqual({
    timeZone: progress.timeZone,
    from: progress.from,
    to: progress.to,
    dailyReviews: progress.dailyReviews,
  }, {
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-13",
    dailyReviews: [
      { date: "2026-04-11", reviewCount: 0 },
      { date: "2026-04-12", reviewCount: 0 },
      { date: "2026-04-13", reviewCount: 0 },
    ],
  });
  assert.match(progress.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("loadUserProgressSummaryInExecutor returns zero summary metrics for an empty history", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    allReviewDateRowsByRequest: {},
    reviewScheduleRowsByRequest: {},
  });

  const progress = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });

  assert.deepEqual(progress, {
    timeZone: "Europe/Madrid",
    summary: {
      currentStreakDays: 0,
      hasReviewedToday: false,
      lastReviewedOn: null,
      activeReviewDays: 0,
    },
    generatedAt: progress.generatedAt,
  });
  assert.match(progress.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("loadUserProgressReviewScheduleInExecutor returns stable zero buckets for an empty schedule", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    allReviewDateRowsByRequest: {},
    reviewScheduleRowsByRequest: {
      "workspace-1|Europe/Madrid": [
        createEmptyReviewScheduleCountRow(),
      ],
    },
  });

  const progress = await loadUserProgressReviewScheduleInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });

  assert.deepEqual(progress.buckets, reviewScheduleBucketKeys.map((key) => ({
    key,
    count: 0,
  })));
  assert.equal(progress.timeZone, "Europe/Madrid");
  assert.equal(progress.totalCards, 0);
  assert.match(progress.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("loadUserProgressSeriesInExecutor fills gaps and merges review counts across multiple workspaces", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {
      "workspace-1|Europe/Madrid|2026-04-11|2026-04-14": [
        { review_date: "2026-04-11", review_count: 1 },
        { review_date: "2026-04-13", review_count: "4" },
      ],
      "workspace-2|Europe/Madrid|2026-04-11|2026-04-14": [
        { review_date: "2026-04-11", review_count: 2 },
        { review_date: "2026-04-14", review_count: 3 },
      ],
    },
    allReviewDateRowsByRequest: {},
    reviewScheduleRowsByRequest: {},
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-14",
  });

  assert.deepEqual(progress.dailyReviews, [
    { date: "2026-04-11", reviewCount: 3 },
    { date: "2026-04-12", reviewCount: 0 },
    { date: "2026-04-13", reviewCount: 4 },
    { date: "2026-04-14", reviewCount: 3 },
  ]);
});

test("loadUserProgressReviewScheduleInExecutor merges bucket counts across workspaces and applies scopes", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {},
    allReviewDateRowsByRequest: {},
    reviewScheduleRowsByRequest: {
      "workspace-1|Europe/Madrid": [
        createReviewScheduleCountRow({
          newCount: 1,
          todayCount: 2,
          days1To7Count: 3,
          days8To30Count: 4,
          days31To90Count: 5,
          days91To360Count: 6,
          years1To2Count: 7,
          laterCount: 8,
        }),
      ],
      "workspace-2|Europe/Madrid": [
        createReviewScheduleCountRow({
          newCount: "10",
          todayCount: "20",
          days1To7Count: "30",
          days8To30Count: "40",
          days31To90Count: "50",
          days91To360Count: "60",
          years1To2Count: "70",
          laterCount: "80",
        }),
      ],
    },
  });

  const progress = await loadUserProgressReviewScheduleInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });

  assert.deepEqual(progress.buckets, [
    { key: "new", count: 11 },
    { key: "today", count: 22 },
    { key: "days1To7", count: 33 },
    { key: "days8To30", count: 44 },
    { key: "days31To90", count: 55 },
    { key: "days91To360", count: 66 },
    { key: "years1To2", count: 77 },
    { key: "later", count: 88 },
  ]);
  assert.equal(progress.totalCards, 396);

  const scheduleQueries = recordedQueries.filter((query) => (
    query.text.includes("COUNT(*) FILTER (WHERE cards.due_at IS NULL)::int AS new_count")
  ));
  assert.equal(scheduleQueries.length, 2);
  assert.match(scheduleQueries[0]?.text ?? "", /WHERE cards\.workspace_id = \$1 AND cards\.deleted_at IS NULL/);

  const scopeQueries = recordedQueries.filter((query) => query.text.includes("set_config('app.user_id', $1, true)"));
  assert.deepEqual(scopeQueries.map((query) => query.params), [
    ["user-1", ""],
    ["user-1", "workspace-1"],
    ["user-1", "workspace-2"],
  ]);
});

test("loadUserProgressSummaryInExecutor merges all-time review dates across workspaces without double-counting overlap", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {},
    allReviewDateRowsByRequest: {
      "workspace-1|Europe/Madrid": [
        { review_date: "2026-04-14" },
        { review_date: "2026-04-13" },
        { review_date: "2026-04-11" },
      ],
      "workspace-2|Europe/Madrid": [
        { review_date: "2026-04-14" },
        { review_date: "2026-04-12" },
      ],
    },
    reviewScheduleRowsByRequest: {},
  });

  const progress = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });

  assert.deepEqual(progress.summary, {
    currentStreakDays: 0,
    hasReviewedToday: false,
    lastReviewedOn: "2026-04-14",
    activeReviewDays: 4,
  });
});

test("loadUserProgressReviewScheduleInExecutor uses timezone calendar boundaries in SQL aggregate buckets", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    allReviewDateRowsByRequest: {},
    reviewScheduleRowsByRequest: {
      "workspace-1|America/Los_Angeles": [
        createEmptyReviewScheduleCountRow(),
      ],
    },
  });

  await loadUserProgressReviewScheduleInExecutor(executor, {
    userId: "user-1",
    timeZone: "America/Los_Angeles",
  });

  const scheduleQuery = recordedQueries.find((query) => (
    query.text.includes("COUNT(*) FILTER (WHERE cards.due_at IS NULL)::int AS new_count")
  ));
  if (scheduleQuery === undefined) {
    assert.fail("Expected a review schedule query to be recorded");
  }

  assert.match(scheduleQuery.text, /FROM content\.cards AS cards/);
  assert.match(scheduleQuery.text, /timezone\(\$2, \$3::timestamptz\)::date \+ 1\)::timestamp AT TIME ZONE \$2\) AS tomorrow_start/);
  assert.match(scheduleQuery.text, /timezone\(\$2, \$3::timestamptz\)::date \+ 8\)::timestamp AT TIME ZONE \$2\) AS days_8_start/);
  assert.match(scheduleQuery.text, /timezone\(\$2, \$3::timestamptz\)::date \+ 31\)::timestamp AT TIME ZONE \$2\) AS days_31_start/);
  assert.match(scheduleQuery.text, /timezone\(\$2, \$3::timestamptz\)::date \+ 91\)::timestamp AT TIME ZONE \$2\) AS days_91_start/);
  assert.match(scheduleQuery.text, /timezone\(\$2, \$3::timestamptz\)::date \+ 361\)::timestamp AT TIME ZONE \$2\) AS days_361_start/);
  assert.match(scheduleQuery.text, /timezone\(\$2, \$3::timestamptz\)::date \+ 721\)::timestamp AT TIME ZONE \$2\) AS days_721_start/);
  assert.match(scheduleQuery.text, /cards\.due_at IS NOT NULL AND cards\.due_at < schedule_boundaries\.tomorrow_start/);
  assert.match(scheduleQuery.text, /cards\.due_at >= schedule_boundaries\.tomorrow_start AND cards\.due_at < schedule_boundaries\.days_8_start/);
  assert.match(scheduleQuery.text, /cards\.due_at >= schedule_boundaries\.days_8_start AND cards\.due_at < schedule_boundaries\.days_31_start/);
  assert.match(scheduleQuery.text, /cards\.due_at >= schedule_boundaries\.days_31_start AND cards\.due_at < schedule_boundaries\.days_91_start/);
  assert.match(scheduleQuery.text, /cards\.due_at >= schedule_boundaries\.days_91_start AND cards\.due_at < schedule_boundaries\.days_361_start/);
  assert.match(scheduleQuery.text, /cards\.due_at >= schedule_boundaries\.days_361_start AND cards\.due_at < schedule_boundaries\.days_721_start/);
  assert.match(scheduleQuery.text, /cards\.due_at >= schedule_boundaries\.days_721_start/);
  assert.doesNotMatch(scheduleQuery.text, /SELECT card_id/);
  assert.equal(scheduleQuery.params[0], "workspace-1");
  assert.equal(scheduleQuery.params[1], "America/Los_Angeles");
  assert.ok(scheduleQuery.params[2] instanceof Date);
});

test("loadUserProgressSeriesInExecutor buckets review counts by reviewed_at_client in the requested timezone", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {
      "workspace-1|America/Los_Angeles|2026-04-11|2026-04-12": [
        { review_date: "2026-04-11", review_count: 1 },
      ],
    },
    allReviewDateRowsByRequest: {},
    reviewScheduleRowsByRequest: {},
  });

  await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "America/Los_Angeles",
    from: "2026-04-11",
    to: "2026-04-12",
  });

  const reviewQuery = recordedQueries.find((query) => query.text.includes("COUNT(*)::int AS review_count"));
  if (reviewQuery === undefined) {
    assert.fail("Expected a review_events chart query to be recorded");
  }
  assert.match(reviewQuery.text, /timezone\(\$2, review_events\.reviewed_at_client\)::date/);
  assert.match(reviewQuery.text, /review_events\.reviewed_at_client >= \(\(\$3::date\)::timestamp AT TIME ZONE \$2\)/);
  assert.match(reviewQuery.text, /review_events\.reviewed_at_client < \(\(\(\(\$4::date\) \+ 1\)::timestamp\) AT TIME ZONE \$2\)/);
  assert.doesNotMatch(reviewQuery.text, /reviewed_at_server/);
  assert.deepEqual(reviewQuery.params, [
    "workspace-1",
    "America/Los_Angeles",
    "2026-04-11",
    "2026-04-12",
  ]);
});

test("loadUserProgressSummaryInExecutor derives active review dates from reviewed_at_client in the requested timezone", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    allReviewDateRowsByRequest: {
      "workspace-1|America/Los_Angeles": [
        { review_date: "2026-04-11" },
      ],
    },
    reviewScheduleRowsByRequest: {},
  });

  await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone: "America/Los_Angeles",
  });

  const summaryQuery = recordedQueries.find((query) => (
    query.text.includes("SELECT DISTINCT timezone($2, review_events.reviewed_at_client)::date AS review_local_date")
  ));
  if (summaryQuery === undefined) {
    assert.fail("Expected an all-time review date query to be recorded");
  }
  assert.match(summaryQuery.text, /ORDER BY review_local_dates\.review_local_date DESC/);
  assert.doesNotMatch(summaryQuery.text, /reviewed_at_server/);
  assert.deepEqual(summaryQuery.params, [
    "workspace-1",
    "America/Los_Angeles",
  ]);
});

test("loadUserProgressSeriesInExecutor applies user scope for memberships and workspace scope for each review query", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {
      "workspace-1|Europe/Madrid|2026-04-11|2026-04-14": [
        { review_date: "2026-04-11", review_count: 3 },
      ],
      "workspace-2|Europe/Madrid|2026-04-11|2026-04-14": [
        { review_date: "2026-04-14", review_count: 1 },
      ],
    },
    allReviewDateRowsByRequest: {},
    reviewScheduleRowsByRequest: {},
  });

  await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-14",
  });

  const reviewQueries = recordedQueries.filter((query) => query.text.includes("COUNT(*)::int AS review_count"));
  assert.equal(reviewQueries.length, 2);
  assert.match(reviewQueries[0]?.text ?? "", /WHERE review_events\.workspace_id = \$1/);

  const scopeQueries = recordedQueries.filter((query) => query.text.includes("set_config('app.user_id', $1, true)"));
  assert.deepEqual(scopeQueries.map((query) => query.params), [
    ["user-1", ""],
    ["user-1", "workspace-1"],
    ["user-1", "workspace-2"],
  ]);
});

test("loadUserProgressSummaryInExecutor applies user scope for memberships and workspace scope for each summary query", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {},
    allReviewDateRowsByRequest: {
      "workspace-1|Europe/Madrid": [
        { review_date: "2026-04-11" },
      ],
      "workspace-2|Europe/Madrid": [
        { review_date: "2026-04-14" },
      ],
    },
    reviewScheduleRowsByRequest: {},
  });

  await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });

  const summaryQueries = recordedQueries.filter((query) => (
    query.text.includes("SELECT DISTINCT timezone($2, review_events.reviewed_at_client)::date AS review_local_date")
  ));
  assert.equal(summaryQueries.length, 2);
  assert.match(summaryQueries[0]?.text ?? "", /WHERE review_events\.workspace_id = \$1/);

  const scopeQueries = recordedQueries.filter((query) => query.text.includes("set_config('app.user_id', $1, true)"));
  assert.deepEqual(scopeQueries.map((query) => query.params), [
    ["user-1", ""],
    ["user-1", "workspace-1"],
    ["user-1", "workspace-2"],
  ]);
});

test("loadUserProgressSummaryInExecutor keeps summary independent from the requested series range", async () => {
  const timeZone = "Europe/Madrid";
  const today = formatDateAsTimeZoneLocalDate(new Date(), timeZone);
  const yesterday = shiftLocalDate(today, -1);
  const twoDaysAgo = shiftLocalDate(today, -2);
  const tenDaysAgo = shiftLocalDate(today, -10);
  const oldFrom = shiftLocalDate(today, -40);
  const oldTo = shiftLocalDate(today, -35);
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    allReviewDateRowsByRequest: {
      [`workspace-1|${timeZone}`]: [
        { review_date: today },
        { review_date: yesterday },
        { review_date: twoDaysAgo },
        { review_date: tenDaysAgo },
      ],
    },
    reviewScheduleRowsByRequest: {},
  });

  const progress = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone,
  });

  assert.deepEqual(progress.summary, {
    currentStreakDays: 3,
    hasReviewedToday: true,
    lastReviewedOn: today,
    activeReviewDays: 4,
  });
});

test("loadUserProgressSummaryInExecutor keeps hasReviewedToday true when a future-dated review is present", async () => {
  const timeZone = "Europe/Madrid";
  const today = formatDateAsTimeZoneLocalDate(new Date(), timeZone);
  const yesterday = shiftLocalDate(today, -1);
  const tomorrow = shiftLocalDate(today, 1);
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    allReviewDateRowsByRequest: {
      [`workspace-1|${timeZone}`]: [
        { review_date: tomorrow },
        { review_date: today },
        { review_date: yesterday },
      ],
    },
    reviewScheduleRowsByRequest: {},
  });

  const progress = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone,
  });

  assert.deepEqual(progress.summary, {
    currentStreakDays: 2,
    hasReviewedToday: true,
    lastReviewedOn: tomorrow,
    activeReviewDays: 3,
  });
});

test("published contract excludes progress endpoints while the API Gateway resource tree still predeclares the paths", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    info?: Readonly<{ title?: string; description?: string }>;
    paths?: Readonly<Record<string, unknown>>;
  }>;
  assert.equal(openApiDocument.info?.title, "Flashcards Open Source App External AI-Agent API");
  assert.match(openApiDocument.info?.description ?? "", /external ai agents/i);
  assert.equal(openApiDocument.paths?.["/me/progress"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/summary"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/review-schedule"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/series"], undefined);

  const apiGatewayPath = path.resolve(process.cwd(), "../../infra/aws/lib/api-gateway.ts");
  const apiGatewaySource = fs.readFileSync(apiGatewayPath, "utf8");
  assert.match(apiGatewaySource, /const meProgress = me\.addResource\("progress"\);/);
  assert.doesNotMatch(apiGatewaySource, /meProgress\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /meProgress\.addResource\("summary"\)\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /meProgress\.addResource\("review-schedule"\)\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /meProgress\.addResource\("series"\)\.addMethod\("GET", integration\);/);
});

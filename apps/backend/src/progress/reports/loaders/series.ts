import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type SqlValue,
} from "../../../database";
import { listUserWorkspaceIdsInExecutor } from "../../../workspaces/queries";
import {
  loadUserActiveReviewLocalDatesInExecutor,
  materializeMissingActiveReviewDaysForUserInExecutor,
  rememberProgressTimeZoneInExecutor,
} from "../../activeReviewDays/activeReviewDays";
import {
  evaluateStreakFreeze,
  streakFreezePolicy,
  type StreakDay,
  type StreakDayState,
} from "../../streakFreeze";
import { formatDateAsTimeZoneLocalDate } from "../../timeZone";
import {
  createUtcDateFromLocalDate,
  type DailyReviewPoint,
  type ProgressReviewHistoryWatermark,
  type ProgressSeries,
  type ProgressSeriesRequest,
} from "../contracts";
import {
  loadReviewHistoryWatermarksInExecutor,
  normalizeNonNegativeIntegerFromQuery,
  sortReviewHistoryWatermarks,
} from "./shared";

type DailyReviewCountRow = Readonly<{
  review_date: string;
  review_count: string | number;
  again_count: string | number;
  hard_count: string | number;
  good_count: string | number;
  easy_count: string | number;
}>;

type DailyReviewCounts = Readonly<{
  reviewCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
}>;

type WorkspaceProgressSeriesRequest = Readonly<{
  workspaceId: string;
  userId: string;
  timeZone: string;
  from: string;
  to: string;
}>;

function formatUtcDateAsLocalDate(value: Date): string {
  return value.toISOString().slice(0, 10);
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

function validateProgressSeriesDayInvariant(
  progressSeries: ProgressSeries,
  request: ProgressSeriesRequest,
): void {
  const dailyReviewsByDate: ReadonlyMap<string, DailyReviewPoint> = new Map(
    progressSeries.dailyReviews.map((dailyReview) => [dailyReview.date, dailyReview]),
  );
  const streakStatesByDate: ReadonlyMap<string, StreakDayState> = new Map(
    progressSeries.streakDays.map((streakDay) => [streakDay.date, streakDay.state]),
  );

  for (const dailyReview of dailyReviewsByDate.values()) {
    const streakState = streakStatesByDate.get(dailyReview.date);
    if (streakState === undefined) {
      throw new Error(
        [
          "Progress series day invariant failed",
          `userId=${request.userId}`,
          `timeZone=${request.timeZone}`,
          `from=${request.from}`,
          `to=${request.to}`,
          `date=${dailyReview.date}`,
          `reviewCount=${dailyReview.reviewCount}`,
          "streakState=missing",
        ].join("; "),
      );
    }

    // Progress is temporarily mixed-scope: daily review bars still reflect the
    // current legacy review-event scope, while streak days are user-wide. A
    // user-wide reviewed streak day can therefore have zero reviews in the
    // daily series until Progress filtering is rebuilt around one shared scope.
    if (dailyReview.reviewCount === 0 && streakState === "reviewed") {
      continue;
    }

    if ((dailyReview.reviewCount > 0) !== (streakState === "reviewed")) {
      throw new Error(
        [
          "Progress series day invariant failed",
          `userId=${request.userId}`,
          `timeZone=${request.timeZone}`,
          `from=${request.from}`,
          `to=${request.to}`,
          `date=${dailyReview.date}`,
          `reviewCount=${dailyReview.reviewCount}`,
          `streakState=${streakState}`,
        ].join("; "),
      );
    }
  }
}

async function loadDailyReviewCountRowsInExecutor(
  executor: DatabaseExecutor,
  request: WorkspaceProgressSeriesRequest,
): Promise<ReadonlyArray<DailyReviewCountRow>> {
  const queryParams: ReadonlyArray<SqlValue> = [
    request.workspaceId,
    request.userId,
    request.timeZone,
    request.from,
    request.to,
  ];
  // Three days covers the full IANA offset spread when row and request time zones differ.
  const result = await executor.query<DailyReviewCountRow>(
    [
      "WITH review_event_local_dates AS (",
      "SELECT",
      "COALESCE(",
      "review_events.reviewed_local_date,",
      "timezone(COALESCE(review_events.reviewed_time_zone, $3), review_events.reviewed_at_client)::date",
      ") AS review_date,",
      "review_events.rating",
      "FROM content.review_events AS review_events",
      "WHERE review_events.workspace_id = $1",
      "AND review_events.reviewed_by_user_id = $2",
      "AND review_events.reviewed_at_client >= (($4::date - 3)::timestamp AT TIME ZONE $3)",
      "AND review_events.reviewed_at_client < (($5::date + 3)::timestamp AT TIME ZONE $3)",
      ")",
      "SELECT",
      "to_char(review_event_local_dates.review_date, 'YYYY-MM-DD') AS review_date,",
      "COUNT(*)::int AS review_count,",
      "COUNT(*) FILTER (WHERE review_event_local_dates.rating = 0)::int AS again_count,",
      "COUNT(*) FILTER (WHERE review_event_local_dates.rating = 1)::int AS hard_count,",
      "COUNT(*) FILTER (WHERE review_event_local_dates.rating = 2)::int AS good_count,",
      "COUNT(*) FILTER (WHERE review_event_local_dates.rating = 3)::int AS easy_count",
      "FROM review_event_local_dates",
      "WHERE review_event_local_dates.review_date BETWEEN $4::date AND $5::date",
      "GROUP BY review_event_local_dates.review_date",
      "ORDER BY review_event_local_dates.review_date ASC",
    ].join(" "),
    queryParams,
  );

  return result.rows;
}

async function buildUserProgressSeriesInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSeriesRequest,
  generatedAtDate: Date,
): Promise<ProgressSeries> {
  let dailyReviewCounts: ReadonlyMap<string, DailyReviewCounts> = new Map<string, DailyReviewCounts>();
  await applyUserDatabaseScopeInExecutor(executor, { userId: request.userId });
  // Daily review counts and streak state both use materialized canonical
  // local review days, with review_events reads still bounded by workspace RLS.
  const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, request.userId);
  await rememberProgressTimeZoneInExecutor(executor, request.userId, request.timeZone);
  let reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark> = [];

  for (const workspaceId of workspaceIds) {
    // review_events reads are workspace-scoped by RLS, so materialize and
    // aggregate one workspace at a time after resolving memberships.
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
    const rows = await loadDailyReviewCountRowsInExecutor(executor, {
      workspaceId,
      userId: request.userId,
      timeZone: request.timeZone,
      from: request.from,
      to: request.to,
    });
    dailyReviewCounts = addDailyReviewCountRows(dailyReviewCounts, rows);
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
  const progressSeries: ProgressSeries = {
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
  validateProgressSeriesDayInvariant(progressSeries, request);

  return progressSeries;
}

export async function loadUserProgressSeriesInExecutor(
  executor: DatabaseExecutor,
  request: ProgressSeriesRequest,
): Promise<ProgressSeries> {
  return buildUserProgressSeriesInExecutor(executor, request, new Date());
}

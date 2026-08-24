import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type SqlValue,
} from "../../../database";
import { listUserWorkspaceIdsInExecutor } from "../../../workspaces/queries";
import {
  reviewScheduleBucketKeys,
  type ProgressReviewHistoryWatermark,
  type ProgressReviewSchedule,
  type ProgressReviewScheduleRequest,
  type ReviewScheduleBucket,
  type ReviewScheduleBucketKey,
} from "../contracts";
import {
  loadReviewHistoryWatermarksInExecutor,
  normalizeNonNegativeIntegerFromQuery,
  sortReviewHistoryWatermarks,
} from "./shared";

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

type WorkspaceProgressReviewScheduleRequest = Readonly<{
  workspaceId: string;
  timeZone: string;
  generatedAt: Date;
}>;

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

export async function loadUserProgressReviewScheduleInExecutor(
  executor: DatabaseExecutor,
  request: ProgressReviewScheduleRequest,
): Promise<ProgressReviewSchedule> {
  return buildUserProgressReviewScheduleInExecutor(executor, request, new Date());
}

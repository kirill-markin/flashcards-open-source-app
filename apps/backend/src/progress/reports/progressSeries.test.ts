import assert from "node:assert/strict";
import test from "node:test";
import { loadUserProgressSeriesInExecutor, type ProgressSeries } from "./index";
import {
  createProgressExecutor,
  formatDateAsTimeZoneLocalDate,
  type RecordedQuery,
  shiftLocalDate,
} from "./progressTestSupport";

type RecordedQueryMatch = Readonly<{
  index: number;
  query: RecordedQuery;
}>;

function findRecordedQuery(
  recordedQueries: ReadonlyArray<RecordedQuery>,
  predicate: (query: RecordedQuery) => boolean,
  failureMessage: string,
): RecordedQueryMatch {
  const index = recordedQueries.findIndex(predicate);
  if (index === -1) {
    assert.fail(failureMessage);
  }

  const query = recordedQueries[index];
  if (query === undefined) {
    assert.fail(failureMessage);
  }

  return { index, query };
}

function assertDailyReviewsMatchStreakDays(progress: ProgressSeries): void {
  type StreakState = ProgressSeries["streakDays"][number]["state"];
  const streakStateByDate: ReadonlyMap<string, StreakState> = new Map(
    progress.streakDays.map((day) => [day.date, day.state]),
  );

  for (const dailyReview of progress.dailyReviews) {
    const streakState = streakStateByDate.get(dailyReview.date);
    if (streakState === undefined) {
      assert.fail(`Missing streak day for ${dailyReview.date}`);
    }

    if (dailyReview.reviewCount > 0) {
      assert.equal(
        streakState,
        "reviewed",
        `Expected ${dailyReview.date} to be reviewed when reviewCount=${dailyReview.reviewCount}`,
      );
    } else {
      assert.notEqual(
        streakState,
        "reviewed",
        `Expected ${dailyReview.date} not to be reviewed when reviewCount=0`,
      );
    }
  }
}

test("loadUserProgressSeriesInExecutor returns a zero-filled series for an empty history", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {},
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 0,
    },
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
    streakDays: progress.streakDays,
    reviewHistoryWatermarks: progress.reviewHistoryWatermarks,
  }, {
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-13",
    dailyReviews: [
      { date: "2026-04-11", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
      { date: "2026-04-12", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
      { date: "2026-04-13", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
    ],
    streakDays: [
      { date: "2026-04-11", state: "missed" },
      { date: "2026-04-12", state: "missed" },
      { date: "2026-04-13", state: "missed" },
    ],
    reviewHistoryWatermarks: [
      { workspaceId: "workspace-1", reviewSequenceId: 0 },
    ],
  });
  assert.match(progress.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(progress.streakDays.length, 3);
});

test("loadUserProgressSeriesInExecutor marks today without review as pending", async () => {
  const timeZone = "Europe/Madrid";
  const today = formatDateAsTimeZoneLocalDate(new Date(), timeZone);
  const yesterday = shiftLocalDate(today, -1);
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {
      [`workspace-1|user-1|${yesterday}|${today}`]: [
        {
          review_date: yesterday,
          review_count: 1,
          again_count: 0,
          hard_count: 0,
          good_count: 1,
          easy_count: 0,
        },
      ],
    },
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: yesterday },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 1,
    },
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone,
    from: yesterday,
    to: today,
  });

  assert.deepEqual(progress.dailyReviews, [
    { date: yesterday, reviewCount: 1, againCount: 0, hardCount: 0, goodCount: 1, easyCount: 0 },
    { date: today, reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
  ]);
  assert.deepEqual(progress.streakDays, [
    { date: yesterday, state: "reviewed" },
    { date: today, state: "pending" },
  ]);
  assert.equal(progress.streakDays.length, 2);
});

test("loadUserProgressSeriesInExecutor fills gaps and merges rating breakdowns across multiple workspaces", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {
      "workspace-1|user-1|2026-04-11|2026-04-14": [
        {
          review_date: "2026-04-11",
          review_count: 1,
          again_count: 0,
          hard_count: 0,
          good_count: 1,
          easy_count: 0,
        },
        {
          review_date: "2026-04-13",
          review_count: "4",
          again_count: "1",
          hard_count: "1",
          good_count: "1",
          easy_count: "1",
        },
      ],
      "workspace-2|user-1|2026-04-11|2026-04-14": [
        {
          review_date: "2026-04-11",
          review_count: 2,
          again_count: 1,
          hard_count: 1,
          good_count: 0,
          easy_count: 0,
        },
        {
          review_date: "2026-04-14",
          review_count: 3,
          again_count: 1,
          hard_count: 0,
          good_count: 1,
          easy_count: 1,
        },
      ],
    },
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: "2026-04-11" },
        { review_date: "2026-04-13" },
        { review_date: "2026-04-14" },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 4,
      "workspace-2": 3,
    },
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-14",
  });

  assert.deepEqual(progress.dailyReviews, [
    { date: "2026-04-11", reviewCount: 3, againCount: 1, hardCount: 1, goodCount: 1, easyCount: 0 },
    { date: "2026-04-12", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
    { date: "2026-04-13", reviewCount: 4, againCount: 1, hardCount: 1, goodCount: 1, easyCount: 1 },
    { date: "2026-04-14", reviewCount: 3, againCount: 1, hardCount: 0, goodCount: 1, easyCount: 1 },
  ]);
  assertDailyReviewsMatchStreakDays(progress);
  const mixedRatingDay = progress.dailyReviews[0];
  if (mixedRatingDay === undefined) {
    assert.fail("Expected the mixed-rating day to be returned");
  }
  assert.equal(
    mixedRatingDay.reviewCount,
    mixedRatingDay.againCount + mixedRatingDay.hardCount + mixedRatingDay.goodCount + mixedRatingDay.easyCount,
  );
  assert.deepEqual(progress.reviewHistoryWatermarks, [
    { workspaceId: "workspace-1", reviewSequenceId: 4 },
    { workspaceId: "workspace-2", reviewSequenceId: 3 },
  ]);
});

test("loadUserProgressSeriesInExecutor buckets review counts by canonical review local date", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {
      "workspace-1|user-1|2026-04-11|2026-04-12": [
        {
          review_date: "2026-04-11",
          review_count: 1,
          again_count: 0,
          hard_count: 0,
          good_count: 1,
          easy_count: 0,
        },
      ],
    },
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: "2026-04-11" },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 1,
    },
  });

  await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "America/Los_Angeles",
    from: "2026-04-11",
    to: "2026-04-12",
  });

  const reviewQueryMatch = findRecordedQuery(
    recordedQueries,
    (query) => query.text.includes("WITH review_event_local_dates AS"),
    "Expected a review_events chart query to be recorded",
  );
  const reviewQuery = reviewQueryMatch.query;
  assert.match(reviewQuery.text, /COALESCE\(\s*review_events\.reviewed_local_date,\s*timezone\(COALESCE\(review_events\.reviewed_time_zone, \$3\), review_events\.reviewed_at_client\)::date\s*\) AS review_date/);
  assert.match(reviewQuery.text, /to_char\(review_event_local_dates\.review_date, 'YYYY-MM-DD'\) AS review_date/);
  assert.match(reviewQuery.text, /COUNT\(\*\)::int AS review_count/);
  assert.match(reviewQuery.text, /COUNT\(\*\) FILTER \(WHERE review_event_local_dates\.rating = 0\)::int AS again_count/);
  assert.match(reviewQuery.text, /COUNT\(\*\) FILTER \(WHERE review_event_local_dates\.rating = 1\)::int AS hard_count/);
  assert.match(reviewQuery.text, /COUNT\(\*\) FILTER \(WHERE review_event_local_dates\.rating = 2\)::int AS good_count/);
  assert.match(reviewQuery.text, /COUNT\(\*\) FILTER \(WHERE review_event_local_dates\.rating = 3\)::int AS easy_count/);
  assert.match(reviewQuery.text, /WHERE review_events\.workspace_id = \$1/);
  assert.match(reviewQuery.text, /AND review_events\.reviewed_by_user_id = \$2/);
  assert.match(reviewQuery.text, /AND review_events\.reviewed_at_client >= \(\(\$4::date - 3\)::timestamp AT TIME ZONE \$3\)/);
  assert.match(reviewQuery.text, /AND review_events\.reviewed_at_client < \(\(\$5::date \+ 3\)::timestamp AT TIME ZONE \$3\)/);
  assert.match(reviewQuery.text, /WHERE review_event_local_dates\.review_date BETWEEN \$4::date AND \$5::date/);
  assert.match(reviewQuery.text, /GROUP BY review_event_local_dates\.review_date/);
  assert.match(reviewQuery.text, /ORDER BY review_event_local_dates\.review_date ASC/);
  assert.doesNotMatch(reviewQuery.text, /timezone\(\$2, review_events\.reviewed_at_client\)::date/);
  assert.doesNotMatch(reviewQuery.text, /reviewed_at_server/);
  assert.deepEqual(reviewQuery.params, [
    "workspace-1",
    "user-1",
    "America/Los_Angeles",
    "2026-04-11",
    "2026-04-12",
  ]);

  const materializationQueryMatch = findRecordedQuery(
    recordedQueries,
    (query) => query.text.includes("WITH target_review_events AS"),
    "Expected an active review day materialization query to be recorded",
  );
  const materializationQuery = materializationQueryMatch.query;
  assert.ok(
    materializationQueryMatch.index < reviewQueryMatch.index,
    "Expected active review day materialization before daily review count loading",
  );
  assert.match(materializationQuery.text, /INSERT INTO progress\.user_active_review_days/);
  assert.match(materializationQuery.text, /WHERE review_events\.reviewed_by_user_id = \$1/);
  assert.match(materializationQuery.text, /AND review_events\.workspace_id = \$3/);
  assert.doesNotMatch(materializationQuery.text, /review_events\.rating/);
  assert.deepEqual(materializationQuery.params, [
    "user-1",
    "America/Los_Angeles",
    "workspace-1",
  ]);

  const activeDayQuery = recordedQueries.find((query) => (
    query.text.includes("FROM progress.user_active_review_days AS active_days")
  ));
  if (activeDayQuery === undefined) {
    assert.fail("Expected an active review day read query to be recorded");
  }
  assert.deepEqual(activeDayQuery.params, ["user-1"]);
  assert.doesNotMatch(activeDayQuery.text, /workspace_id/);
  assert.equal(
    recordedQueries.some((query) => (
      query.text.includes("SELECT DISTINCT timezone($2, review_events.reviewed_at_client)::date")
    )),
    false,
  );
});

test("loadUserProgressSeriesInExecutor aligns daily reviews and streak days on canonical review local dates", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {
      "workspace-1|user-1|2026-05-01|2026-05-02": [
        {
          review_date: "2026-05-02",
          review_count: 1,
          again_count: 0,
          hard_count: 0,
          good_count: 0,
          easy_count: 1,
        },
      ],
    },
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: "2026-05-02" },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 1,
    },
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "America/Los_Angeles",
    from: "2026-05-01",
    to: "2026-05-02",
  });

  assert.deepEqual(progress.dailyReviews, [
    { date: "2026-05-01", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
    { date: "2026-05-02", reviewCount: 1, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 1 },
  ]);
  assertDailyReviewsMatchStreakDays(progress);
  assert.deepEqual(
    progress.streakDays.find((day) => day.date === "2026-05-02"),
    { date: "2026-05-02", state: "reviewed" },
  );
});

test("loadUserProgressSeriesInExecutor ignores other workspace members' review rows", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
      "user-2": ["workspace-1"],
    },
    reviewRowsByRequest: {
      "workspace-1|user-2|2026-06-01|2026-06-01": [
        {
          review_date: "2026-06-01",
          review_count: 1,
          again_count: 0,
          hard_count: 0,
          good_count: 1,
          easy_count: 0,
        },
      ],
    },
    activeReviewDateRowsByUser: {},
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 1,
    },
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-06-01",
    to: "2026-06-01",
  });

  assert.deepEqual(progress.dailyReviews, [
    { date: "2026-06-01", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
  ]);
  assertDailyReviewsMatchStreakDays(progress);
  assert.notEqual(progress.streakDays[0]?.state, "reviewed");
});

test("loadUserProgressSeriesInExecutor rejects daily and streak day invariant mismatches", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {
      "workspace-1|user-1|2026-04-26|2026-04-26": [
        {
          review_date: "2026-04-26",
          review_count: 9,
          again_count: 1,
          hard_count: 2,
          good_count: 3,
          easy_count: 3,
        },
      ],
    },
    activeReviewDateRowsByUser: {},
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 9,
    },
  });

  await assert.rejects(
    async () => loadUserProgressSeriesInExecutor(executor, {
      userId: "user-1",
      timeZone: "Europe/Madrid",
      from: "2026-04-26",
      to: "2026-04-26",
    }),
    (error: unknown): boolean => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Progress series day invariant failed/);
      assert.match(error.message, /date=2026-04-26/);
      assert.match(error.message, /reviewCount=9/);
      assert.match(error.message, /streakState=missed/);
      return true;
    },
  );
});

test("loadUserProgressSeriesInExecutor allows user-wide streak days outside the legacy daily review scope", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: "2026-06-20" },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 0,
    },
  });

  const progress = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "America/Los_Angeles",
    from: "2026-06-20",
    to: "2026-06-20",
  });

  assert.deepEqual(progress.dailyReviews, [
    { date: "2026-06-20", reviewCount: 0, againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0 },
  ]);
  assert.deepEqual(progress.streakDays, [
    { date: "2026-06-20", state: "reviewed" },
  ]);
});

test("loadUserProgressSeriesInExecutor applies user scope for memberships and workspace scope for each review query", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {
      "workspace-1|user-1|2026-04-11|2026-04-14": [
        {
          review_date: "2026-04-11",
          review_count: 3,
          again_count: 1,
          hard_count: 1,
          good_count: 1,
          easy_count: 0,
        },
      ],
      "workspace-2|user-1|2026-04-11|2026-04-14": [
        {
          review_date: "2026-04-14",
          review_count: 1,
          again_count: 0,
          hard_count: 0,
          good_count: 0,
          easy_count: 1,
        },
      ],
    },
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: "2026-04-11" },
        { review_date: "2026-04-14" },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 3,
      "workspace-2": 1,
    },
  });

  await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-14",
  });

  const reviewQueries = recordedQueries.filter((query) => query.text.includes("easy_count"));
  assert.equal(reviewQueries.length, 2);
  assert.match(reviewQueries[0]?.text ?? "", /WHERE review_events\.workspace_id = \$1/);
  assert.ok(reviewQueries.every((query) => query.text.includes("AND review_events.reviewed_by_user_id = $2")));
  assert.deepEqual(reviewQueries.map((query) => query.params), [
    ["workspace-1", "user-1", "Europe/Madrid", "2026-04-11", "2026-04-14"],
    ["workspace-2", "user-1", "Europe/Madrid", "2026-04-11", "2026-04-14"],
  ]);

  const materializationQueries = recordedQueries.filter((query) => (
    query.text.includes("WITH target_review_events AS")
    && query.text.includes("INSERT INTO progress.user_active_review_days")
  ));
  assert.equal(materializationQueries.length, 2);
  assert.ok(materializationQueries.every((query) => (
    query.text.includes("WHERE review_events.reviewed_by_user_id = $1")
    && query.text.includes("AND review_events.workspace_id = $3")
  )));
  assert.deepEqual(materializationQueries.map((query) => query.params), [
    ["user-1", "Europe/Madrid", "workspace-1"],
    ["user-1", "Europe/Madrid", "workspace-2"],
  ]);

  const activeDayQueries = recordedQueries.filter((query) => (
    query.text.includes("FROM progress.user_active_review_days AS active_days")
  ));
  assert.equal(activeDayQueries.length, 1);
  assert.deepEqual(activeDayQueries[0]?.params, ["user-1"]);
  assert.doesNotMatch(activeDayQueries[0]?.text ?? "", /workspace_id/);

  const scopeQueries = recordedQueries.filter((query) => query.text.includes("set_config('app.user_id', $1, true)"));
  assert.deepEqual(scopeQueries.map((query) => query.params), [
    ["user-1", ""],
    ["user-1", "workspace-1"],
    ["user-1", "workspace-2"],
  ]);
});

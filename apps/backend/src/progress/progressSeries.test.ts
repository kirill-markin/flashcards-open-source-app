import assert from "node:assert/strict";
import test from "node:test";
import { loadUserProgressSeriesInExecutor } from "./index";
import {
  createProgressExecutor,
  formatDateAsTimeZoneLocalDate,
  shiftLocalDate,
} from "./progressTestSupport";

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
      [`workspace-1|${timeZone}|${yesterday}|${today}`]: [
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
      "workspace-1|Europe/Madrid|2026-04-11|2026-04-14": [
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
      "workspace-2|Europe/Madrid|2026-04-11|2026-04-14": [
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
    activeReviewDateRowsByUser: {},
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

test("loadUserProgressSeriesInExecutor buckets review counts by reviewed_at_client in the requested timezone", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {
      "workspace-1|America/Los_Angeles|2026-04-11|2026-04-12": [
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
    activeReviewDateRowsByUser: {},
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

  const reviewQuery = recordedQueries.find((query) => query.text.includes("COUNT(*)::int AS review_count"));
  if (reviewQuery === undefined) {
    assert.fail("Expected a review_events chart query to be recorded");
  }
  assert.match(reviewQuery.text, /timezone\(\$2, review_events\.reviewed_at_client\)::date/);
  assert.match(reviewQuery.text, /COUNT\(\*\)::int AS review_count/);
  assert.match(reviewQuery.text, /COUNT\(\*\) FILTER \(WHERE review_events\.rating = 0\)::int AS again_count/);
  assert.match(reviewQuery.text, /COUNT\(\*\) FILTER \(WHERE review_events\.rating = 1\)::int AS hard_count/);
  assert.match(reviewQuery.text, /COUNT\(\*\) FILTER \(WHERE review_events\.rating = 2\)::int AS good_count/);
  assert.match(reviewQuery.text, /COUNT\(\*\) FILTER \(WHERE review_events\.rating = 3\)::int AS easy_count/);
  assert.match(reviewQuery.text, /review_events\.reviewed_at_client >= \(\(\$3::date\)::timestamp AT TIME ZONE \$2\)/);
  assert.match(reviewQuery.text, /review_events\.reviewed_at_client < \(\(\(\(\$4::date\) \+ 1\)::timestamp\) AT TIME ZONE \$2\)/);
  assert.doesNotMatch(reviewQuery.text, /reviewed_at_server/);
  assert.deepEqual(reviewQuery.params, [
    "workspace-1",
    "America/Los_Angeles",
    "2026-04-11",
    "2026-04-12",
  ]);

  const materializationQuery = recordedQueries.find((query) => query.text.includes("WITH target_review_events AS"));
  if (materializationQuery === undefined) {
    assert.fail("Expected an active review day materialization query to be recorded");
  }
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

test("loadUserProgressSeriesInExecutor applies user scope for memberships and workspace scope for each review query", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {
      "workspace-1|Europe/Madrid|2026-04-11|2026-04-14": [
        {
          review_date: "2026-04-11",
          review_count: 3,
          again_count: 1,
          hard_count: 1,
          good_count: 1,
          easy_count: 0,
        },
      ],
      "workspace-2|Europe/Madrid|2026-04-11|2026-04-14": [
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
    activeReviewDateRowsByUser: {},
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

  const materializationQueries = recordedQueries.filter((query) => (
    query.text.includes("WITH target_review_events AS")
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

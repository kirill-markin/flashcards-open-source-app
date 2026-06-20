import assert from "node:assert/strict";
import test from "node:test";
import {
  loadUserProgressSeriesInExecutor,
  loadUserProgressSummaryInExecutor,
} from "./index";
import {
  createFullStreakFreeze,
  createProgressExecutor,
  createStreakFreezeAfterOneFrozenDay,
  formatDateAsTimeZoneLocalDate,
  shiftLocalDate,
} from "./progressTestSupport";
import { streakFreezePolicy } from "./streakFreeze";

test("loadUserProgressSummaryInExecutor returns zero summary metrics for an empty history", async () => {
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

  const progress = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });

  assert.deepEqual(progress, {
    timeZone: "Europe/Madrid",
    summary: {
      currentStreakDays: 0,
      longestStreakDays: 0,
      hasReviewedToday: false,
      lastReviewedOn: null,
      activeReviewDays: 0,
      streakFreeze: createFullStreakFreeze(),
    },
    generatedAt: progress.generatedAt,
    reviewHistoryWatermarks: [
      { workspaceId: "workspace-1", reviewSequenceId: 0 },
    ],
  });
  assert.match(progress.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    progress.summary.streakFreeze.earnedUnitsPerStreakDay,
    streakFreezePolicy.earnedUnitsPerStreakDay,
  );
});

test("loadUserProgressSummaryInExecutor raises when the progress timezone settings row is missing", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {},
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {},
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {},
  });

  await assert.rejects(
    () => loadUserProgressSummaryInExecutor(executor, {
      userId: "missing-user",
      timeZone: "Europe/Madrid",
    }),
    /Progress timezone user_settings row was not found for userId=missing-user/,
  );
});

test("loadUserProgressSummaryInExecutor freezes one completed missed day and recharges progress", async () => {
  const timeZone = "Europe/Madrid";
  const today = formatDateAsTimeZoneLocalDate(new Date(), timeZone);
  const twoDaysAgo = shiftLocalDate(today, -2);
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: twoDaysAgo },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 1,
    },
  });

  const progress = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone,
  });

  assert.deepEqual(progress.summary, {
    currentStreakDays: 2,
    longestStreakDays: 2,
    hasReviewedToday: false,
    lastReviewedOn: twoDaysAgo,
    activeReviewDays: 1,
    streakFreeze: createStreakFreezeAfterOneFrozenDay(),
  });
  assert.equal(progress.summary.streakFreeze.balanceUnits, 11);
  assert.equal(progress.summary.streakFreeze.nextCreditProgressUnits, 1);
  assert.equal(
    progress.summary.streakFreeze.earnedUnitsPerStreakDay,
    streakFreezePolicy.earnedUnitsPerStreakDay,
  );
});

test("loadUserProgressSummaryInExecutor resets a gap larger than available freezes before the next review", async () => {
  const timeZone = "Europe/Madrid";
  const today = formatDateAsTimeZoneLocalDate(new Date(), timeZone);
  const sixDaysAgo = shiftLocalDate(today, -6);
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {
      [`workspace-1|${timeZone}|${sixDaysAgo}|${today}`]: [
        {
          review_date: sixDaysAgo,
          review_count: 1,
          again_count: 0,
          hard_count: 0,
          good_count: 1,
          easy_count: 0,
        },
        {
          review_date: today,
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
        { review_date: sixDaysAgo },
        { review_date: today },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 2,
    },
  });

  const summary = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone,
  });
  const series = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone,
    from: sixDaysAgo,
    to: today,
  });

  assert.deepEqual(summary.summary, {
    currentStreakDays: 1,
    longestStreakDays: 3,
    hasReviewedToday: true,
    lastReviewedOn: today,
    activeReviewDays: 2,
    streakFreeze: createFullStreakFreeze(),
  });
  assert.deepEqual(series.streakDays, [
    { date: sixDaysAgo, state: "reviewed" },
    { date: shiftLocalDate(sixDaysAgo, 1), state: "frozen" },
    { date: shiftLocalDate(sixDaysAgo, 2), state: "frozen" },
    { date: shiftLocalDate(sixDaysAgo, 3), state: "missed" },
    { date: shiftLocalDate(sixDaysAgo, 4), state: "missed" },
    { date: shiftLocalDate(sixDaysAgo, 5), state: "missed" },
    { date: today, state: "reviewed" },
  ]);
});

test("loadUserProgressSummaryInExecutor reads user-wide active review dates without double-counting overlap", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: "2026-04-11" },
        { review_date: "2026-04-12" },
        { review_date: "2026-04-13" },
        { review_date: "2026-04-14" },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 3,
      "workspace-2": 2,
    },
  });

  const progress = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });

  assert.deepEqual(progress.summary, {
    currentStreakDays: 0,
    longestStreakDays: 6,
    hasReviewedToday: false,
    lastReviewedOn: "2026-04-14",
    activeReviewDays: 4,
    streakFreeze: createFullStreakFreeze(),
  });
  assert.deepEqual(progress.reviewHistoryWatermarks, [
    { workspaceId: "workspace-1", reviewSequenceId: 3 },
    { workspaceId: "workspace-2", reviewSequenceId: 2 },
  ]);
});

test("loadUserProgressSummaryInExecutor materializes and reads active review days in the requested timezone", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
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

  await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone: "America/Los_Angeles",
  });

  const timezoneRememberQuery = recordedQueries.find((query) => (
    query.text.includes("WITH target_user AS")
    && query.text.includes("UPDATE org.user_settings AS user_settings")
  ));
  if (timezoneRememberQuery === undefined) {
    assert.fail("Expected a progress timezone remember query to be recorded");
  }
  assert.match(timezoneRememberQuery.text, /target_user\.progress_time_zone IS DISTINCT FROM \$2/);
  assert.match(timezoneRememberQuery.text, /LEFT JOIN updated_user/);
  assert.deepEqual(timezoneRememberQuery.params, [
    "user-1",
    "America/Los_Angeles",
  ]);

  const materializationQuery = recordedQueries.find((query) => (
    query.text.includes("WITH target_review_events AS")
  ));
  if (materializationQuery === undefined) {
    assert.fail("Expected an active review day materialization query to be recorded");
  }
  assert.match(
    materializationQuery.text,
    /timezone\(COALESCE\(review_events\.reviewed_time_zone, \$2\), review_events\.reviewed_at_client\)::date/,
  );
  assert.match(materializationQuery.text, /WHERE review_events\.reviewed_by_user_id = \$1/);
  assert.match(materializationQuery.text, /AND review_events\.workspace_id = \$3/);
  assert.match(materializationQuery.text, /INSERT INTO progress\.user_active_review_days/);
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
  assert.match(activeDayQuery.text, /ORDER BY active_days\.local_date ASC/);
  assert.doesNotMatch(activeDayQuery.text, /workspace_id/);
  assert.deepEqual(activeDayQuery.params, ["user-1"]);
  assert.equal(
    recordedQueries.some((query) => (
      query.text.includes("SELECT DISTINCT timezone($2, review_events.reviewed_at_client)::date")
    )),
    false,
  );
});

test("loadUserProgressSummaryInExecutor applies user scope while reading user-wide active days", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: "2026-04-11" },
        { review_date: "2026-04-14" },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 1,
      "workspace-2": 1,
    },
  });

  await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });

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

test("loadUserProgressSummaryInExecutor keeps summary independent from the requested series range", async () => {
  const timeZone = "Europe/Madrid";
  const today = formatDateAsTimeZoneLocalDate(new Date(), timeZone);
  const yesterday = shiftLocalDate(today, -1);
  const twoDaysAgo = shiftLocalDate(today, -2);
  const tenDaysAgo = shiftLocalDate(today, -10);
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: tenDaysAgo },
        { review_date: twoDaysAgo },
        { review_date: yesterday },
        { review_date: today },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 4,
    },
  });

  const progress = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone,
  });

  assert.deepEqual(progress.summary, {
    currentStreakDays: 3,
    longestStreakDays: 3,
    hasReviewedToday: true,
    lastReviewedOn: today,
    activeReviewDays: 4,
    streakFreeze: createFullStreakFreeze(),
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
    activeReviewDateRowsByUser: {
      "user-1": [
        { review_date: yesterday },
        { review_date: today },
        { review_date: tomorrow },
      ],
    },
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 3,
    },
  });

  const progress = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone,
  });

  assert.deepEqual(progress.summary, {
    currentStreakDays: 2,
    longestStreakDays: 2,
    hasReviewedToday: true,
    lastReviewedOn: tomorrow,
    activeReviewDays: 3,
    streakFreeze: createFullStreakFreeze(),
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../shared/errors";
import {
  loadUserProgressReviewScheduleInExecutor,
  parseProgressReviewScheduleInputFromRequest,
  reviewScheduleBucketKeys,
} from "./index";
import {
  createEmptyReviewScheduleCountRow,
  createProgressExecutor,
  createReviewScheduleCountRow,
} from "./progressTestSupport";

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

test("loadUserProgressReviewScheduleInExecutor returns stable zero buckets for an empty schedule", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {},
    reviewScheduleRowsByRequest: {
      "workspace-1|Europe/Madrid": [
        createEmptyReviewScheduleCountRow(),
      ],
    },
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 0,
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
  assert.deepEqual(progress.reviewHistoryWatermarks, [
    { workspaceId: "workspace-1", reviewSequenceId: 0 },
  ]);
  assert.match(progress.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("loadUserProgressReviewScheduleInExecutor merges bucket counts across workspaces and applies scopes", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1", "workspace-2"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {},
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
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 8,
      "workspace-2": "80",
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
  assert.deepEqual(progress.reviewHistoryWatermarks, [
    { workspaceId: "workspace-1", reviewSequenceId: 8 },
    { workspaceId: "workspace-2", reviewSequenceId: 80 },
  ]);

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

test("loadUserProgressReviewScheduleInExecutor uses timezone calendar boundaries in SQL aggregate buckets", async () => {
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {},
    reviewScheduleRowsByRequest: {
      "workspace-1|America/Los_Angeles": [
        createEmptyReviewScheduleCountRow(),
      ],
    },
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": 0,
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

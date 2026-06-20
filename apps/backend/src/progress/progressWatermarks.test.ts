import assert from "node:assert/strict";
import test from "node:test";
import {
  loadUserProgressReviewScheduleInExecutor,
  loadUserProgressSeriesInExecutor,
  loadUserProgressSummaryInExecutor,
} from "./index";
import {
  createEmptyReviewScheduleCountRow,
  createProgressExecutor,
} from "./progressTestSupport";

test("progress responses include sorted review-history watermarks for accessible workspaces", async () => {
  const expectedWatermarks = [
    { workspaceId: "workspace-1", reviewSequenceId: 42 },
    { workspaceId: "workspace-2", reviewSequenceId: 7 },
  ];
  const { executor, recordedQueries } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-2", "workspace-1"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {},
    reviewScheduleRowsByRequest: {
      "workspace-1|Europe/Madrid": [
        createEmptyReviewScheduleCountRow(),
      ],
      "workspace-2|Europe/Madrid": [
        createEmptyReviewScheduleCountRow(),
      ],
    },
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": "42",
      "workspace-2": 7,
    },
  });

  const summary = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });
  const series = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-12",
  });
  const reviewSchedule = await loadUserProgressReviewScheduleInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });

  assert.deepEqual(summary.reviewHistoryWatermarks, expectedWatermarks);
  assert.deepEqual(series.reviewHistoryWatermarks, expectedWatermarks);
  assert.deepEqual(reviewSchedule.reviewHistoryWatermarks, expectedWatermarks);

  const watermarkQueries = recordedQueries.filter((query) => (
    query.text.includes("COALESCE(MAX(review_events.review_sequence), 0) AS review_sequence_id")
  ));
  assert.ok(watermarkQueries.length > 0);
  assert.ok(watermarkQueries.every((query) => (
    query.text.includes("WHERE security.current_workspace_access_allowed(requested_workspace_ids.workspace_id)")
  )));
});

test("progress responses return empty review-history watermarks when the user has no workspaces", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": [],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {},
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {},
  });

  const summary = await loadUserProgressSummaryInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });
  const series = await loadUserProgressSeriesInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-12",
  });
  const reviewSchedule = await loadUserProgressReviewScheduleInExecutor(executor, {
    userId: "user-1",
    timeZone: "Europe/Madrid",
  });

  assert.deepEqual(summary.reviewHistoryWatermarks, []);
  assert.deepEqual(series.reviewHistoryWatermarks, []);
  assert.deepEqual(reviewSchedule.reviewHistoryWatermarks, []);
});

test("loadUserProgressSummaryInExecutor raises workspace context for invalid review-history sequence", async () => {
  const { executor } = createProgressExecutor({
    workspaceIdsByUser: {
      "user-1": ["workspace-1"],
    },
    reviewRowsByRequest: {},
    activeReviewDateRowsByUser: {},
    reviewScheduleRowsByRequest: {},
    reviewSequenceIdsByWorkspaceId: {
      "workspace-1": "42-invalid",
    },
  });

  await assert.rejects(
    () => loadUserProgressSummaryInExecutor(executor, {
      userId: "user-1",
      timeZone: "Europe/Madrid",
    }),
    /Invalid review_sequence returned for progress watermark: workspaceId=workspace-1/,
  );
});

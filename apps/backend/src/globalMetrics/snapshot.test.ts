import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGlobalMetricsSnapshot,
  createGlobalMetricsSnapshotWindow,
  globalMetricsSnapshotSchemaVersion,
} from "./snapshot";

test("createGlobalMetricsSnapshotWindow uses the historical all-time UTC day window", () => {
  const window = createGlobalMetricsSnapshotWindow({
    now: new Date("2026-04-23T13:45:56.789Z"),
    historicalStartDate: "2026-03-07",
  });

  assert.equal(window.generatedAtUtc, "2026-04-23T13:45:56.789Z");
  assert.equal(window.asOfUtc, "2026-04-23T00:00:00.000Z");
  assert.equal(window.from, "2026-03-07");
  assert.equal(window.to, "2026-04-22");
  assert.equal(window.rangeStartUtc, "2026-03-07T00:00:00.000Z");
  assert.equal(window.rangeEndUtc, "2026-04-23T00:00:00.000Z");
  assert.equal(window.days.length, 47);
  assert.equal(window.days[0], "2026-03-07");
  assert.equal(window.days[46], "2026-04-22");
});

test("buildGlobalMetricsSnapshot zero-fills missing UTC dates and keeps unique users total separate from day sums", () => {
  const window = createGlobalMetricsSnapshotWindow({
    now: new Date("2026-04-23T09:30:00.000Z"),
    historicalStartDate: "2026-03-07",
  });
  const snapshot = buildGlobalMetricsSnapshot({
    window,
    totalsRow: {
      unique_reviewing_users: 8,
      total_review_events: 5,
      web_review_events: 2,
      android_review_events: 2,
      ios_review_events: 1,
    },
    dayRows: [
      {
        review_date: "2026-03-07",
        unique_reviewing_users: 2,
        new_reviewing_users: 2,
        returning_reviewing_users: 0,
        total_review_events: 3,
        web_review_events: 1,
        android_review_events: 1,
        ios_review_events: 1,
      },
      {
        review_date: "2026-04-22",
        unique_reviewing_users: 2,
        new_reviewing_users: 1,
        returning_reviewing_users: 1,
        total_review_events: 2,
        web_review_events: 1,
        android_review_events: 1,
        ios_review_events: 0,
      },
    ],
  });

  assert.equal(snapshot.schemaVersion, globalMetricsSnapshotSchemaVersion);
  assert.equal(snapshot.from, "2026-03-07");
  assert.equal(snapshot.to, "2026-04-22");
  assert.equal(snapshot.totals.uniqueReviewingUsers, 8);
  assert.deepEqual(snapshot.totals.reviewEvents, {
    total: 5,
    byPlatform: {
      web: 2,
      android: 2,
      ios: 1,
    },
  });
  assert.equal(snapshot.days.length, 47);
  assert.deepEqual(snapshot.days[0], {
    date: "2026-03-07",
    uniqueReviewingUsers: 2,
    newReviewingUsers: 2,
    returningReviewingUsers: 0,
    reviewEvents: {
      total: 3,
      byPlatform: {
        web: 1,
        android: 1,
        ios: 1,
      },
    },
  });
  assert.deepEqual(snapshot.days[1], {
    date: "2026-03-08",
    uniqueReviewingUsers: 0,
    newReviewingUsers: 0,
    returningReviewingUsers: 0,
    reviewEvents: {
      total: 0,
      byPlatform: {
        web: 0,
        android: 0,
        ios: 0,
      },
    },
  });
  assert.deepEqual(snapshot.days[46], {
    date: "2026-04-22",
    uniqueReviewingUsers: 2,
    newReviewingUsers: 1,
    returningReviewingUsers: 1,
    reviewEvents: {
      total: 2,
      byPlatform: {
        web: 1,
        android: 1,
        ios: 0,
      },
    },
  });

  const daySeriesReviewEventTotal = snapshot.days.reduce((sum, day) => sum + day.reviewEvents.total, 0);
  assert.equal(daySeriesReviewEventTotal, 5);
  assert.equal(snapshot.totals.reviewEvents.total, daySeriesReviewEventTotal);
});

test("createGlobalMetricsSnapshotWindow collapses to a single zero day when no historical review date exists", () => {
  const window = createGlobalMetricsSnapshotWindow({
    now: new Date("2026-04-23T13:45:56.789Z"),
    historicalStartDate: null,
  });

  assert.equal(window.generatedAtUtc, "2026-04-23T13:45:56.789Z");
  assert.equal(window.asOfUtc, "2026-04-23T00:00:00.000Z");
  assert.equal(window.from, "2026-04-22");
  assert.equal(window.to, "2026-04-22");
  assert.equal(window.rangeStartUtc, "2026-04-22T00:00:00.000Z");
  assert.equal(window.rangeEndUtc, "2026-04-23T00:00:00.000Z");
  assert.deepEqual(window.days, ["2026-04-22"]);
});

test("buildGlobalMetricsSnapshot emits a zero-filled single day when no qualifying history exists", () => {
  const snapshot = buildGlobalMetricsSnapshot({
    window: createGlobalMetricsSnapshotWindow({
      now: new Date("2026-04-23T09:30:00.000Z"),
      historicalStartDate: null,
    }),
    totalsRow: {
      unique_reviewing_users: 0,
      total_review_events: 0,
      web_review_events: 0,
      android_review_events: 0,
      ios_review_events: 0,
    },
    dayRows: [],
  });

  assert.equal(snapshot.schemaVersion, globalMetricsSnapshotSchemaVersion);
  assert.equal(snapshot.from, "2026-04-22");
  assert.equal(snapshot.to, "2026-04-22");
  assert.equal(snapshot.totals.uniqueReviewingUsers, 0);
  assert.deepEqual(snapshot.totals.reviewEvents, {
    total: 0,
    byPlatform: {
      web: 0,
      android: 0,
      ios: 0,
    },
  });
  assert.deepEqual(snapshot.days, [
    {
      date: "2026-04-22",
      uniqueReviewingUsers: 0,
      newReviewingUsers: 0,
      returningReviewingUsers: 0,
      reviewEvents: {
        total: 0,
        byPlatform: {
          web: 0,
          android: 0,
          ios: 0,
        },
      },
    },
  ]);
});


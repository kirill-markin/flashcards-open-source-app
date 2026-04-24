import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGlobalMetricsSnapshot,
  createGlobalMetricsSnapshotWindow,
} from "./snapshot";

test("createGlobalMetricsSnapshotWindow uses the trailing 90 complete UTC days", () => {
  const window = createGlobalMetricsSnapshotWindow(new Date("2026-04-23T13:45:56.789Z"));

  assert.equal(window.generatedAtUtc, "2026-04-23T13:45:56.789Z");
  assert.equal(window.asOfUtc, "2026-04-23T00:00:00.000Z");
  assert.equal(window.from, "2026-01-23");
  assert.equal(window.to, "2026-04-22");
  assert.equal(window.rangeStartUtc, "2026-01-23T00:00:00.000Z");
  assert.equal(window.rangeEndUtc, "2026-04-23T00:00:00.000Z");
  assert.equal(window.days.length, 90);
  assert.equal(window.days[0], "2026-01-23");
  assert.equal(window.days[89], "2026-04-22");
});

test("buildGlobalMetricsSnapshot zero-fills missing UTC dates and keeps unique users total separate from day sums", () => {
  const window = createGlobalMetricsSnapshotWindow(new Date("2026-04-23T09:30:00.000Z"));
  const snapshot = buildGlobalMetricsSnapshot({
    window,
    totalsRow: {
      unique_reviewing_users: 8,
      total_review_events: 12,
      web_review_events: 4,
      android_review_events: 5,
      ios_review_events: 3,
    },
    dayRows: [
      {
        review_date: "2026-01-23",
        unique_reviewing_users: 2,
        total_review_events: 3,
        web_review_events: 1,
        android_review_events: 1,
        ios_review_events: 1,
      },
      {
        review_date: "2026-04-22",
        unique_reviewing_users: 2,
        total_review_events: 2,
        web_review_events: 1,
        android_review_events: 1,
        ios_review_events: 0,
      },
    ],
  });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.from, "2026-01-23");
  assert.equal(snapshot.to, "2026-04-22");
  assert.equal(snapshot.totals.uniqueReviewingUsers, 8);
  assert.deepEqual(snapshot.totals.reviewEvents, {
    total: 12,
    byPlatform: {
      web: 4,
      android: 5,
      ios: 3,
    },
  });
  assert.equal(snapshot.days.length, 90);
  assert.deepEqual(snapshot.days[0], {
    date: "2026-01-23",
    uniqueReviewingUsers: 2,
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
    date: "2026-01-24",
    uniqueReviewingUsers: 0,
    reviewEvents: {
      total: 0,
      byPlatform: {
        web: 0,
        android: 0,
        ios: 0,
      },
    },
  });
  assert.deepEqual(snapshot.days[89], {
    date: "2026-04-22",
    uniqueReviewingUsers: 2,
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
  assert.notEqual(snapshot.totals.reviewEvents.total, daySeriesReviewEventTotal);
});

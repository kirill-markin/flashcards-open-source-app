import { z } from "zod";
import { createGlobalMetricsSnapshotWindow, globalMetricsSnapshotSchema } from "./snapshot";

export const reviewMetricsPlatforms = ["web", "android", "ios", "agent", "unattributed"] as const;
const countSchema = z.number().int().nonnegative();
const reviewEventsSchema = z.object({
  total: countSchema,
  byPlatform: z.object({
    web: countSchema,
    android: countSchema,
    ios: countSchema,
    agent: countSchema,
    unattributed: countSchema,
  }).strict(),
}).strict();

const snapshotV3Schema = globalMetricsSnapshotSchema.extend({
  schemaVersion: z.literal(3),
  totals: z.object({
    uniqueReviewingUsers: countSchema,
    reviewEvents: reviewEventsSchema,
  }).strict(),
  days: z.array(globalMetricsSnapshotSchema.shape.days.element.extend({
    reviewEvents: reviewEventsSchema,
  })),
});

export type GlobalMetricsSnapshotV3 = Readonly<z.infer<typeof snapshotV3Schema>>;
export type GlobalMetricsSnapshotV3Day = GlobalMetricsSnapshotV3["days"][number];

export function parseGlobalMetricsSnapshotV3Json(value: string): GlobalMetricsSnapshotV3 {
  const snapshot = snapshotV3Schema.parse(JSON.parse(value));
  const window = createGlobalMetricsSnapshotWindow({
    now: new Date(snapshot.generatedAtUtc),
    historicalStartDate: snapshot.from,
  });
  if (
    window.generatedAtUtc !== snapshot.generatedAtUtc
    || window.asOfUtc !== snapshot.asOfUtc
    || window.to !== snapshot.to
    || window.days.length !== snapshot.days.length
  ) {
    throw new Error("Global metrics v3 snapshot has an invalid completed UTC day window.");
  }

  const counts = [snapshot.totals.reviewEvents, ...snapshot.days.map((day) => day.reviewEvents)];
  for (const reviewEvents of counts) {
    const platformSum = reviewMetricsPlatforms.reduce((sum, platform) => sum + reviewEvents.byPlatform[platform], 0);
    if (reviewEvents.total !== platformSum) {
      throw new Error("Global metrics v3 review total must equal the sum of all five platforms.");
    }
  }
  for (const [index, day] of snapshot.days.entries()) {
    if (
      day.date !== window.days[index]
      || day.uniqueReviewingUsers !== day.newReviewingUsers + day.returningReviewingUsers
    ) {
      throw new Error("Global metrics v3 day dates and reviewer cohorts must match the complete series.");
    }
  }
  for (const platform of reviewMetricsPlatforms) {
    const daySum = snapshot.days.reduce((sum, day) => sum + day.reviewEvents.byPlatform[platform], 0);
    if (snapshot.totals.reviewEvents.byPlatform[platform] !== daySum) {
      throw new Error(`Global metrics v3 ${platform} total must equal its day series.`);
    }
  }
  const newUsers = snapshot.days.reduce((sum, day) => sum + day.newReviewingUsers, 0);
  if (snapshot.totals.uniqueReviewingUsers !== newUsers || snapshot.days[0]?.returningReviewingUsers !== 0) {
    throw new Error("Global metrics v3 all-time unique reviewers must match first-review cohorts.");
  }
  return snapshot;
}

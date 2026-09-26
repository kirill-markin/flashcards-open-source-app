import { withReportingReadOnlyTransaction } from "../admin/reportingDb";
import { buildDailyReviewActorPlatformSql, buildReviewAnswersCteSql } from "../reviewMetricsSql";
import { createGlobalMetricsSnapshotWindow } from "./snapshot";
import {
  parseGlobalMetricsSnapshotV3Json,
  type GlobalMetricsSnapshotV3,
  type GlobalMetricsSnapshotV3Day,
} from "./snapshotV3";

export function buildGlobalMetricsV3DaysSql(): string {
  return [
    `WITH ${buildReviewAnswersCteSql("$1::timestamptz", "TRUE")},`,
    `daily_activity AS (${buildDailyReviewActorPlatformSql("TRUE")})`,
    "SELECT to_char(review_date, 'YYYY-MM-DD') AS date,",
    '  COUNT(DISTINCT actor_id)::int AS "uniqueReviewingUsers",',
    '  COUNT(DISTINCT actor_id) FILTER (WHERE first_review_date = review_date)::int AS "newReviewingUsers",',
    '  COUNT(DISTINCT actor_id) FILTER (WHERE first_review_date < review_date)::int AS "returningReviewingUsers",',
    "  jsonb_build_object('total', SUM(review_event_count)::int, 'byPlatform', jsonb_build_object(",
    "    'web', COALESCE(SUM(review_event_count) FILTER (WHERE platform = 'web'), 0)::int,",
    "    'android', COALESCE(SUM(review_event_count) FILTER (WHERE platform = 'android'), 0)::int,",
    "    'ios', COALESCE(SUM(review_event_count) FILTER (WHERE platform = 'ios'), 0)::int,",
    "    'agent', COALESCE(SUM(review_event_count) FILTER (WHERE platform = 'agent'), 0)::int,",
    "    'unattributed', COALESCE(SUM(review_event_count) FILTER (WHERE platform = 'unattributed'), 0)::int",
    '  )) AS "reviewEvents"',
    "FROM daily_activity GROUP BY review_date ORDER BY review_date",
  ].join("\n");
}

export async function generateGlobalMetricsSnapshotV3(): Promise<GlobalMetricsSnapshotV3> {
  const now = new Date();
  const cutoff = createGlobalMetricsSnapshotWindow({ now, historicalStartDate: null });
  return withReportingReadOnlyTransaction(async (executor) => {
    const result = await executor.query<GlobalMetricsSnapshotV3Day>(buildGlobalMetricsV3DaysSql(), [cutoff.asOfUtc]);
    const window = createGlobalMetricsSnapshotWindow({ now, historicalStartDate: result.rows[0]?.date ?? null });
    const byDate = new Map(result.rows.map((day) => [day.date, day]));
    const days = window.days.map((date) => byDate.get(date) ?? {
      date,
      uniqueReviewingUsers: 0,
      newReviewingUsers: 0,
      returningReviewingUsers: 0,
      reviewEvents: { total: 0, byPlatform: { web: 0, android: 0, ios: 0, agent: 0, unattributed: 0 } },
    });
    const totals = days.reduce((sum, day) => ({
      uniqueReviewingUsers: sum.uniqueReviewingUsers + day.newReviewingUsers,
      reviewEvents: {
        total: sum.reviewEvents.total + day.reviewEvents.total,
        byPlatform: {
          web: sum.reviewEvents.byPlatform.web + day.reviewEvents.byPlatform.web,
          android: sum.reviewEvents.byPlatform.android + day.reviewEvents.byPlatform.android,
          ios: sum.reviewEvents.byPlatform.ios + day.reviewEvents.byPlatform.ios,
          agent: sum.reviewEvents.byPlatform.agent + day.reviewEvents.byPlatform.agent,
          unattributed: sum.reviewEvents.byPlatform.unattributed + day.reviewEvents.byPlatform.unattributed,
        },
      },
    }), {
      uniqueReviewingUsers: 0,
      reviewEvents: { total: 0, byPlatform: { web: 0, android: 0, ios: 0, agent: 0, unattributed: 0 } },
    });
    return parseGlobalMetricsSnapshotV3Json(JSON.stringify({
      schemaVersion: 3,
      generatedAtUtc: window.generatedAtUtc,
      asOfUtc: window.asOfUtc,
      from: window.from,
      to: window.to,
      totals,
      days,
    }));
  });
}

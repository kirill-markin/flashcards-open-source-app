import type { ReviewEventPlatform } from "../../adminApi";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  buildEventPlatformsNarrowingSql,
  buildExcludedActorSqlLines,
  buildTrustedActorRowsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import type { DailyActivitySource } from "../dailyNewReturning/query";
import { buildReportBucketSql, type ReportPeriod } from "./reportPeriod";

const reviewRowsFromSql = `FROM analytics.product_events_resolved AS events
  WHERE events.event_name = 'review_answered'
    AND events.actor_id IS NOT NULL
    AND ${buildTrustedActorRowsFilterSql("events.trust_level")}`;

// Meaningful use is any trusted answered review, whatever its rating. No bounds: first use must
// survive every selection, and today's reviews are shown in progress.
export function buildMeaningfulActivityCtesSql(): string {
  return `activity_clock AS (
  SELECT (now() AT TIME ZONE 'UTC')::date - 1 AS latest_complete_date
), recorded_activity AS MATERIALIZED (
  SELECT events.actor_id::text AS actor_id,
    (events.occurred_at AT TIME ZONE 'UTC')::date AS activity_date
  ${reviewRowsFromSql}
), activity_coverage AS (
  SELECT MIN(activity_date) AS history_from FROM recorded_activity
), included_actors AS MATERIALIZED (
  SELECT DISTINCT recorded_activity.actor_id
  FROM recorded_activity
  WHERE recorded_activity.actor_id IS NOT NULL
${buildExcludedActorSqlLines("recorded_activity.actor_id").join("\n")}
), meaningful_activity AS MATERIALIZED (
  SELECT DISTINCT recorded_activity.actor_id, recorded_activity.activity_date
  FROM recorded_activity
  JOIN included_actors USING (actor_id)
), actor_first_use AS MATERIALIZED (
  SELECT actor_id, MIN(activity_date) AS first_use_date
  FROM meaningful_activity
  GROUP BY actor_id
)`;
}

export const reviewActivitySource: DailyActivitySource = {
  ctesSql: buildMeaningfulActivityCtesSql(),
  activityCte: "meaningful_activity",
  firstUseCte: "actor_first_use",
  coverageCte: "activity_coverage",
  eventRowsFromSql: reviewRowsFromSql,
  eventRowsAppVersionSql: null,
};

/** Every trusted `review_answered` of `range` on `eventPlatforms`, with its day and `period` bucket. */
function buildRangeReviewsSql(
  period: ReportPeriod,
  range: AnalyticsDateRange,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
): string {
  return `SELECT events.actor_id::text AS actor_id,
      (events.occurred_at AT TIME ZONE 'UTC')::date AS activity_date,
      ${buildReportBucketSql(period, "(events.occurred_at AT TIME ZONE 'UTC')::date")} AS bucket_date,
      events.occurred_at, events.event_id, events.platform
    ${reviewRowsFromSql}
      AND events.occurred_at >= (${escapeSqlStringLiteral(range.from)}::date)::timestamp AT TIME ZONE 'UTC'
      AND events.occurred_at < (${escapeSqlStringLiteral(range.to)}::date + 1)::timestamp AT TIME ZONE 'UTC'
      ${buildEventPlatformsNarrowingSql("COALESCE(events.platform, 'unattributed')", eventPlatforms)}`;
}

/**
 * The `meaningful_range_reviews` CTE, composed after `buildMeaningfulActivityCtesSql`: every
 * `review_answered` of the range on `eventPlatforms` that `meaningful_activity` counts, one row per
 * review, so the shared actor exclusions apply.
 */
export function buildMeaningfulRangeReviewsCteSql(
  period: ReportPeriod,
  range: AnalyticsDateRange,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
): string {
  return `meaningful_range_reviews AS (
  SELECT range_reviews.*
  FROM (
    ${buildRangeReviewsSql(period, range, eventPlatforms)}
  ) AS range_reviews
  JOIN meaningful_activity USING (actor_id, activity_date)
)`;
}

/**
 * The `meaningful_last_reviews` CTE, composed after `buildMeaningfulActivityCtesSql`: one row per
 * bucket of the range and person `meaningful_activity` counts in it on `eventPlatforms`, carrying that
 * person's last `review_answered` there in the bucket (latest `occurred_at`, then `event_id`), so a
 * breakdown places each person once per bar.
 */
export function buildMeaningfulLastReviewsCteSql(
  period: ReportPeriod,
  range: AnalyticsDateRange,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
): string {
  return `meaningful_last_reviews AS (
  SELECT DISTINCT ON (range_reviews.bucket_date, range_reviews.actor_id) range_reviews.*
  FROM (
    ${buildRangeReviewsSql(period, range, eventPlatforms)}
  ) AS range_reviews
  JOIN meaningful_activity USING (actor_id, activity_date)
  ORDER BY range_reviews.bucket_date, range_reviews.actor_id, range_reviews.occurred_at DESC, range_reviews.event_id DESC
)`;
}

/**
 * The `actor_first_use_platform` CTE, composed after `buildMeaningfulActivityCtesSql`: for each person
 * whose first use falls in `range`, the `platform` of the answered review that is that first use
 * (earliest `occurred_at`, then `event_id`).
 */
export function buildActorFirstUsePlatformCteSql(range: AnalyticsDateRange): string {
  return `actor_first_use_platform AS (
  SELECT DISTINCT ON (range_reviews.actor_id) range_reviews.actor_id, range_reviews.platform
  FROM (
    SELECT events.actor_id::text AS actor_id, events.occurred_at, events.event_id, events.platform
    ${reviewRowsFromSql}
      AND events.occurred_at >= (${escapeSqlStringLiteral(range.from)}::date)::timestamp AT TIME ZONE 'UTC'
      AND events.occurred_at < (${escapeSqlStringLiteral(range.to)}::date + 1)::timestamp AT TIME ZONE 'UTC'
  ) AS range_reviews
  JOIN actor_first_use ON actor_first_use.actor_id = range_reviews.actor_id
    AND actor_first_use.first_use_date = (range_reviews.occurred_at AT TIME ZONE 'UTC')::date
  ORDER BY range_reviews.actor_id, range_reviews.occurred_at, range_reviews.event_id
)`;
}

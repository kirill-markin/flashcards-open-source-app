import { buildExcludedActorSqlLines, buildTrustedActorRowsFilterSql } from "../../filters/filterSql";

// Meaningful use is any trusted answered review, whatever its rating. No bounds: first use must
// survive every selection, and today's reviews are shown in progress.
export function buildMeaningfulActivityCtesSql(): string {
  return `activity_clock AS (
  SELECT (now() AT TIME ZONE 'UTC')::date - 1 AS latest_complete_date
), recorded_activity AS MATERIALIZED (
  SELECT events.actor_id::text AS actor_id,
    (events.occurred_at AT TIME ZONE 'UTC')::date AS activity_date
  FROM analytics.product_events_resolved AS events
  WHERE events.event_name = 'review_answered'
    AND events.actor_id IS NOT NULL
    AND ${buildTrustedActorRowsFilterSql("events.trust_level")}
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

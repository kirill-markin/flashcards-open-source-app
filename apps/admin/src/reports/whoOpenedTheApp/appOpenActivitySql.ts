import { buildExcludedActorSqlLines, buildTrustedActorRowsFilterSql } from "../../filters/filterSql";

// The same `app_opened` rows, trust rule and actor exclusions as `buildDailyActiveUsersSql` in
// `../dailyActiveUsers/query.ts`, whose header explains them. No bounds: first open must survive
// every selection, and today's opens are shown in progress. Coverage is read before exclusions.
export function buildAppOpenActivityCtesSql(): string {
  return `app_open_rows AS MATERIALIZED (
  SELECT events.actor_id::text AS actor_id,
    (events.occurred_at AT TIME ZONE 'UTC')::date AS activity_date
  FROM analytics.product_events_resolved AS events
  WHERE events.event_name = 'app_opened'
    AND ${buildTrustedActorRowsFilterSql("events.trust_level")}
), app_open_coverage AS (
  SELECT MIN(activity_date) AS history_from FROM app_open_rows
), app_open_activity AS MATERIALIZED (
  SELECT DISTINCT app_open_rows.actor_id, app_open_rows.activity_date
  FROM app_open_rows
  WHERE app_open_rows.actor_id IS NOT NULL
${buildExcludedActorSqlLines("app_open_rows.actor_id").join("\n")}
), app_open_first_use AS MATERIALIZED (
  SELECT actor_id, MIN(activity_date) AS first_use_date
  FROM app_open_activity
  GROUP BY actor_id
)`;
}

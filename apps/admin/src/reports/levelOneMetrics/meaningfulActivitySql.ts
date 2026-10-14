import { buildExcludedActorSqlLines, buildTrustedActorRowsFilterSql } from "../../filters/filterSql";

// No lower bound: first use and rolling pre-range history must survive every selection.
// Native chat role includes attachment-only messages without reading private payloads.
export function buildMeaningfulActivityCtesSql(): string {
  return `activity_clock AS (
  SELECT (now() AT TIME ZONE 'UTC')::date - 1 AS latest_complete_date
), chat_actors AS (
  SELECT sessions.session_id,
    COALESCE(upgrade.user_id::text, pg_catalog.lower(sessions.user_id)) AS actor_id
  FROM ai.chat_sessions AS sessions
  LEFT JOIN (
    SELECT DISTINCT ON (links.anonymous_id) links.anonymous_id, links.user_id
    FROM analytics.identity_links AS links
    WHERE links.source = 'server_derived'
    ORDER BY links.anonymous_id, links.linked_at, links.link_id
  ) AS upgrade ON upgrade.anonymous_id::text = pg_catalog.lower(sessions.user_id)
), recorded_activity AS MATERIALIZED (
  SELECT events.actor_id::text AS actor_id,
    (events.occurred_at AT TIME ZONE 'UTC')::date AS activity_date
  FROM analytics.product_events_resolved AS events
  WHERE events.event_name = 'review_answered'
    AND events.actor_id IS NOT NULL
    AND ${buildTrustedActorRowsFilterSql("events.trust_level")}
    AND events.occurred_at < ((SELECT latest_complete_date + 1 FROM activity_clock))::timestamp AT TIME ZONE 'UTC'
  UNION ALL
  SELECT chat_actors.actor_id, (items.created_at AT TIME ZONE 'UTC')::date AS activity_date
  FROM ai.chat_items AS items
  JOIN chat_actors ON chat_actors.session_id = items.session_id
  WHERE items.role = 'user'
    AND items.created_at < ((SELECT latest_complete_date + 1 FROM activity_clock))::timestamp AT TIME ZONE 'UTC'
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

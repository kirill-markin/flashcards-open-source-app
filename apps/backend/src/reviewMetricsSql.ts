// Pure SQL only: this module is also imported by the admin browser bundle.
// Stored account ids are TEXT and may use uppercase UUID hex; resolved actor ids are canonical.
// The automated verdict is actor-wide. Its uncorrelated array avoids repeated scans for CTE callers.
export function buildExcludedActorSqlLines(
  actorIdSqlExpression: string,
): ReadonlyArray<string> {
  return [
    "  AND NOT EXISTS (",
    "    SELECT 1",
    "    FROM org.user_settings AS excluded_settings",
    `    WHERE pg_catalog.lower(excluded_settings.user_id) = ${actorIdSqlExpression}`,
    "      AND (",
    "        LOWER(btrim(excluded_settings.email)) LIKE '%@example.com'",
    "        OR EXISTS (",
    "          SELECT 1",
    "          FROM auth.admin_users AS excluded_admin_users",
    "          WHERE excluded_admin_users.email = LOWER(btrim(excluded_settings.email))",
    "        )",
    "      )",
    "  )",
    "  AND NOT EXISTS (",
    "    SELECT 1",
    "    FROM analytics.excluded_actors AS excluded_actors",
    `    WHERE excluded_actors.actor_id = ${actorIdSqlExpression}`,
    "      AND excluded_actors.restored_at IS NULL",
    "  )",
    // The NULL arm keeps an unresolvable actor exactly as the two `NOT EXISTS` above keep it, which a
    // bare comparison would not: `NOT (NULL = ANY (...))` is unknown and would drop such a row. A
    // caller whose relation can hold one is rejecting it for its own reasons, never through this rule.
    "  AND (",
    `    ${actorIdSqlExpression} IS NULL`,
    `    OR NOT (${actorIdSqlExpression} = ANY (ARRAY(`,
    "      SELECT DISTINCT automated_events.actor_id::text",
    "      FROM analytics.product_events_resolved AS automated_events",
    "      WHERE automated_events.automated_client",
    // A marked row nobody can be resolved behind names no actor to drop, and a NULL inside the array
    // would make every comparison that does not match a listed actor unknown, so the caller would
    // keep no row either way.
    "        AND automated_events.actor_id IS NOT NULL",
    "    )))",
    "  )",
  ];
}

export function buildReviewAnswersCteSql(
  endExclusiveSql: string,
  actorSelectionSql: string,
): string {
  return [
    "review_answers AS (",
    "  SELECT resolved.actor_id::text AS actor_id,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS review_date,",
    "    CASE WHEN resolved.platform IN ('web', 'android', 'ios', 'agent')",
    "      THEN resolved.platform ELSE 'unattributed' END AS platform",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.event_name = 'review_answered'",
    "    AND resolved.actor_id IS NOT NULL",
    `    AND resolved.occurred_at < ${endExclusiveSql}`,
    `    AND ${actorSelectionSql}`,
    ...buildExcludedActorSqlLines("resolved.actor_id::text"),
    "),",
    // No lower date/platform bound: selecting a range must never redefine somebody's first review.
    // Materialization prevents a nested-loop plan from recalculating history for each outer row.
    "actor_first_review_date AS MATERIALIZED (",
    "  SELECT actor_id, MIN(review_date) AS first_review_date",
    "  FROM review_answers GROUP BY actor_id",
    ")",
  ].join("\n");
}

export function buildDailyReviewActorPlatformSql(selectionSql: string): string {
  return [
    "SELECT review_answers.review_date, review_answers.actor_id, review_answers.platform,",
    "  actor_first_review_date.first_review_date, COUNT(*)::int AS review_event_count",
    "FROM review_answers",
    "INNER JOIN actor_first_review_date USING (actor_id)",
    `WHERE ${selectionSql}`,
    "GROUP BY review_answers.review_date, review_answers.actor_id, review_answers.platform,",
    "  actor_first_review_date.first_review_date",
  ].join("\n");
}

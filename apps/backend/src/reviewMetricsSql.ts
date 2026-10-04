// Pure SQL only: this module is also imported by the admin browser bundle.
// Stored account ids are TEXT and may use uppercase UUID hex; resolved actor ids are canonical.
// The automated verdict is actor-wide.
// The arms of the one exclusion rule, each as unindented lines, for `buildExcludedActorSqlLines` and
// the admin users list's exclusion reason; the reason restates the settings and exclusion-list arms
// per actor, so change both forms together.

/** The actor's own `org.user_settings` row, aliased `excluded_settings`, which both settings arms read. */
export function buildExcludedSettingsRowSqlLines(actorIdSqlExpression: string): ReadonlyArray<string> {
  return [
    "SELECT 1",
    "FROM org.user_settings AS excluded_settings",
    `WHERE pg_catalog.lower(excluded_settings.user_id) = ${actorIdSqlExpression}`,
  ];
}

export const excludedTestEmailSql = "LOWER(btrim(excluded_settings.email)) LIKE '%@example.com'";

/** Any admin grant for the settings row's email, revoked or not. */
export const excludedAdminUserSqlLines: ReadonlyArray<string> = [
  "SELECT 1",
  "FROM auth.admin_users AS excluded_admin_users",
  "WHERE excluded_admin_users.email = LOWER(btrim(excluded_settings.email))",
];

export function buildExclusionListedActorSqlLines(actorIdSqlExpression: string): ReadonlyArray<string> {
  return [
    "SELECT 1",
    "FROM analytics.excluded_actors AS excluded_actors",
    `WHERE excluded_actors.actor_id = ${actorIdSqlExpression}`,
    "  AND excluded_actors.restored_at IS NULL",
  ];
}

export const automatedActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT DISTINCT automated_events.actor_id::text",
  "FROM analytics.product_events_resolved AS automated_events",
  "WHERE automated_events.automated_client",
  // A marked row nobody can be resolved behind names no actor to drop, and a NULL inside the set
  // would make every comparison that does not match a listed actor unknown, so the caller would
  // keep no row either way.
  "  AND automated_events.actor_id IS NOT NULL",
];

function indentSqlLines(lines: ReadonlyArray<string>, indent: string): ReadonlyArray<string> {
  return lines.map((line) => `${indent}${line}`);
}

export function buildExcludedActorSqlLines(
  actorIdSqlExpression: string,
): ReadonlyArray<string> {
  // One uncorrelated `NOT IN` set, which Postgres builds once as a hashed SubPlan instead of
  // rescanning per outer row, whatever the planner estimates for that row count. Every arm must
  // yield only non-NULL ids: one NULL in the set makes `NOT IN` unknown for every unlisted actor and
  // drops every row. The NULL arm keeps an unresolvable actor, which a bare `NOT IN` would drop; a
  // caller whose relation can hold one is rejecting it for its own reasons, never through this rule.
  return [
    "  AND (",
    `    ${actorIdSqlExpression} IS NULL`,
    `    OR ${actorIdSqlExpression} NOT IN (`,
    "      SELECT pg_catalog.lower(excluded_settings.user_id)",
    "      FROM org.user_settings AS excluded_settings",
    `      WHERE ${excludedTestEmailSql}`,
    "        OR EXISTS (",
    ...indentSqlLines(excludedAdminUserSqlLines, "          "),
    "        )",
    "      UNION ALL",
    "      SELECT excluded_actors.actor_id",
    "      FROM analytics.excluded_actors AS excluded_actors",
    "      WHERE excluded_actors.restored_at IS NULL",
    "      UNION ALL",
    ...indentSqlLines(automatedActorIdsSqlLines, "      "),
    "    )",
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

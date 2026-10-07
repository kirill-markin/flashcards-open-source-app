// Pure SQL only: this module is also imported by the admin browser bundle.
// Stored account ids are TEXT and may use uppercase UUID hex; resolved actor ids are canonical.

function indentSqlLines(lines: ReadonlyArray<string>, indent: string): ReadonlyArray<string> {
  return lines.map((line) => `${indent}${line}`);
}

export const excludedTestEmailSql =
  "(LOWER(btrim(excluded_settings.email)) LIKE '%@example.com' OR LOWER(btrim(excluded_settings.email)) LIKE '%+test%')";

/** Any admin grant for the settings row's email, revoked or not. */
export const excludedAdminUserSqlLines: ReadonlyArray<string> = [
  "SELECT 1",
  "FROM auth.admin_users AS excluded_admin_users",
  "WHERE excluded_admin_users.email = LOWER(btrim(excluded_settings.email))",
];

export const excludedTestEmailActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT pg_catalog.lower(excluded_settings.user_id)",
  "FROM org.user_settings AS excluded_settings",
  `WHERE ${excludedTestEmailSql}`,
];

export const excludedAdminActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT pg_catalog.lower(excluded_settings.user_id)",
  "FROM org.user_settings AS excluded_settings",
  "WHERE EXISTS (",
  ...indentSqlLines(excludedAdminUserSqlLines, "  "),
  ")",
];

// Only the detector's exact historical burst rows are audit records rather than active exclusions.
export const legacyAndroidBurstExclusionSql =
  "excluded_actors.source = 'automatic' AND excluded_actors.excluded_by = 'job:synthetic-actor-detector' AND excluded_actors.reason = 'android install burst: 4+ short-lived guest installs of one device fingerprint within 24h'";

// Whole trusted history decides the classification independently of report selections. NULL device
// fields on server facts do not add fingerprints. Restored people contribute to the burst size,
// but a restore under any of their resolved/raw/subject IDs overrides the match.
export const probableAndroidBurstActorIdsSql = `
WITH actor_history AS MATERIALIZED (
  SELECT
    pg_catalog.lower(pg_catalog.btrim(resolved.actor_id::text)) AS actor_id,
    min(resolved.device_model) FILTER (WHERE resolved.platform = 'android') AS device_model,
    min(resolved.os_version) FILTER (WHERE resolved.platform = 'android') AS os_version,
    min(resolved.app_version) FILTER (WHERE resolved.platform = 'android') AS app_version,
    min(resolved.occurred_at) AS first_event_at,
    array_agg(DISTINCT pg_catalog.lower(pg_catalog.btrim(resolved.user_id::text)))
      FILTER (WHERE resolved.user_id IS NOT NULL) AS event_user_ids,
    array_agg(DISTINCT pg_catalog.lower(pg_catalog.btrim(resolved.subject_user_id::text)))
      FILTER (WHERE resolved.subject_user_id IS NOT NULL) AS event_subject_user_ids
  FROM analytics.product_events_resolved AS resolved
  WHERE resolved.actor_id IS NOT NULL
    AND resolved.trust_level <> 'anonymous_client'
  GROUP BY 1
  HAVING count(DISTINCT resolved.device_model) FILTER (WHERE resolved.platform = 'android') = 1
    AND count(DISTINCT resolved.os_version) FILTER (WHERE resolved.platform = 'android') = 1
    AND count(DISTINCT resolved.app_version) FILTER (WHERE resolved.platform = 'android') = 1
    AND max(resolved.occurred_at) - min(resolved.occurred_at) < interval '24 hours'
),
person_ids AS MATERIALIZED (
  SELECT DISTINCT actor_history.actor_id, person_key.person_id
  FROM actor_history
  CROSS JOIN LATERAL unnest(
    ARRAY[actor_history.actor_id]
      || COALESCE(actor_history.event_user_ids, ARRAY[]::text[])
      || COALESCE(actor_history.event_subject_user_ids, ARRAY[]::text[])
  ) AS person_key(person_id)
),
qualifying AS (
  SELECT actor_history.*
  FROM actor_history
  WHERE NOT EXISTS (
    SELECT 1
    FROM person_ids AS signed_in_person
    JOIN auth.user_identities AS signed_in_identities
      ON pg_catalog.lower(signed_in_identities.user_id) = signed_in_person.person_id
    WHERE signed_in_person.actor_id = actor_history.actor_id
      AND signed_in_identities.provider_type = 'cognito'
  )
),
burst_windows AS (
  SELECT anchor.device_model, anchor.os_version, anchor.app_version,
    anchor.first_event_at AS window_start
  FROM qualifying AS anchor
  JOIN qualifying AS member
    ON member.device_model = anchor.device_model
    AND member.os_version = anchor.os_version
    AND member.app_version = anchor.app_version
    AND member.first_event_at >= anchor.first_event_at
    AND member.first_event_at < anchor.first_event_at + interval '24 hours'
  GROUP BY anchor.actor_id, anchor.device_model, anchor.os_version, anchor.app_version, anchor.first_event_at
  HAVING count(*) >= 4
),
burst_members AS (
  SELECT DISTINCT member.actor_id
  FROM qualifying AS member
  JOIN burst_windows
    ON burst_windows.device_model = member.device_model
    AND burst_windows.os_version = member.os_version
    AND burst_windows.app_version = member.app_version
    AND member.first_event_at >= burst_windows.window_start
    AND member.first_event_at < burst_windows.window_start + interval '24 hours'
)
SELECT burst_members.actor_id
FROM burst_members
WHERE NOT EXISTS (
  SELECT 1
  FROM analytics.excluded_actors AS restored
  JOIN person_ids AS restored_person
    ON restored_person.person_id = restored.actor_id
  WHERE restored_person.actor_id = burst_members.actor_id
    AND restored.restored_at IS NOT NULL
)
`.trim();

export const probableAndroidBurstActorIdsSqlLines: ReadonlyArray<string> =
  probableAndroidBurstActorIdsSql.split("\n");

export const excludedListedActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT excluded_actors.actor_id",
  "FROM analytics.excluded_actors AS excluded_actors",
  "WHERE excluded_actors.restored_at IS NULL",
  `  AND NOT (${legacyAndroidBurstExclusionSql})`,
];

export const automatedActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT DISTINCT automated_events.actor_id::text",
  "FROM analytics.product_events_resolved AS automated_events",
  "WHERE automated_events.automated_client",
  // A marked row nobody can be resolved behind names no actor to drop, and a NULL inside the set
  // would make every comparison that does not match a listed actor unknown, so the caller would
  // keep no row either way.
  "  AND automated_events.actor_id IS NOT NULL",
];

export function buildExcludedActorSqlLines(
  actorIdSqlExpression: string,
): ReadonlyArray<string> {
  // One uncorrelated `NOT IN` set, so Postgres computes it once and never rescans it per outer row;
  // it probes the set by hash or scans the cached result, choosing by cost. Every arm must yield
  // only non-NULL ids: one NULL in the set makes `NOT IN` unknown for every unlisted actor and drops
  // every row. The NULL arm keeps an unresolvable actor, which a bare `NOT IN` would drop; a caller
  // whose relation can hold one is rejecting it for its own reasons, never through this rule.
  return [
    "  AND (",
    `    ${actorIdSqlExpression} IS NULL`,
    `    OR ${actorIdSqlExpression} NOT IN (`,
    ...indentSqlLines(excludedTestEmailActorIdsSqlLines, "      "),
    "      UNION ALL",
    ...indentSqlLines(excludedAdminActorIdsSqlLines, "      "),
    "      UNION ALL",
    ...indentSqlLines(excludedListedActorIdsSqlLines, "      "),
    "      UNION ALL",
    ...indentSqlLines(automatedActorIdsSqlLines, "      "),
    "      UNION ALL",
    "      SELECT probable_android_bursts.actor_id",
    "      FROM (",
    ...indentSqlLines(probableAndroidBurstActorIdsSqlLines, "        "),
    "      ) AS probable_android_bursts",
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

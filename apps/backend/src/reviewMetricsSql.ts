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

// Refreshed hourly from whole trusted history; see db/migrations/0171_probable_android_burst_actors.sql.
export const probableAndroidBurstActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT probable_android_bursts.actor_id",
  "FROM analytics.probable_android_burst_actors AS probable_android_bursts",
];

// Refreshed hourly; see db/migrations/0225_probable_scraper_fleet_facts_rule.sql.
export const probableScraperFleetActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT probable_scraper_fleet.subject_id",
  "FROM analytics.probable_scraper_fleet_visitors AS probable_scraper_fleet",
  "WHERE probable_scraper_fleet.subject_kind = 'actor'",
];

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

export const automationInstallationActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT pg_catalog.lower(automation_installations.user_id)",
  "FROM sync.installations AS automation_installations",
  "WHERE automation_installations.is_automation",
  "  AND NOT EXISTS (",
  "    SELECT 1",
  "    FROM auth.user_identities AS signed_in_identities",
  "    WHERE signed_in_identities.provider_type = 'cognito'",
  "      AND pg_catalog.lower(signed_in_identities.user_id) = pg_catalog.lower(automation_installations.user_id)",
  "  )",
];

// Unlike the automation arm, a signed-in person on a test build is dropped too: a product decision.
// sync.installations.user_id names only the current owner, and nothing suppresses a test build's
// activity at write time, so every earlier owner is found through the installation's per-workspace
// replicas, which a later claim never reassigns.
export const testDistributionInstallationActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT pg_catalog.lower(test_distribution_installations.user_id)",
  "FROM sync.installations AS test_distribution_installations",
  "WHERE test_distribution_installations.is_test_distribution",
  "UNION ALL",
  "SELECT pg_catalog.lower(test_distribution_replicas.user_id)",
  "FROM sync.workspace_replicas AS test_distribution_replicas",
  "JOIN sync.installations AS test_distribution_replica_installations",
  "  ON test_distribution_replica_installations.installation_id = test_distribution_replicas.installation_id",
  "WHERE test_distribution_replica_installations.is_test_distribution",
];

// `entitlement_changed` is the only billing fact that carries `environment`
// (apps/backend/src/productAnalytics/catalog.ts).
export const sandboxBillingActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT DISTINCT sandbox_billing_events.actor_id::text",
  "FROM analytics.product_events_resolved AS sandbox_billing_events",
  "WHERE sandbox_billing_events.event_name = 'entitlement_changed'",
  "  AND sandbox_billing_events.origin = 'server'",
  "  AND sandbox_billing_events.event_properties ->> 'environment' = 'sandbox'",
  "  AND sandbox_billing_events.actor_id IS NOT NULL",
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
    ...indentSqlLines(automationInstallationActorIdsSqlLines, "      "),
    "      UNION ALL",
    ...indentSqlLines(testDistributionInstallationActorIdsSqlLines, "      "),
    "      UNION ALL",
    ...indentSqlLines(sandboxBillingActorIdsSqlLines, "      "),
    "      UNION ALL",
    ...indentSqlLines(probableAndroidBurstActorIdsSqlLines, "      "),
    "      UNION ALL",
    ...indentSqlLines(probableScraperFleetActorIdsSqlLines, "      "),
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

import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type ReviewEventCohort,
  type ReviewEventPlatform,
} from "../adminApi";
import { escapeSqlStringLiteral } from "../sql";
import {
  isAcceptedMinimumCount,
  type AnalyticsDateRange,
  type AnalyticsFilterState,
  type AnalyticsMinimumEventCount,
} from "./analyticsFilters";

// The SQL half of `AnalyticsFilterState`: one predicate builder per filter field, so every report
// applies a selection the same way and the "what does an empty selection mean" decisions live here
// once.
//
// Each builder takes the SQL expression to compare rather than a column name, because every report
// derives its own actor, cohort and platform expressions - a cohort in particular is a comparison
// between a row's date and that actor's first day of the activity the report counts, and no two
// reports count the same activity.

function buildInPredicateSql(sqlExpression: string, values: ReadonlyArray<string>): string {
  if (values.length === 0) {
    return "FALSE";
  }

  return `${sqlExpression} IN (${values.map(escapeSqlStringLiteral).join(", ")})`;
}

/** Picking nobody keeps every user, so an empty selection is the absence of a filter rather than "none". */
export function buildUsersFilterSql(
  actorIdSqlExpression: string,
  users: ReadonlyArray<string>,
): string {
  return users.length === 0 ? "TRUE" : buildInPredicateSql(actorIdSqlExpression, users);
}

/** Both sides are selected by default, so an empty selection is a deliberate "neither" and matches nothing. */
export function buildUserCohortsFilterSql(
  cohortSqlExpression: string,
  userCohorts: ReadonlyArray<ReviewEventCohort>,
): string {
  return buildInPredicateSql(cohortSqlExpression, userCohorts);
}

/** Every platform is selected by default, so an empty selection matches nothing, as on the cohorts. */
export function buildEventPlatformsFilterSql(
  platformSqlExpression: string,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
): string {
  return buildInPredicateSql(platformSqlExpression, eventPlatforms);
}

// `catalog_deck_installed` is the one counted event type with a visible counterpart on screen, the
// `Catalog deck installs` section, and a threshold that counted more installs than that section shows
// would let a chip and a chart disagree about the same person. So this repeats the two exclusions the
// `deck_installs` CTE of `buildCatalogInstallsSql` applies: the delisted `test` fixture of
// `db/migrations/0111_delist_catalog_test_fixture.sql`, and installs made by an admin whose grant is
// not revoked. The `%@example.com` exclusion that CTE also applies is deliberately not repeated,
// because every set of users a threshold is applied to has already dropped those actors itself.
const catalogInstallThresholdExclusionSqlLines = [
  "    AND threshold_events.event_properties ->> 'package_slug' <> 'test'",
  "    AND NOT EXISTS (",
  "      SELECT 1",
  "      FROM org.user_settings AS threshold_user_settings",
  "      JOIN auth.admin_users AS threshold_admin_users",
  "        ON threshold_admin_users.email = LOWER(btrim(threshold_user_settings.email))",
  "      WHERE pg_catalog.lower(threshold_user_settings.user_id) = threshold_events.actor_id::text",
  "        AND threshold_admin_users.revoked_at IS NULL",
  "    )",
];

// One threshold, as the set of actors that cleared it. The count is taken inside the selected range
// on `analytics.product_events_resolved`, the one table every report here reads, so a threshold means
// the same thing on every area no matter which activity that area charts. Actors are compared as
// text because that is how each report already exposes its own actor id; `actor_id IS NOT NULL`
// keeps the set free of a NULL, which would otherwise make a non-match read as unknown rather than
// as false.
function buildMinimumEventCountFilterSql(
  actorIdSqlExpression: string,
  minimumEventCount: AnalyticsMinimumEventCount,
  dateRange: AnalyticsDateRange,
): string {
  if (isAcceptedMinimumCount(minimumEventCount.minimumCount) === false) {
    throw new Error(
      `Minimum event count for ${minimumEventCount.eventType} must be a whole number of at least 1. Got ${minimumEventCount.minimumCount}.`,
    );
  }

  return [
    `${actorIdSqlExpression} IN (`,
    "  SELECT threshold_events.actor_id::text",
    "  FROM analytics.product_events_resolved AS threshold_events",
    `  WHERE threshold_events.event_name = ${escapeSqlStringLiteral(minimumEventCount.eventType)}`,
    "    AND threshold_events.actor_id IS NOT NULL",
    "    AND threshold_events.occurred_at >= (",
    `      (${escapeSqlStringLiteral(dateRange.from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND threshold_events.occurred_at < (",
    `      (${escapeSqlStringLiteral(dateRange.to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    ...(minimumEventCount.eventType === "catalog_deck_installed"
      ? catalogInstallThresholdExclusionSqlLines
      : []),
    "  GROUP BY threshold_events.actor_id",
    `  HAVING COUNT(*) >= ${minimumEventCount.minimumCount}`,
    ")",
  ].join("\n");
}

/**
 * Every selected threshold at once: a user has to clear all of them, so they compose with AND, and
 * selecting none is the absence of a filter rather than "nobody".
 *
 * This restricts people rather than rows, so a report applies it wherever its own set of counted
 * users is decided - which on a report with a distinct-user denominator is the CTE that cohort is
 * built from, not only the rows counted inside it.
 */
export function buildMinimumEventCountsFilterSql(
  actorIdSqlExpression: string,
  minimumEventCounts: ReadonlyArray<AnalyticsMinimumEventCount>,
  dateRange: AnalyticsDateRange,
): string {
  if (minimumEventCounts.length === 0) {
    return "TRUE";
  }

  // Parenthesized as a whole, so a caller can drop it into an `OR` branch as safely as into an
  // `AND` chain.
  return `(${minimumEventCounts
    .map((minimumEventCount) => buildMinimumEventCountFilterSql(
      actorIdSqlExpression,
      minimumEventCount,
      dateRange,
    ))
    .join("\n  AND ")})`;
}

/**
 * A row whose cohort cannot be decided is kept only while both cohorts are selected, which is the
 * state the filter row treats as "no cohort filter". Catalog installs are the one report with that
 * case: an installer with no `app_opened` day inside the range belongs to neither side.
 */
export function isEveryUserCohortSelected(filters: AnalyticsFilterState): boolean {
  return filters.userCohorts.length === reviewEventCohorts.length;
}

/**
 * True once the cohort or the platform selection stops spanning every value. Community rows carry no
 * cohort and no platform of their own, so this is what makes them fall back to the users that still
 * have review events in range.
 */
export function isCohortOrPlatformNarrowed(filters: AnalyticsFilterState): boolean {
  return isEveryUserCohortSelected(filters) === false
    || filters.eventPlatforms.length !== reviewEventPlatforms.length;
}

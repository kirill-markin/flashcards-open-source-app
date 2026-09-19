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

// The half-open UTC instants of a range, as the expressions a timestamp column is compared to. Each
// one is parenthesized whole, so it drops into a comparison as safely as into a select list.
function buildRangeStartSql(dateRange: AnalyticsDateRange): string {
  return `((${escapeSqlStringLiteral(dateRange.from)}::date)::timestamp AT TIME ZONE 'UTC')`;
}

function buildRangeEndSql(dateRange: AnalyticsDateRange): string {
  return `((${escapeSqlStringLiteral(dateRange.to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')`;
}

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
 * The retained connection samples of one range, as one row per (actor, sampled country, event UI
 * locale). The audience report's country and pair dimensions, the country option list and the country
 * filter below all read this one fragment, so a country always means the same evidence.
 *
 * `eventPlatforms` narrows the samples to a platform selection, and `null` is every platform. The
 * filter and the option list both pass `null`, because a person's connection country is not a
 * property of the platform slice on screen, and because
 * `analytics.installation_country_observations.platform` only ever holds `web`, `ios` or `android`
 * (`db/migrations/0137_audience_context.sql`): narrowing the platform field to `unattributed` alone -
 * the natural way to read the catalog installs section, whose rows are always `unattributed` - would
 * otherwise make the country predicate match nobody and empty every section. The audience report
 * passes its own selection, because its charts count the platform slice on screen.
 *
 * ENDPOINT EQUALITY PROVES THE ACCEPTED SAMPLING BATCH, not the queued event's location. A sample is
 * matched to the client events of the same installation and platform whose `server_received_at` is
 * exactly one endpoint of the observation period. There is deliberately no interval overlap and no
 * `analytics.installation_profiles.user_id` ownership join.
 *
 * DETAILED COUNTRY HISTORY IS KEPT FOR 90 DAYS ONLY
 * (`db/migrations/0137_audience_context.sql`), so the observation period and the matched endpoint
 * both have to fall inside that window as well as inside the range. What comes out is a conservative
 * lower bound: an actor with no retained sample carries no country at all, and a long range loses
 * proportionally more of them.
 */
export function buildConnectionCountrySamplesSql(
  dateRange: AnalyticsDateRange,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform> | null,
): string {
  const rangeStartSql = buildRangeStartSql(dateRange);
  const rangeEndSql = buildRangeEndSql(dateRange);
  const retainedSinceSql = "now() - INTERVAL '90 days'";

  return [
    "SELECT DISTINCT sample_events.actor_id, sample_endpoints.country, sample_events.ui_locale",
    "FROM (",
    "  SELECT DISTINCT",
    "    observation.anonymous_id,",
    "    observation.platform,",
    "    observation.country,",
    "    endpoint.sample_time",
    "  FROM analytics.installation_country_observations AS observation",
    "  CROSS JOIN LATERAL (VALUES (observation.first_seen), (observation.sampled_at))",
    "    AS endpoint(sample_time)",
    `  WHERE observation.last_seen >= ${retainedSinceSql}`,
    `    AND endpoint.sample_time >= ${retainedSinceSql}`,
    `    AND endpoint.sample_time >= ${rangeStartSql}`,
    `    AND endpoint.sample_time < ${rangeEndSql}`,
    ") AS sample_endpoints",
    "JOIN analytics.product_events_resolved AS sample_events",
    "  ON sample_events.anonymous_id = sample_endpoints.anonymous_id",
    "  AND sample_events.platform = sample_endpoints.platform",
    "  AND sample_events.server_received_at = sample_endpoints.sample_time",
    "WHERE sample_events.origin = 'client'",
    // A sample nobody can be resolved behind names no person to keep or to offer.
    "  AND sample_events.actor_id IS NOT NULL",
    `  AND sample_events.occurred_at >= ${rangeStartSql}`,
    `  AND sample_events.occurred_at < ${rangeEndSql}`,
    ...(eventPlatforms === null ? [] : [
      `  AND ${buildEventPlatformsFilterSql("COALESCE(sample_events.platform, 'unattributed')", eventPlatforms)}`,
    ]),
  ].join("\n");
}

/**
 * Picking no country keeps every user, as on the users field.
 *
 * This restricts people rather than rows: a user matches a country when at least one retained sample
 * says so, so a user with no retained sample matches no country at all and is dropped as soon as this
 * field is narrowed. The samples are read across every platform whatever the platform field says, so
 * this predicate matches exactly the countries its own range-scoped option list offers. The audience
 * report's own country and pair charts stay narrowed to the selected platforms, so a person kept by
 * this filter can still land in their `unknown` buckets.
 */
export function buildConnectionCountriesFilterSql(
  actorIdSqlExpression: string,
  connectionCountries: ReadonlyArray<string>,
  dateRange: AnalyticsDateRange,
): string {
  if (connectionCountries.length === 0) {
    return "TRUE";
  }

  return [
    `${actorIdSqlExpression} IN (`,
    "  SELECT country_samples.actor_id::text",
    "  FROM (",
    buildConnectionCountrySamplesSql(dateRange, null),
    "  ) AS country_samples",
    `  WHERE ${buildInPredicateSql("country_samples.country", connectionCountries)}`,
    ")",
  ].join("\n");
}

/**
 * Picking no language keeps every user.
 *
 * `ui_locale` is the interface language the client recorded on the event before queuing it, taken
 * inside the range over every event rather than over one report's own event name, and across every
 * platform whatever the platform field says, so this predicate matches exactly the languages its own
 * range-scoped option list offers. The audience report's own language and pair charts stay narrowed
 * to the selected platforms, so a person kept by this filter can still land in their `unknown`
 * buckets. An old client and an old queued event carry no locale, so a user whose events in range
 * carry none matches no language and is dropped as soon as this field is narrowed. This restricts
 * people rather than rows, so one person's other events stay counted.
 */
export function buildAppUiLanguagesFilterSql(
  actorIdSqlExpression: string,
  appUiLanguages: ReadonlyArray<string>,
  dateRange: AnalyticsDateRange,
): string {
  if (appUiLanguages.length === 0) {
    return "TRUE";
  }

  return [
    `${actorIdSqlExpression} IN (`,
    "  SELECT ui_locale_events.actor_id::text",
    "  FROM analytics.product_events_resolved AS ui_locale_events",
    `  WHERE ${buildInPredicateSql("ui_locale_events.ui_locale", appUiLanguages)}`,
    "    AND ui_locale_events.actor_id IS NOT NULL",
    `    AND ui_locale_events.occurred_at >= ${buildRangeStartSql(dateRange)}`,
    `    AND ui_locale_events.occurred_at < ${buildRangeEndSql(dateRange)}`,
    ")",
  ].join("\n");
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

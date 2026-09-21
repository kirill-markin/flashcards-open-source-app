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

/**
 * Whether one actor is excluded from reporting right now.
 *
 * `analytics.excluded_actors` is the one list of actors no human produced, and an exclusion is active
 * while `restored_at IS NULL`, because a human restore is recorded on the row rather than deleting it
 * (`db/migrations/0140_analytics_excluded_actors.sql`).
 *
 * NOTHING IS FOLDED ON THIS SIDE. The stored key is lower-cased and trimmed by its own CHECK, so every
 * reader folds its own side to match it - but every actor expression on this dashboard is
 * `analytics.product_events_resolved.actor_id`, a UUID whose `::text` is already canonical lowercase
 * hex, so a fold here would be a no-op. A reader comparing an unconstrained TEXT id instead, as the
 * public snapshot does, has to fold that column.
 */
export function buildActorIsExcludedSql(actorIdSqlExpression: string): string {
  return [
    "EXISTS (",
    "  SELECT 1",
    "  FROM analytics.excluded_actors AS excluded_actors",
    `  WHERE excluded_actors.actor_id = ${actorIdSqlExpression}`,
    "    AND excluded_actors.restored_at IS NULL",
    ")",
  ].join("\n");
}

/**
 * Drops every event of an excluded actor, on every surface that counts people.
 *
 * This is an identity rule rather than a selection, so it takes no filter state and a report composes
 * it into the CTE its own actors come from, beside the `%@example.com` exclusion that is restated
 * there. The option lists restate it for the reason they restate that one: a country, language or deck
 * only an excluded actor ever produced must not be offered.
 */
export function buildExcludedActorsFilterSql(actorIdSqlExpression: string): string {
  return `NOT ${buildActorIsExcludedSql(actorIdSqlExpression)}`;
}

/**
 * Drops rows a credential-free caller wrote, on every surface that counts people.
 *
 * `trust_level = 'anonymous_client'` is the credential-free collector
 * (`docs/anonymous-client-analytics.md`): the row is accepted from an allowlisted browser origin
 * with no credential at all, and its `anonymous_id` - which is what
 * `analytics.product_events_resolved` falls back to for `actor_id` - is a caller-supplied UUID the
 * route verifies nothing about. Such a claim is evidence that an event happened; it is not evidence
 * that a person exists, so it must never enter a distinct count of people. The collector accepts
 * every client-reportable name, `app_opened` among them, so without this predicate a signed-out
 * marketing-site visitor, or anyone posting to the route, would become a daily active user on an
 * append-only table that cannot be corrected afterwards.
 *
 * This is a trust rule rather than a selection, so it takes no filter state and a report composes it
 * into the CTE its own actors come from, beside the exclusion above. Every other trust level is
 * kept: `server_derived` and `backfill_derived` are the server's own observations, and
 * `authenticated_client` and `guest_client` are claims made on an authenticated request.
 *
 * APPLIED EVERYWHERE IT CAN DECIDE A PERSON, AND THIS IS THE WHOLE LIST. Nineteen entries below
 * derive an actor-level fact from `analytics.product_events_resolved`, eighteen in this package and
 * one outside it. Each is APPLIED or UNREACHABLE, and the two are not interchangeable: adding this
 * predicate to an UNREACHABLE entry is a no-op, and reading one as an omission produces a
 * remediation that converts the entries it happens to have been told about and stops. A shared
 * fragment is one entry, listed where it is written, with its readers named.
 *
 * APPLIED (10).
 *   - `reports/dailyActiveUsers/query.ts`, the `app_opens` CTE and the first-active-date cohort it
 *     feeds.
 *   - `reports/audience/query.ts`, the `history` CTE and the cohort it feeds.
 *   - `reports/audience/query.ts`, `language_events`: the per-actor language and `unknown` coverage
 *     of an already-counted actor, over every event name.
 *   - `reports/catalogInstalls/query.ts`, `installer_app_opens`: the new-versus-returning cohort.
 *   - `reports/catalogInstallFunnel/query.ts`, `install_actor_first_event`: whether the installing
 *     identity is new, which is a different rule from the cohort above - the absence of any trusted
 *     row before the anchoring site visit, read with no lower bound and, by design, no event-name
 *     restriction at all, so it sees every name the collector accepts. The shared visitor identity
 *     makes it load-bearing rather than defensive: the site click that anchors the row is itself a
 *     collector row resolving onto that same identity, so without this predicate every installer
 *     would have an event at their own first visit and none would ever read as new.
 *   - `buildMinimumEventCountFilterSql` below, the `app_opened:N` style threshold every report's
 *     filter bar composes.
 *   - `buildConnectionCountrySamplesSql` below, whose `origin = 'client'` is exactly what an
 *     `anonymous_client` row carries; read by the country filter, the country option list and the
 *     country and pair charts of `Audience`.
 *   - `buildAppUiLanguagesFilterSql` below, over every event name, composed by every report's
 *     filter bar.
 *   - `filters/optionsQuery.ts`, the `Users` option list.
 *   - `filters/optionsQuery.ts`, the `ui_locale` list, which otherwise gates on nothing but a
 *     non-NULL actor, so a locale only a signed-out visitor ever sent would be offered as a filter
 *     value.
 *
 * UNREACHABLE (8): SAFE FOR A DIFFERENT REASON, NOT CONVERTED. Every event these derive an actor
 * from is either `serverOnly: true` in `apps/backend/src/productAnalytics/catalog.ts`, which the
 * collector refuses outright, or already carries a trust predicate of its own, so no row this
 * collector writes can reach them and this predicate would change nothing.
 *   - `reports/reviewEventsByDate/query.ts`, the `review_answered` cohort. By event name.
 *   - `reports/reviewEventsByDate/query.ts`, the `friend_invitation_created` and
 *     `friendship_created` community series. By event name.
 *   - `reports/catalogInstalls/query.ts`, the `deck_installs` CTE (`catalog_deck_installed`). By
 *     event name.
 *   - `reports/catalogInstallFunnel/query.ts`, `install_actors` and `install_actor_reviews`. By
 *     event name: an identity enters them only by reaching the server-origin
 *     `catalog_deck_installed`, and the reviews read `review_answered`.
 *   - `reports/catalogInstallFunnel/query.ts`, the identity-level exclusion, which reads the
 *     candidate row's own `actor_id` rather than bridging to an install. That id is the
 *     collector-supplied one for a visitor who never signed in, and the predicate stays off it on
 *     purpose: this removes rows rather than counting people, so reaching such a row is the safe
 *     direction and refusing to read it would keep an excluded person in.
 *   - `buildCatalogInstalledDeckVersionsSql` and `buildCatalogInstallAttributionSql` below - two
 *     fragments, one bridge - read by the installed-deck and click-attribution filters and by their
 *     five option lists. The attribution fragment reads `anonymous_client` clicks deliberately, but
 *     a click names nobody: every actor it emits comes from the server-origin install it joins to.
 *   - `reports/catalogInstallFunnel/query.ts`, the installs-without-site-visit diagnostic, which
 *     applies the actor exclusions to a server-origin `catalog_deck_installed`. By event name.
 *   - `filters/optionsQuery.ts`, the deck-slug list (`catalog_deck_installed`). By event name.
 *
 * OUTSIDE THIS PACKAGE (1), and it cannot take the rule from here.
 *   - `apps/backend/src/productAnalytics/syntheticActorDetector.ts` groups the whole event store by
 *     actor and restates this rule, because the backend cannot import this package. Its candidate
 *     population is gated on `review_answered`, so the collector can never produce a candidate, but
 *     its `app_opened_events = 0` safety signal counts that actor's whole history, so without the
 *     restatement a collector row resolving onto a candidate would suppress a detection. It is the
 *     one entry the rule reaches in the weaker direction: a collector row can only suppress a
 *     detection there, never cause one, and the restatement is what removes that suppression, so
 *     the restatement itself can cause a detection that would not have fired and can never
 *     suppress one.
 *
 * NOT AN ENTRY EITHER, AND THE ONE THAT MOST LOOKS LIKE ONE. The catalog install funnel's cohort
 * keys a row on the identity an `anonymous_client` click carries, and reads that identity through
 * every later step. Applying this predicate there would empty the report, because the marketing-site
 * click is credential-free by construction. It stays out because what the funnel counts is browser
 * visitor identities arriving at a deck, which is what it calls them on screen and in
 * `docs/admin-app.md`; that number is never merged into a count of people, and the one place inside
 * the funnel that does decide a person - `install_actor_first_event` - is in the applied list above.
 *
 * That funnel's `surface_events` is not an entry either, one step further on. It derives per-actor
 * step facts over `screen_viewed`, which is not `serverOnly`, and reads the import screens at every
 * trust level, so the collector does reach it - but it decides no person. Its one trust predicate,
 * on the signed-in step, selects a row an account credential sent rather than excluding the
 * collector's. Its actors are already fixed by the cohort above and it only answers which steps
 * one of them reached, so this rule stays off deliberately rather than by omission: applying it
 * would zero the import-screen step for every signed-out visitor, whose `screen_viewed` rows are
 * credential-free by construction.
 *
 * NOT ENTRIES, AND NOT OMISSIONS. The two available-range probes,
 * `buildReviewEventsByDateAvailableRangeSql` and `buildCatalogInstallFunnelAvailableRangeSql`, read
 * the same view but derive no actor fact at all - each is a `MIN(occurred_at)` over event names - so
 * neither needs this predicate, and the funnel's reads `anonymous_client` rows on purpose. The
 * review-events one is still the one surface a credential-free `app_opened` row can move: it reads
 * that name with no trust predicate, so such a row pulls the earliest selectable date backwards.
 * That widens a date picker rather than deciding anything about a person, so it stays out of this
 * list on purpose.
 *
 * Any further reader that decides a person takes the rule from here rather than restating it - unless
 * it cannot import this module, the way the one entry outside this package cannot - and adds itself
 * to this list.
 */
export function buildTrustedActorRowsFilterSql(trustLevelSqlExpression: string): string {
  return `${trustLevelSqlExpression} <> 'anonymous_client'`;
}

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

/**
 * One person-level membership test, as `= ANY (ARRAY(...))` over an uncorrelated subquery.
 *
 * DELIBERATELY NOT `IN (SELECT ...)`, and the difference is only a planning one: both forms mean the
 * same set here, because every subquery below selects an actor id it has already guarded as non-NULL,
 * which is the one case the two disagree on. Every caller compares an actor expression a report reads
 * off a CTE, and a CTE scan carries no column statistics, so the planner falls back to a `rows=1`
 * guess for the outer side, picks a nested loop and re-executes the whole inner subquery once per
 * outer row - which on a range-wide scan of `analytics.product_events_resolved` is what takes a report
 * past the 30s `reporting_readonly` statement timeout. `ARRAY(...)` around the subquery makes it an
 * InitPlan: it is uncorrelated, so it is evaluated exactly once no matter how wrong that outer
 * estimate is, and the outer row then probes the finished array.
 */
function buildSubqueryMembershipSql(
  sqlExpression: string,
  subquerySqlLines: ReadonlyArray<string>,
): string {
  return [
    `${sqlExpression} = ANY (ARRAY(`,
    ...subquerySqlLines,
    "))",
  ].join("\n");
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
// would let the threshold the filter bar names and that chart disagree about the same person. So this repeats the two exclusions the
// `deck_installs` CTE of `buildCatalogInstallsSql` applies: the delisted `test` fixture of
// `db/migrations/0111_delist_catalog_test_fixture.sql`, and installs made by an admin whose grant is
// not revoked. The `%@example.com` and excluded-actor exclusions that CTE also applies are
// deliberately not repeated, because every set of users a threshold is applied to has already dropped
// those actors itself.
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
// the same thing on every area no matter which activity that area charts. Actors are compared as text
// because that is how each report already exposes its own actor id; `actor_id IS NOT NULL` keeps the
// set free of a NULL, which would otherwise make a non-match read as unknown rather than as false.
//
// The trust rule is restated for the same reason the range is: a threshold decides whether a person
// is kept, so counting rows the report itself refuses to count would let `app_opened:N` keep or drop
// someone on evidence no chart of that report shows.
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

  return buildSubqueryMembershipSql(actorIdSqlExpression, [
    "  SELECT threshold_events.actor_id::text",
    "  FROM analytics.product_events_resolved AS threshold_events",
    `  WHERE threshold_events.event_name = ${escapeSqlStringLiteral(minimumEventCount.eventType)}`,
    "    AND threshold_events.actor_id IS NOT NULL",
    `    AND ${buildTrustedActorRowsFilterSql("threshold_events.trust_level")}`,
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
  ]);
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
    // `origin = 'client'` above is exactly what a credential-free collector row carries, and every
    // reader of this fragment puts a person in a country. See `buildTrustedActorRowsFilterSql`.
    `  AND ${buildTrustedActorRowsFilterSql("sample_events.trust_level")}`,
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
 * the platform dimension never narrows what this can match, which is exactly how its own range-scoped
 * option list reads them too. The list is still a strict subset of what this matches, because it
 * restates the `%@example.com` and excluded-actor exclusions on purpose. The audience report's own
 * country and pair charts stay narrowed to the selected platforms, so a person kept by this filter can
 * still land in their `unknown` buckets.
 */
export function buildConnectionCountriesFilterSql(
  actorIdSqlExpression: string,
  connectionCountries: ReadonlyArray<string>,
  dateRange: AnalyticsDateRange,
): string {
  if (connectionCountries.length === 0) {
    return "TRUE";
  }

  return buildSubqueryMembershipSql(actorIdSqlExpression, [
    "  SELECT country_samples.actor_id::text",
    "  FROM (",
    buildConnectionCountrySamplesSql(dateRange, null),
    "  ) AS country_samples",
    `  WHERE ${buildInPredicateSql("country_samples.country", connectionCountries)}`,
  ]);
}

/**
 * Picking no language keeps every user.
 *
 * `ui_locale` is the interface language the client recorded on the event before queuing it, taken
 * inside the range over every event rather than over one report's own event name, and across every
 * platform whatever the platform field says, so the platform dimension never narrows what this can
 * match, which is exactly how its own range-scoped option list reads them too. The list is still a
 * strict subset of what this matches, because it restates the `%@example.com` and excluded-actor
 * exclusions on purpose.
 * The audience report's own language and pair charts stay narrowed to the selected platforms, so a
 * person kept by this filter can still land in their `unknown` buckets. An old client and an old
 * queued event carry no locale, so a user whose events in range carry none matches no language and is
 * dropped as soon as this field is narrowed. This restricts people rather than rows, so one person's
 * other events stay counted.
 */
export function buildAppUiLanguagesFilterSql(
  actorIdSqlExpression: string,
  appUiLanguages: ReadonlyArray<string>,
  dateRange: AnalyticsDateRange,
): string {
  if (appUiLanguages.length === 0) {
    return "TRUE";
  }

  return buildSubqueryMembershipSql(actorIdSqlExpression, [
    "  SELECT ui_locale_events.actor_id::text",
    "  FROM analytics.product_events_resolved AS ui_locale_events",
    `  WHERE ${buildInPredicateSql("ui_locale_events.ui_locale", appUiLanguages)}`,
    "    AND ui_locale_events.actor_id IS NOT NULL",
    // This keeps a person, and it reads every event name, so it reads the names the credential-free
    // collector accepts too. See `buildTrustedActorRowsFilterSql`.
    `    AND ${buildTrustedActorRowsFilterSql("ui_locale_events.trust_level")}`,
    `    AND ui_locale_events.occurred_at >= ${buildRangeStartSql(dateRange)}`,
    `    AND ui_locale_events.occurred_at < ${buildRangeEndSql(dateRange)}`,
  ]);
}

/**
 * Every completed catalog install, as one row per install carrying the deck version the install
 * itself recorded. The installed-deck predicate below and the deck option list both read this one
 * fragment, so an installed deck always means the same evidence.
 *
 * THIS DELIBERATELY ASKS NOTHING ABOUT A CLICK. `package_version_id` is a property of
 * `catalog_deck_installed` itself, and both it and `install_journey_id` are optional on that event
 * (`docs/catalog-install-funnel.md`, whose acceptance keeps a legacy confirm carrying no journey id
 * valid). An install whose click was never recorded - a legacy one, or one whose click never reached
 * the public collector that must never block an install - still names the deck it installed, so
 * requiring a click here would drop those people and never even offer their deck version.
 *
 * There is deliberately no date bound: this answers what a person ever installed, over that person's
 * whole history.
 */
export function buildCatalogInstalledDeckVersionsSql(): string {
  return [
    "SELECT",
    "  installs.actor_id,",
    "  installs.event_properties ->> 'package_version_id' AS package_version_id,",
    "  installs.event_properties ->> 'package_slug' AS package_slug",
    "FROM analytics.product_events_resolved AS installs",
    "WHERE installs.event_name = 'catalog_deck_installed'",
    "  AND installs.origin = 'server'",
    "  AND installs.actor_id IS NOT NULL",
  ].join("\n");
}

/**
 * Picking no deck keeps every user, as on the users field.
 *
 * This restricts people rather than rows, and it restricts them on their whole history rather than
 * inside the selected range, so what it keeps is "users who ever completed an install of one of these
 * deck versions" - whether or not the click that led there was ever recorded. Its own option list is
 * a strict subset of what this matches, because the list restates the `%@example.com`, excluded-actor
 * and delisted `test` exclusions on purpose and this restates none of them.
 */
export function buildInstalledDecksFilterSql(
  actorIdSqlExpression: string,
  installedDecks: ReadonlyArray<string>,
): string {
  if (installedDecks.length === 0) {
    return "TRUE";
  }

  return buildSubqueryMembershipSql(actorIdSqlExpression, [
    "  SELECT installed_decks.actor_id::text",
    "  FROM (",
    buildCatalogInstalledDeckVersionsSql(),
    "  ) AS installed_decks",
    `  WHERE ${buildInPredicateSql("installed_decks.package_version_id", installedDecks)}`,
  ]);
}

/**
 * Every completed catalog install whose originating click was recorded, as one row per install
 * carrying the properties of that click. The four click-dimension predicates below and their four
 * option lists all read this one fragment, so an attribution value always means the same evidence.
 *
 * `catalog_install_clicked` NAMES NO USER, because the click happens before sign-in. The only bridge
 * to a person is the server-origin `catalog_deck_installed`, which carries `actor_id` next to the
 * same `install_journey_id` and `package_version_id`; those two are the join keys here. A click that never became an install names
 * nobody and can therefore never match, and an install whose click was never recorded carries no
 * attribution at all - which is why the installed-deck fragment above reads the install alone.
 *
 * ONE CLICK PER JOURNEY, THE FIRST ONE. The clicks are reduced by `DISTINCT ON (install_journey_id)`,
 * so a journey that recorded several clicks is attributed to one click rather than carrying the
 * values of every click it ever recorded.
 *
 * Both sides state `event_properties ? 'install_journey_id'`, which is the predicate of
 * `idx_product_events_catalog_install_journey`
 * (`db/migrations/0134_catalog_install_journey_analytics.sql`). This join is unbounded by date and
 * sits on the critical path of every General and Audience load, so the guard is what lets the planner
 * prove that partial index applies; it also prunes the installs that could never have joined.
 *
 * There is deliberately no date bound and no conversion window here. The funnel measures one cohort
 * converting within seven days; this answers what a person's installs were ever attributed to, over
 * that person's whole history.
 *
 * `placement`, `source` and `device_category` are properties of the click event, while `device_locale`
 * is a view column on the click row. An empty locale is the absence of a reported browser language
 * rather than a value, so it is folded to NULL and can then be neither offered nor matched.
 */
export function buildCatalogInstallAttributionSql(): string {
  return [
    "SELECT",
    "  installs.actor_id,",
    "  clicks.placement,",
    "  clicks.source,",
    "  clicks.device_category,",
    "  clicks.device_locale",
    "FROM analytics.product_events_resolved AS installs",
    "JOIN (",
    "  SELECT DISTINCT ON (candidate_clicks.event_properties ->> 'install_journey_id')",
    "    candidate_clicks.event_properties ->> 'install_journey_id' AS install_journey_id,",
    "    candidate_clicks.event_properties ->> 'package_version_id' AS package_version_id,",
    "    candidate_clicks.event_properties ->> 'placement' AS placement,",
    "    candidate_clicks.event_properties ->> 'source' AS source,",
    "    candidate_clicks.event_properties ->> 'device_category' AS device_category,",
    "    NULLIF(candidate_clicks.device_locale, '') AS device_locale",
    "  FROM analytics.product_events_resolved AS candidate_clicks",
    "  WHERE candidate_clicks.event_name = 'catalog_install_clicked'",
    "    AND candidate_clicks.origin = 'client'",
    "    AND candidate_clicks.trust_level = 'anonymous_client'",
    "    AND candidate_clicks.event_properties ? 'install_journey_id'",
    "  ORDER BY",
    "    candidate_clicks.event_properties ->> 'install_journey_id',",
    "    candidate_clicks.occurred_at,",
    "    candidate_clicks.event_id",
    ") AS clicks",
    "  ON clicks.install_journey_id = installs.event_properties ->> 'install_journey_id'",
    "  AND clicks.package_version_id = installs.event_properties ->> 'package_version_id'",
    "WHERE installs.event_name = 'catalog_deck_installed'",
    "  AND installs.origin = 'server'",
    "  AND installs.actor_id IS NOT NULL",
    "  AND installs.event_properties ? 'install_journey_id'",
  ].join("\n");
}

/**
 * The whole catalog selection at once: picking nothing in every one of the five fields is the absence
 * of a filter, as on the users field.
 *
 * This restricts people rather than rows, and it restricts them on their whole history rather than
 * inside the selected range. The four click dimensions are all applied to the same attributed
 * install, so narrowing two of them asks for one install whose own click carried both values rather
 * than for two unrelated installs. A narrowed deck stands next to them as its own condition, because
 * it is read from the install event itself and therefore also holds for the installs whose click was
 * never recorded.
 */
export function buildCatalogAttributionFiltersSql(
  actorIdSqlExpression: string,
  filters: AnalyticsFilterState,
): string {
  const clickSelections: ReadonlyArray<Readonly<{
    columnSqlName: string;
    values: ReadonlyArray<string>;
  }>> = [
    { columnSqlName: "placement", values: filters.catalogPlacements },
    { columnSqlName: "source", values: filters.catalogSources },
    { columnSqlName: "device_category", values: filters.catalogDeviceCategories },
    { columnSqlName: "device_locale", values: filters.catalogClickBrowserLanguages },
  ];
  const narrowedSelections = clickSelections.filter((selection) => selection.values.length > 0);
  const clickAttributionSql = narrowedSelections.length === 0
    ? "TRUE"
    : buildSubqueryMembershipSql(actorIdSqlExpression, [
      "  SELECT install_attribution.actor_id::text",
      "  FROM (",
      buildCatalogInstallAttributionSql(),
      "  ) AS install_attribution",
      `  WHERE ${narrowedSelections
        .map((selection) => buildInPredicateSql(
          `install_attribution.${selection.columnSqlName}`,
          selection.values,
        ))
        .join("\n    AND ")}`,
    ]);
  const narrowedPredicateSql = [
    buildInstalledDecksFilterSql(actorIdSqlExpression, filters.installedDecks),
    clickAttributionSql,
  ].filter((predicateSql) => predicateSql !== "TRUE");

  if (narrowedPredicateSql.length === 0) {
    return "TRUE";
  }

  // Parenthesized as a whole, so a caller can drop it into an `OR` branch as safely as into an
  // `AND` chain.
  return `(${narrowedPredicateSql.join("\n  AND ")})`;
}

/**
 * A row whose cohort cannot be decided is kept only while both cohorts are selected, which is the
 * state the filter row treats as "no cohort filter". Catalog installs are the one report with that
 * case: an installer with no trusted `app_opened` day inside the range belongs to neither side,
 * trusted as `buildTrustedActorRowsFilterSql` defines it.
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

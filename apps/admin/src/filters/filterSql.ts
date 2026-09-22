import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type ReviewEventCohort,
  type ReviewEventPlatform,
} from "../adminApi";
import { catalogInstallConversionWindowDays } from "../reports/catalogInstallFunnel/query";
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
 * THE ONE EXCLUSION RULE: the people no analytics number on this dashboard counts, as `AND` lines on
 * one actor. Every report, every filter option list and the catalog attribution fragment below compose
 * it into the rows their actors come from, and this is the only place it is written. The public daily
 * snapshot restates all four arms below against its own identity column in
 * `apps/backend/src/globalMetrics/reporting.ts`, which this package cannot import from, so the two
 * files must be changed together. An actor is dropped when
 *   - a stored `org.user_settings` row of that actor has an `@example.com` address, a test account;
 *   - a stored row of that actor has the address of any `auth.admin_users` row, whether or not the
 *     grant was revoked, so an admin's history never comes back into the numbers. That table's email
 *     is lower/btrim normalized by its own CHECK (`db/migrations/0045_admin_users.sql`), so only the
 *     settings side is folded, and `reporting_readonly` reads it through
 *     `db/migrations/0125_reporting_readonly_admin_users.sql`;
 *   - `analytics.excluded_actors` lists the actor and no human restored it, `restored_at IS NULL`
 *     (`db/migrations/0140_analytics_excluded_actors.sql`);
 *   - any row of that actor carries the credential-free collector's automated verdict,
 *     `automated_client IS TRUE` (`db/migrations/0145_anonymous_client_automated_marker.sql`): a bot,
 *     a crawler, a headless browser, an HTTP library, or a request that sent no `User-Agent` at all.
 *     NULL is kept, and `IS FALSE` is never asked for, because NULL means nothing assessed the row -
 *     it was stored before the marker shipped, or on a trust level where no `User-Agent` is read -
 *     rather than that a person sent it.
 *
 * THE ACTOR SIDE IS NEVER FOLDED HERE, and the stored sides are. Every caller passes
 * `analytics.product_events_resolved.actor_id::text`, which renders canonical lowercase hex, while
 * `org.user_settings.user_id` is an unconstrained TEXT key folded with `pg_catalog.lower` for the
 * reason `buildReviewEventsByDateSql` states in full. The excluded-actor key is lower-cased and
 * trimmed by its own CHECK. Both address tests ask whether ANY stored row of the actor matches rather
 * than joining them, so an actor with two case-folded rows cannot stay counted because one of them
 * carries a NULL or a real address.
 *
 * A visitor who never signed in resolves to their own browser id, which is no account's user id, so
 * the address and admin tests find nothing for them; only the exclusion list and the automated
 * verdict can reach such a row. A visitor the web app later linked to an account resolves to that
 * account, so the rule reaches that person's rows from before they signed in as well.
 *
 * THE AUTOMATED VERDICT IS READ AT ACTOR LEVEL HERE, NOT AT ROW LEVEL, and that choice is why it
 * belongs in this rule at all. The marker sits on the collector's rows only, while the identity
 * behind them goes on producing trusted rows afterwards: a smoke run that browses the site and then
 * signs into a real account resolves its marked site rows onto that account, so dropping the marked
 * rows alone would leave every later app event of that run counted as a person. One marked row
 * therefore removes the actor from every number on this dashboard. Where a read has no actor to test
 * - the funnels' cookieless hashed cohort - the same verdict is applied to the row instead, by
 * `buildNonAutomatedClientRowsFilterSql` below, which carries that list.
 *
 * THAT ARM HAS NO RESTORE PATH, and it is the only one that has none. `analytics.excluded_actors`
 * carries `restored_at`, so a person listed by mistake comes back the moment a human clears it. There
 * is no counterpart here: `analytics.product_events` is append-only, so a stored verdict can never be
 * rewritten, and nothing overrides it on the read side. A missing or empty `User-Agent` counts as
 * automated by `db/migrations/0145_anonymous_client_automated_marker.sql`, so one stripped-header
 * request from a real person who later signs in takes that account out of every number on this
 * dashboard and out of the public snapshot, permanently. Accepted as the cost of the actor level:
 * undoing it means a new migration that lists the exception, not a change here.
 *
 * IT IS THE ONE ARM WRITTEN AS AN `ARRAY(...)` InitPlan rather than as a correlated `NOT EXISTS`, and
 * the reason is the plan shape of the outer side, not of the subquery. Postgres does turn a top-level
 * `NOT EXISTS` into an anti-join rather than a per-row subplan - but it still chooses the join method
 * from the outer estimate, and the funnel cohorts compose this rule onto a CTE scan, which carries no
 * column statistics and estimates at `rows=1`. On that estimate a nested-loop anti-join costs about
 * what a hash anti-join costs, and `analytics.product_events_resolved.actor_id` can never become an
 * index qual, so the loop the planner may pick re-scans the event store once per outer row. The
 * remaining callers compose it onto a base or derived-table scan instead, whose estimate is a real
 * one; nothing here is claimed about what the planner would choose for them.
 * `buildSubqueryMembershipSql` below states that failure in full for the `= ANY` case; the InitPlan
 * form removes the choice for every call site, because an uncorrelated subquery is evaluated exactly
 * once however wrong that estimate is. It is written as a negated `= ANY (ARRAY(...))` rather than as `<> ALL (...)`
 * deliberately: the planner's hashed array path exists for `= ANY` alone, so `<> ALL` forecloses it,
 * while this form leaves it open. Nothing here is claimed about whether this call site actually
 * receives it - that path also wants a constant array, and `ARRAY(SELECT ...)` reaches the comparison
 * as an InitPlan parameter - and nothing here depends on the answer: the subquery is evaluated once
 * either way, and the per-outer-row cost this rule was written to avoid is already gone with it. The
 * two forms agree exactly here, because the subquery guards its `actor_id` as non-NULL. `db/migrations/0146_product_events_automated_client_index.sql`
 * keeps the InitPlan itself off a whole-table scan. The array is small besides, though nothing
 * enforces that: the site gives a browser no visitor cookie until it consents, so an unconsenting
 * bot's rows resolve to no actor at all and are judged on the hashed side instead.
 */
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
 * into the CTE its own actors come from, beside the exclusion rule above. Every other trust level is
 * kept: `server_derived` and `backfill_derived` are the server's own observations, and
 * `authenticated_client` and `guest_client` are claims made on an authenticated request.
 *
 * APPLIED EVERYWHERE IT CAN DECIDE A PERSON, AND THIS IS THE WHOLE LIST. Twenty-two entries below
 * derive an actor-level fact from `analytics.product_events_resolved`, twenty-one in this package
 * and one outside it. Each is APPLIED or UNREACHABLE, and the two are not interchangeable: adding this
 * predicate to an UNREACHABLE entry is a no-op, and reading one as an omission produces a
 * remediation that converts the entries it happens to have been told about and stops. A shared
 * fragment is one entry, listed where it is written, with its readers named.
 *
 * APPLIED (13).
 *   - `reports/dailyActiveUsers/query.ts`, the `app_opens` CTE and the first-active-date cohort it
 *     feeds.
 *   - `reports/audience/query.ts`, the `history` CTE and the cohort it feeds.
 *   - `reports/audience/query.ts`, `language_events`: the per-actor language and `unknown` coverage
 *     of an already-counted actor, over every event name.
 *   - `reports/catalogInstalls/query.ts`, `installer_app_opens`: the new-versus-returning cohort.
 *   - `reports/catalogInstallFunnel/query.ts`, `install_actor_first_event`: whether the installing
 *     identity is new, which is a different rule from the cohort above - the absence of any trusted
 *     row before the anchoring deck page view, read with no lower bound and, by design, no event-name
 *     restriction at all, so it sees every name the collector accepts. The shared visitor identity
 *     makes it load-bearing rather than defensive: the page view that anchors the row is itself a
 *     collector row resolving onto that same identity, so without this predicate every installer
 *     would have an event at their own first visit and none would ever read as new.
 *   - `reports/mobileFirstLaunchFunnel/query.ts`, `actor_first_events` and `step_events`. The first
 *     decides whether a person's first-ever event is a mobile app open. It reads every event name with
 *     no lower bound and lets through only a `card_created` at most 60 seconds before that open, which
 *     is the seeded demo card. Without this predicate, a signed-out marketing-site visit resolving onto
 *     the same identity would keep that person out. The second reads the client-reportable
 *     `screen_viewed` and `review_card_revealed` steps, so a credential-free claim would otherwise
 *     advance a cohort member through the funnel.
 *   - `reports/siteEntryFunnel/query.ts`, `actor_first_events` and `step_events`, read by the home
 *     page and blog article funnels. The first decides whether a person was already here before their
 *     first marketing-site page view, over every event name with no lower bound. The second reads
 *     the in-app steps, the client-reportable web `app_opened` among them, so a credential-free claim
 *     would otherwise advance a cohort member. Both also read `site_page_viewed` and
 *     `site_app_entry_clicked` at `trust_level = 'anonymous_client'` only, on purpose: those are the
 *     site's own facts, the cohort is keyed on the visitor identity they carry, and they never count
 *     as the trusted evidence this rule is about.
 *   - `buildMinimumEventCountFilterSql` below, the `app_opened:N` style threshold every report's
 *     filter bar composes.
 *   - `buildConnectionCountrySamplesSql` below, whose `origin = 'client'` is exactly what an
 *     `anonymous_client` row carries; read by the country filter, the country option list, the
 *     country and pair charts of `Audience`, and `buildActorConnectionCountrySql`, which reduces it
 *     to the one country a funnel's `Group by` field places a person in.
 *   - `buildAppUiLanguagesFilterSql` below, over every event name, composed by every report's
 *     filter bar.
 *   - `buildActorAppUiLanguageSql` below, the one UI language a funnel's `Group by` field places a
 *     person in, over every event name and over the same rows the language filter reads.
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
 *     a click decides nobody: every actor it emits is the server-origin install's own, which a click
 *     can only be matched to.
 *   - `reports/catalogInstallFunnel/query.ts`, the installs-without-deck-page-view diagnostic, which
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
 * keys a row on the identity an `anonymous_client` deck page view (`site_page_viewed`) carries, reads
 * its second step from the `anonymous_client` install click on that identity, and reads that identity
 * through every later step; its two no-visit diagnostics read the same page views only to ask whether
 * an identity had one. Applying this predicate there would empty the report, because the
 * marketing-site page view and click are credential-free by construction. It stays out because what
 * the funnel counts is browser visitor identities arriving at a deck, which is what it calls them on
 * screen and in `docs/admin-app.md`; that number is never merged into a count of people, and the one
 * place inside the funnel that does decide a person - `install_actor_first_event` - is in the applied
 * list above.
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
 * `buildReviewEventsByDateAvailableRangeSql` and `buildCatalogInstallFunnelAvailableRangeSql`, and the
 * catalog install funnel's effective-start statement read the same view but derive no actor fact at
 * all - each is a `MIN(occurred_at)` over event names - so none needs this predicate, and the funnel's
 * two read `anonymous_client` deck page views on purpose. The
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

/**
 * Drops one row the credential-free collector judged to come from an automated client, as a predicate
 * on that row's own `automated_client`.
 *
 * TRUE is a bot, a crawler, a headless browser, an HTTP library or a request that sent no
 * `User-Agent` at all, decided by the collector from that header alone at insert time
 * (`db/migrations/0145_anonymous_client_automated_marker.sql`). `IS NOT TRUE` rather than `IS FALSE`
 * is the whole contract: NULL means the code that stored the row did not assess it - a row stored
 * before the marker shipped, or one on any other trust level - so reading NULL as automated would
 * silently drop real people, and FALSE is in any case only the client's own unverified claim about
 * itself.
 *
 * ROW LEVEL IS FOR THE READS THAT NAME NOBODY, AND THIS IS THE WHOLE LIST. Wherever a read has an
 * actor to test, the verdict is applied to that actor by `buildExcludedActorSqlLines` above instead,
 * which is the stronger rule: one marked row drops the person from every number rather than only the
 * rows carrying the marker. So the identified site page views and install clicks of the funnels take
 * nothing from here - their cohorts already compose that rule - and neither do the option lists over
 * collector rows, which restate it too.
 *   - `buildHashedSiteRowSqlLines` in `apps/admin/src/reports/funnels/funnelAudienceSql.ts`, the
 *     cookieless hashed cohort of the two site-entry funnels and the deck funnel: every hashed page
 *     view and every hashed click. Those rows carry a NULL `actor_id` by construction, so this is the
 *     only level at which they can be judged at all, and a marked browser-day never becomes a person.
 *   - `attribution_clicks` in `buildCatalogInstallAttributionSql` below, because its journey bridge
 *     matches a click that claimed no visitor at all, whose own actor is therefore never the install's
 *     and is never tested by the rule the install side applies.
 *
 * The two available-range probes are deliberately not on this list, exactly as they are not on
 * `buildTrustedActorRowsFilterSql`'s: each is a `MIN(occurred_at)` that widens a date picker and
 * decides nothing about a person.
 */
export function buildNonAutomatedClientRowsFilterSql(automatedClientSqlExpression: string): string {
  return `${automatedClientSqlExpression} IS NOT TRUE`;
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
// would let the threshold the filter bar names and that chart disagree about the same person. So this
// repeats the one exclusion of the `deck_installs` CTE of `buildCatalogInstallsSql` that a threshold
// can still decide: the delisted `test` fixture of
// `db/migrations/0111_delist_catalog_test_fixture.sql`. The shared actor exclusions of
// `buildExcludedActorSqlLines` are deliberately not repeated, because every set of users a threshold
// is applied to has already dropped those actors itself.
const catalogInstallThresholdExclusionSqlLines = [
  "    AND threshold_events.event_properties ->> 'package_slug' <> 'test'",
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
 * locale). The audience report's country and pair dimensions, the country option list, the country
 * filter below and the per-actor country a funnel groups by all read this one fragment, so a country
 * always means the same evidence.
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
 * restates the shared actor exclusions on purpose. The audience report's own
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
 * One connection country per actor over the range, as `actor_id, country`, for a report that has to
 * place a person somewhere rather than test a selection: the funnel `Group by` field reads it.
 *
 * `MIN` IS THE RULE, NOT AN APPROXIMATION OF ONE. A person whose retained samples name two countries
 * in the range is placed in the alphabetically first of them, deliberately, so the group key is a
 * function of the person and the range alone: it does not depend on which sample is read first, and
 * it needs neither a most-recent nor an entry-time rule, both of which would cost another scan to
 * decide something the dimension does not claim. The samples are the same fragment the country
 * filter and the country option list read, across every platform, so a country means the same
 * evidence here as everywhere else; a person with no retained sample yields no row at all, and the
 * funnel's own `COALESCE` is what turns that into the `Unresolved` group.
 *
 * THE KEY IS NOT NARROWED BY `buildConnectionCountriesFilterSql`. That filter keeps a person when
 * ANY of their samples matches the selection, while this places them at the alphabetically first of
 * all of them, so a person kept by a `DE` selection can be grouped under an `AT` they were also seen
 * in. A report that shows both says so where it shows them; `docs/admin-app.md` states it too.
 */
export function buildActorConnectionCountrySql(dateRange: AnalyticsDateRange): string {
  return [
    "SELECT country_samples.actor_id, MIN(country_samples.country) AS country",
    "FROM (",
    buildConnectionCountrySamplesSql(dateRange, null),
    ") AS country_samples",
    "GROUP BY country_samples.actor_id",
  ].join("\n");
}

/**
 * One app interface language per actor over the range, as `actor_id, ui_locale`, over exactly the
 * trusted rows the language filter reads.
 *
 * `MIN` means the same thing it means for the country above, including that it is not narrowed by
 * `buildAppUiLanguagesFilterSql`: a person whose events in range carry two locales is placed in the
 * alphabetically first one, so the group key is a function of the person and the range alone. An old
 * client and an old queued event carry no locale, and there is no `ui_locale IS NOT NULL` predicate
 * here on purpose: such a person yields a row whose `ui_locale` is NULL rather than no row at all,
 * which the funnel's `COALESCE` groups as `Unresolved` exactly as it does a missing row.
 */
export function buildActorAppUiLanguageSql(dateRange: AnalyticsDateRange): string {
  return [
    "SELECT ui_locale_events.actor_id, MIN(ui_locale_events.ui_locale) AS ui_locale",
    "FROM analytics.product_events_resolved AS ui_locale_events",
    "WHERE ui_locale_events.actor_id IS NOT NULL",
    `  AND ${buildTrustedActorRowsFilterSql("ui_locale_events.trust_level")}`,
    `  AND ui_locale_events.occurred_at >= ${buildRangeStartSql(dateRange)}`,
    `  AND ui_locale_events.occurred_at < ${buildRangeEndSql(dateRange)}`,
    "GROUP BY ui_locale_events.actor_id",
  ].join("\n");
}

/**
 * Picking no language keeps every user.
 *
 * `ui_locale` is the interface language the client recorded on the event before queuing it, taken
 * inside the range over every event rather than over one report's own event name, and across every
 * platform whatever the platform field says, so the platform dimension never narrows what this can
 * match, which is exactly how its own range-scoped option list reads them too. The list is still a
 * strict subset of what this matches, because it restates the shared actor exclusions on purpose.
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
 * a strict subset of what this matches, because the list restates the shared actor exclusions and the
 * delisted `test` one on purpose and this restates none of them.
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
 * Every completed catalog install attributed to one originating site click, as one row per install
 * carrying the properties of that click. The four click-dimension predicates below and their four
 * option lists all read this one fragment, so an attribution value always means the same evidence.
 *
 * TWO BRIDGES, ONE CLICK PER INSTALL. `catalog_install_clicked` is sent before sign-in, so only the
 * server-origin `catalog_deck_installed` names the person, and a click reaches it in one of two ways,
 * both also requiring the same `package_version_id`:
 *   - the shared identity: the click resolves to the install's own `actor_id` through the
 *     `analytics_visitor` cookie, exactly as the funnel's steps are joined, and the install falls
 *     within `catalogInstallConversionWindowDays` of it. Of the clicks in those days before the
 *     install, the install takes the earliest by `occurred_at` then `event_id`. The funnel
 *     (`buildCatalogInstallFunnelSql` in `apps/admin/src/reports/catalogInstallFunnel/query.ts`)
 *     instead anchors on a visitor's first click in the selected range, converting or not, so the two
 *     credit one install to different clicks when the range cuts off an earlier click: with clicks on
 *     day 0 and day 3, the install on day 5 and the range starting on day 2, the funnel's anchor is the
 *     day-3 click and this picks the day-0 one.
 *   - the per-attempt `install_journey_id`, which only rows written before the producers dropped it
 *     carry, on the first click of that journey. It stays because those clicks share no identity with
 *     anything: a click that claimed no visitor cookie is stored under its journey id
 *     (`readAnonymousId` in `apps/backend/src/productAnalytics/anonymousEvent.ts`), so without this
 *     bridge every pre-move install would lose its attribution. Where an install is reached both
 *     ways, the journey click wins, because that key was written by the one attempt that installed.
 * `DISTINCT ON` the install's `event_id` is what keeps an install reached both ways a single row.
 *
 * A click that never became an install names nobody and can therefore never match, and an install
 * with no qualifying click carries no attribution at all - which is why the installed-deck fragment
 * above reads the install alone. There is deliberately no date bound: the window only relates a click
 * to its install, the journey bridge needs none because its key names one attempt, and this answers
 * what a person's installs were ever attributed to.
 *
 * The install side drops the delisted `test` deck by the install's own slug and applies
 * `buildExcludedActorSqlLines` to the installing actor, so a value only such an install carried is
 * neither offered nor matched. The click side drops a row marked as an automated client's, which is
 * the one exclusion the install's actor cannot make for it on the journey bridge, where the click
 * shares no identity with the install; on the actor bridge the install's own actor already carries it.
 *
 * Each side is read in one `MATERIALIZED` pass and both bridges are hash-joinable equalities on it,
 * because an equality on `actor_id` can never become an index qual on the view (see
 * `buildActorMembershipSql` in the funnel query) and this sits on the critical path of every General
 * and Audience load.
 *
 * `placement`, `source` and `device_category` are properties of the click event, while `device_locale`
 * is a view column on the click row. An empty locale is the absence of a reported browser language
 * rather than a value, so it is folded to NULL and can then be neither offered nor matched.
 */
export function buildCatalogInstallAttributionSql(): string {
  const clickColumnsSql = [
    "    clicks.placement,",
    "    clicks.source,",
    "    clicks.device_category,",
    "    clicks.device_locale",
  ];

  return [
    "WITH attribution_installs AS MATERIALIZED (",
    "  SELECT",
    "    installs.event_id,",
    "    installs.actor_id,",
    "    installs.occurred_at,",
    "    installs.event_properties ->> 'package_version_id' AS package_version_id,",
    "    installs.event_properties ->> 'install_journey_id' AS install_journey_id",
    "  FROM analytics.product_events_resolved AS installs",
    "  WHERE installs.event_name = 'catalog_deck_installed'",
    "    AND installs.origin = 'server'",
    "    AND installs.actor_id IS NOT NULL",
    "    AND installs.event_properties ->> 'package_slug' IS DISTINCT FROM 'test'",
    ...buildExcludedActorSqlLines("installs.actor_id::text"),
    "), attribution_clicks AS MATERIALIZED (",
    "  SELECT",
    "    candidate_clicks.event_id,",
    "    candidate_clicks.actor_id,",
    "    candidate_clicks.occurred_at,",
    "    candidate_clicks.event_properties ->> 'package_version_id' AS package_version_id,",
    "    candidate_clicks.event_properties ->> 'install_journey_id' AS install_journey_id,",
    "    candidate_clicks.event_properties ->> 'placement' AS placement,",
    "    candidate_clicks.event_properties ->> 'source' AS source,",
    "    candidate_clicks.event_properties ->> 'device_category' AS device_category,",
    "    NULLIF(candidate_clicks.device_locale, '') AS device_locale",
    "  FROM analytics.product_events_resolved AS candidate_clicks",
    "  WHERE candidate_clicks.event_name = 'catalog_install_clicked'",
    "    AND candidate_clicks.origin = 'client'",
    "    AND candidate_clicks.trust_level = 'anonymous_client'",
    // Load-bearing on the journey bridge alone, and kept for it. That bridge matches a click that
    // claimed no visitor, whose actor is its own journey id and so is never the install's, so the
    // exclusion rule the install side applies to the installing actor never reads that click: this
    // predicate is the only thing that can drop it. Only rows written before the producers dropped
    // `install_journey_id` reach it, and the query is deliberately unbounded in time, so that window
    // is still read. On the actor bridge below it is redundant - a marked click actor equals the
    // install's actor there, which `buildExcludedActorSqlLines` has already dropped above.
    // See `buildNonAutomatedClientRowsFilterSql`.
    `    AND ${buildNonAutomatedClientRowsFilterSql("candidate_clicks.automated_client")}`,
    ")",
    "SELECT DISTINCT ON (attributed.install_event_id)",
    "  attributed.actor_id,",
    "  attributed.placement,",
    "  attributed.source,",
    "  attributed.device_category,",
    "  attributed.device_locale",
    "FROM (",
    "  SELECT",
    "    installs.event_id AS install_event_id,",
    "    1 AS bridge_rank,",
    "    installs.actor_id,",
    ...clickColumnsSql,
    "  FROM attribution_installs AS installs",
    "  JOIN (",
    "    SELECT DISTINCT ON (journey_clicks.install_journey_id) journey_clicks.*",
    "    FROM attribution_clicks AS journey_clicks",
    "    WHERE journey_clicks.install_journey_id IS NOT NULL",
    "    ORDER BY",
    "      journey_clicks.install_journey_id,",
    "      journey_clicks.occurred_at,",
    "      journey_clicks.event_id",
    "  ) AS clicks",
    "    ON clicks.install_journey_id = installs.install_journey_id",
    "    AND clicks.package_version_id = installs.package_version_id",
    "  UNION ALL",
    // Parenthesized so this `ORDER BY` picks this branch's first click rather than sorting the union.
    "  (",
    "    SELECT DISTINCT ON (installs.event_id)",
    "      installs.event_id AS install_event_id,",
    "      2 AS bridge_rank,",
    "      installs.actor_id,",
    ...clickColumnsSql.map((line) => `  ${line}`),
    "    FROM attribution_installs AS installs",
    "    JOIN attribution_clicks AS clicks",
    "      ON clicks.actor_id = installs.actor_id",
    "      AND clicks.package_version_id = installs.package_version_id",
    "      AND clicks.occurred_at <= installs.occurred_at",
    `      AND installs.occurred_at <= clicks.occurred_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "    ORDER BY installs.event_id, clicks.occurred_at, clicks.event_id",
    "  )",
    ") AS attributed",
    "ORDER BY attributed.install_event_id, attributed.bridge_rank",
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

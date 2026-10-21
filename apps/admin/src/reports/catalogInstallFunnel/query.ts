import { runAdminQuery } from "../../adminApi";
import type { AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildActorAppUiLanguageSql,
  buildActorConnectionCountrySql,
  buildAppUiLanguagesFilterSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorSqlLines,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import {
  buildHashedPageViewFilterSqlLines,
  buildHashedSiteRowSqlLines,
  buildHashedVisitorDayRangeSqlLines,
  buildHashedVisitorDaySql,
} from "../funnels/funnelAudienceSql";
import {
  assertIsString,
  assertValidDateRange,
  laterCalendarDate,
  toInteger,
} from "../reportValues";

export const catalogInstallFunnelReportLabel = "Deck page to install funnel";
export const catalogInstallConversionWindowDays = 7;

/**
 * The first UTC day deck page views count from, whatever range is selected. The site began sending
 * identified page views partway through 2026-09-22, so that day is partial and no day before it has any.
 */
export const catalogInstallFunnelStartDate = "2026-09-23";

export const catalogInstallPlacements = ["top", "middle", "bottom"] as const;
export const catalogInstallSources = [
  "direct",
  "search",
  "social",
  "referral",
  "internal",
  "unknown",
] as const;
export const catalogInstallDeviceCategories = [
  "desktop",
  "mobile",
  "tablet",
  "unknown",
] as const;
export type CatalogInstallPlacement = (typeof catalogInstallPlacements)[number];
export type CatalogInstallSource = (typeof catalogInstallSources)[number];
export type CatalogInstallDeviceCategory = (typeof catalogInstallDeviceCategories)[number];

/**
 * One visitor identity and one deck version, anchored at that identity's first view of the deck's
 * marketing-site page in range. Every other step needs `installClickedAt`, the install click on that
 * same deck version, and is null without it.
 *
 * A row is not the funnel's unit: the section reduces these rows to people. Every step grows by at
 * most one per person who reached it, and a person counts at a step only if the same person reached
 * every earlier step, so a person with rows for several decks still adds at most +1 to each step.
 *
 * The identity is `analytics.product_events_resolved.actor_id`. A row the browser sent with no
 * account credential - the page view, the site click - resolves through the shared
 * `analytics_visitor` cookie in its `anonymous_id`, and onto the account once the web app records an
 * `authenticated_client` identity link for that cookie; the server install carries the account in
 * `user_id` already. That is what carries a person from the site click to the server install. An
 * install made as a web browser guest names the guest instead, and joins the visit through the
 * click's `anonymous_id`: either the guest's own rows share it (`browser_guest_actors` below), or the
 * guest's server install itself carries it from the request's visitor cookie.
 *
 * The click and the install each require the row's own `package_version_id`. `source` and
 * `deviceCategory` are the page view's own.
 */
export type CatalogInstallFunnelVisit = Readonly<{
  actorId: string;
  packageVersionId: string;
  /**
   * The deck behind that version, which only the `Group by` field's deck dimension reads: it is keyed
   * on `packageId`, so two versions of one deck are one bar, and named by `deckSlug`, the deck's
   * public slug on the marketing site and in the catalog API.
   *
   * Both are null together for a version the catalog no longer holds a row for, which the analytics
   * rows outlive; such a visit is kept and grouped as `Unresolved` rather than dropped.
   */
  packageId: string | null;
  deckSlug: string | null;
  visitedAt: string;
  source: CatalogInstallSource;
  deviceCategory: CatalogInstallDeviceCategory;
  installClickedAt: string | null;
  installedAt: string | null;
  /**
   * The two post-install engagement facts, both null together exactly when the visit has no server
   * install, because a person's reviews are only measurable from the install onwards.
   *
   * `installReviewCount` counts the `review_answered` rows of the identity and its browser guest
   * from the install to the page view's seven-day bound, anywhere in the product rather than in the
   * installed deck.
   * `installReviewDayCount` is the distinct UTC days those same reviews fall on.
   */
  installReviewCount: number | null;
  installReviewDayCount: number | null;
  /**
   * The four values only the funnel's `Group by` field reads, on every row of every load rather
   * than with the dimension that reads them: the field regroups the rows the browser already holds
   * instead of reloading the report, so a column that arrived only with its own dimension selected
   * would never arrive at all.
   *
   * `connectionCountry` and `appUiLanguage` are the identity's over the selected dates, from the
   * same per-actor fragments the two filter fields of those names read, and null for an identity
   * neither can place. `clickPlacement` and `clickBrowserLanguage` belong to the install click that
   * is step two, so they are null on exactly the rows that never reached it.
   *
   * `clickPlacement` IS A PLAIN STRING HERE, not the `CatalogInstallPlacement` the filter field
   * offers, and it is deliberately the one catalog column this parser does not hold to its declared
   * values. It is only ever a group key and is drawn as it comes, so the day the site ships a fourth
   * placement it should become its own bar rather than throw away both result sets of a report whose
   * statements share one request. The filter's own
   * option list refuses that same unknown value on purpose (`buildCatalogAttributionEnumOptions` in
   * `../../filters/optionsQuery.ts`): a value that cannot be selected costs one popover entry,
   * while a value that cannot be grouped costs the page.
   */
  connectionCountry: string | null;
  appUiLanguage: string | null;
  clickPlacement: string | null;
  clickBrowserLanguage: string | null;
}>;

export type CatalogInstallFunnelReport = Readonly<{
  generatedAtUtc: string;
  from: string;
  to: string;
  visits: ReadonlyArray<CatalogInstallFunnelVisit>;
  /**
   * The cookieless visitors, one person per daily hash per UTC day: those who viewed any deck page,
   * and those among them whose install click was on a deck whose page they had viewed. There is no
   * third count because every step below the click needs an identity a hash never has.
   */
  hashedDeckPageViewCount: number;
  hashedInstallClickCount: number;
}>;

export type CatalogInstallFunnelRange = Readonly<{
  from: string;
  to: string;
}>;

function assertEnumValue<Value extends string>(
  value: AdminQueryValue,
  values: ReadonlyArray<Value>,
  fieldName: string,
): Value {
  const parsedValue = assertIsString(value, catalogInstallFunnelReportLabel, fieldName);
  if (values.includes(parsedValue as Value) === false) {
    throw new Error(`${catalogInstallFunnelReportLabel} field "${fieldName}" is invalid.`);
  }

  return parsedValue as Value;
}

function assertNullableString(value: AdminQueryValue, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return assertIsString(value, catalogInstallFunnelReportLabel, fieldName);
}

function assertTimestamp(value: AdminQueryValue, fieldName: string): string {
  const timestamp = assertIsString(value, catalogInstallFunnelReportLabel, fieldName);
  if (Number.isNaN(new Date(timestamp).getTime())) {
    throw new Error(`${catalogInstallFunnelReportLabel} field "${fieldName}" must be a timestamp.`);
  }

  return timestamp;
}

function assertNullableTimestamp(value: AdminQueryValue, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return assertTimestamp(value, fieldName);
}

function assertNullableInteger(value: AdminQueryValue, fieldName: string): number | null {
  if (value === null) {
    return null;
  }

  return toInteger(value, catalogInstallFunnelReportLabel, fieldName);
}

function parseVisitRow(row: Readonly<Record<string, AdminQueryValue>>): CatalogInstallFunnelVisit {
  return {
    actorId: assertIsString(row.actor_id ?? null, catalogInstallFunnelReportLabel, "actor_id"),
    packageVersionId: assertIsString(
      row.package_version_id ?? null,
      catalogInstallFunnelReportLabel,
      "package_version_id",
    ),
    packageId: assertNullableString(row.package_id ?? null, "package_id"),
    deckSlug: assertNullableString(row.deck_slug ?? null, "deck_slug"),
    visitedAt: assertTimestamp(row.visited_at ?? null, "visited_at"),
    source: assertEnumValue(row.source ?? null, catalogInstallSources, "source"),
    deviceCategory: assertEnumValue(
      row.device_category ?? null,
      catalogInstallDeviceCategories,
      "device_category",
    ),
    installClickedAt: assertNullableTimestamp(row.install_clicked_at ?? null, "install_clicked_at"),
    installedAt: assertNullableTimestamp(row.installed_at ?? null, "installed_at"),
    installReviewCount: assertNullableInteger(row.install_review_count ?? null, "install_review_count"),
    installReviewDayCount: assertNullableInteger(row.install_review_day_count ?? null, "install_review_day_count"),
    connectionCountry: assertNullableString(row.connection_country ?? null, "connection_country"),
    appUiLanguage: assertNullableString(row.app_ui_language ?? null, "app_ui_language"),
    clickPlacement: assertNullableString(row.click_placement ?? null, "click_placement"),
    clickBrowserLanguage: assertNullableString(
      row.click_browser_language ?? null,
      "click_browser_language",
    ),
  };
}

/**
 * An identified view of a deck's marketing-site page, as `AND`-joined predicates on `rowAlias`. The
 * site reports its facts only through the credential-free collector, under the visitor cookie, and
 * sends `package_version_id` only on a `catalog_package` page; a browser that refused consent resolves
 * to a NULL actor and is nobody.
 */
function buildDeckPageViewSql(rowAlias: string): string {
  return [
    `${rowAlias}.event_name = 'site_page_viewed'`,
    `${rowAlias}.origin = 'client'`,
    `${rowAlias}.trust_level = 'anonymous_client'`,
    `${rowAlias}.event_properties ->> 'page_kind' = 'catalog_package'`,
    `${rowAlias}.event_properties ->> 'package_version_id' IS NOT NULL`,
    `${rowAlias}.actor_id IS NOT NULL`,
  ].join("\n    AND ");
}

export function buildCatalogInstallFunnelAvailableRangeSql(): string {
  return [
    "SELECT",
    "  COALESCE(",
    "    to_char((MIN(resolved.occurred_at) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),",
    "    to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')",
    "  ) AS from_date,",
    "  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS to_date",
    "FROM analytics.product_events_resolved AS resolved",
    `WHERE ${buildDeckPageViewSql("resolved")}`,
  ].join("\n");
}

/** One dimension of the row's own properties, as a predicate; picking nothing keeps every value. */
function buildVisitDimensionFilterSqlLines(
  columnSqlExpression: string,
  values: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (values.length === 0) {
    return [];
  }

  return [`    AND ${columnSqlExpression} IN (${values.map(escapeSqlStringLiteral).join(", ")})`];
}

/**
 * The selection a visit row answers itself: the platform and the deck version of its anchoring page
 * view, and the shared connection country and app interface language, which keep an identity the way
 * they keep a person on General.
 *
 * These are applied after `cohort_visits` has already reduced an identity and deck version to its
 * first page view, so a selection drops whole rows and can never move the anchor the later steps are
 * measured from. Selecting nothing anywhere leaves every predicate out.
 */
function buildFunnelVisitFilterSqlLines(filters: AnalyticsFilterState): ReadonlyArray<string> {
  return [
    `    AND ${buildEventPlatformsFilterSql("COALESCE(candidate.platform, 'unattributed')", filters.eventPlatforms)}`,
    ...buildVisitDimensionFilterSqlLines("candidate.package_version_id", filters.installedDecks),
    `    AND ${buildConnectionCountriesFilterSql("candidate.actor_id::text", filters.connectionCountries, filters.dateRange)}`,
    `    AND ${buildAppUiLanguagesFilterSql("candidate.actor_id::text", filters.appUiLanguages, filters.dateRange)}`,
  ];
}

/**
 * The four catalog-click dimensions, as predicates on the install click that is step two. They narrow
 * which click counts, never the page views above it: the placement exists only on the click, and the
 * source, device category and browser language are read from the same row so all four mean the click.
 * `device_locale` is folded with the same `NULLIF` the General attribution fragment uses, so an empty
 * locale is the absence of a reported browser language on both areas.
 */
function buildInstallClickFilterSqlLines(filters: AnalyticsFilterState): ReadonlyArray<string> {
  return [
    ...buildVisitDimensionFilterSqlLines("click.event_properties ->> 'placement'", filters.catalogPlacements),
    ...buildVisitDimensionFilterSqlLines("click.event_properties ->> 'source'", filters.catalogSources),
    ...buildVisitDimensionFilterSqlLines("click.event_properties ->> 'device_category'", filters.catalogDeviceCategories),
    ...buildVisitDimensionFilterSqlLines("NULLIF(click.device_locale, '')", filters.catalogClickBrowserLanguages),
  ];
}

/**
 * The deck page views and the three catalog install facts the funnel and its test-deck exclusion
 * read, all of which carry a deck version, in one pass over the widest window any row can ask for.
 * Only a `catalog_package` page's view is kept, because no other page names a deck.
 *
 * `client_events` leaves the page views out, and the server install gets its own relation, so the
 * per-visit step reads below scan only the catalog facts rather than every deck page view.
 */
function buildEventWindowSql(from: string, to: string): ReadonlyArray<string> {
  return [
    "events AS MATERIALIZED (",
    "  SELECT resolved.*",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.event_name IN (",
    "    'site_page_viewed',",
    "    'catalog_install_clicked',",
    "    'catalog_deck_install_started',",
    "    'catalog_deck_installed'",
    "  )",
    "    AND (",
    "      resolved.event_name <> 'site_page_viewed'",
    "      OR resolved.event_properties ->> 'page_kind' = 'catalog_package'",
    "    )",
    // A browser that refused consent is given no identifier at all, so its rows resolve to a NULL
    // actor. That is an event belonging to no identity rather than an event missing one, and this
    // report joins every step by identity, so such a row can anchor nothing and bridge nothing.
    // Dropping it here is what keeps the whole credential-free remainder from collapsing into one
    // phantom NULL visitor that no filter and no exclusion could reject.
    "    AND resolved.actor_id IS NOT NULL",
    "    AND resolved.occurred_at >= (",
    `      (${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND resolved.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "), deck_page_views AS MATERIALIZED (",
    "  SELECT events.*",
    "  FROM events",
    `  WHERE ${buildDeckPageViewSql("events")}`,
    "), client_events AS MATERIALIZED (",
    "  SELECT events.*",
    "  FROM events",
    "  WHERE events.event_name <> 'site_page_viewed'",
    "    AND events.origin = 'client'",
    "    AND events.trust_level = 'anonymous_client'",
    "), install_start_events AS (",
    "  SELECT events.*",
    "  FROM events",
    "  WHERE events.event_name = 'catalog_deck_install_started'",
    "    AND events.origin = 'client'",
    "    AND events.trust_level IN ('anonymous_client', 'authenticated_client')",
    "), server_installs AS MATERIALIZED (",
    "  SELECT events.*",
    "  FROM events",
    "  WHERE events.event_name = 'catalog_deck_installed'",
    "    AND events.origin = 'server'",
    ")",
  ];
}

/** The test deck, rejected on the candidate's own identity and deck version inside its window. */
function buildTestDeckFilterSqlLines(): ReadonlyArray<string> {
  return [
    "    AND NOT EXISTS (",
    "      SELECT 1",
    "      FROM install_start_events AS test_start",
    "      WHERE test_start.actor_id = candidate.actor_id",
    "        AND test_start.event_properties ->> 'package_version_id' = candidate.package_version_id",
    "        AND test_start.event_properties ->> 'package_slug' = 'test'",
    "        AND test_start.occurred_at >= candidate.anchor_at",
    `        AND test_start.occurred_at <= candidate.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "    )",
  ];
}

/**
 * A cohort membership test, as an uncorrelated subquery rather than a correlation.
 *
 * `analytics.product_events_resolved.actor_id` is
 * `COALESCE(first_guest_upgrade_link.user_id, product_events.user_id, first_anonymous_link.user_id,
 * product_events.anonymous_id)` over two `LEFT JOIN`ed `DISTINCT ON` subqueries
 * (`db/migrations/0137_audience_context.sql`), so an equality on it can never become an index qual and
 * can never be pushed below those joins: one comparison against it is one full pass of that view. So
 * a relation keyed on identity must never be computed per row. This is the same `= ANY (ARRAY(...))`
 * that `buildSubqueryMembershipSql` in `apps/admin/src/filters/filterSql.ts` uses and for the same
 * reason - the subquery is uncorrelated, so the planner evaluates it once as an InitPlan instead of
 * re-running it per row of a CTE it has no statistics for, which is what takes a report past the 30s
 * `reporting_readonly` statement timeout and fails every statement of the page with it.
 */
function buildActorMembershipSql(relationName: string, actorIdSqlExpression: string): string {
  return [
    `${actorIdSqlExpression} = ANY (ARRAY(`,
    `  SELECT ${relationName}.actor_id`,
    `  FROM ${relationName}`,
    "))",
  ].join("\n");
}

/**
 * The cookieless cohort, as its own statement rather than more visit rows.
 *
 * A hashed person has no `actor_id`, no deck they can be followed to and no step below the click, so
 * a `CatalogInstallFunnelVisit` could carry nothing but nulls for them and every reduction the
 * section performs on those rows would have to learn to skip them. Two counts say the same thing and
 * leave the visit-row contract alone.
 *
 * ONE PERSON IS ONE HASH ON ONE UTC DAY, and the two counts follow the funnel rule on that pair the
 * way the identified steps follow it on an actor: the first is the distinct people who viewed any
 * deck page, the second the distinct people among them whose click was on a deck whose page they had
 * viewed, at or after viewing it. That is the identified rule of step two, keyed on the hash.
 *
 * THE DELISTED `test` DECK IS COUNTED HERE, and there is no way to reject it on these rows.
 * `buildTestDeckFilterSqlLines` recognises the fixture by a matching `catalog_deck_install_started`
 * by the same actor, an app-side row a cookieless browser can never produce, and `site_page_viewed`
 * carries no `package_slug` to test instead. So the fixture's own page views and install clicks join
 * the hashed counts, and the section says so beside the exclusion-list, test-account and admin gaps
 * the cohort escapes for the same reason: it has no actor to test.
 */
function buildHashedCatalogInstallFunnelSql(
  filters: AnalyticsFilterState,
  from: string,
  to: string,
): string {
  const visitorDaySql = buildHashedVisitorDaySql("candidate");
  const packageVersionSql = "candidate.event_properties ->> 'package_version_id'";

  return [
    "WITH hashed_deck_views AS MATERIALIZED (",
    "  SELECT",
    "    candidate.daily_visitor_hash,",
    `    ${visitorDaySql} AS visitor_day,`,
    `    ${packageVersionSql} AS package_version_id,`,
    "    MIN(candidate.occurred_at) AS viewed_at",
    "  FROM analytics.product_events_resolved AS candidate",
    `  WHERE ${buildHashedSiteRowSqlLines("candidate", "site_page_viewed").join("\n    AND ")}`,
    "    AND candidate.event_properties ->> 'page_kind' = 'catalog_package'",
    `    AND ${packageVersionSql} IS NOT NULL`,
    `    AND ${buildHashedPageViewFilterSqlLines("candidate", "COALESCE(candidate.platform, 'unattributed')", filters).join("\n    AND ")}`,
    ...buildVisitDimensionFilterSqlLines(packageVersionSql, filters.installedDecks),
    `    AND ${buildHashedVisitorDayRangeSqlLines("candidate", from, to).join("\n    AND ")}`,
    `  GROUP BY candidate.daily_visitor_hash, ${visitorDaySql}, ${packageVersionSql}`,
    // The four click dimensions narrow this click exactly as they narrow the identified one, because
    // they are properties the click row carries whether or not it names anybody.
    "), hashed_deck_clicks AS MATERIALIZED (",
    "  SELECT DISTINCT hashed_view.daily_visitor_hash, hashed_view.visitor_day",
    "  FROM hashed_deck_views AS hashed_view",
    "  INNER JOIN analytics.product_events_resolved AS click",
    "    ON click.daily_visitor_hash = hashed_view.daily_visitor_hash",
    `    AND ${buildHashedVisitorDaySql("click")} = hashed_view.visitor_day`,
    "    AND click.event_properties ->> 'package_version_id' = hashed_view.package_version_id",
    "    AND click.occurred_at >= hashed_view.viewed_at",
    `  WHERE ${buildHashedSiteRowSqlLines("click", "catalog_install_clicked").join("\n    AND ")}`,
    ...buildInstallClickFilterSqlLines(filters),
    `    AND ${buildHashedVisitorDayRangeSqlLines("click", from, to).join("\n    AND ")}`,
    ")",
    "SELECT",
    // One row per person, not per deck: `hashed_deck_views` is grouped by the deck version too, so a
    // person who viewed two deck pages in their day is two rows there and one person here.
    "  (",
    "    SELECT COUNT(*)",
    "    FROM (",
    "      SELECT DISTINCT hashed_view.daily_visitor_hash, hashed_view.visitor_day",
    "      FROM hashed_deck_views AS hashed_view",
    "    ) AS distinct_hashed_viewers",
    "  )::int AS hashed_view_count,",
    "  (SELECT COUNT(*) FROM hashed_deck_clicks)::int AS hashed_click_count",
  ].join("\n");
}

/**
 * The visit rows, then the cookieless counts, over the selected UTC days from
 * `catalogInstallFunnelStartDate` on. The section reduces the rows to people by the
 * funnel rule in `../funnels/funnelSections.ts`.
 */
export function buildCatalogInstallFunnelSql(filters: AnalyticsFilterState): string {
  const { from: selectedFrom, to } = assertValidDateRange(filters.dateRange, catalogInstallFunnelReportLabel);
  // A range ending before the start date leaves `from` after `to`, so nothing counts.
  const from = laterCalendarDate(selectedFrom, catalogInstallFunnelStartDate);

  const cohortQuery = [
    "WITH",
    ...buildEventWindowSql(from, to),
    ", page_view_candidates AS (",
    "  SELECT",
    "    page_view.actor_id,",
    "    page_view.event_properties ->> 'package_version_id' AS package_version_id,",
    "    page_view.occurred_at AS anchor_at,",
    "    page_view.event_id,",
    "    page_view.event_properties ->> 'source' AS source,",
    "    page_view.event_properties ->> 'device_category' AS device_category,",
    "    page_view.platform",
    "  FROM deck_page_views AS page_view",
    "  WHERE page_view.occurred_at < (",
    `    (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    // One row per identity per deck version, anchored at the first view of that deck's page the
    // identity made in range. Coming back to the same deck page is the same person arriving again.
    "), cohort_visits AS (",
    "  SELECT DISTINCT ON (page_view_candidates.actor_id, page_view_candidates.package_version_id)",
    "    page_view_candidates.*",
    "  FROM page_view_candidates",
    "  ORDER BY",
    "    page_view_candidates.actor_id,",
    "    page_view_candidates.package_version_id,",
    "    page_view_candidates.anchor_at,",
    "    page_view_candidates.event_id",
    "), eligible_visits AS MATERIALIZED (",
    "  SELECT candidate.*",
    "  FROM cohort_visits AS candidate",
    "  WHERE TRUE",
    ...buildTestDeckFilterSqlLines(),
    ...buildExcludedActorSqlLines("candidate.actor_id::text"),
    ...buildFunnelVisitFilterSqlLines(filters),
    // Step two, the first install click on the same deck version within the window, as one hash join
    // rather than a per-visit read. Every later step chains from it, so the per-visit reads below run
    // only on visits that clicked.
    //
    // The click has to resolve to the page view's identity, which a click body that claims no
    // `anonymousId` never does: the collector stores it under its per-attempt `install_journey_id`
    // instead (`readAnonymousId` in `apps/backend/src/productAnalytics/anonymousEvent.ts`), an
    // identity nothing else shares.
    "), visit_clicks AS MATERIALIZED (",
    // `DISTINCT ON` rather than `MIN(click.occurred_at)`, which picks the same first click: the
    // placement and the browser language of that one click come back with it, so the two click
    // dimensions of the `Group by` field read the very row step two was counted on rather than a
    // second click of the same visit. `event_id` decides a tie, as it does everywhere here.
    "  SELECT DISTINCT ON (visit.actor_id, visit.package_version_id)",
    "    visit.actor_id,",
    "    visit.package_version_id,",
    "    click.occurred_at AS clicked_at,",
    "    click.event_properties ->> 'placement' AS click_placement,",
    // The same `NULLIF` the click filter and the General attribution fragment apply, so an empty
    // locale is the absence of a reported browser language here too, and groups as `Unresolved`.
    "    NULLIF(click.device_locale, '') AS click_browser_language,",
    "    click.anonymous_id AS click_anonymous_id",
    "  FROM eligible_visits AS visit",
    "  INNER JOIN client_events AS click",
    "    ON click.actor_id = visit.actor_id",
    "    AND click.event_properties ->> 'package_version_id' = visit.package_version_id",
    "    AND click.occurred_at >= visit.anchor_at",
    `    AND click.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  WHERE click.event_name = 'catalog_install_clicked'",
    ...buildInstallClickFilterSqlLines(filters),
    "  ORDER BY visit.actor_id, visit.package_version_id, click.occurred_at, click.event_id",
    // The same cohort by identity alone, for the two per-actor `Group by` sources to be probed
    // against. `DISTINCT` is the whole point of it: `eligible_visits` holds an actor once per deck
    // version they viewed, and the array an InitPlan produces is not a `Const`, so the planner
    // cannot hash the `= ANY (...)` and probes it linearly - and this is the largest cohort the
    // pattern is handed anywhere in the query, one row per identity and deck version rather than
    // per click or per install, so every duplicate would be one more comparison for every row of
    // the source being filtered. `install_actors` below is distinct for the same reason.
    "), visit_actors AS (",
    "  SELECT DISTINCT eligible_visits.actor_id",
    "  FROM eligible_visits",
    // A signed-out visitor who imports the deck gets a web browser guest seconds after the click, and
    // the server install names that guest rather than the visitor: the backend writes no identity link
    // for a guest request, so the visitor's own rows never resolve onto it. The guest's own
    // `guest_client` rows carry the click's `anonymous_id`, and that shared visitor id is the join
    // here; the install's own copy of it is the third arm of `visit_install_actors` below. The
    // guest's `actor_id` rather than its `user_id`, because the install and its reviews are
    // keyed on the resolved identity, which a later merge moves onto the target account.
    //
    // The guest is held to the visitor's own exclusion rule, so an excluded guest stays out.
    "), browser_guest_actors AS MATERIALIZED (",
    "  SELECT DISTINCT guest_row.anonymous_id, guest_row.actor_id",
    "  FROM analytics.product_events_resolved AS guest_row",
    "  WHERE guest_row.trust_level = 'guest_client'",
    "    AND guest_row.platform = 'web'",
    "    AND guest_row.anonymous_id = ANY (ARRAY(",
    "      SELECT visit_clicks.click_anonymous_id",
    "      FROM visit_clicks",
    "    ))",
    "    AND guest_row.actor_id IS NOT NULL",
    "    AND guest_row.occurred_at >= (",
    `      (${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND guest_row.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    ...buildExcludedActorSqlLines("guest_row.actor_id::text"),
    // Every identity whose server install and reviews count for a clicked visit: the visit's own, its
    // browser guest's, and the installing guest of a server install that carries the click's
    // `anonymous_id`. `UNION` keeps each once, so no review joins a visit twice.
    "), visit_install_actors AS MATERIALIZED (",
    "  SELECT clicked.actor_id, clicked.package_version_id, clicked.actor_id AS install_actor_id",
    "  FROM visit_clicks AS clicked",
    "  UNION",
    "  SELECT clicked.actor_id, clicked.package_version_id, guest.actor_id AS install_actor_id",
    "  FROM visit_clicks AS clicked",
    "  INNER JOIN browser_guest_actors AS guest",
    "    ON guest.anonymous_id = clicked.click_anonymous_id",
    "  UNION",
    // The install request carries the browser's `analytics_visitor` cookie, and the server install
    // stores it as `anonymous_id` while naming the guest as its actor, so this reaches a browser guest
    // whose own rows never arrived. Only a guest install counts: the cookie survives a logout and an
    // account switch, so on a shared browser an account's install would otherwise be credited to
    // another account's click. It is bound to the deck version and the bounds the install step below
    // applies, and held to the exclusion rule the browser guest is.
    "  SELECT clicked.actor_id, clicked.package_version_id, visitor_install.actor_id AS install_actor_id",
    "  FROM visit_clicks AS clicked",
    "  INNER JOIN eligible_visits AS visit",
    "    ON visit.actor_id = clicked.actor_id",
    "    AND visit.package_version_id = clicked.package_version_id",
    "  INNER JOIN server_installs AS visitor_install",
    "    ON visitor_install.anonymous_id = clicked.click_anonymous_id",
    "    AND visitor_install.guest_session_id IS NOT NULL",
    "    AND visitor_install.event_properties ->> 'package_version_id' = clicked.package_version_id",
    "    AND visitor_install.occurred_at >= clicked.clicked_at",
    `    AND visitor_install.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  WHERE TRUE",
    ...buildExcludedActorSqlLines("visitor_install.actor_id::text"),
    "), visit_rows AS MATERIALIZED (",
    "SELECT",
    "  visit.actor_id,",
    "  visit.package_version_id,",
    "  visit.anchor_at AS visited_at,",
    "  clicked.clicked_at AS install_clicked_at,",
    "  clicked.click_placement,",
    "  clicked.click_browser_language,",
    "  installed.occurred_at AS installed_at",
    "FROM eligible_visits AS visit",
    "INNER JOIN visit_clicks AS clicked",
    "  ON clicked.actor_id = visit.actor_id",
    "  AND clicked.package_version_id = visit.package_version_id",
    "LEFT JOIN LATERAL (",
    "  SELECT installed_event.occurred_at",
    "  FROM server_installs AS installed_event",
    "  WHERE installed_event.actor_id IN (",
    "      SELECT install_actor.install_actor_id",
    "      FROM visit_install_actors AS install_actor",
    "      WHERE install_actor.actor_id = visit.actor_id",
    "        AND install_actor.package_version_id = visit.package_version_id",
    "    )",
    "    AND installed_event.event_properties ->> 'package_version_id' = visit.package_version_id",
    "    AND installed_event.occurred_at >= clicked.clicked_at",
    `    AND installed_event.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY installed_event.occurred_at, installed_event.event_id",
    "  LIMIT 1",
    ") AS installed ON TRUE",
    // Post-install engagement, keyed by the installing identity rather than per visit row. A visit
    // without a server install has no install to measure from, so its columns arrive null together
    // rather than as a zero that would read as a drop-off.
    "), install_actors AS (",
    "  SELECT DISTINCT install_actor.install_actor_id AS actor_id",
    "  FROM visit_rows AS visit",
    "  INNER JOIN visit_install_actors AS install_actor",
    "    ON install_actor.actor_id = visit.actor_id",
    "    AND install_actor.package_version_id = visit.package_version_id",
    "  WHERE visit.installed_at IS NOT NULL",
    // THE REVIEWS ARE THE PERSON'S, NOT THE DECK'S. `review_answered` carries only `rating` and
    // `source`, so no deck or card identity exists to narrow them by, and this reads every review
    // those identities answered. It cannot reuse the `events` CTE: that one is restricted to the deck
    // page view and the catalog event names, and `review_answered` is not among them.
    //
    // The bounds are the widest any visit can ask for, so one pass serves all of them: no review
    // counts before the install, and no install is earlier than the range's first instant, while the
    // per-visit bound below reaches at most a page view on the last selected day plus the window.
    "), install_actor_reviews AS MATERIALIZED (",
    "  SELECT",
    "    review_event.actor_id,",
    "    review_event.occurred_at",
    "  FROM analytics.product_events_resolved AS review_event",
    "  WHERE review_event.event_name = 'review_answered'",
    `    AND ${buildActorMembershipSql("install_actors", "review_event.actor_id")}`,
    "    AND review_event.occurred_at >= (",
    `      (${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND review_event.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    // The count and the review day count come from one grouped pass over the same review rows rather
    // than two scans of them. The window runs from the install - a review before it cannot be a
    // consequence of it - to the same seven-day bound on the page view every other step here uses,
    // so a late install leaves less of it. A review day is a UTC calendar day, the same UTC day every
    // other admin report reads.
    //
    // The join is on a visit rather than on an actor, which is what keeps one person who installs two
    // decks in range counted as the two rows they are: each row carries that identity's reviews for
    // its own window, so their reviews are counted once per deck they installed.
    "), visit_engagement AS (",
    "  SELECT",
    "    visit.actor_id,",
    "    visit.package_version_id,",
    "    COUNT(review.occurred_at)::int AS review_count,",
    "    COUNT(DISTINCT (review.occurred_at AT TIME ZONE 'UTC')::date)::int AS review_day_count",
    "  FROM visit_rows AS visit",
    "  INNER JOIN visit_install_actors AS install_actor",
    "    ON install_actor.actor_id = visit.actor_id",
    "    AND install_actor.package_version_id = visit.package_version_id",
    "  LEFT JOIN install_actor_reviews AS review",
    "    ON review.actor_id = install_actor.install_actor_id",
    "    AND review.occurred_at >= visit.installed_at",
    `    AND review.occurred_at <= visit.visited_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  WHERE visit.installed_at IS NOT NULL",
    "  GROUP BY visit.actor_id, visit.package_version_id",
    "), actor_country AS MATERIALIZED (",
    "  SELECT cohort_country.actor_id, cohort_country.country",
    "  FROM (",
    buildActorConnectionCountrySql(filters.dateRange),
    "  ) AS cohort_country",
    `  WHERE ${buildActorMembershipSql("visit_actors", "cohort_country.actor_id")}`,
    "), actor_language AS MATERIALIZED (",
    "  SELECT cohort_language.actor_id, cohort_language.ui_locale",
    "  FROM (",
    buildActorAppUiLanguageSql(filters.dateRange),
    "  ) AS cohort_language",
    `  WHERE ${buildActorMembershipSql("visit_actors", "cohort_language.actor_id")}`,
    ")",
    // Every eligible page view is a row; one that never reached the click carries null steps.
    "SELECT",
    "  visit.actor_id::text AS actor_id,",
    "  visit.package_version_id,",
    "  deck.package_id::text AS package_id,",
    "  deck.slug AS deck_slug,",
    "  visit.anchor_at AS visited_at,",
    "  visit.source,",
    "  visit.device_category,",
    "  actor_country.country AS connection_country,",
    "  actor_language.ui_locale AS app_ui_language,",
    "  stepped.install_clicked_at,",
    "  stepped.click_placement,",
    "  stepped.click_browser_language,",
    "  stepped.installed_at,",
    "  engagement.review_count AS install_review_count,",
    "  engagement.review_day_count AS install_review_day_count",
    "FROM eligible_visits AS visit",
    "LEFT JOIN visit_rows AS stepped",
    "  ON stepped.actor_id = visit.actor_id",
    "  AND stepped.package_version_id = visit.package_version_id",
    "LEFT JOIN visit_engagement AS engagement",
    "  ON engagement.actor_id = visit.actor_id",
    "  AND engagement.package_version_id = visit.package_version_id",
    // The deck behind the row's version, which is what the `Group by` field's deck dimension is keyed
    // and named on. Both joins are outer because the analytics rows outlive the catalog: a version
    // whose row is gone keeps its visit with a NULL package and slug, and groups as `Unresolved`.
    //
    // `::text` on the catalog column rather than `::uuid` on the property, the way every other join
    // between this store and a UUID column is written here: the property is client-reported JSON text,
    // and casting it would fail both statements of the page on one malformed id rather than leave
    // that one visit unnamed. `reporting_readonly` may read these two columns of each table and no
    // other (`db/migrations/0148_reporting_readonly_catalog_deck_names.sql`).
    "LEFT JOIN catalog.package_versions AS deck_version",
    "  ON deck_version.package_version_id::text = visit.package_version_id",
    "LEFT JOIN catalog.packages AS deck",
    "  ON deck.package_id = deck_version.package_id",
    // BOTH PER-ACTOR SOURCES ON EVERY LOAD, never only the one a selected dimension reads, which is
    // where this funnel departs from the first launch one. Its `Group by` field reloads the report and can
    // therefore join the one source its key needs; this one regroups rows the browser already holds,
    // so a column joined only while its own dimension is selected would never be there to read.
    //
    // WHAT MAKES THAT AFFORDABLE IS THE MEMBERSHIP PREDICATE ON EACH OF THEM - but it bounds what
    // survives rather than what is read. The planner applies it as a post-scan `Filter` instead of
    // pushing it through the source's own `GROUP BY` onto the scan beneath, so each source still
    // passes over the whole selected range and its cost follows that range rather than this cohort.
    // What the predicate does buy is everything above those scans - unbounded, the country source
    // cross-joins the retained connection samples to two endpoints each and hash-joins the view
    // again, and the language source alone materializes and hash-joins a row for every trusted actor
    // in the selected range rather than for this cohort's - on a statement group whose 30 s timeout
    // fails the visits and the cookieless counts together.
    //
    // EACH SOURCE IS A `MATERIALIZED` CTE, computed once and joined here by a CTE scan. The planner
    // has no statistics for the JSONB predicates that build `eligible_visits` and can estimate it at
    // one row; joined as an inline subquery, each source then lands on the inner side of a nested
    // loop and reruns its whole scan once per visit, which alone takes this statement past the 30 s
    // timeout.
    //
    // The predicate sits inside each CTE rather than in this query's own WHERE because a row here
    // must survive with a NULL country or locale. `buildActorMembershipSql` yields
    // `actor_id = ANY (ARRAY(...))`, an uncorrelated subselect the planner evaluates once as an
    // InitPlan and leaves in the qual as a plain parameter rather than re-running it per row.
    "LEFT JOIN actor_country ON actor_country.actor_id = visit.actor_id",
    "LEFT JOIN actor_language ON actor_language.actor_id = visit.actor_id",
    "ORDER BY visit.anchor_at, visit.actor_id, visit.package_version_id",
  ].join("\n");

  return [
    cohortQuery,
    buildHashedCatalogInstallFunnelSql(filters, from, to),
  ].join(";\n");
}

export async function loadCatalogInstallFunnelAvailableRange(
  config: AdminAppConfig,
  signal: AbortSignal,
): Promise<CatalogInstallFunnelRange> {
  const response = await runAdminQuery(config, buildCatalogInstallFunnelAvailableRangeSql(), signal);
  if (response.resultSets.length !== 1) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} available range must return exactly one result set. Got ${response.resultSets.length}.`,
    );
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined || resultSet.rows.length !== 1) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} available range must return exactly one row. Got ${resultSet?.rows.length ?? 0}.`,
    );
  }

  const row = resultSet.rows[0];
  if (row === undefined) {
    throw new Error(`${catalogInstallFunnelReportLabel} available range row is missing.`);
  }

  return assertValidDateRange({
    from: assertIsString(row.from_date ?? null, catalogInstallFunnelReportLabel, "from_date"),
    to: assertIsString(row.to_date ?? null, catalogInstallFunnelReportLabel, "to_date"),
  }, `${catalogInstallFunnelReportLabel} available range`);
}

export async function loadCatalogInstallFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  signal: AbortSignal,
): Promise<CatalogInstallFunnelReport> {
  const response = await runAdminQuery(config, buildCatalogInstallFunnelSql(filters), signal);
  if (response.resultSets.length !== 2) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} must return exactly two result sets. Got ${response.resultSets.length}.`,
    );
  }

  const visitsResultSet = response.resultSets[0];
  const hashedResultSet = response.resultSets[1];
  if (visitsResultSet === undefined || hashedResultSet === undefined) {
    throw new Error(`${catalogInstallFunnelReportLabel} result sets are missing.`);
  }

  const hashedRow = hashedResultSet.rows[0];
  if (hashedRow === undefined || hashedResultSet.rows.length !== 1) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} hashed result set must return one row. Got ${hashedResultSet.rows.length}.`,
    );
  }

  return {
    generatedAtUtc: response.executedAtUtc,
    from: filters.dateRange.from,
    to: filters.dateRange.to,
    visits: visitsResultSet.rows.map(parseVisitRow),
    hashedDeckPageViewCount: toInteger(
      hashedRow.hashed_view_count ?? null,
      catalogInstallFunnelReportLabel,
      "hashed_view_count",
    ),
    hashedInstallClickCount: toInteger(
      hashedRow.hashed_click_count ?? null,
      catalogInstallFunnelReportLabel,
      "hashed_click_count",
    ),
  };
}

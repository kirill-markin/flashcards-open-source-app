import {
  runAdminQuery,
  type AdminQueryResultSet,
  type ReviewEventsByDateUser,
} from "../adminApi";
import type { AdminAppConfig } from "../config";
import { assertIsString, assertValidDateRange, toInteger } from "../reports/reportValues";
import { catalogInstallPlacements, type CatalogInstallPlacement } from "../reports/catalogInstallFunnel/query";
import {
  buildHashedSiteViewRowsSql,
  buildIdentifiedSiteViewRowsSql,
  buildSiteVisitorFilterValueSql,
} from "../reports/whoSawUs/siteFactSql";
import {
  buildCatalogInstallAttributionSql,
  buildCatalogInstalledDeckVersionsSql,
  buildConnectionCountrySamplesSql,
  buildExcludedActorSqlLines,
  buildTrustedActorRowsFilterSql,
} from "./filterSql";
import { getUserFilterLabel } from "./userFilters";
import { escapeSqlStringLiteral } from "../sql";
import {
  siteDeviceCategories,
  siteSources,
  type AnalyticsDateRange,
  type SiteDeviceCategory,
  type SiteSource,
  type SiteVisitorFilterState,
} from "./analyticsFilters";

const optionsReportLabel = "Analytics filter options";

/**
 * The filter options of one date range, deliberately independent of the current selection.
 *
 * Every report is filtered server-side, so none of them can answer "who could be picked here" any
 * more: a user missing from a narrowed report is exactly the user the popup has to keep offering.
 * The deck slugs are the colour domain of the installs chart for the same reason - a deck must not
 * change colour because a filter removed another deck.
 */
export type AnalyticsFilterOptions = Readonly<{
  generatedAtUtc: string;
  users: ReadonlyArray<ReviewEventsByDateUser>;
  catalogPackageSlugs: ReadonlyArray<string>;
  connectionCountries: ReadonlyArray<string>;
  appUiLanguages: ReadonlyArray<string>;
  catalogDecks: ReadonlyArray<CatalogDeckOption>;
  catalogPlacements: ReadonlyArray<CatalogInstallPlacement>;
  catalogSources: ReadonlyArray<SiteSource>;
  catalogDeviceCategories: ReadonlyArray<SiteDeviceCategory>;
  catalogClickBrowserLanguages: ReadonlyArray<string>;
}>;

/** The site visitor fields whose values come from data rather than from a declared vocabulary. */
const siteVisitorOptionFields = [
  "siteCountries",
  "siteBrowserLanguages",
  "sitePageKinds",
] as const satisfies ReadonlyArray<keyof SiteVisitorFilterState>;

type SiteVisitorOptionField = (typeof siteVisitorOptionFields)[number];

/** What the Web engaged page's data-driven site fields offer over one date range. */
export type SiteVisitorFilterOptions = Readonly<Record<SiteVisitorOptionField, ReadonlyArray<string>>>;

/** For every bar that does not offer the site fields. */
export const noSiteVisitorFilterOptions: SiteVisitorFilterOptions = {
  siteCountries: [],
  siteBrowserLanguages: [],
  sitePageKinds: [],
};

export type CatalogDeckOption = Readonly<{
  packageVersionId: string;
  packageSlug: string;
}>;

// The people the General and Audience user filter offers inside the range. No chart there draws
// `review_answered`: it feeds the review-event count the popup prints and ranks people by, and still
// offers someone whose only activity in range is reviewing. Every source applies the shared exclusion
// rule of `buildExcludedActorSqlLines`, and the install source drops the delisted `test` fixture on
// top of it.
//
// `friendship_created` is the one source that reaches back before the range, because the community
// chart carries a running friendship total: a friendship created earlier still shows on every day in
// range, so its actor is still offered. Every other source has to happen inside the range.
function buildAnalyticsFilterOptionUsersSql(dateRange: AnalyticsDateRange): string {
  const fromLiteral = escapeSqlStringLiteral(dateRange.from);
  const toLiteral = escapeSqlStringLiteral(dateRange.to);

  return [
    "WITH",
    // One stored email per actor key. The email join is folded on the stored side because `actor_id`
    // renders canonical lowercase hex while `org.user_settings.user_id` is unconstrained TEXT.
    // Folding can merge two stored rows, and a join on them would fan every event row out once per
    // folded row and double `COUNT(*)`. Deduping the stored side here
    // rather than aggregating the fan-out away downstream keeps one row per event structural, so the
    // review count below stays the real one.
    // `MIN` over the nullable address keeps a real email whenever any folded row carries one and
    // falls back to NULL only when none does.
    "user_emails AS (",
    "  SELECT",
    "    pg_catalog.lower(user_settings.user_id) AS user_key,",
    "    MIN(NULLIF(btrim(user_settings.email), '')) AS email",
    "  FROM org.user_settings AS user_settings",
    "  GROUP BY pg_catalog.lower(user_settings.user_id)",
    "),",
    "option_events AS (",
    "  SELECT",
    "    resolved.actor_id::text AS actor_id,",
    "    resolved.event_name,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS event_date,",
    "    resolved.event_properties ->> 'package_slug' AS package_slug,",
    "    user_emails.email",
    "  FROM analytics.product_events_resolved AS resolved",
    "  LEFT JOIN user_emails ON user_emails.user_key = resolved.actor_id::text",
    // `db/migrations/0115_product_analytics_resolved_view.sql` resolves `actor_id` down to
    // `anonymous_id`, so an event with no account behind it still names one actor and is still
    // offered here. This guard drops only the rows where even `anonymous_id` is NULL, which would
    // group into a NULL `user_id` that `buildUserOptions` rejects - failing this query takes the
    // whole General and Audience load down. `apps/admin/src/reports/audience/query.ts` guards the
    // same column.
    "  WHERE resolved.actor_id IS NOT NULL",
    "    AND resolved.event_name IN (",
    "      'review_answered',",
    "      'app_opened',",
    "      'catalog_deck_installed',",
    "      'friend_invitation_created',",
    "      'friendship_created'",
    "    )",
    "    AND resolved.occurred_at < (",
    `      (${toLiteral}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    // Only the friendship source reads below the range start. Bounding the others here as well as in
    // the per-source rules below keeps the scan bounded whatever the planner does with this CTE.
    "    AND (",
    "      resolved.event_name = 'friendship_created'",
    "      OR resolved.occurred_at >= (",
    `        (${fromLiteral}::date)::timestamp AT TIME ZONE 'UTC'`,
    "      )",
    "    )",
    ...buildExcludedActorSqlLines("resolved.actor_id::text"),
    // The popup offers people, so it drops the credential-free collector's rows for the reason
    // `buildTrustedActorRowsFilterSql` states: that collector accepts `app_opened` like every other
    // client-reportable name, and an unverified visitor UUID offered here would be a selectable
    // "user" in the filter bar of the very reports that refuse to count it.
    `    AND ${buildTrustedActorRowsFilterSql("resolved.trust_level")}`,
    ")",
    // One row per actor, and one popup entry per person: `user_emails` holds one row per folded
    // actor key, so the email here is functionally determined by the actor and grouping by the pair
    // cannot split a person across two entries. That is also what makes `COUNT(*)` truthful - it
    // counts events, not joined pairs.
    "SELECT",
    "  option_events.actor_id AS user_id,",
    "  COALESCE(option_events.email, '(no email)') AS email,",
    "  CAST(COUNT(*) FILTER (WHERE option_events.event_name = 'review_answered') AS INTEGER) AS review_event_count",
    "FROM option_events",
    "WHERE option_events.event_name = 'friendship_created'",
    `  OR (option_events.event_date >= ${fromLiteral}::date AND (`,
    "    option_events.event_name IN ('review_answered', 'app_opened', 'friend_invitation_created')",
    "    OR (",
    "      option_events.event_name = 'catalog_deck_installed'",
    "      AND option_events.package_slug <> 'test'",
    "    )",
    "  ))",
    "GROUP BY option_events.actor_id, option_events.email",
    "ORDER BY option_events.actor_id ASC",
  ].join("\n");
}

// The decks the installs chart can colour inside the range. Same exclusions as
// `buildCatalogInstallsSql`, which states why they exist; the colour scale sorts the slugs itself, so
// this returns the set rather than an order.
function buildAnalyticsFilterOptionPackagesSql(dateRange: AnalyticsDateRange): string {
  return [
    "SELECT DISTINCT resolved.event_properties ->> 'package_slug' AS package_slug",
    "FROM analytics.product_events_resolved AS resolved",
    "WHERE resolved.event_name = 'catalog_deck_installed'",
    "  AND resolved.occurred_at >= (",
    `    (${escapeSqlStringLiteral(dateRange.from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND resolved.occurred_at < (",
    `    (${escapeSqlStringLiteral(dateRange.to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND resolved.event_properties ->> 'package_slug' <> 'test'",
    ...buildExcludedActorSqlLines("resolved.actor_id::text"),
  ].join("\n");
}

// Every country a retained connection sample can put a person in inside the range, read through the
// same fragment the country filter reads and with the same platform-blind evidence, so the popup
// offers exactly the countries that filter can match. The audience report reads that fragment
// narrowed to the selected platforms instead, so a country offered here can still chart as `unknown`
// there.
//
// Like the users list above, this restates the shared exclusion rule every report applies, so a
// country only an excluded person was ever seen connecting from is not offered.
function buildAnalyticsFilterOptionCountriesSql(dateRange: AnalyticsDateRange): string {
  return [
    "SELECT DISTINCT country_samples.country AS country",
    "FROM (",
    buildConnectionCountrySamplesSql(dateRange, null),
    ") AS country_samples",
    // A sampled lookup that returned no country is the `unknown` bucket of the audience report rather
    // than a country anybody can pick.
    "WHERE country_samples.country IS NOT NULL",
    ...buildExcludedActorSqlLines("country_samples.actor_id::text"),
    "ORDER BY country ASC",
  ].join("\n");
}

// Every interface locale an event in the range carries, over every event name and every platform,
// which is how the language filter reads it; the audience report narrows the same locales to the
// selected platforms, so a locale offered here can still chart as `unknown` there. A NULL locale is
// not offered: no selection can match it, and a person whose events carry only NULLs is exactly the
// person a narrowed language filter drops. The shared exclusion rule and the trust rule are restated,
// for the reason the country list above states.
function buildAnalyticsFilterOptionAppUiLanguagesSql(dateRange: AnalyticsDateRange): string {
  return [
    "SELECT DISTINCT resolved.ui_locale AS ui_locale",
    "FROM analytics.product_events_resolved AS resolved",
    "WHERE resolved.ui_locale IS NOT NULL",
    "  AND resolved.actor_id IS NOT NULL",
    // A non-NULL actor is the only other gate here, and a credential-free row carries one, so
    // without this a locale only a signed-out visitor ever sent would be offered as a filter value
    // by the very reports that refuse to count that visitor. See `buildTrustedActorRowsFilterSql`.
    `  AND ${buildTrustedActorRowsFilterSql("resolved.trust_level")}`,
    "  AND resolved.occurred_at >= (",
    `    (${escapeSqlStringLiteral(dateRange.from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND resolved.occurred_at < (",
    `    (${escapeSqlStringLiteral(dateRange.to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    ...buildExcludedActorSqlLines("resolved.actor_id::text"),
    "ORDER BY ui_locale ASC",
  ].join("\n");
}

// Every deck version somebody ever completed an install of, read through the same install-only
// lifetime fragment the installed-deck filter reads, so a legacy install and an install whose click
// was never recorded are both offered here. This list and the four below are the one group of option
// lists the selected range does not scope, because neither the installed-deck filter nor the
// click-attribution filter is scoped by it either. What this offers is a strict subset of what the
// installed-deck filter matches, because it restates the exclusions below and that filter restates
// none of them.
//
// The delisted `test` fixture of `db/migrations/0111_delist_catalog_test_fixture.sql` is left out
// here, as it is everywhere a deck is named.
function buildAnalyticsFilterOptionCatalogDecksSql(): string {
  return [
    "SELECT",
    "  installed_decks.package_version_id AS package_version_id,",
    // One row per deck version whatever its installs recorded, so a version cannot be offered twice
    // under two slugs, and a version whose installs named no slug is still offered.
    "  COALESCE(MIN(installed_decks.package_slug), 'Unknown deck') AS package_slug",
    "FROM (",
    buildCatalogInstalledDeckVersionsSql(),
    ") AS installed_decks",
    // `package_version_id` is optional on the install event, so an install that named no version
    // names no deck anybody can pick, and a NULL here would reach the string assertion that reads
    // this list in `loadAnalyticsFilterOptions` and fail the whole load.
    "WHERE installed_decks.package_version_id IS NOT NULL",
    "  AND installed_decks.package_slug IS DISTINCT FROM 'test'",
    ...buildExcludedActorSqlLines("installed_decks.actor_id::text"),
    "GROUP BY installed_decks.package_version_id",
    // Ordered on the aggregate itself rather than on the output name it shares with an ungrouped
    // input column, which would leave the sort to Postgres ambiguity resolution.
    "ORDER BY COALESCE(MIN(installed_decks.package_slug), 'Unknown deck') ASC,",
    "  installed_decks.package_version_id ASC",
  ].join("\n");
}

// Every value one catalog attribution dimension carried on the attributed click of a completed
// install, read through the same lifetime fragment the four click-dimension predicates read, so this
// list is unscoped by the selected range exactly as they are and offers exactly the values they can
// match. Nothing is restated here: that fragment already applies the `test` slug guard and
// `buildExcludedActorSqlLines` inside, so the list and the predicates share one set of exclusions.
// A NULL is not offered: no selection can match it, and a person whose attributed clicks recorded only
// NULLs is exactly the person a narrowed field drops.
function buildAnalyticsFilterOptionCatalogAttributionSql(columnSqlName: string): string {
  return [
    `SELECT DISTINCT install_attribution.${columnSqlName} AS option_value`,
    "FROM (",
    buildCatalogInstallAttributionSql(),
    ") AS install_attribution",
    `WHERE install_attribution.${columnSqlName} IS NOT NULL`,
    "ORDER BY option_value ASC",
  ].join("\n");
}

/**
 * The declared values of one closed attribution dimension that the data actually carries.
 *
 * A value outside the declared list is skipped rather than raised. A value that is never offered can
 * never be selected, so dropping it costs one popover entry and makes nothing on screen lie, while
 * raising here would blank both General and Audience whole: this list loads in the same `Promise.all`
 * as every report of both areas, and because it is not scoped by the range no date selection could
 * dodge the offending row.
 */
function buildCatalogAttributionEnumOptions<Value extends string>(
  resultSet: AdminQueryResultSet,
  declaredValues: ReadonlyArray<Value>,
  fieldName: string,
): ReadonlyArray<Value> {
  return resultSet.rows.flatMap((row) => {
    const optionValue = assertIsString(row.option_value ?? null, optionsReportLabel, fieldName);

    return declaredValues.includes(optionValue as Value) ? [optionValue as Value] : [];
  });
}

function buildUserOptions(resultSet: AdminQueryResultSet): ReadonlyArray<ReviewEventsByDateUser> {
  return resultSet.rows
    .map((row) => ({
      userId: assertIsString(row.user_id ?? null, optionsReportLabel, "user_id"),
      email: assertIsString(row.email ?? null, optionsReportLabel, "email"),
      totalReviewEvents: toInteger(row.review_event_count ?? null, optionsReportLabel, "review_event_count"),
    }))
    .sort((left, right) => {
      if (right.totalReviewEvents !== left.totalReviewEvents) {
        return right.totalReviewEvents - left.totalReviewEvents;
      }

      return getUserFilterLabel(left).localeCompare(getUserFilterLabel(right));
    });
}

function requireResultSet(
  resultSets: ReadonlyArray<AdminQueryResultSet>,
  index: number,
  resultSetLabel: string,
): AdminQueryResultSet {
  const resultSet = resultSets[index];
  if (resultSet === undefined) {
    throw new Error(`${optionsReportLabel} ${resultSetLabel} result set is missing.`);
  }

  return resultSet;
}

export async function loadAnalyticsFilterOptions(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  signal: AbortSignal,
): Promise<AnalyticsFilterOptions> {
  assertValidDateRange(dateRange, optionsReportLabel);
  const optionListSql = [
    buildAnalyticsFilterOptionUsersSql(dateRange),
    buildAnalyticsFilterOptionPackagesSql(dateRange),
    buildAnalyticsFilterOptionCountriesSql(dateRange),
    buildAnalyticsFilterOptionAppUiLanguagesSql(dateRange),
    buildAnalyticsFilterOptionCatalogDecksSql(),
    buildAnalyticsFilterOptionCatalogAttributionSql("placement"),
    buildAnalyticsFilterOptionCatalogAttributionSql("source"),
    buildAnalyticsFilterOptionCatalogAttributionSql("device_category"),
    buildAnalyticsFilterOptionCatalogAttributionSql("device_locale"),
  ];
  const response = await runAdminQuery(config, optionListSql.join(";\n"), signal);
  if (response.resultSets.length !== optionListSql.length) {
    throw new Error(`${optionsReportLabel} must return exactly ${optionListSql.length} result sets. Got ${response.resultSets.length}.`);
  }
  const resultSets = response.resultSets;

  return {
    generatedAtUtc: response.executedAtUtc,
    users: buildUserOptions(requireResultSet(resultSets, 0, "user")),
    catalogPackageSlugs: requireResultSet(resultSets, 1, "package").rows.map(
      (row) => assertIsString(row.package_slug ?? null, optionsReportLabel, "package_slug"),
    ),
    connectionCountries: requireResultSet(resultSets, 2, "connection country").rows.map(
      (row) => assertIsString(row.country ?? null, optionsReportLabel, "country"),
    ),
    appUiLanguages: requireResultSet(resultSets, 3, "app UI language").rows.map(
      (row) => assertIsString(row.ui_locale ?? null, optionsReportLabel, "ui_locale"),
    ),
    catalogDecks: requireResultSet(resultSets, 4, "catalog deck").rows.map((row) => ({
      packageVersionId: assertIsString(
        row.package_version_id ?? null,
        optionsReportLabel,
        "package_version_id",
      ),
      packageSlug: assertIsString(row.package_slug ?? null, optionsReportLabel, "package_slug"),
    })),
    catalogPlacements: buildCatalogAttributionEnumOptions(
      requireResultSet(resultSets, 5, "catalog placement"),
      catalogInstallPlacements,
      "placement",
    ),
    catalogSources: buildCatalogAttributionEnumOptions(
      requireResultSet(resultSets, 6, "catalog source"),
      siteSources,
      "source",
    ),
    catalogDeviceCategories: buildCatalogAttributionEnumOptions(
      requireResultSet(resultSets, 7, "catalog device category"),
      siteDeviceCategories,
      "device_category",
    ),
    catalogClickBrowserLanguages: requireResultSet(resultSets, 8, "catalog click browser language")
      .rows.map((row) => assertIsString(row.option_value ?? null, optionsReportLabel, "device_locale")),
  };
}

const siteVisitorOptionsReportLabel = "Web engaged filter options";

// Every value the three data-driven site fields can match inside the range, read off every page view
// any chart of the Web engaged page reads: the traffic categories chart counts the visitors the series
// drops too, so a value only they carry is still a segment there. Values are read as the charts
// segment them, so Unknown is offered whenever a view lacks one. Any view offers its values, not only
// a visitor's first, because finding first views per bucket would cost the whole engagement query
// for one popover; a value only later views carry matches nobody.
function buildSiteVisitorFilterOptionsSql(dateRange: AnalyticsDateRange): string {
  const buildViewValuesSql = (rowAlias: string, rowsSql: string): string => [
    "  SELECT",
    siteVisitorOptionFields
      .map((field) => `    ${buildSiteVisitorFilterValueSql(field, rowAlias)} AS "${field}"`)
      .join(",\n"),
    `  FROM analytics.product_events_resolved AS ${rowAlias}`,
    `  WHERE ${rowsSql}`,
  ].join("\n");

  return [
    "WITH site_view_values AS (",
    buildViewValuesSql("site_view", buildIdentifiedSiteViewRowsSql("site_view", dateRange)),
    "  UNION ALL",
    buildViewValuesSql("hashed_view", buildHashedSiteViewRowsSql("hashed_view", dateRange)),
    ")",
    "SELECT DISTINCT option_values.field_name, option_values.option_value",
    "FROM site_view_values",
    "CROSS JOIN LATERAL (VALUES",
    siteVisitorOptionFields
      .map((field) => `  (${escapeSqlStringLiteral(field)}, site_view_values."${field}")`)
      .join(",\n"),
    ") AS option_values(field_name, option_value)",
    "ORDER BY option_values.field_name, option_values.option_value",
  ].join("\n");
}

function isSiteVisitorOptionField(value: string): value is SiteVisitorOptionField {
  return (siteVisitorOptionFields as ReadonlyArray<string>).includes(value);
}

/** Loaded by the Web engaged page alone, deliberately independent of its current selection. */
export async function loadSiteVisitorFilterOptions(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  signal: AbortSignal,
): Promise<SiteVisitorFilterOptions> {
  const range = assertValidDateRange(dateRange, siteVisitorOptionsReportLabel);
  const response = await runAdminQuery(config, buildSiteVisitorFilterOptionsSql(range), signal);
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${siteVisitorOptionsReportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  const optionsByField: Record<SiteVisitorOptionField, Array<string>> = {
    siteCountries: [],
    siteBrowserLanguages: [],
    sitePageKinds: [],
  };
  for (const row of result.rows) {
    const fieldName = assertIsString(row.field_name ?? null, siteVisitorOptionsReportLabel, "field_name");
    if (isSiteVisitorOptionField(fieldName) === false) {
      throw new Error(`${siteVisitorOptionsReportLabel} returned an unknown field_name ${fieldName}.`);
    }
    optionsByField[fieldName].push(assertIsString(row.option_value ?? null, siteVisitorOptionsReportLabel, "option_value"));
  }

  return optionsByField;
}

const appVersionOptionsReportLabel = "App version filter options";

// Every version a trusted `app_opened` of the range recorded, the rows the Level 1 version filter reads,
// after the shared exclusions. A NULL or empty version is not offered: no selection can match it.
function buildAppVersionFilterOptionsSql(dateRange: AnalyticsDateRange): string {
  return [
    "SELECT DISTINCT resolved.app_version AS app_version",
    "FROM analytics.product_events_resolved AS resolved",
    "WHERE resolved.event_name = 'app_opened'",
    "  AND resolved.app_version <> ''",
    "  AND resolved.actor_id IS NOT NULL",
    `  AND ${buildTrustedActorRowsFilterSql("resolved.trust_level")}`,
    "  AND resolved.occurred_at >= (",
    `    (${escapeSqlStringLiteral(dateRange.from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND resolved.occurred_at < (",
    `    (${escapeSqlStringLiteral(dateRange.to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    ...buildExcludedActorSqlLines("resolved.actor_id::text"),
  ].join("\n");
}

/** Loaded by the Level 1 bar, newest version first, comparing dotted parts as numbers so 1.10 follows 1.9. */
export async function loadAppVersionFilterOptions(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  signal: AbortSignal,
): Promise<ReadonlyArray<string>> {
  const range = assertValidDateRange(dateRange, appVersionOptionsReportLabel);
  const response = await runAdminQuery(config, buildAppVersionFilterOptionsSql(range), signal);
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${appVersionOptionsReportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  return result.rows
    .map((row) => assertIsString(row.app_version ?? null, appVersionOptionsReportLabel, "app_version"))
    .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
}

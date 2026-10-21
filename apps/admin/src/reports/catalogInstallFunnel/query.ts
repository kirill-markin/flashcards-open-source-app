import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorSqlLines,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { firstLaunchEngagedReviewThreshold } from "../firstLaunchFunnel/query";
import {
  buildHashedPageViewFilterSqlLines,
  buildHashedSiteVisitorRowSqlLines,
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

/** One count per step, as `buildCatalogInstallFunnelSql` defines them. */
export type CatalogInstallFunnelReport = Readonly<{
  deckPageViewerCount: number;
  installClickerCount: number;
  installerCount: number;
  oneReviewInstallerCount: number;
  twoReviewsInstallerCount: number;
  twoReviewDaysInstallerCount: number;
  engagedReturningInstallerCount: number;
  /** Installers whose first install in range is younger than the window, so their review steps are still filling in. */
  maturingInstallerCount: number;
}>;

export type CatalogInstallFunnelRange = Readonly<{
  from: string;
  to: string;
}>;

/**
 * An identified view of a deck's marketing-site page, as `AND`-joined predicates on `rowAlias`. The
 * site reports its facts only through the credential-free collector, under the visitor cookie, and
 * sends `package_version_id` only on a `catalog_package` page; a browser that refused consent resolves
 * to a NULL actor.
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

/**
 * The two marketing-site steps, a deck page view and an install click, as one predicate on
 * `rowAlias`, each naming its deck version. Only a `catalog_package` page names a deck.
 */
function buildSiteStepRowSql(rowAlias: string): string {
  return [
    "(",
    `      (${rowAlias}.event_name = 'site_page_viewed' AND ${rowAlias}.event_properties ->> 'page_kind' = 'catalog_package')`,
    `      OR ${rowAlias}.event_name = 'catalog_install_clicked'`,
    "    )",
    `    AND ${rowAlias}.event_properties ->> 'package_version_id' IS NOT NULL`,
  ].join("\n");
}

/**
 * Rejects a row of the delisted `test` deck (`db/migrations/0111_delist_catalog_test_fixture.sql`) by
 * its own deck version. `NOT EXISTS` keeps a legacy server install that names no version.
 */
function buildTestDeckFilterSqlLines(packageVersionIdSqlExpression: string): ReadonlyArray<string> {
  return [
    "    AND NOT EXISTS (",
    "      SELECT 1",
    "      FROM catalog.package_versions AS test_deck_version",
    "      INNER JOIN catalog.packages AS test_deck",
    "        ON test_deck.package_id = test_deck_version.package_id",
    "      WHERE test_deck.slug = 'test'",
    `        AND test_deck_version.package_version_id::text = ${packageVersionIdSqlExpression}`,
    "    )",
  ];
}

/**
 * The rules an identified row's actor answers: the shared exclusion rule, and the connection country
 * and app interface language, which keep an actor the way they keep a person on General.
 */
function buildActorFilterSqlLines(
  actorIdSqlExpression: string,
  filters: AnalyticsFilterState,
): ReadonlyArray<string> {
  return [
    ...buildExcludedActorSqlLines(actorIdSqlExpression),
    `    AND ${buildConnectionCountriesFilterSql(actorIdSqlExpression, filters.connectionCountries, filters.dateRange)}`,
    `    AND ${buildAppUiLanguagesFilterSql(actorIdSqlExpression, filters.appUiLanguages, filters.dateRange)}`,
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

/** One site step's distinct identities: identified actors plus cookieless visitors, two disjoint sets. */
function buildSiteStepCountSql(eventName: string): string {
  return [
    "  (",
    "    (",
    "      SELECT COUNT(DISTINCT identified.actor_id)",
    "      FROM identified_site_rows AS identified",
    `      WHERE identified.event_name = ${escapeSqlStringLiteral(eventName)}`,
    "    ) + (",
    "      SELECT COUNT(DISTINCT (hashed.daily_visitor_hash, hashed.visitor_day))",
    "      FROM hashed_site_rows AS hashed",
    `      WHERE hashed.event_name = ${escapeSqlStringLiteral(eventName)}`,
    "    )",
    "  )::int",
  ].join("\n");
}

/**
 * One row of step counts over the selected UTC days from `catalogInstallFunnelStartDate` on.
 *
 * THE FIRST THREE STEPS ARE EACH COUNTED ON THEIR OWN: no identity link, order or time window joins
 * them, so a later step can exceed an earlier one. Most visitors carry no stable identity - a
 * cookieless view and click arrive under a daily hash, and the install that follows names a fresh web
 * guest - so linking the steps would lose those installs. A site step counts the row's `actor_id`, or
 * for a cookieless row its daily hash on that hash's salt day. The install step counts the actors of server-origin `catalog_deck_installed`; every install comes
 * through the web import page, the only caller of the install route, so no entry path is required.
 *
 * ONLY THE REVIEW STEPS ARE LINKED, to the installer: their `review_answered` rows from their first
 * install in range to `catalogInstallConversionWindowDays` after it. `review_answered` names no deck
 * or card, so these are the person's reviews anywhere in the product, never deck-level retention.
 *
 * The client platform narrows only the site rows; a server install carries none, so it narrows
 * neither the install nor the review steps.
 */
export function buildCatalogInstallFunnelSql(filters: AnalyticsFilterState): string {
  const { from: selectedFrom, to } = assertValidDateRange(filters.dateRange, catalogInstallFunnelReportLabel);
  // A range ending before the start date leaves `from` after `to`, so nothing counts.
  const from = laterCalendarDate(selectedFrom, catalogInstallFunnelStartDate);
  const rangeStartSql = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  const reviewWindowEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`;
  const windowSql = `INTERVAL '${catalogInstallConversionWindowDays} days'`;
  const platformSql = "COALESCE(site_row.platform, 'unattributed')";

  return [
    "WITH identified_site_rows AS MATERIALIZED (",
    "  SELECT site_row.event_name, site_row.actor_id",
    "  FROM analytics.product_events_resolved AS site_row",
    `  WHERE ${buildSiteStepRowSql("site_row")}`,
    "    AND site_row.origin = 'client'",
    "    AND site_row.trust_level = 'anonymous_client'",
    "    AND site_row.actor_id IS NOT NULL",
    `    AND site_row.occurred_at >= ${rangeStartSql}`,
    `    AND site_row.occurred_at < ${rangeEndSql}`,
    `    AND ${buildEventPlatformsFilterSql(platformSql, filters.eventPlatforms)}`,
    ...buildTestDeckFilterSqlLines("site_row.event_properties ->> 'package_version_id'"),
    ...buildActorFilterSqlLines("site_row.actor_id::text", filters),
    "), hashed_site_rows AS MATERIALIZED (",
    "  SELECT",
    "    site_row.event_name,",
    "    site_row.daily_visitor_hash,",
    `    ${buildHashedVisitorDaySql("site_row")} AS visitor_day`,
    "  FROM analytics.product_events_resolved AS site_row",
    `  WHERE ${buildSiteStepRowSql("site_row")}`,
    `    AND ${buildHashedSiteVisitorRowSqlLines("site_row").join("\n    AND ")}`,
    `    AND ${buildHashedVisitorDayRangeSqlLines("site_row", from, to).join("\n    AND ")}`,
    `    AND ${buildHashedPageViewFilterSqlLines("site_row", platformSql, filters).join("\n    AND ")}`,
    ...buildTestDeckFilterSqlLines("site_row.event_properties ->> 'package_version_id'"),
    "), installers AS MATERIALIZED (",
    "  SELECT install.actor_id, MIN(install.occurred_at) AS first_installed_at",
    "  FROM analytics.product_events_resolved AS install",
    "  WHERE install.event_name = 'catalog_deck_installed'",
    "    AND install.origin = 'server'",
    "    AND install.actor_id IS NOT NULL",
    `    AND install.occurred_at >= ${rangeStartSql}`,
    `    AND install.occurred_at < ${rangeEndSql}`,
    ...buildTestDeckFilterSqlLines("install.event_properties ->> 'package_version_id'"),
    ...buildActorFilterSqlLines("install.actor_id::text", filters),
    "  GROUP BY install.actor_id",
    // Bounded by the widest window any installer can ask for, so one pass serves all of them.
    "), installer_reviews AS MATERIALIZED (",
    "  SELECT review.actor_id, review.occurred_at",
    "  FROM analytics.product_events_resolved AS review",
    "  WHERE review.event_name = 'review_answered'",
    `    AND ${buildActorMembershipSql("installers", "review.actor_id")}`,
    `    AND review.occurred_at >= ${rangeStartSql}`,
    `    AND review.occurred_at < ${reviewWindowEndSql}`,
    "), installer_engagement AS (",
    "  SELECT",
    "    COUNT(review.occurred_at)::int AS review_count,",
    "    COUNT(DISTINCT (review.occurred_at AT TIME ZONE 'UTC')::date)::int AS review_day_count",
    "  FROM installers AS installer",
    "  INNER JOIN installer_reviews AS review",
    "    ON review.actor_id = installer.actor_id",
    "    AND review.occurred_at >= installer.first_installed_at",
    `    AND review.occurred_at <= installer.first_installed_at + ${windowSql}`,
    "  GROUP BY installer.actor_id",
    ")",
    "SELECT",
    `${buildSiteStepCountSql("site_page_viewed")} AS deck_page_viewer_count,`,
    `${buildSiteStepCountSql("catalog_install_clicked")} AS install_clicker_count,`,
    "  (SELECT COUNT(*) FROM installers)::int AS installer_count,",
    "  (SELECT COUNT(*) FROM installer_engagement WHERE review_count >= 1)::int AS one_review_count,",
    "  (SELECT COUNT(*) FROM installer_engagement WHERE review_count >= 2)::int AS two_reviews_count,",
    "  (SELECT COUNT(*) FROM installer_engagement WHERE review_day_count >= 2)::int AS two_review_days_count,",
    "  (",
    "    SELECT COUNT(*)",
    "    FROM installer_engagement",
    `    WHERE review_count >= ${firstLaunchEngagedReviewThreshold}`,
    "      AND review_day_count >= 3",
    "  )::int AS engaged_returning_count,",
    `  (SELECT COUNT(*) FROM installers WHERE first_installed_at + ${windowSql} > now())::int AS maturing_installer_count`,
  ].join("\n");
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
  if (response.resultSets.length !== 1) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} must return exactly one result set. Got ${response.resultSets.length}.`,
    );
  }

  const resultSet = response.resultSets[0];
  const row = resultSet?.rows[0];
  if (resultSet === undefined || row === undefined || resultSet.rows.length !== 1) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} must return exactly one row. Got ${resultSet?.rows.length ?? 0}.`,
    );
  }

  const count = (fieldName: string): number => (
    toInteger(row[fieldName] ?? null, catalogInstallFunnelReportLabel, fieldName)
  );
  return {
    deckPageViewerCount: count("deck_page_viewer_count"),
    installClickerCount: count("install_clicker_count"),
    installerCount: count("installer_count"),
    oneReviewInstallerCount: count("one_review_count"),
    twoReviewsInstallerCount: count("two_reviews_count"),
    twoReviewDaysInstallerCount: count("two_review_days_count"),
    engagedReturningInstallerCount: count("engaged_returning_count"),
    maturingInstallerCount: count("maturing_installer_count"),
  };
}

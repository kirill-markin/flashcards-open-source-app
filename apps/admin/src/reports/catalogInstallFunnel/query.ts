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
export const catalogInstallActivationWindowHours = 24;

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

export type CatalogInstallFunnelReport = Readonly<{
  observedAtUtc: string;
  deckPageViewerCount: number;
  installClickerCount: number;
  installerCount: number;
  cookielessDeckPageViewerCount: number;
  cookielessInstallClickerCount: number;
  cohortClickerCount: number;
  attributedInstallerCount: number;
  activatedClickerCount: number;
  maturingClickerCount: number;
  matureRepeatClickerCount: number;
  oneReviewClickerCount: number;
  twoReviewsClickerCount: number;
  twoReviewDaysClickerCount: number;
  engagedReturningClickerCount: number;
}>;

export type CatalogInstallFunnelRange = Readonly<{
  from: string;
  to: string;
}>;

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
    `WHERE (${buildDeckPageViewSql("resolved")})`,
    "  OR (resolved.event_name = 'catalog_install_clicked'",
    "    AND resolved.origin = 'client' AND resolved.trust_level = 'anonymous_client'",
    "    AND resolved.platform = 'web' AND resolved.actor_id IS NOT NULL",
    "    AND resolved.anonymous_id IS NOT NULL",
    "    AND resolved.anonymous_id::text IS DISTINCT FROM resolved.event_properties ->> 'install_journey_id'",
    "    AND NULLIF(resolved.event_properties ->> 'package_version_id', '') IS NOT NULL)",
  ].join("\n");
}

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
 * First-ever eligible clicks are selected before the range and audience filters. Follow-up is
 * local to that click's browser: guest observations never create a global identity link.
 */
export function buildCatalogInstallFunnelSql(filters: AnalyticsFilterState): string {
  const { from: selectedFrom, to } = assertValidDateRange(filters.dateRange, catalogInstallFunnelReportLabel);
  const from = laterCalendarDate(selectedFrom, catalogInstallFunnelStartDate);
  const rangeStartSql = `(${escapeSqlStringLiteral(selectedFrom)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const coverageStartSql = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  const followUpEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`;
  const repeatWindowSql = `INTERVAL '${catalogInstallConversionWindowDays} days'`;
  const activationWindowSql = `INTERVAL '${catalogInstallActivationWindowHours} hours'`;
  const platformSql = "COALESCE(site_row.platform, 'unattributed')";

  return [
    "WITH identified_site_rows AS MATERIALIZED (",
    "  SELECT site_row.event_name, site_row.actor_id",
    "  FROM analytics.product_events_resolved AS site_row",
    `  WHERE ${buildSiteStepRowSql("site_row")}`,
    "    AND site_row.origin = 'client'",
    "    AND site_row.trust_level = 'anonymous_client'",
    "    AND site_row.actor_id IS NOT NULL",
    `    AND site_row.occurred_at >= ${coverageStartSql}`,
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
    `    AND install.occurred_at >= ${coverageStartSql}`,
    `    AND install.occurred_at < ${rangeEndSql}`,
    ...buildTestDeckFilterSqlLines("install.event_properties ->> 'package_version_id'"),
    ...buildActorFilterSqlLines("install.actor_id::text", filters),
    "  GROUP BY install.actor_id",
    "), first_clicks AS MATERIALIZED (",
    "  SELECT DISTINCT ON (click.actor_id)",
    "    click.actor_id, click.anonymous_id, click.occurred_at AS clicked_at, click.platform,",
    "    click.event_properties ->> 'package_version_id' AS package_version_id",
    "  FROM analytics.product_events_resolved AS click",
    "  WHERE click.event_name = 'catalog_install_clicked'",
    "    AND click.origin = 'client'",
    "    AND click.trust_level = 'anonymous_client'",
    "    AND click.platform = 'web'",
    "    AND click.actor_id IS NOT NULL",
    "    AND click.anonymous_id IS NOT NULL",
    "    AND click.anonymous_id::text IS DISTINCT FROM click.event_properties ->> 'install_journey_id'",
    "    AND NULLIF(click.event_properties ->> 'package_version_id', '') IS NOT NULL",
    `    AND click.occurred_at < LEAST(${rangeEndSql}, now())`,
    ...buildTestDeckFilterSqlLines("click.event_properties ->> 'package_version_id'"),
    "  ORDER BY click.actor_id, click.occurred_at, click.event_id",
    "), cohort AS MATERIALIZED (",
    "  SELECT click.*",
    "  FROM first_clicks AS click",
    `  WHERE click.clicked_at >= ${rangeStartSql}`,
    `    AND ${buildEventPlatformsFilterSql("click.platform", filters.eventPlatforms)}`,
    ...buildActorFilterSqlLines("click.actor_id::text", filters),
    "), browser_observations AS MATERIALIZED (",
    "  SELECT observation.actor_id, observation.anonymous_id, observation.occurred_at,",
    "    observation.origin, observation.event_properties ->> 'package_version_id' AS package_version_id",
    "  FROM analytics.product_events_resolved AS observation",
    // Uncorrelated membership avoids a pass over the resolved view per cohort member.
    "  WHERE observation.anonymous_id = ANY (ARRAY(SELECT anonymous_id FROM cohort))",
    "    AND observation.actor_id IS NOT NULL",
    `    AND observation.occurred_at >= ${rangeStartSql}`,
    `    AND observation.occurred_at < LEAST(${followUpEndSql}, now())`,
    "    AND (",
    "      (observation.origin = 'client' AND observation.platform = 'web'",
    "        AND observation.trust_level IN ('guest_client', 'authenticated_client'))",
    "      OR (observation.origin = 'server' AND observation.event_name = 'catalog_deck_installed')",
    "    )",
    ...buildExcludedActorSqlLines("observation.actor_id::text"),
    "), actor_associations AS MATERIALIZED (",
    "  SELECT click_actor, study_actor, MIN(observed_at) AS observed_at",
    "  FROM (",
    "    SELECT actor_id AS click_actor, actor_id AS study_actor, clicked_at AS observed_at FROM cohort",
    "    UNION ALL",
    "    SELECT click.actor_id, observation.actor_id, observation.occurred_at",
    "    FROM cohort AS click",
    "    INNER JOIN browser_observations AS observation",
    "      ON observation.anonymous_id = click.anonymous_id",
    "      AND observation.occurred_at >= click.clicked_at",
    `      AND observation.occurred_at <= click.clicked_at + ${repeatWindowSql}`,
    "      AND (observation.origin = 'client' OR observation.package_version_id = click.package_version_id)",
    "  ) AS associations",
    "  GROUP BY click_actor, study_actor",
    "), install_rows AS MATERIALIZED (",
    "  SELECT install.actor_id, install.occurred_at,",
    "    install.event_properties ->> 'package_version_id' AS package_version_id",
    "  FROM analytics.product_events_resolved AS install",
    "  WHERE install.event_name = 'catalog_deck_installed' AND install.origin = 'server'",
    "    AND install.actor_id = ANY (ARRAY(SELECT study_actor FROM actor_associations))",
    `    AND install.occurred_at >= ${rangeStartSql}`,
    `    AND install.occurred_at < LEAST(${followUpEndSql}, now())`,
    ...buildExcludedActorSqlLines("install.actor_id::text"),
    "), attributed_installs AS MATERIALIZED (",
    "  SELECT click.actor_id, MIN(install.occurred_at) AS installed_at",
    "  FROM cohort AS click",
    "  INNER JOIN actor_associations AS association ON association.click_actor = click.actor_id",
    `    AND association.observed_at <= click.clicked_at + ${activationWindowSql}`,
    "  INNER JOIN install_rows AS install ON install.actor_id = association.study_actor",
    "    AND install.package_version_id = click.package_version_id",
    "    AND install.occurred_at >= click.clicked_at",
    `    AND install.occurred_at <= click.clicked_at + ${activationWindowSql}`,
    "  GROUP BY click.actor_id",
    "), review_rows AS MATERIALIZED (",
    "  SELECT review.event_id, review.actor_id, review.occurred_at",
    "  FROM analytics.product_events_resolved AS review",
    "  WHERE review.event_name = 'review_answered'",
    "    AND review.trust_level IN ('server_derived', 'backfill_derived')",
    "    AND review.actor_id = ANY (ARRAY(SELECT study_actor FROM actor_associations))",
    `    AND review.occurred_at >= ${rangeStartSql}`,
    `    AND review.occurred_at < LEAST(${followUpEndSql}, now())`,
    ...buildExcludedActorSqlLines("review.actor_id::text"),
    "), outcomes AS MATERIALIZED (",
    "  SELECT click.actor_id,",
    `    click.clicked_at + ${activationWindowSql} > now() AS maturing24,`,
    `    click.clicked_at + ${repeatWindowSql} <= now() AS mature7,`,
    "    install.installed_at IS NOT NULL AS installed24,",
    "    COUNT(DISTINCT review.event_id) FILTER (",
    `      WHERE association.observed_at <= click.clicked_at + ${activationWindowSql}`,
    "        AND review.occurred_at >= install.installed_at",
    `        AND review.occurred_at <= click.clicked_at + ${activationWindowSql}`,
    "    ) > 0 AS activated24,",
    "    COUNT(DISTINCT review.event_id)::int AS review_count7,",
    "    COUNT(DISTINCT (review.occurred_at AT TIME ZONE 'UTC')::date)::int AS review_days7",
    "  FROM cohort AS click",
    "  LEFT JOIN attributed_installs AS install ON install.actor_id = click.actor_id",
    "  LEFT JOIN actor_associations AS association ON association.click_actor = click.actor_id",
    "  LEFT JOIN review_rows AS review ON review.actor_id = association.study_actor",
    "    AND review.occurred_at >= click.clicked_at",
    `    AND review.occurred_at <= click.clicked_at + ${repeatWindowSql}`,
    "  GROUP BY click.actor_id, click.clicked_at, install.installed_at",
    ")",
    "SELECT",
    "  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC' AS observed_at_utc,",
    `${buildSiteStepCountSql("site_page_viewed")} AS deck_page_viewer_count,`,
    `${buildSiteStepCountSql("catalog_install_clicked")} AS install_clicker_count,`,
    "  (SELECT COUNT(*) FROM installers)::int AS installer_count,",
    "  (SELECT COUNT(DISTINCT (daily_visitor_hash, visitor_day)) FROM hashed_site_rows",
    "    WHERE event_name = 'site_page_viewed')::int AS cookieless_deck_page_viewer_count,",
    "  (SELECT COUNT(DISTINCT (daily_visitor_hash, visitor_day)) FROM hashed_site_rows",
    "    WHERE event_name = 'catalog_install_clicked')::int AS cookieless_install_clicker_count,",
    "  COUNT(*)::int AS cohort_clicker_count,",
    "  COUNT(*) FILTER (WHERE installed24)::int AS attributed_installer_count,",
    "  COUNT(*) FILTER (WHERE activated24)::int AS activated_clicker_count,",
    "  COUNT(*) FILTER (WHERE maturing24)::int AS maturing_clicker_count,",
    "  COUNT(*) FILTER (WHERE mature7)::int AS mature_repeat_clicker_count,",
    "  COUNT(*) FILTER (WHERE mature7 AND review_count7 >= 1)::int AS one_review_clicker_count,",
    "  COUNT(*) FILTER (WHERE mature7 AND review_count7 >= 2)::int AS two_reviews_clicker_count,",
    "  COUNT(*) FILTER (WHERE mature7 AND review_days7 >= 2)::int AS two_review_days_clicker_count,",
    `  COUNT(*) FILTER (WHERE mature7 AND review_count7 >= ${firstLaunchEngagedReviewThreshold}`,
    "    AND review_days7 >= 3)::int AS engaged_returning_clicker_count",
    "FROM outcomes",
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
    observedAtUtc: assertIsString(row.observed_at_utc ?? null, catalogInstallFunnelReportLabel, "observed_at_utc"),
    deckPageViewerCount: count("deck_page_viewer_count"),
    installClickerCount: count("install_clicker_count"),
    installerCount: count("installer_count"),
    cookielessDeckPageViewerCount: count("cookieless_deck_page_viewer_count"),
    cookielessInstallClickerCount: count("cookieless_install_clicker_count"),
    cohortClickerCount: count("cohort_clicker_count"),
    attributedInstallerCount: count("attributed_installer_count"),
    activatedClickerCount: count("activated_clicker_count"),
    maturingClickerCount: count("maturing_clicker_count"),
    matureRepeatClickerCount: count("mature_repeat_clicker_count"),
    oneReviewClickerCount: count("one_review_clicker_count"),
    twoReviewsClickerCount: count("two_reviews_clicker_count"),
    twoReviewDaysClickerCount: count("two_review_days_clicker_count"),
    engagedReturningClickerCount: count("engaged_returning_clicker_count"),
  };
}

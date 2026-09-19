import { runAdminQuery } from "../../adminApi";
import type {
  AdminQueryResultSet,
  AdminQueryValue,
  CatalogInstallsPackage,
  CatalogInstallsReport,
  CatalogInstallsRow,
  CatalogInstallsUser,
  ReviewEventPlatform,
} from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildCatalogAttributionFiltersSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorsFilterSql,
  buildMinimumEventCountsFilterSql,
  buildUserCohortsFilterSql,
  buildUsersFilterSql,
  isEveryUserCohortSelected,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import {
  assertIsString,
  assertPlatform,
  assertValidDateRange,
  toInteger,
} from "../reportValues";

export const catalogInstallsReportLabel = "Catalog deck installs report";

type CatalogInstallsQueryRow = Readonly<{
  install_date: string;
  user_id: string;
  email: string;
  platform: ReviewEventPlatform;
  package_slug: string;
  install_count: string | number;
  card_count: string | number;
}>;

type CatalogInstallsAggregateFields = Readonly<Pick<
  CatalogInstallsReport,
  "totalInstalls" | "users" | "packages"
>>;

function toCatalogInstallsQueryRow(
  resultSetRow: Readonly<Record<string, AdminQueryValue>>,
): CatalogInstallsQueryRow {
  return {
    install_date: assertIsString(resultSetRow.install_date ?? null, catalogInstallsReportLabel, "install_date"),
    user_id: assertIsString(resultSetRow.user_id ?? null, catalogInstallsReportLabel, "user_id"),
    email: assertIsString(resultSetRow.email ?? null, catalogInstallsReportLabel, "email"),
    platform: assertPlatform(resultSetRow.platform ?? null, catalogInstallsReportLabel, "platform"),
    package_slug: assertIsString(resultSetRow.package_slug ?? null, catalogInstallsReportLabel, "package_slug"),
    install_count: toInteger(resultSetRow.install_count ?? null, catalogInstallsReportLabel, "install_count"),
    card_count: toInteger(resultSetRow.card_count ?? null, catalogInstallsReportLabel, "card_count"),
  };
}

function buildCatalogInstallsUsers(
  rows: ReadonlyArray<CatalogInstallsRow>,
): ReadonlyArray<CatalogInstallsUser> {
  const usersByUserId = new Map<string, CatalogInstallsUser>();

  for (const row of rows) {
    const existingUser = usersByUserId.get(row.userId);
    usersByUserId.set(row.userId, {
      userId: row.userId,
      email: existingUser?.email ?? row.email,
      installCount: (existingUser?.installCount ?? 0) + row.installCount,
    });
  }

  return Array.from(usersByUserId.values()).sort((left, right) => {
    if (right.installCount !== left.installCount) {
      return right.installCount - left.installCount;
    }

    const leftLabel = left.email === "(no email)" ? left.userId : left.email;
    const rightLabel = right.email === "(no email)" ? right.userId : right.email;
    return leftLabel.localeCompare(rightLabel);
  });
}

/** Ordered by installs, so the chart stacks the most installed deck at the bottom of every column. */
function buildCatalogInstallsPackages(
  rows: ReadonlyArray<CatalogInstallsRow>,
): ReadonlyArray<CatalogInstallsPackage> {
  const installCountsByPackageSlug = new Map<string, number>();

  for (const row of rows) {
    installCountsByPackageSlug.set(
      row.packageSlug,
      (installCountsByPackageSlug.get(row.packageSlug) ?? 0) + row.installCount,
    );
  }

  return Array.from(installCountsByPackageSlug.entries())
    .map(([packageSlug, installCount]) => ({ packageSlug, installCount }))
    .sort((left, right) => {
      if (right.installCount !== left.installCount) {
        return right.installCount - left.installCount;
      }

      return left.packageSlug.localeCompare(right.packageSlug);
    });
}

function buildCatalogInstallsAggregateFields(
  rows: ReadonlyArray<CatalogInstallsRow>,
): CatalogInstallsAggregateFields {
  return {
    totalInstalls: rows.reduce((total, row) => total + row.installCount, 0),
    users: buildCatalogInstallsUsers(rows),
    packages: buildCatalogInstallsPackages(rows),
  };
}

function buildCatalogInstallsReport(
  resultSet: AdminQueryResultSet,
  executedAtUtc: string,
  from: string,
  to: string,
): CatalogInstallsReport {
  const rows = resultSet.rows
    .map(toCatalogInstallsQueryRow)
    .map((row) => ({
      date: row.install_date,
      userId: row.user_id,
      email: row.email,
      platform: row.platform,
      packageSlug: row.package_slug,
      installCount: toInteger(row.install_count, catalogInstallsReportLabel, "install_count"),
      cardCount: toInteger(row.card_count, catalogInstallsReportLabel, "card_count"),
    }));

  return {
    generatedAtUtc: executedAtUtc,
    from,
    to,
    ...buildCatalogInstallsAggregateFields(rows),
    rows,
  };
}

// The side one install takes, NULL when the installer has no first active day to compare it against.
// A NULL never satisfies the cohort `IN` list, so the "neither side" case is decided entirely by the
// predicate that guards it.
const catalogInstallCohortSqlExpression = [
  "CASE",
  "  WHEN installer_first_active_date.first_active_date IS NULL THEN NULL",
  "  WHEN installer_first_active_date.first_active_date = deck_installs.install_date THEN 'new'",
  "  ELSE 'returning'",
  "END",
].join(" ");

// Per-actor catalog deck installs for the admin "Catalog deck installs" section. One install action
// by one person is one event, and one row is one (UTC date, actor, package slug).
//
// The shape mirrors `buildReviewEventsByDateSql`: the `org.user_settings` email join folded with
// `pg_catalog.lower` because `actor_id` renders canonical lowercase hex while
// `org.user_settings.user_id` is an unconstrained TEXT primary key, the `%@example.com` exclusion
// restated inline because this package cannot import
// `exampleComEmailExclusionSqlFragments` from `apps/backend/src/globalMetrics/reporting.ts`, and
// grouping by `actor_id` so a guest and the account that guest became are one person. Unlike that
// query the install CTE is bounded on both sides, because an install's cohort is not derived from a
// first-install day at all.
//
// NEW VERSUS RETURNING IS THE INSTALLER'S FIRST `app_opened` DAY, which is the cohort definition of
// the daily active users section rather than one of this section's own, so the two sections cannot
// disagree about which day a person was new on. `installer_first_active_date` recreates exactly what
// that section exposes: each installer's first `app_opened` day over all history up to the end of the
// range, kept only for installers that have an `app_opened` day INSIDE the range, because that is the
// window the other section reports on.
//
// AN INSTALLER WITH NO `app_opened` DAY INSIDE THE RANGE BELONGS TO NEITHER SIDE. There is no first
// active day to compare the install against, so the row is kept only while both cohorts are selected,
// which is the state the filter row treats as "no cohort filter"; any narrowing drops the row rather
// than guessing a side for it.
//
// EVERYTHING THIS SECTION NEEDS IS ON THE EVENT. `catalog_deck_installed` is server-only and carries
// `package_slug` and `card_count` (`apps/backend/src/productAnalytics/catalog.ts`), emitted after the
// install transaction commits and keyed by `(workspace_id, install_id)` so an idempotent replay
// cannot double count (`apps/backend/src/catalog/distribution/install/index.ts`). No catalog table is
// read, so there are no deck titles or version numbers here and the deck dimension is the slug.
//
// TWO EXCLUSIONS, AND THEY ARE WHY THIS SECTION IS NEARLY EMPTY ON PRODUCTION HISTORY.
//   * The delisted test fixture is dropped by slug `'test'` only, the fixture
//     `db/migrations/0111_delist_catalog_test_fixture.sql` delisted. Package status is not read,
//     because that needs a `catalog` grant this report deliberately does not take.
//   * Installs by active admins are dropped. `auth.admin_users.email` is already lower/btrim
//     normalized by its own CHECK constraint, so only the `org.user_settings` side is folded, and
//     `revoked_at IS NULL` is what an active grant means. `reporting_readonly` reads that column pair
//     through `db/migrations/0125_reporting_readonly_admin_users.sql`; without that grant deployed
//     the whole query fails as HTTP 500 `INTERNAL_ERROR` rather than as a readable permission error.
// Almost every install in production history is an admin install, so a near-empty chart is the
// intended default rather than a defect.
//
// PLATFORM IS ALWAYS `unattributed`. The producer writes NULL on purpose - the install names no
// server-stored replica or guest session row, and the request headers that do name a platform are a
// client claim - and the `0120` backfill wrote none either. The bucket is still derived with the same
// CASE as every other report rather than invented, so the section obeys the shared platform filter,
// which means selecting any device platform empties it.
export function buildCatalogInstallsSql(filters: AnalyticsFilterState): string {
  const dateRange = assertValidDateRange(filters.dateRange, catalogInstallsReportLabel);
  const from = dateRange.from;
  const to = dateRange.to;
  const unknownCohortSelectionSql = isEveryUserCohortSelected(filters) ? "TRUE" : "FALSE";

  return [
    // The range predicate is on the raw `occurred_at` column rather than on its UTC date so
    // `idx_product_events_event_name_occurred_at` stays usable as an (event_name, occurred_at) range
    // scan.
    "WITH deck_installs AS (",
    "  SELECT",
    "    resolved.actor_id::text AS actor_id,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS install_date,",
    "    CASE",
    "      WHEN resolved.platform IN ('web', 'android', 'ios', 'agent') THEN resolved.platform",
    "      ELSE 'unattributed'",
    "    END AS platform,",
    "    COALESCE(NULLIF(btrim(user_settings.email), ''), '(no email)') AS email,",
    "    resolved.event_properties ->> 'package_slug' AS package_slug,",
    "    (resolved.event_properties ->> 'card_count')::int AS card_count",
    "  FROM analytics.product_events_resolved AS resolved",
    "  LEFT JOIN org.user_settings AS user_settings",
    "    ON pg_catalog.lower(user_settings.user_id) = resolved.actor_id::text",
    "  WHERE resolved.event_name = 'catalog_deck_installed'",
    "    AND resolved.occurred_at >= (",
    `      (${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND resolved.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND resolved.event_properties ->> 'package_slug' <> 'test'",
    "    AND (",
    "      user_settings.email IS NULL",
    "      OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "    )",
    "    AND NOT EXISTS (",
    "      SELECT 1",
    "      FROM auth.admin_users AS admin_users",
    "      WHERE admin_users.email = LOWER(btrim(user_settings.email))",
    "        AND admin_users.revoked_at IS NULL",
    "    )",
    `    AND ${buildExcludedActorsFilterSql("resolved.actor_id::text")}`,
    "),",
    // Only the installers' own app opens are read: an install row has already settled which actors
    // this section counts at all, and the same actor carries the same email and the same exclusion
    // state here, so this CTE restates neither. Bounded above only, because a first active day may
    // predate the range.
    "installer_app_opens AS (",
    "  SELECT",
    "    resolved.actor_id::text AS actor_id,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS active_date",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.event_name = 'app_opened'",
    "    AND resolved.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND EXISTS (",
    "      SELECT 1",
    "      FROM deck_installs",
    "      WHERE deck_installs.actor_id = resolved.actor_id::text",
    "    )",
    "),",
    // `HAVING` is the "inside the range" rule: the rows are bounded above already, so an actor whose
    // last active day is still before the range start has no active day in it and drops out, leaving
    // the install with no cohort.
    "installer_first_active_date AS (",
    "  SELECT",
    "    installer_app_opens.actor_id,",
    "    MIN(installer_app_opens.active_date) AS first_active_date",
    "  FROM installer_app_opens",
    "  GROUP BY installer_app_opens.actor_id",
    `  HAVING MAX(installer_app_opens.active_date) >= ${escapeSqlStringLiteral(from)}::date`,
    ")",
    "SELECT",
    "  to_char(deck_installs.install_date, 'YYYY-MM-DD') AS install_date,",
    // Emitted under the name the SPA row shape already uses. The value is the resolved actor.
    "  deck_installs.actor_id AS user_id,",
    "  deck_installs.email,",
    "  deck_installs.platform,",
    "  deck_installs.package_slug,",
    "  COUNT(*)::int AS install_count,",
    // The cards those installs added, summed because one person can install one deck more than once
    // on a day and a later version can carry a different card count.
    "  SUM(deck_installs.card_count)::int AS card_count",
    "FROM deck_installs",
    "LEFT JOIN installer_first_active_date",
    "  ON installer_first_active_date.actor_id = deck_installs.actor_id",
    `WHERE ${buildUsersFilterSql("deck_installs.actor_id", filters.users)}`,
    `  AND ${buildEventPlatformsFilterSql("deck_installs.platform", filters.eventPlatforms)}`,
    `  AND ${buildMinimumEventCountsFilterSql("deck_installs.actor_id", filters.minimumEventCounts, dateRange)}`,
    `  AND ${buildConnectionCountriesFilterSql("deck_installs.actor_id", filters.connectionCountries, dateRange)}`,
    `  AND ${buildAppUiLanguagesFilterSql("deck_installs.actor_id", filters.appUiLanguages, dateRange)}`,
    `  AND ${buildCatalogAttributionFiltersSql("deck_installs.actor_id", filters)}`,
    "  AND (",
    `    (installer_first_active_date.first_active_date IS NULL AND ${unknownCohortSelectionSql})`,
    `    OR ${buildUserCohortsFilterSql(catalogInstallCohortSqlExpression, filters.userCohorts)}`,
    "  )",
    "GROUP BY",
    "  deck_installs.install_date,",
    "  deck_installs.actor_id,",
    "  deck_installs.email,",
    "  deck_installs.platform,",
    "  deck_installs.package_slug",
    "ORDER BY",
    "  deck_installs.install_date ASC,",
    "  install_count DESC,",
    "  deck_installs.actor_id ASC,",
    "  deck_installs.package_slug ASC",
  ].join("\n");
}

export async function loadCatalogInstallsReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
): Promise<CatalogInstallsReport> {
  const response = await runAdminQuery(config, buildCatalogInstallsSql(filters));
  if (response.resultSets.length !== 1) {
    throw new Error(`${catalogInstallsReportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined) {
    throw new Error(`${catalogInstallsReportLabel} result set is missing.`);
  }

  return buildCatalogInstallsReport(
    resultSet,
    response.executedAtUtc,
    filters.dateRange.from,
    filters.dateRange.to,
  );
}

import { reviewEventCohorts, reviewEventPlatforms, runAdminQuery } from "../../adminApi";
import type {
  AdminQueryResultSet,
  AdminQueryValue,
  CatalogInstallsPackage,
  CatalogInstallsReport,
  CatalogInstallsRow,
  CatalogInstallsUser,
  ReviewEventCohort,
  ReviewEventPlatform,
} from "../../adminApi";
import type { AdminAppConfig } from "../../config";
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

export type CatalogInstallsFilterState = Readonly<{
  selectedUserIds: ReadonlyArray<string>;
  selectedCohorts: ReadonlyArray<ReviewEventCohort>;
  selectedPlatforms: ReadonlyArray<ReviewEventPlatform>;
  /**
   * `DailyActiveUsersReport.firstActiveDateByUserId`, so new versus returning is defined in exactly
   * one place instead of being recomputed from installs.
   */
  firstActiveDateByUserId: ReadonlyMap<string, string>;
}>;

type CatalogInstallsAggregateFields = Readonly<Pick<
  CatalogInstallsReport,
  "totalInstalls" | "users" | "packages"
>>;

type CatalogInstallsRowFilter = Readonly<{
  selectedUserIds: ReadonlySet<string>;
  selectedCohorts: ReadonlySet<ReviewEventCohort>;
  selectedPlatforms: ReadonlySet<ReviewEventPlatform>;
  firstActiveDateByUserId: ReadonlyMap<string, string>;
  keepsUnknownCohort: boolean;
}>;

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

/**
 * The cohort of one install, read from the daily active users report instead of recomputed here.
 *
 * `null` means the installer has no `app_opened` day inside the loaded range, so that report knows
 * of no first active day to compare this install against and the row belongs to neither cohort. It
 * is then kept only while the cohort filter still selects every cohort, which is the state the
 * filter row treats as "no cohort filter"; any narrowing drops the row rather than guessing a side
 * for it.
 */
function getCatalogInstallsRowCohort(
  row: CatalogInstallsRow,
  firstActiveDateByUserId: ReadonlyMap<string, string>,
): ReviewEventCohort | null {
  const firstActiveDate = firstActiveDateByUserId.get(row.userId);
  if (firstActiveDate === undefined) {
    return null;
  }

  return firstActiveDate === row.date ? "new" : "returning";
}

function isUnfilteredCatalogInstallsReport(filters: CatalogInstallsFilterState): boolean {
  return filters.selectedUserIds.length === 0
    && filters.selectedCohorts.length === reviewEventCohorts.length
    && filters.selectedPlatforms.length === reviewEventPlatforms.length;
}

function shouldIncludeCatalogInstallsRow(
  row: CatalogInstallsRow,
  rowFilter: CatalogInstallsRowFilter,
): boolean {
  if (rowFilter.selectedUserIds.size > 0 && rowFilter.selectedUserIds.has(row.userId) === false) {
    return false;
  }

  const cohort = getCatalogInstallsRowCohort(row, rowFilter.firstActiveDateByUserId);
  if (cohort === null) {
    if (rowFilter.keepsUnknownCohort === false) {
      return false;
    }
  } else if (rowFilter.selectedCohorts.has(cohort) === false) {
    return false;
  }

  return rowFilter.selectedPlatforms.has(row.platform);
}

export function filterCatalogInstallsReport(
  report: CatalogInstallsReport,
  filters: CatalogInstallsFilterState,
): CatalogInstallsReport {
  if (isUnfilteredCatalogInstallsReport(filters)) {
    return report;
  }

  const rowFilter: CatalogInstallsRowFilter = {
    selectedUserIds: new Set(filters.selectedUserIds),
    selectedCohorts: new Set(filters.selectedCohorts),
    selectedPlatforms: new Set(filters.selectedPlatforms),
    firstActiveDateByUserId: filters.firstActiveDateByUserId,
    keepsUnknownCohort: filters.selectedCohorts.length === reviewEventCohorts.length,
  };
  const rows = report.rows.filter((row) => shouldIncludeCatalogInstallsRow(row, rowFilter));

  return {
    ...report,
    ...buildCatalogInstallsAggregateFields(rows),
    rows,
  };
}

// Per-actor catalog deck installs for the admin "Catalog deck installs" section. One install action
// by one person is one event, and one row is one (UTC date, actor, package slug).
//
// The shape mirrors `buildReviewEventsByDateSql`: the `org.user_settings` email join folded with
// `pg_catalog.lower` because `actor_id` renders canonical lowercase hex while
// `org.user_settings.user_id` is an unconstrained TEXT primary key, the `%@example.com` exclusion
// restated inline because this package cannot import
// `exampleComEmailExclusionSqlFragments` from `apps/backend/src/globalMetrics/reporting.ts`, and
// grouping by `actor_id` so a guest and the account that guest became are one person. Unlike that
// query this CTE is bounded on both sides, because new versus returning is read from the daily
// active users report rather than recomputed from a first-install day here.
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
export function buildCatalogInstallsSql(from: string, to: string): string {
  assertValidDateRange({ from, to }, catalogInstallsReportLabel);

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
  from: string,
  to: string,
): Promise<CatalogInstallsReport> {
  const response = await runAdminQuery(config, buildCatalogInstallsSql(from, to));
  if (response.resultSets.length !== 1) {
    throw new Error(`${catalogInstallsReportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined) {
    throw new Error(`${catalogInstallsReportLabel} result set is missing.`);
  }

  return buildCatalogInstallsReport(resultSet, response.executedAtUtc, from, to);
}

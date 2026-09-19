import {
  runAdminQuery,
  type AdminQueryResultSet,
  type ReviewEventsByDateUser,
} from "../adminApi";
import type { AdminAppConfig } from "../config";
import { assertIsString, assertValidDateRange, toInteger } from "../reports/reportValues";
import { buildConnectionCountrySamplesSql } from "./filterSql";
import { getUserFilterLabel } from "./userFilters";
import { escapeSqlStringLiteral } from "../sql";
import type { AnalyticsDateRange } from "./analyticsFilters";

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
}>;

// Every actor the General sections can show inside the range, with the review-event count the popup
// prints next to them. The four sources are the four ways a person reaches a chart: review events,
// community activity, active days and catalog installs. Each source restates the exclusions of the
// report it stands for, so a person offered here is a person some section can really show:
// `%@example.com` everywhere, and the delisted `test` fixture plus active admins on installs alone -
// an admin who opened the app is still an active user and stays in the list.
//
// `friendship_created` is the one source that reaches back before the range, because the community
// chart carries a running friendship total: a friendship created earlier still shows on every day in
// range, so its actor is still offered. Every other source has to happen inside the range.
function buildAnalyticsFilterOptionUsersSql(dateRange: AnalyticsDateRange): string {
  const fromLiteral = escapeSqlStringLiteral(dateRange.from);
  const toLiteral = escapeSqlStringLiteral(dateRange.to);

  return [
    "WITH active_admin_emails AS (",
    "  SELECT admin_users.email",
    "  FROM auth.admin_users AS admin_users",
    "  WHERE admin_users.revoked_at IS NULL",
    "),",
    // One stored email per actor key. The email join is folded on the stored side for the reason
    // `buildReviewEventsByDateSql` states in full, and that note also states what folding two stored
    // rows together costs: the join fans every event row out once per folded row, which "silently
    // doubles `COUNT(*)`". Deduping the stored side here rather than aggregating the fan-out away
    // downstream keeps one row per event structural, so the review count below stays the real one.
    // `MIN` over the nullable address keeps a real email whenever any folded row carries one and
    // falls back to NULL only when none does.
    "user_emails AS (",
    "  SELECT",
    "    pg_catalog.lower(user_settings.user_id) AS user_key,",
    "    MIN(NULLIF(btrim(user_settings.email), '')) AS email",
    "  FROM org.user_settings AS user_settings",
    "  GROUP BY pg_catalog.lower(user_settings.user_id)",
    "),",
    // One pass over the five event names.
    "option_events AS (",
    "  SELECT",
    "    resolved.actor_id::text AS actor_id,",
    "    resolved.event_name,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS event_date,",
    "    resolved.event_properties ->> 'package_slug' AS package_slug,",
    "    user_emails.email,",
    "    EXISTS (",
    "      SELECT 1",
    "      FROM active_admin_emails",
    "      WHERE active_admin_emails.email = LOWER(user_emails.email)",
    "    ) AS is_active_admin",
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
    "    AND (",
    "      user_emails.email IS NULL",
    "      OR LOWER(user_emails.email) NOT LIKE '%@example.com'",
    "    )",
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
    "      AND option_events.is_active_admin = FALSE",
    "    )",
    "  ))",
    "GROUP BY option_events.actor_id, option_events.email",
    "ORDER BY option_events.actor_id ASC",
  ].join("\n");
}

// The decks the installs chart can colour inside the range. Same two exclusions as
// `buildCatalogInstallsSql`, which states why they exist; the colour scale sorts the slugs itself, so
// this returns the set rather than an order.
function buildAnalyticsFilterOptionPackagesSql(dateRange: AnalyticsDateRange): string {
  return [
    "SELECT DISTINCT resolved.event_properties ->> 'package_slug' AS package_slug",
    "FROM analytics.product_events_resolved AS resolved",
    "LEFT JOIN org.user_settings AS user_settings",
    "  ON pg_catalog.lower(user_settings.user_id) = resolved.actor_id::text",
    "WHERE resolved.event_name = 'catalog_deck_installed'",
    "  AND resolved.occurred_at >= (",
    `    (${escapeSqlStringLiteral(dateRange.from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND resolved.occurred_at < (",
    `    (${escapeSqlStringLiteral(dateRange.to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND resolved.event_properties ->> 'package_slug' <> 'test'",
    "  AND (",
    "    user_settings.email IS NULL",
    "    OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "  )",
    "  AND NOT EXISTS (",
    "    SELECT 1",
    "    FROM auth.admin_users AS admin_users",
    "    WHERE admin_users.email = LOWER(btrim(user_settings.email))",
    "      AND admin_users.revoked_at IS NULL",
    "  )",
  ].join("\n");
}

// Every country a retained connection sample can put a person in inside the range, read through the
// same fragment the country filter reads and with the same platform-blind evidence, so the popup
// offers exactly the countries that filter can match. The audience report reads that fragment
// narrowed to the selected platforms instead, so a country offered here can still chart as `unknown`
// there.
//
// Like the users list above, this restates the one exclusion every report applies, `%@example.com`,
// so a country only a test account was ever seen connecting from is not offered. The active-admin
// exclusion is deliberately not restated: Audience drops admins but the General sections show them,
// so a country only an admin connected from is a country some section can really display.
function buildAnalyticsFilterOptionCountriesSql(dateRange: AnalyticsDateRange): string {
  return [
    "SELECT DISTINCT country_samples.country AS country",
    "FROM (",
    buildConnectionCountrySamplesSql(dateRange, null),
    ") AS country_samples",
    "LEFT JOIN org.user_settings AS user_settings",
    "  ON pg_catalog.lower(user_settings.user_id) = country_samples.actor_id::text",
    // A sampled lookup that returned no country is the `unknown` bucket of the audience report rather
    // than a country anybody can pick.
    "WHERE country_samples.country IS NOT NULL",
    "  AND (",
    "    user_settings.email IS NULL",
    "    OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "  )",
    "ORDER BY country ASC",
  ].join("\n");
}

// Every interface locale an event in the range carries, over every event name and every platform,
// which is how the language filter reads it; the audience report narrows the same locales to the
// selected platforms, so a locale offered here can still chart as `unknown` there. A NULL locale is
// not offered: no selection can match it, and a person whose events carry only NULLs is exactly the
// person a narrowed language filter drops. `%@example.com` is restated and the active-admin exclusion
// is not, for the reason the country list above states.
function buildAnalyticsFilterOptionAppUiLanguagesSql(dateRange: AnalyticsDateRange): string {
  return [
    "SELECT DISTINCT resolved.ui_locale AS ui_locale",
    "FROM analytics.product_events_resolved AS resolved",
    "LEFT JOIN org.user_settings AS user_settings",
    "  ON pg_catalog.lower(user_settings.user_id) = resolved.actor_id::text",
    "WHERE resolved.ui_locale IS NOT NULL",
    "  AND resolved.actor_id IS NOT NULL",
    "  AND resolved.occurred_at >= (",
    `    (${escapeSqlStringLiteral(dateRange.from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND resolved.occurred_at < (",
    `    (${escapeSqlStringLiteral(dateRange.to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND (",
    "    user_settings.email IS NULL",
    "    OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "  )",
    "ORDER BY ui_locale ASC",
  ].join("\n");
}

/** Most review events first, then by the label the popup prints, as the review report sorts its own users. */
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

export async function loadAnalyticsFilterOptions(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
): Promise<AnalyticsFilterOptions> {
  assertValidDateRange(dateRange, optionsReportLabel);
  const response = await runAdminQuery(config, [
    buildAnalyticsFilterOptionUsersSql(dateRange),
    buildAnalyticsFilterOptionPackagesSql(dateRange),
    buildAnalyticsFilterOptionCountriesSql(dateRange),
    buildAnalyticsFilterOptionAppUiLanguagesSql(dateRange),
  ].join(";\n"));
  if (response.resultSets.length !== 4) {
    throw new Error(`${optionsReportLabel} must return exactly four result sets. Got ${response.resultSets.length}.`);
  }

  const userResultSet = response.resultSets[0];
  if (userResultSet === undefined) {
    throw new Error(`${optionsReportLabel} user result set is missing.`);
  }

  const packageResultSet = response.resultSets[1];
  if (packageResultSet === undefined) {
    throw new Error(`${optionsReportLabel} package result set is missing.`);
  }

  const countryResultSet = response.resultSets[2];
  if (countryResultSet === undefined) {
    throw new Error(`${optionsReportLabel} connection country result set is missing.`);
  }

  const appUiLanguageResultSet = response.resultSets[3];
  if (appUiLanguageResultSet === undefined) {
    throw new Error(`${optionsReportLabel} app UI language result set is missing.`);
  }

  return {
    generatedAtUtc: response.executedAtUtc,
    users: buildUserOptions(userResultSet),
    catalogPackageSlugs: packageResultSet.rows.map(
      (row) => assertIsString(row.package_slug ?? null, optionsReportLabel, "package_slug"),
    ),
    connectionCountries: countryResultSet.rows.map(
      (row) => assertIsString(row.country ?? null, optionsReportLabel, "country"),
    ),
    appUiLanguages: appUiLanguageResultSet.rows.map(
      (row) => assertIsString(row.ui_locale ?? null, optionsReportLabel, "ui_locale"),
    ),
  };
}

import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildEventPlatformsFilterSql,
  buildNonAutomatedClientRowsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { laterCalendarDate } from "../reportValues";

// Who counts as a person beyond an identified actor - a registered account, a cookieless hashed
// visitor - expressed once against `analytics.product_events_resolved` for every report that asks.

/**
 * The first UTC day a cookieless visitor can be counted from, whatever range is selected.
 *
 * `analytics.product_events_resolved.daily_visitor_hash` reached production at 18:25 UTC on
 * 2026-09-22 (`db/migrations/0144_anonymous_client_daily_visitor_hash.sql`), so that day is partial
 * and this is the first whole one. It is a separate constant from each funnel's own start date on
 * purpose: they are equal today, and a funnel whose start moves earlier must show the note its
 * section builds rather than silently draw a hashed segment that begins mid-range.
 */
export const funnelDailyVisitorHashStartDate = "2026-09-23";

/**
 * A REAL, NON-GUEST ACCOUNT, as one SQL boolean expression over one actor, and the one place that
 * rule is written.
 *
 * The signal is a `auth.user_identities` row for the actor. That table accepts only
 * `provider_type = 'cognito'` by its own CHECK (`db/migrations/0031_guest_ai_identity_and_quota.sql`),
 * so a row exists exactly when a Cognito sign-in has bound that app user id, and
 * `db/migrations/0066_reporting_readonly_operational_analytics.sql` grants `reporting_readonly`
 * SELECT on its `provider_type`, `user_id` and `created_at`. A one-time backfill in migration 0031
 * gave every account that predates the table an identity row, so old accounts are covered too.
 *
 * IT ANSWERS "EVER REGISTERED", and it does so through both conversion shapes rather than only the
 * visible one:
 *   - a bound completion, the ordinary first-ever conversion, keeps the guest's own user id and binds
 *     the Cognito subject to it (`bindCognitoIdentityMappingInExecutor` in
 *     `apps/backend/src/guestAuth/upgrade/index.ts`). No upgrade-history row and no identity link are
 *     written, and `actor_id` never changes, so the new `auth.user_identities` row is the only
 *     evidence in the database that this person stopped being a guest;
 *   - a merge, or a web sign-in link, writes an `analytics.identity_links` row and the view's
 *     `first_guest_upgrade_link` arm rewrites `actor_id` to the target account's user id, which has an
 *     identity row of its own.
 * Either way the person's whole history, including the steps they took while still a guest, resolves
 * to an actor this test keeps, which is exactly the decision: a guest who later registered is in.
 *
 * NEITHER `org.user_settings` NOR `auth.guest_sessions` CAN STAND IN FOR IT. A guest gets an
 * `org.user_settings` row at session creation with a NULL email
 * (`ensureUserSettingsRowInExecutor` in `apps/backend/src/workspaces/create.ts`), so the presence of a
 * row proves nothing; the email is a usable proxy but a leakier one, because a Cognito token with no
 * email claim leaves a genuine account's email NULL. And a bound completion deliberately leaves the
 * guest session live under what is now the account's id, so an existing guest session is not evidence
 * of a guest.
 *
 * THE STORED SIDE IS FOLDED AND THE ACTOR SIDE IS NOT, for the reason `buildExcludedActorSqlLines`
 * gives in full: `auth.user_identities.user_id` is an unconstrained TEXT key, while every caller
 * passes `actor_id::text`, which renders canonical lowercase hex. The stored side is deliberately not
 * cast to `uuid` either, because the `'local'` id seeded by `db/migrations/0001_initial_schema.sql`
 * is not one and the cast would abort the statement rather than fail to match.
 *
 * A PERSON WHO DELETED THEIR ACCOUNT READS AS NOT SIGNED IN. Account deletion removes the
 * `org.user_settings` row and the identity row cascades with it
 * (`apps/backend/src/auth/accountDeletion.ts`), while their events survive under a per-deletion
 * pseudonym. It therefore names who is still a registered account rather than who ever
 * completed a registration, and it is the one case where those two differ.
 */
export function buildSignedInActorSql(actorIdSqlExpression: string): string {
  return [
    "EXISTS (",
    "    SELECT 1",
    "    FROM auth.user_identities AS signed_in_identities",
    "    WHERE signed_in_identities.provider_type = 'cognito'",
    `      AND pg_catalog.lower(signed_in_identities.user_id) = ${actorIdSqlExpression}`,
    "  )",
  ].join("\n");
}

/**
 * The days a hashed row may be counted in, as `AND`-joined predicates on `rowAlias`: the caller's
 * selected range, its start raised to the hash's own start date.
 *
 * THE BOUND IS THE SALT DAY, `buildHashedVisitorDaySql`'s own column, and not the `occurred_at` every
 * other report bounds on. It has to be the column the person is keyed on, because the two name
 * different days around midnight: `occurred_at` is `server_received_at` minus the send delay, so a
 * row of a salt-day inside the range can carry an `occurred_at` outside it. Bounding on `occurred_at`
 * would then keep part of a person's day and drop the rest, and a partial day is not merely a lost
 * row: the site funnel reads a person's first page view as the `MIN` over the rows that survive the
 * bound, so a visitor whose genuine first view was clipped would have their second one promoted to
 * first and could enter a funnel they never entered. On this bound a person-day is whole or absent.
 */
export function buildHashedVisitorDayRangeSqlLines(
  rowAlias: string,
  from: string,
  to: string,
): ReadonlyArray<string> {
  const hashedFrom = laterCalendarDate(from, funnelDailyVisitorHashStartDate);
  const visitorDaySql = buildHashedVisitorDaySql(rowAlias);
  return [
    `${visitorDaySql} >= ${escapeSqlStringLiteral(hashedFrom)}::date`,
    `${visitorDaySql} <= ${escapeSqlStringLiteral(to)}::date`,
  ];
}

/**
 * A marketing-site row of a cookieless visitor, as `AND`-joined predicates on `rowAlias`.
 *
 * `daily_visitor_hash` is non-NULL only on the credential-free site rows of a browser that carries no
 * visitor cookie, and never on a consent fact, so it is both the person key and the test for
 * belonging to this cohort. Such a row has a NULL `actor_id` by construction: it has no cookie and no
 * account to resolve to, and the hash is deliberately never made one
 * (`db/migrations/0144_anonymous_client_daily_visitor_hash.sql`).
 *
 * THE SHARED EXCLUSION RULE CANNOT REACH THIS COHORT, and that is a property of the data rather than
 * an omission here. `buildExcludedActorSqlLines` drops a person by their actor - a test address, an
 * ever-admin address, an entry on the exclusion list - and these rows have no actor to test, so an
 * admin browsing the site without consenting is counted among the hashed people, and the sections say
 * what the segment is.
 *
 * TWO ARMS OF THAT RULE DO REACH THEM, because each names a row or a hash rather than a person, so
 * neither needs an actor. The automated verdict is written onto the row: a browser-day reported by a
 * bot, a crawler, a headless browser or a request carrying no `User-Agent` never becomes a hashed
 * person at all. `buildNonAutomatedClientRowsFilterSql` owns that predicate and the reason it keeps
 * NULL, which on these rows is one stored before the marker shipped and is a real visitor. The
 * scraper fleet lists its browser-days by hash
 * (`db/migrations/0230_probable_scraper_fleet_app_visitors.sql`), as one uncorrelated
 * `NOT IN` set.
 */
export function buildHashedSiteVisitorRowSqlLines(rowAlias: string): ReadonlyArray<string> {
  return [
    `${rowAlias}.origin = 'client'`,
    `${rowAlias}.trust_level = 'anonymous_client'`,
    `${rowAlias}.daily_visitor_hash IS NOT NULL`,
    buildNonAutomatedClientRowsFilterSql(`${rowAlias}.automated_client`),
    [
      `${rowAlias}.daily_visitor_hash NOT IN (`,
      "  SELECT probable_scraper_fleet.subject_id",
      "  FROM analytics.probable_scraper_fleet_visitors AS probable_scraper_fleet",
      "  WHERE probable_scraper_fleet.subject_kind = 'daily_visitor_hash'",
      ")",
    ].join("\n"),
  ];
}

/** `buildHashedSiteVisitorRowSqlLines` for one event. */
export function buildHashedSiteRowSqlLines(
  rowAlias: string,
  eventName: string,
): ReadonlyArray<string> {
  return [
    `${rowAlias}.event_name = ${escapeSqlStringLiteral(eventName)}`,
    ...buildHashedSiteVisitorRowSqlLines(rowAlias),
  ];
}

/**
 * The selection a hashed page view answers itself, as `AND` lines.
 *
 * The platform is read off the row through `platformSqlExpression`, which the caller passes so that
 * the hashed arm asks its funnel's own platform question rather than a second one: the site-entry
 * funnel compares the bare column, where a NULL platform matches nothing, and the deck funnel
 * compares `COALESCE(..., 'unattributed')`, where a NULL platform is a selectable value. Deriving it
 * here instead would let a cookieless row with a NULL platform enter a cohort the identical
 * identified row is dropped from, under the default selection. The public collector stamps every
 * anonymous site row as web and no client can override it, so a selection without web empties the
 * hashed segment either way, which is the same thing it does to the identified one.
 *
 * The app interface language and the connection country are the row's own `ui_locale` and
 * ingest-time `country`, rather than the person-level tests `buildAppUiLanguagesFilterSql` and
 * `buildConnectionCountriesFilterSql` apply to an actor: a hashed person is one page view's worth of
 * evidence, with no history and no installation to ask.
 */
export function buildHashedPageViewFilterSqlLines(
  rowAlias: string,
  platformSqlExpression: string,
  filters: AnalyticsFilterState,
): ReadonlyArray<string> {
  return [
    `${buildEventPlatformsFilterSql(platformSqlExpression, filters.eventPlatforms)}`,
    ...(filters.appUiLanguages.length === 0 ? [] : [
      `${rowAlias}.ui_locale IN (${filters.appUiLanguages.map(escapeSqlStringLiteral).join(", ")})`,
    ]),
    ...(filters.connectionCountries.length === 0 ? [] : [
      `${rowAlias}.country IN (${filters.connectionCountries.map(escapeSqlStringLiteral).join(", ")})`,
    ]),
  ];
}

/**
 * The UTC day of a hashed row, which is half of that cohort's person key.
 *
 * A hash is rotated daily against a salt the reporting role cannot read, so it names one browser for
 * one UTC day and nothing beyond it. Keying on the pair rather than on the hash alone is what makes
 * the funnel rule hold inside a day without depending on the hash's construction never colliding
 * across days: two days are two people either way.
 *
 * THE DAY IS `server_received_at`'s, NOT `occurred_at`'s, because that is the day whose salt made
 * the hash: the backend picks the salt by `toUtcDay(row.serverReceivedAt)`
 * (`apps/backend/src/productAnalytics/dailyVisitorHash.ts`), as the column comment in
 * `db/migrations/0144_anonymous_client_daily_visitor_hash.sql` states. `occurred_at` is the
 * skew-corrected `server_received_at - (client_sent_at - client_occurred_at)`
 * (`db/migrations/0114_product_analytics_storage.sql`), so the two differ by the send delay and
 * around midnight they name different days. Keying on `occurred_at` would let one browser's single
 * salt-day split across two person keys, or put a click on the other side of the day from the view
 * it followed; keying on the salt's own day cannot, because a hash value exists for exactly one of
 * these days by construction. The view is `analytics.product_events_resolved`, which projects
 * `server_received_at` and grants it to `reporting_readonly` in that same migration. The range
 * bounds are this same day rather than `occurred_at`, for the reason
 * `buildHashedVisitorDayRangeSqlLines` gives: only a bound on the key's own column can keep a
 * person-day whole at the edges of the range.
 */
export function buildHashedVisitorDaySql(rowAlias: string): string {
  return `(${rowAlias}.server_received_at AT TIME ZONE 'UTC')::date`;
}

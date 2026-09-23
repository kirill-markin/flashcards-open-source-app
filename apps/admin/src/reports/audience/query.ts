import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildCatalogAttributionFiltersSql,
  buildConnectionCountriesFilterSql,
  buildConnectionCountrySamplesSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorSqlLines,
  buildMinimumEventCountsFilterSql,
  buildTrustedActorRowsFilterSql,
  buildUserCohortsFilterSql,
  buildUsersFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { assertIsString, assertValidDateRange, toInteger } from "../reportValues";

const dimensions = ["summary", "country", "language", "pair", "platform"] as const;
type AudienceDimension = (typeof dimensions)[number];
export type AudienceBucket = Readonly<{
  dimension: AudienceDimension;
  value: string;
  secondary: string;
  users: number;
}>;
export type AudienceReport = Readonly<{
  generatedAtUtc: string;
  buckets: ReadonlyArray<AudienceBucket>;
}>;

// The cohort is everyone who opened the app inside the range, which is the "was here" definition of
// the daily active users section rather than one of this section's own, so the two cannot disagree
// about which day a person was new on. THE TWO DENOMINATORS NOW AGREE: `history` below applies
// `buildExcludedActorSqlLines`, the one exclusion rule every section applies, so the admin gap that
// used to separate this count from that section's unique users is gone.
// A narrower population is a threshold rather than a mode: the people who answered at least one card
// are `review_answered >= 1`.
//
// `history` also drops `trust_level = 'anonymous_client'`, for the reason
// `buildTrustedActorRowsFilterSql` states: the credential-free collector's `anonymous_id` is an
// unverified caller-supplied claim, and this report's every number is a share of one distinct-user
// denominator. The daily active users section applies the same predicate, so the two cohorts stay
// comparable. `language_events` below drops it a second time, because it reads every event name
// rather than `app_opened` alone: it decides the interface language and the `unknown` language
// coverage of a person the cohort already counted, and a credential-free row resolving onto that
// person is not evidence of what language that person uses.
//
// `analytics_settings` is the one thing in this report that is not an event: both decisions are
// stored state with no history, so the six metrics built from it say what the cohort holds now,
// never who changed anything inside the range. The precedence below mirrors the guest-to-account
// carry rather than inventing a reporting rule - the account row's explicit answer wins, and live
// guest sessions decide only while the account holds NULL, exactly as
// `apps/backend/src/guestAuth/store/session.ts` documents, on its own ground that an account answer
// is that person's own later decision. It is needed because a bound upgrade leaves the guest session
// alive under the same actor (`apps/backend/src/guestAuth/upgrade/index.ts`), so one person can
// carry a frozen guest answer beside their account answer. Ingest is not the model for it: ingest
// reads whichever credential the batch arrived on (`apps/backend/src/routes/productAnalytics.ts`,
// over the guest override in `apps/backend/src/server/requestContext.ts`), so a batch sent on that
// frozen guest credential is still dropped, and ingest never reads `analytics_consent` at all.
// No path creates a second live guest row under one actor today - a new session mints a new user,
// and a creation-idempotency retry rotates the secret on the existing row
// (`apps/backend/src/guestAuth/session/index.ts`) - but were there ever two, the restrictive answer
// among them would win. Revoked guest sessions are left out because both upgrade shapes carry a
// recorded answer onto the account before anything revokes or deletes the guest row.
// `db/migrations/0149_product_analytics_off_switch.sql` says why the two questions are never derived
// from each other, and why NULL reads as ON while an explicit TRUE is stored rather than collapsed
// back to it, so that "never answered" and "answered yes" stay distinguishable.
// Two people this field cannot see: a deleted account, whose settings row is gone and whose guest
// sessions cascaded with it while their `app_opened` rows keep them in the cohort, so they report as
// no answer recorded even if they answered; and a signed-out browser, whose switch is enforced in
// that browser because a web guest credential never holds a value here.
export function buildAudienceSql(filters: AnalyticsFilterState): string {
  const dateRange = assertValidDateRange(filters.dateRange, "Audience");
  const userSelection = buildUsersFilterSql("history.actor_id::text", filters.users);
  const platformSelection = buildEventPlatformsFilterSql(
    "COALESCE(events.platform, 'unattributed')",
    filters.eventPlatforms,
  );
  const cohortSelection = buildUserCohortsFilterSql(
    "CASE WHEN history.event_date = history.first_date THEN 'new' ELSE 'returning' END",
    filters.userCohorts,
  );
  // Every number in this report is a share of one distinct-user denominator, so a threshold has to
  // restrict the cohort the denominator is counted from rather than only the rows inside it.
  const minimumEventCountSelection = buildMinimumEventCountsFilterSql(
    "history.actor_id::text",
    filters.minimumEventCounts,
    dateRange,
  );
  // The country and the language a person is filtered on are the same two facts this report charts,
  // but the two predicates read their evidence across every platform while `sampled_events` and
  // `language_events` below stay narrowed to the selected platforms. That is deliberate: these two
  // fields select people, whose country and interface language are not properties of the platform
  // slice on screen. So a person kept by either filter can still be counted into the `unknown`
  // country, language or pair buckets here, when the only evidence of their value came from a
  // platform this selection leaves out.
  const countrySelection = buildConnectionCountriesFilterSql(
    "history.actor_id::text",
    filters.connectionCountries,
    dateRange,
  );
  const languageSelection = buildAppUiLanguagesFilterSql(
    "history.actor_id::text",
    filters.appUiLanguages,
    dateRange,
  );
  // The catalog attribution fields select people too, as the two above do, so they belong on the same
  // cohort: every number here is a share of one distinct-user denominator. They read a person's whole
  // history rather than the range, which is the one thing that makes them unlike every other field.
  const catalogAttributionSelection = buildCatalogAttributionFiltersSql(
    "history.actor_id::text",
    filters,
  );

  return `WITH bounds AS (
    SELECT (${escapeSqlStringLiteral(dateRange.from)}::date)::timestamp AT TIME ZONE 'UTC' AS starts_at,
      (${escapeSqlStringLiteral(dateRange.to)}::date + 1)::timestamp AT TIME ZONE 'UTC' AS ends_at
  ), history AS MATERIALIZED (
    SELECT events.actor_id, events.platform, events.occurred_at,
      (events.occurred_at AT TIME ZONE 'UTC')::date AS event_date,
      MIN((events.occurred_at AT TIME ZONE 'UTC')::date) OVER (PARTITION BY events.actor_id) AS first_date
    FROM analytics.product_events_resolved AS events
    CROSS JOIN bounds
    WHERE events.event_name = 'app_opened'
      AND events.actor_id IS NOT NULL
      AND events.occurred_at < bounds.ends_at
      AND ${buildTrustedActorRowsFilterSql("events.trust_level")}
${buildExcludedActorSqlLines("events.actor_id::text").join("\n")}
  ), cohort_events AS MATERIALIZED (
    SELECT history.actor_id, COALESCE(history.platform, 'unattributed') AS platform
    FROM history CROSS JOIN bounds
    WHERE history.occurred_at >= bounds.starts_at
      AND ${userSelection}
      AND ${cohortSelection}
      AND ${minimumEventCountSelection}
      AND ${countrySelection}
      AND ${languageSelection}
      AND ${catalogAttributionSelection}
      AND ${buildEventPlatformsFilterSql("COALESCE(history.platform, 'unattributed')", filters.eventPlatforms)}
  ), actors AS (
    SELECT DISTINCT actor_id FROM cohort_events
  ), language_events AS MATERIALIZED (
    SELECT events.actor_id, events.anonymous_id, events.platform, events.server_received_at, events.ui_locale
    FROM analytics.product_events_resolved AS events
    JOIN actors ON actors.actor_id = events.actor_id
    CROSS JOIN bounds
    WHERE events.occurred_at >= bounds.starts_at AND events.occurred_at < bounds.ends_at
      AND ${platformSelection}
      AND ${buildTrustedActorRowsFilterSql("events.trust_level")}
  ), sampled_events AS MATERIALIZED (
    SELECT country_samples.actor_id, country_samples.country, country_samples.ui_locale
    FROM (
${buildConnectionCountrySamplesSql(dateRange, filters.eventPlatforms)}
    ) AS country_samples
    JOIN actors ON actors.actor_id = country_samples.actor_id
  ), countries AS (
    SELECT DISTINCT actor_id, country FROM sampled_events WHERE country IS NOT NULL
  ), languages AS (
    SELECT DISTINCT actor_id, ui_locale FROM language_events WHERE ui_locale IS NOT NULL
  ), pairs AS (
    SELECT DISTINCT actor_id, country, ui_locale FROM sampled_events
    WHERE country IS NOT NULL AND ui_locale IS NOT NULL
  ), analytics_settings AS (
    SELECT actors.actor_id, TRUE AS is_account,
      account_settings.analytics_consent, account_settings.product_analytics_enabled
    FROM actors
    JOIN org.user_settings AS account_settings
      ON pg_catalog.lower(account_settings.user_id) = actors.actor_id::text
    UNION ALL
    SELECT actors.actor_id, FALSE AS is_account,
      guest_sessions.analytics_consent, guest_sessions.product_analytics_enabled
    FROM actors
    JOIN auth.guest_sessions AS guest_sessions
      ON pg_catalog.lower(guest_sessions.user_id) = actors.actor_id::text
    WHERE guest_sessions.revoked_at IS NULL
  ), analytics_answers AS (
    SELECT actor_id,
      COALESCE(bool_or(product_analytics_enabled IS FALSE) FILTER (WHERE is_account), FALSE) AS account_analytics_off,
      COALESCE(bool_or(product_analytics_enabled IS TRUE) FILTER (WHERE is_account), FALSE) AS account_analytics_on,
      COALESCE(bool_or(product_analytics_enabled IS FALSE) FILTER (WHERE NOT is_account), FALSE) AS guest_analytics_off,
      COALESCE(bool_or(product_analytics_enabled IS TRUE) FILTER (WHERE NOT is_account), FALSE) AS guest_analytics_on,
      COALESCE(bool_or(analytics_consent = 'declined') FILTER (WHERE is_account), FALSE) AS account_consent_declined,
      COALESCE(bool_or(analytics_consent = 'granted') FILTER (WHERE is_account), FALSE) AS account_consent_granted,
      COALESCE(bool_or(analytics_consent = 'declined') FILTER (WHERE NOT is_account), FALSE) AS guest_consent_declined,
      COALESCE(bool_or(analytics_consent = 'granted') FILTER (WHERE NOT is_account), FALSE) AS guest_consent_granted
    FROM analytics_settings
    GROUP BY actor_id
  ), actor_coverage AS (
    SELECT actors.actor_id,
      (SELECT count(*) FROM countries WHERE countries.actor_id = actors.actor_id) AS countries,
      (SELECT count(*) FROM languages WHERE languages.actor_id = actors.actor_id) AS languages,
      EXISTS (SELECT 1 FROM pairs WHERE pairs.actor_id = actors.actor_id) AS has_pair,
      EXISTS (SELECT 1 FROM language_events WHERE language_events.actor_id = actors.actor_id
        AND language_events.ui_locale IS NULL) AS has_unknown_language,
      EXISTS (SELECT 1 FROM sampled_events WHERE sampled_events.actor_id = actors.actor_id) AS has_sample,
      -- The account's explicit answer outranks every live guest record of the same person, and the
      -- guest records decide only while the account holds none - which is the account pair both
      -- being false. Each pair is disjoint for every one of the sixteen input combinations, not only
      -- the reachable ones, so the three counts below always partition the cohort: the restrictive
      -- answer is checked first and the permissive one is guarded by its negation on both tiers.
      COALESCE(answers.account_analytics_off
        OR (NOT answers.account_analytics_off AND NOT answers.account_analytics_on
          AND answers.guest_analytics_off), FALSE) AS has_analytics_off,
      COALESCE(NOT answers.account_analytics_off
        AND (answers.account_analytics_on
          OR (NOT answers.account_analytics_on AND NOT answers.guest_analytics_off
            AND answers.guest_analytics_on)), FALSE) AS has_analytics_on,
      COALESCE(answers.account_consent_declined
        OR (NOT answers.account_consent_declined AND NOT answers.account_consent_granted
          AND answers.guest_consent_declined), FALSE) AS has_consent_declined,
      COALESCE(NOT answers.account_consent_declined
        AND (answers.account_consent_granted
          OR (NOT answers.account_consent_granted AND NOT answers.guest_consent_declined
            AND answers.guest_consent_granted)), FALSE) AS has_consent_granted
    FROM actors
    LEFT JOIN analytics_answers AS answers ON answers.actor_id = actors.actor_id
  )
  SELECT 'summary' AS dimension, metric.value, '' AS secondary, metric.users
  FROM (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE countries > 0) AS country_known,
      count(*) FILTER (WHERE countries = 0) AS country_unknown,
      count(*) FILTER (WHERE languages > 0) AS language_known,
      count(*) FILTER (WHERE languages = 0) AS language_unknown,
      count(*) FILTER (WHERE countries > 1) AS multi_country,
      count(*) FILTER (WHERE languages > 1) AS multi_language,
      count(*) FILTER (WHERE has_pair) AS pair_known,
      count(*) FILTER (WHERE NOT has_pair) AS pair_unknown,
      count(*) FILTER (WHERE has_unknown_language) AS missing_language_events,
      count(*) FILTER (WHERE has_sample) AS sampled,
      count(*) FILTER (WHERE has_analytics_off) AS analytics_off,
      count(*) FILTER (WHERE has_analytics_on) AS analytics_on,
      count(*) FILTER (WHERE NOT has_analytics_off AND NOT has_analytics_on) AS analytics_unanswered,
      count(*) FILTER (WHERE has_consent_declined) AS consent_declined,
      count(*) FILTER (WHERE has_consent_granted) AS consent_granted,
      count(*) FILTER (WHERE NOT has_consent_declined AND NOT has_consent_granted) AS consent_unanswered
    FROM actor_coverage
  ) AS totals
  CROSS JOIN LATERAL (VALUES
    ('total', totals.total), ('country_known', totals.country_known), ('country_unknown', totals.country_unknown),
    ('language_known', totals.language_known), ('language_unknown', totals.language_unknown),
    ('multi_country', totals.multi_country), ('multi_language', totals.multi_language),
    ('pair_known', totals.pair_known), ('pair_unknown', totals.pair_unknown),
    ('missing_language_events', totals.missing_language_events), ('sampled', totals.sampled),
    ('analytics_off', totals.analytics_off), ('analytics_on', totals.analytics_on),
    ('analytics_unanswered', totals.analytics_unanswered),
    ('consent_declined', totals.consent_declined), ('consent_granted', totals.consent_granted),
    ('consent_unanswered', totals.consent_unanswered)
  ) AS metric(value, users)
  UNION ALL
  SELECT 'country', country, '', count(DISTINCT actor_id) FROM countries GROUP BY country
  UNION ALL
  SELECT 'country', 'unknown', '', count(*) FROM actor_coverage WHERE countries = 0
  UNION ALL
  SELECT 'language', ui_locale, '', count(DISTINCT actor_id) FROM languages GROUP BY ui_locale
  UNION ALL
  SELECT 'language', 'unknown', '', count(*) FROM actor_coverage WHERE languages = 0
  UNION ALL
  SELECT 'pair', country, ui_locale, count(DISTINCT actor_id) FROM pairs GROUP BY country, ui_locale
  UNION ALL
  SELECT 'pair', 'unknown', 'unknown', count(*) FROM actor_coverage WHERE NOT has_pair
  UNION ALL
  SELECT 'platform', platform, '', count(DISTINCT actor_id) FROM cohort_events GROUP BY platform
  ORDER BY dimension, users DESC, value, secondary`;
}

function parseBucket(row: AdminQueryRow): AudienceBucket {
  const dimension = assertIsString(row.dimension ?? null, "Audience", "dimension");
  if (!dimensions.includes(dimension as AudienceDimension)) {
    throw new Error(`Audience returned an unsupported dimension: ${dimension}`);
  }
  const users = toInteger(row.users ?? null, "Audience", "users");
  if (!Number.isSafeInteger(users) || users < 0) {
    throw new Error("Audience users must be a non-negative safe integer.");
  }
  return {
    dimension: dimension as AudienceDimension,
    value: assertIsString(row.value ?? null, "Audience", "value"),
    secondary: assertIsString(row.secondary ?? null, "Audience", "secondary"),
    users,
  };
}

export async function loadAudienceReport(config: AdminAppConfig, filters: AnalyticsFilterState): Promise<AudienceReport> {
  const response = await runAdminQuery(config, buildAudienceSql(filters));
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error("Audience query must return exactly one result set.");
  }
  return { generatedAtUtc: response.executedAtUtc, buckets: result.rows.map(parseBucket) };
}

export function audienceTotal(report: AudienceReport, value: string): number {
  const bucket = report.buckets.find((row) => row.dimension === "summary" && row.value === value);
  if (bucket === undefined) {
    throw new Error(`Audience summary is missing ${value}.`);
  }
  return bucket.users;
}

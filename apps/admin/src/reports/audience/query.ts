import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildCatalogAttributionFiltersSql,
  buildConnectionCountriesFilterSql,
  buildConnectionCountrySamplesSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorsFilterSql,
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
// about which day a person was new on. THE TWO DENOMINATORS STILL DIFFER, by exactly the admin
// accounts: `history` below drops every user with an unrevoked `auth.admin_users` grant, which the
// daily active users section keeps, and on production history admin activity is most of the traffic.
// Reconciling this section's user count against that one's unique users has to allow for that gap.
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
    LEFT JOIN org.user_settings AS settings ON lower(settings.user_id) = events.actor_id::text
    WHERE events.event_name = 'app_opened'
      AND events.actor_id IS NOT NULL
      AND events.occurred_at < bounds.ends_at
      AND COALESCE(lower(settings.email), '') NOT LIKE '%@example.com'
      AND ${buildExcludedActorsFilterSql("events.actor_id::text")}
      AND ${buildTrustedActorRowsFilterSql("events.trust_level")}
      AND NOT EXISTS (
        SELECT 1 FROM auth.admin_users AS admins
        WHERE lower(admins.email) = lower(settings.email) AND admins.revoked_at IS NULL
      )
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
  ), actor_coverage AS (
    SELECT actors.actor_id,
      (SELECT count(*) FROM countries WHERE countries.actor_id = actors.actor_id) AS countries,
      (SELECT count(*) FROM languages WHERE languages.actor_id = actors.actor_id) AS languages,
      EXISTS (SELECT 1 FROM pairs WHERE pairs.actor_id = actors.actor_id) AS has_pair,
      EXISTS (SELECT 1 FROM language_events WHERE language_events.actor_id = actors.actor_id
        AND language_events.ui_locale IS NULL) AS has_unknown_language,
      EXISTS (SELECT 1 FROM sampled_events WHERE sampled_events.actor_id = actors.actor_id) AS has_sample
    FROM actors
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
      count(*) FILTER (WHERE has_sample) AS sampled
    FROM actor_coverage
  ) AS totals
  CROSS JOIN LATERAL (VALUES
    ('total', totals.total), ('country_known', totals.country_known), ('country_unknown', totals.country_unknown),
    ('language_known', totals.language_known), ('language_unknown', totals.language_unknown),
    ('multi_country', totals.multi_country), ('multi_language', totals.multi_language),
    ('pair_known', totals.pair_known), ('pair_unknown', totals.pair_unknown),
    ('missing_language_events', totals.missing_language_events), ('sampled', totals.sampled)
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

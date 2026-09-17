import { runAdminQuery, type AdminQueryRow, type ReviewEventCohort, type ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";
import { assertIsString, assertValidDateRange, toInteger } from "../reportValues";

export type AudiencePopulation = "active" | "reviewed";
export type AudienceFilters = Readonly<{
  from: string;
  to: string;
  population: AudiencePopulation;
  selectedUserIds: ReadonlyArray<string>;
  selectedCohorts: ReadonlyArray<ReviewEventCohort>;
  selectedPlatforms: ReadonlyArray<ReviewEventPlatform>;
}>;

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

function sqlSelection(column: string, values: ReadonlyArray<string>): string {
  return values.length === 0 ? "FALSE" : `${column} IN (${values.map(escapeSqlStringLiteral).join(", ")})`;
}

export function buildAudienceSql(filters: AudienceFilters): string {
  assertValidDateRange(filters, "Audience");
  const eventName = filters.population === "active" ? "app_opened" : "review_answered";
  const userSelection = filters.selectedUserIds.length === 0
    ? "TRUE" : sqlSelection("history.actor_id::text", filters.selectedUserIds);
  const platformSelection = sqlSelection("COALESCE(events.platform, 'unattributed')", filters.selectedPlatforms);
  const cohortSelection = sqlSelection(
    "CASE WHEN history.event_date = history.first_date THEN 'new' ELSE 'returning' END",
    filters.selectedCohorts,
  );

  // Endpoint equality proves the accepted sampling batch, not the queued event's location.
  // There is deliberately no interval overlap or installation_profiles.user_id ownership join.
  return `WITH bounds AS (
    SELECT (${escapeSqlStringLiteral(filters.from)}::date)::timestamp AT TIME ZONE 'UTC' AS starts_at,
      (${escapeSqlStringLiteral(filters.to)}::date + 1)::timestamp AT TIME ZONE 'UTC' AS ends_at,
      now() - INTERVAL '90 days' AS retained_since
  ), history AS MATERIALIZED (
    SELECT events.actor_id, events.platform, events.occurred_at,
      (events.occurred_at AT TIME ZONE 'UTC')::date AS event_date,
      MIN((events.occurred_at AT TIME ZONE 'UTC')::date) OVER (PARTITION BY events.actor_id) AS first_date
    FROM analytics.product_events_resolved AS events
    CROSS JOIN bounds
    LEFT JOIN org.user_settings AS settings ON lower(settings.user_id) = events.actor_id::text
    WHERE events.event_name = '${eventName}'
      AND events.actor_id IS NOT NULL
      AND events.occurred_at < bounds.ends_at
      AND COALESCE(lower(settings.email), '') NOT LIKE '%@example.com'
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
      AND ${sqlSelection("COALESCE(history.platform, 'unattributed')", filters.selectedPlatforms)}
  ), actors AS (
    SELECT DISTINCT actor_id FROM cohort_events
  ), language_events AS MATERIALIZED (
    SELECT events.actor_id, events.anonymous_id, events.platform, events.server_received_at, events.ui_locale
    FROM analytics.product_events_resolved AS events
    JOIN actors ON actors.actor_id = events.actor_id
    CROSS JOIN bounds
    WHERE events.occurred_at >= bounds.starts_at AND events.occurred_at < bounds.ends_at
      AND ${platformSelection}
  ), endpoints AS MATERIALIZED (
    SELECT DISTINCT observation.anonymous_id, observation.platform, observation.country, endpoint.sample_time
    FROM analytics.installation_country_observations AS observation
    CROSS JOIN bounds
    CROSS JOIN LATERAL (VALUES (observation.first_seen), (observation.sampled_at)) AS endpoint(sample_time)
    WHERE observation.last_seen >= bounds.retained_since
      AND endpoint.sample_time >= bounds.retained_since
      AND endpoint.sample_time >= bounds.starts_at AND endpoint.sample_time < bounds.ends_at
  ), sampled_events AS MATERIALIZED (
    SELECT DISTINCT events.actor_id, endpoints.country, events.ui_locale
    FROM endpoints
    JOIN analytics.product_events_resolved AS events
      ON events.anonymous_id = endpoints.anonymous_id
      AND events.platform = endpoints.platform
      AND events.server_received_at = endpoints.sample_time
    JOIN actors ON actors.actor_id = events.actor_id
    CROSS JOIN bounds
    WHERE events.origin = 'client'
      AND events.occurred_at >= bounds.starts_at AND events.occurred_at < bounds.ends_at
      AND ${platformSelection}
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

export async function loadAudienceReport(config: AdminAppConfig, filters: AudienceFilters): Promise<AudienceReport> {
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

import type { ReviewEventPlatform } from "../../adminApi";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  buildAppVersionsFilterSql,
  buildAppVersionsNarrowingSql,
  buildEventPlatformsNarrowingSql,
  buildExcludedActorSqlLines,
  buildTrustedActorRowsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import type { DailyActivitySource } from "../dailyNewReturning/query";
import { buildReportBucketSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";

const appOpenRowsFromSql = `FROM analytics.product_events_resolved AS events
  WHERE events.event_name = 'app_opened'
    AND ${buildTrustedActorRowsFilterSql("events.trust_level")}`;

// No bounds: first open must survive every selection, and today's opens are shown in progress.
// Coverage is read before exclusions.
export function buildAppOpenActivityCtesSql(): string {
  return `app_open_rows AS MATERIALIZED (
  SELECT events.actor_id::text AS actor_id,
    (events.occurred_at AT TIME ZONE 'UTC')::date AS activity_date
  ${appOpenRowsFromSql}
), app_open_coverage AS (
  SELECT MIN(activity_date) AS history_from FROM app_open_rows
), app_open_activity AS MATERIALIZED (
  SELECT DISTINCT app_open_rows.actor_id, app_open_rows.activity_date
  FROM app_open_rows
  WHERE app_open_rows.actor_id IS NOT NULL
${buildExcludedActorSqlLines("app_open_rows.actor_id").join("\n")}
), app_open_first_use AS MATERIALIZED (
  SELECT actor_id, MIN(activity_date) AS first_use_date
  FROM app_open_activity
  GROUP BY actor_id
)`;
}

export const appOpenActivitySource: DailyActivitySource = {
  ctesSql: buildAppOpenActivityCtesSql(),
  activityCte: "app_open_activity",
  firstUseCte: "app_open_first_use",
  coverageCte: "app_open_coverage",
  eventRowsFromSql: appOpenRowsFromSql,
  eventRowsAppVersionSql: "events.app_version",
};

/**
 * The `app_open_first_use_platform` CTE, composed after `buildAppOpenActivityCtesSql`: for each person
 * whose first open falls in `range`, the `platform` of the `app_opened` that is that first open
 * (earliest `occurred_at`, then `event_id`).
 */
export function buildAppOpenFirstUsePlatformCteSql(range: AnalyticsDateRange): string {
  return `app_open_first_use_platform AS (
  SELECT DISTINCT ON (range_opens.actor_id) range_opens.actor_id, range_opens.platform
  FROM (
    SELECT events.actor_id::text AS actor_id, events.occurred_at, events.event_id, events.platform
    ${appOpenRowsFromSql}
      AND events.occurred_at >= (${escapeSqlStringLiteral(range.from)}::date)::timestamp AT TIME ZONE 'UTC'
      AND events.occurred_at < (${escapeSqlStringLiteral(range.to)}::date + 1)::timestamp AT TIME ZONE 'UTC'
  ) AS range_opens
  JOIN app_open_first_use ON app_open_first_use.actor_id = range_opens.actor_id
    AND app_open_first_use.first_use_date = (range_opens.occurred_at AT TIME ZONE 'UTC')::date
  ORDER BY range_opens.actor_id, range_opens.occurred_at, range_opens.event_id
)`;
}

/**
 * The `app_open_last_opens` CTE, composed after `buildAppOpenActivityCtesSql`: one row per bucket of
 * the range and person `app_open_activity` counts in it on `eventPlatforms` and `appVersions` (`[]` for
 * every version), carrying that person's last `app_opened` there in the bucket (latest `occurred_at`,
 * then `event_id`), so a breakdown places each person once per bar.
 */
export function buildAppOpenLastOpensCteSql(
  period: ReportPeriod,
  range: AnalyticsDateRange,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  appVersions: ReadonlyArray<string>,
): string {
  const appVersionsNarrowingSql = appVersions.length === 0
    ? ""
    : `\n      ${buildAppVersionsNarrowingSql("events.app_version", appVersions)}`;
  return `app_open_last_opens AS (
  SELECT DISTINCT ON (range_opens.bucket_date, range_opens.actor_id) range_opens.*
  FROM (
    SELECT events.actor_id::text AS actor_id,
      (events.occurred_at AT TIME ZONE 'UTC')::date AS activity_date,
      ${buildReportBucketSql(period, "(events.occurred_at AT TIME ZONE 'UTC')::date")} AS bucket_date,
      events.occurred_at, events.event_id, events.platform, events.ui_locale, events.trust_level, events.app_version
    ${appOpenRowsFromSql}
      AND events.occurred_at >= (${escapeSqlStringLiteral(range.from)}::date)::timestamp AT TIME ZONE 'UTC'
      AND events.occurred_at < (${escapeSqlStringLiteral(range.to)}::date + 1)::timestamp AT TIME ZONE 'UTC'
      ${buildEventPlatformsNarrowingSql("COALESCE(events.platform, 'unattributed')", eventPlatforms)}${appVersionsNarrowingSql}
  ) AS range_opens
  JOIN app_open_activity USING (actor_id, activity_date)
  ORDER BY range_opens.bucket_date, range_opens.actor_id, range_opens.occurred_at DESC, range_opens.event_id DESC
)`;
}

/**
 * The CTEs, ending in `app_version_people`, by which a chart whose own rows carry no app version keeps
 * a person in a bar only when their last app open there on `eventPlatforms`, as `app_open_last_opens`
 * reads it, carries one of `appVersions`: one `(bucket_date, actor_id)` row per bar and person kept.
 * Their CTE names do not collide with `buildMeaningfulActivityCtesSql`'s.
 */
export function buildLastAppOpenVersionPeopleCtesSql(
  period: ReportPeriod,
  range: AnalyticsDateRange,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  appVersions: ReadonlyArray<string>,
): string {
  return `${buildAppOpenActivityCtesSql()}, ${buildAppOpenLastOpensCteSql(period, range, eventPlatforms, [])}, app_version_people AS MATERIALIZED (
  SELECT last_open.bucket_date, last_open.actor_id
  FROM app_open_last_opens AS last_open
  WHERE ${buildAppVersionsFilterSql("last_open.app_version", appVersions)}
)`;
}

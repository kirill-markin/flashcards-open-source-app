import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildExcludedActorSqlLines, buildTrustedActorRowsFilterSql } from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { buildReportBucketSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";

// The same `app_opened` rows, trust rule and actor exclusions as `buildDailyActiveUsersSql` in
// `../dailyActiveUsers/query.ts`, whose header explains them.
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

/**
 * The `app_open_last_opens` CTE, composed after `buildAppOpenActivityCtesSql`: one row per bucket of
 * the range and person `app_open_activity` counts in it, carrying that person's last `app_opened` in
 * the bucket (latest `occurred_at`, then `event_id`), so a breakdown places each person once per bar.
 */
export function buildAppOpenLastOpensCteSql(period: ReportPeriod, range: AnalyticsDateRange): string {
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
  ) AS range_opens
  JOIN app_open_activity USING (actor_id, activity_date)
  ORDER BY range_opens.bucket_date, range_opens.actor_id, range_opens.occurred_at DESC, range_opens.event_id DESC
)`;
}

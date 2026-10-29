import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildExcludedActorSqlLines } from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { buildReportBucketColumnsSql, buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";

// `reason` and `period_type` reached `autorenew_disabled` on 2026-10-04 15:58 UTC; this is the first full UTC day carrying both.
export const cancellationsTrackedFrom = "2026-10-05";

/**
 * Per bucket, the renewals a person turned off (`billing_error` is a failed charge, not a choice), on
 * the UTC day of the provider's own time. Every count is NULL for a bucket wholly before `cancellationsTrackedFrom`.
 */
export function buildCancellationsSql(period: ReportPeriod, range: AnalyticsDateRange): string {
  const trackedFromSql = `${escapeSqlStringLiteral(cancellationsTrackedFrom)}::date`;
  return `WITH ${buildReportBucketsCteSql(period, range)},
cancellations AS (
  SELECT (events.occurred_at AT TIME ZONE 'UTC')::date AS cancelled_on,
    events.event_properties->>'period_type' AS period_type,
    events.event_properties->>'survey_reason' AS survey_reason
  FROM analytics.product_events_resolved AS events
  WHERE events.event_name = 'autorenew_disabled' AND events.origin = 'server'
    AND events.event_properties->>'reason' IN ('voluntary', 'unknown')
    AND events.occurred_at >= ${trackedFromSql}::timestamp AT TIME ZONE 'UTC'
    AND events.occurred_at >= (${escapeSqlStringLiteral(range.from)}::date)::timestamp AT TIME ZONE 'UTC'
    AND events.occurred_at < (${escapeSqlStringLiteral(range.to)}::date + 1)::timestamp AT TIME ZONE 'UTC'
${buildExcludedActorSqlLines("events.actor_id::text").join("\n")}
), bucketed AS (
  SELECT buckets.bucket_date, buckets.selected_from, buckets.selected_to,
    COUNT(cancellations.cancelled_on) AS total,
    COUNT(*) FILTER (WHERE cancellations.period_type = 'trial') AS trial,
    COUNT(*) FILTER (WHERE cancellations.period_type = 'paid') AS paid
  FROM report_buckets AS buckets
  LEFT JOIN cancellations ON cancellations.cancelled_on BETWEEN buckets.selected_from AND buckets.selected_to
  GROUP BY buckets.bucket_date, buckets.selected_from, buckets.selected_to
), surveyed AS (
  SELECT bucket_date, jsonb_object_agg(survey_reason, answers) AS survey_reasons
  FROM (
    SELECT buckets.bucket_date, cancellations.survey_reason, COUNT(*) AS answers
    FROM report_buckets AS buckets
    JOIN cancellations ON cancellations.cancelled_on BETWEEN buckets.selected_from AND buckets.selected_to
    WHERE cancellations.survey_reason IS NOT NULL
    GROUP BY buckets.bucket_date, cancellations.survey_reason
  ) AS survey_counts
  GROUP BY bucket_date
)
SELECT ${buildReportBucketColumnsSql("bucketed")},
  CASE WHEN bucketed.selected_to >= ${trackedFromSql} THEN bucketed.total END AS total,
  CASE WHEN bucketed.selected_to >= ${trackedFromSql} THEN bucketed.trial END AS trial,
  CASE WHEN bucketed.selected_to >= ${trackedFromSql} THEN bucketed.paid END AS paid,
  CASE WHEN bucketed.selected_to >= ${trackedFromSql} THEN COALESCE(surveyed.survey_reasons, '{}'::jsonb) END AS survey_reasons
FROM bucketed LEFT JOIN surveyed USING (bucket_date)
ORDER BY bucketed.bucket_date`;
}

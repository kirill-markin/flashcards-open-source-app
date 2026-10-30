import { runAdminQuery, type AdminQueryResponse, type ReviewEventPlatform } from "../../adminApi";
import { breakdownOtherValue, breakdownUnknownValue } from "../../charts/stackedBreakdownChart";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  buildBreakdownSql,
  buildBreakdownValueSql,
  loadBreakdownReport,
  parseBreakdownReport,
} from "../levelOneMetrics/breakdownQuery";
import { liveSourceBarFreshness, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import { buildMeaningfulActivityCtesSql, buildMeaningfulRangeReviewsCteSql } from "../levelOneMetrics/meaningfulActivitySql";
import { buildReportBucketsCteSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertIsString, assertValidDateRange } from "../reportValues";

const personReportLabel = "Review events by person report";
const platformReportLabel = "Review events by platform report";

/** Whether a person breakdown value is an actor id rather than Other or Unknown. */
export function isNamedPerson(value: string): boolean {
  return value !== breakdownOtherValue && value !== breakdownUnknownValue;
}

// Every answered review on a selected platform the Who studied people made in an available bar, each
// under `valueSql` over its `meaningful_range_reviews` row.
function buildReviewEventsBreakdownSql(
  valueSql: string,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return buildBreakdownSql(`${buildMeaningfulActivityCtesSql()}, ${buildReportBucketsCteSql(period, range)}, ${buildMeaningfulRangeReviewsCteSql(period, range, eventPlatforms)}, measured_buckets AS (
  SELECT buckets.bucket_date
  FROM report_buckets AS buckets
  CROSS JOIN activity_coverage AS coverage
  WHERE buckets.selected_from >= coverage.history_from
), measured_values AS (
  SELECT review.bucket_date,
    ${buildBreakdownValueSql(valueSql)} AS dimension_value,
    1 AS value_count
  FROM meaningful_range_reviews AS review
  JOIN measured_buckets USING (bucket_date)
)`);
}

/**
 * The person breakdown, each series value an `actor_id`, plus `series_email`: the account email of
 * that actor, NULL for Other and an actor with none. The email join folds `org.user_settings.user_id`
 * with `pg_catalog.lower` because `actor_id` renders canonical lowercase hex while `user_id` is an
 * unconstrained TEXT key.
 */
function buildReviewEventsByPersonSql(
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
): string {
  return `SELECT breakdown.*, actor_email.email AS series_email
FROM (
${buildReviewEventsBreakdownSql("review.actor_id", dateRange, period, eventPlatforms, personReportLabel)}
) AS breakdown
LEFT JOIN (
  SELECT pg_catalog.lower(settings.user_id) AS actor_id, MIN(NULLIF(btrim(settings.email), '')) AS email
  FROM org.user_settings AS settings
  GROUP BY pg_catalog.lower(settings.user_id)
) AS actor_email ON actor_email.actor_id = breakdown.series_value
ORDER BY breakdown.bucket_date, breakdown.series_rank`;
}

/** A named person's label: their account email, else `(no email)` and the start of their actor id. */
function parsePersonLabels(response: AdminQueryResponse): ReadonlyMap<string, string> {
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${personReportLabel} must return one result set.`);
  }
  return new Map(result.rows.flatMap((row) => {
    if ((row.series_value ?? null) === null) return [];
    const actorId = assertIsString(row.series_value ?? null, personReportLabel, "series_value");
    if (!isNamedPerson(actorId)) return [];
    const email = row.series_email ?? null;
    return [[actorId, email === null ? `(no email) ${actorId.slice(0, 8)}` : assertIsString(email, personReportLabel, "series_email")] as const];
  }));
}

export async function loadReviewEventsByPersonReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  signal: AbortSignal,
): Promise<BreakdownReport> {
  const response = await runAdminQuery(config, buildReviewEventsByPersonSql(dateRange, period, eventPlatforms), signal);
  return {
    ...parseBreakdownReport(response, period, personReportLabel, liveSourceBarFreshness),
    valueLabels: parsePersonLabels(response),
  };
}

export function loadReviewEventsByPlatformReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  signal: AbortSignal,
): Promise<BreakdownReport> {
  return loadBreakdownReport(
    config,
    buildReviewEventsBreakdownSql("review.platform", dateRange, period, eventPlatforms, platformReportLabel),
    period,
    platformReportLabel,
    liveSourceBarFreshness,
    signal,
  );
}

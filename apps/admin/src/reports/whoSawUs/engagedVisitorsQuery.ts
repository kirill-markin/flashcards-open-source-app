import { runAdminQuery } from "../../adminApi";
import type { ChartNote } from "../../charts/chartNotes";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import { buildHashedVisitorDaySql } from "../funnels/funnelAudienceSql";
import {
  buildReportBucketColumnsSql,
  buildReportBucketSql,
  buildReportBucketsCteSql,
  parseReportBucket,
  type ReportBucket,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange, parseActivityCount, parseActivityDate } from "../reportValues";
import { buildHashedSiteFactFilterSql, buildIdentifiedSiteFactFilterSql, buildSiteEventNamesSql } from "./query";

const reportLabel = "Engaged visitors report";

/**
 * The site facts that make a visitor-day engaged beside its page views: every marketing-site event,
 * the deck page's `catalog_install_clicked` included, except `sitePassiveImpressionEventNames`.
 * Listed by name rather than as a `NOT IN` so the (event_name, occurred_at) index stays usable; a new
 * site event counts only once added here.
 */
const siteEngagementEventNames: ReadonlyArray<string> = [
  "site_page_engaged",
  "site_app_entry_clicked",
  "site_internal_cta_clicked",
  "site_outbound_clicked",
  "site_catalog_searched",
  "site_catalog_filtered",
  "site_catalog_sorted",
  "site_catalog_paginated",
  "site_catalog_deck_opened",
  "site_copy_action",
  "site_locale_suggestion_answered",
  "site_consent_granted",
  "catalog_install_clicked",
];

/** Site events sent without a visitor action; they count toward engagement only before `engagedRuleSwitchInstant`. */
const sitePassiveImpressionEventNames: ReadonlyArray<string> = [
  "site_app_entry_shown",
  "site_locale_suggestion_shown",
  "site_store_qr_shown",
  "site_consent_prompt_shown",
  "site_consent_declined",
  "site_collection_disabled",
  "site_collection_enabled",
];

/** The production deploy of website PR #692, from which the site sends page reads (`site_page_engaged`). */
export const engagedRuleSwitchInstant = "2026-10-19T21:06:34Z";

export const engagedRuleSwitchLabel = `${engagedRuleSwitchInstant.slice(0, 10)} ${engagedRuleSwitchInstant.slice(11, 16)} UTC`;

export const pageReadEngagementChartNote: ChartNote = {
  at: engagedRuleSwitchInstant,
  shortText: "Engaged rule changes",
  longText: `Before ${engagedRuleSwitchLabel}, any two site events of a visitor's day counted as engaged, automatic ones such as a shown app button or cookie prompt included, as a looser stand-in because the site did not send page reads yet. From here only a second page view or a real site action counts, including a 10+ second page read with a scroll, click or key press.`,
};

const siteActiveFactEventNames: ReadonlyArray<string> = ["site_page_viewed", ...siteEngagementEventNames];

/** The rows engagement is counted over; any two that `buildSiteEngagementFactSql` accepts engage. */
export const siteFactEventNames: ReadonlyArray<string> = [...siteActiveFactEventNames, ...sitePassiveImpressionEventNames];

/** Whether one site fact counts toward engagement: a page view or site action always, an impression only before the switch. */
export function buildSiteEngagementFactSql(rowAlias: string): string {
  return [
    `(${buildSiteEventNamesSql(rowAlias, siteActiveFactEventNames)}`,
    ` OR (${buildSiteEventNamesSql(rowAlias, sitePassiveImpressionEventNames)}`,
    ` AND ${rowAlias}.occurred_at < ${escapeSqlStringLiteral(engagedRuleSwitchInstant)}::timestamptz))`,
  ].join("");
}

export type EngagedVisitorsBucket = Readonly<{
  bucket: ReportBucket;
  /** NULL exactly where the `web` series is: the bucket has no site visitor at all. */
  engagedVisitors: number | null;
}>;

export type EngagedVisitorsReport = Readonly<{
  generatedAtUtc: string;
  period: ReportPeriod;
  today: string;
  /** Every bucket of the range, oldest first. */
  buckets: ReadonlyArray<EngagedVisitorsBucket>;
}>;

/**
 * `identified_visitor_days(actor_id, visit_date, is_engaged)` and
 * `hashed_visitor_days(daily_visitor_hash, visit_date, is_engaged)`: the `web` series' visitor-days.
 *
 * A visitor-day is one of that series' people on one UTC day, keyed as the series keys them: an
 * identified visitor on the UTC day of `occurred_at`, a cookieless one on the hash's salt day. It
 * exists only with a page view, so every engaged visitor is a `web` visitor of the same bucket, and
 * it is engaged with two facts of the day that `buildSiteEngagementFactSql` accepts.
 */
export function buildSiteVisitorDaysCtesSql(range: AnalyticsDateRange): string {
  const identifiedDaySql = "(site_fact.occurred_at AT TIME ZONE 'UTC')::date";
  const hashedDaySql = buildHashedVisitorDaySql("hashed_fact");
  return [
    "identified_visitor_days AS (",
    "  SELECT",
    "    site_fact.actor_id,",
    `    ${identifiedDaySql} AS visit_date,`,
    `    COUNT(*) FILTER (WHERE ${buildSiteEngagementFactSql("site_fact")}) >= 2 AS is_engaged`,
    "  FROM analytics.product_events_resolved AS site_fact",
    `  WHERE ${buildIdentifiedSiteFactFilterSql("site_fact", siteFactEventNames, range)}`,
    `  GROUP BY site_fact.actor_id, ${identifiedDaySql}`,
    "  HAVING COUNT(*) FILTER (WHERE site_fact.event_name = 'site_page_viewed') > 0",
    "), hashed_visitor_days AS (",
    "  SELECT",
    "    hashed_fact.daily_visitor_hash,",
    `    ${hashedDaySql} AS visit_date,`,
    `    COUNT(*) FILTER (WHERE ${buildSiteEngagementFactSql("hashed_fact")}) >= 2 AS is_engaged`,
    "  FROM analytics.product_events_resolved AS hashed_fact",
    `  WHERE ${buildHashedSiteFactFilterSql("hashed_fact", siteFactEventNames, range)}`,
    `  GROUP BY hashed_fact.daily_visitor_hash, ${hashedDaySql}`,
    "  HAVING COUNT(*) FILTER (WHERE hashed_fact.event_name = 'site_page_viewed') > 0",
    ")",
  ].join("\n");
}

/**
 * One row per bucket of the range: the `web` series' visitors who did more than open one page, over
 * `buildSiteVisitorDaysCtesSql`. The buckets combine the two cohorts as the series does: an
 * identified visitor engaged on any of the bucket's days counts once, cookieless visitor-days are
 * summed.
 */
export function buildEngagedVisitorsSql(dateRange: AnalyticsDateRange, period: ReportPeriod): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const identifiedBucketSql = buildReportBucketSql(period, "identified.visit_date");
  const hashedBucketSql = buildReportBucketSql(period, "hashed.visit_date");

  return [
    `WITH ${buildReportBucketsCteSql(period, range)}, ${buildSiteVisitorDaysCtesSql(range)}, engaged_visitors AS (`,
    "  SELECT",
    `    ${identifiedBucketSql} AS bucket_date,`,
    "    COUNT(DISTINCT identified.actor_id) FILTER (WHERE identified.is_engaged) AS visitor_count",
    "  FROM identified_visitor_days AS identified",
    `  GROUP BY ${identifiedBucketSql}`,
    "  UNION ALL",
    "  SELECT",
    `    ${hashedBucketSql} AS bucket_date,`,
    "    COUNT(*) FILTER (WHERE hashed.is_engaged) AS visitor_count",
    "  FROM hashed_visitor_days AS hashed",
    `  GROUP BY ${hashedBucketSql}`,
    "), engaged_buckets AS (",
    "  SELECT engaged_visitors.bucket_date, SUM(engaged_visitors.visitor_count)::bigint AS visitor_count",
    "  FROM engaged_visitors",
    "  GROUP BY engaged_visitors.bucket_date",
    ")",
    "SELECT",
    `  ${buildReportBucketColumnsSql("buckets")},`,
    "  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,",
    "  engaged.visitor_count AS engaged_visitors",
    "FROM report_buckets AS buckets",
    "LEFT JOIN engaged_buckets AS engaged ON engaged.bucket_date = buckets.bucket_date",
    "ORDER BY buckets.bucket_date",
  ].join("\n");
}

export async function loadEngagedVisitorsReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  signal: AbortSignal,
): Promise<EngagedVisitorsReport> {
  const response = await runAdminQuery(config, buildEngagedVisitorsSql(dateRange, period), signal);
  const resultSet = response.resultSets[0];
  const firstRow = resultSet?.rows[0];
  if (response.resultSets.length !== 1 || resultSet === undefined || firstRow === undefined) {
    throw new Error(`${reportLabel} must return one result set with at least one bucket.`);
  }

  return {
    generatedAtUtc: response.executedAtUtc,
    period,
    today: parseActivityDate(firstRow.today ?? null, reportLabel, "today"),
    buckets: resultSet.rows.map((row) => ({
      bucket: parseReportBucket(row, reportLabel),
      engagedVisitors: parseActivityCount(row.engaged_visitors ?? null, reportLabel, "engaged_visitors"),
    })),
  };
}

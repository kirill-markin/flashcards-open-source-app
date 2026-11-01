import type { ChartNote } from "../../charts/chartNotes";
import type { AnalyticsDateRange, SiteVisitorFilterState } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import { buildHashedVisitorDaySql } from "../funnels/funnelAudienceSql";
import { buildReportBucketSql, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import {
  buildHashedSiteFactFilterSql,
  buildHashedSiteViewFilterSql,
  buildIdentifiedSiteFactFilterSql,
  buildIdentifiedSiteViewFilterSql,
  buildSiteEventNamesSql,
  buildSiteVisitorFilterSql,
} from "./siteFactSql";

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

/** The UTC day of an identified site row, which with `actor_id` keys a visitor-day. */
export function buildIdentifiedVisitorDaySql(rowAlias: string): string {
  return `(${rowAlias}.occurred_at AT TIME ZONE 'UTC')::date`;
}

/**
 * `identified_visitor_days(actor_id, visit_date, is_engaged)` and
 * `hashed_visitor_days(daily_visitor_hash, visit_date, is_engaged)`: the site's visitor-days, whose
 * engaged ones the `web` series counts.
 *
 * A visitor-day is one site visitor on one UTC day, keyed as the series keys them: an identified
 * visitor on the UTC day of `occurred_at`, a cookieless one on the hash's salt day. It exists only
 * with a page view, and it is engaged with two facts of the day that `buildSiteEngagementFactSql`
 * accepts.
 */
export function buildSiteVisitorDaysCtesSql(range: AnalyticsDateRange): string {
  const identifiedDaySql = buildIdentifiedVisitorDaySql("site_fact");
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
 * Over `buildSiteVisitorDaysCtesSql`'s CTEs, the visitors the `web` series counts, keyed
 * as `buildSiteFirstViewsCtesSql` counts a visitor once: `engaged_identified_visitors(bucket_date,
 * actor_id)`, engaged on a day of that bucket, and `engaged_hashed_visitors(daily_visitor_hash,
 * visit_date)`, engaged on that hash day.
 */
function buildSiteEngagedVisitorKeysCtesSql(range: AnalyticsDateRange, period: ReportPeriod): string {
  return `${buildSiteVisitorDaysCtesSql(range)}, engaged_identified_visitors AS MATERIALIZED (
  SELECT DISTINCT ${buildReportBucketSql(period, "visit_date")} AS bucket_date, actor_id
  FROM identified_visitor_days
  WHERE is_engaged
), engaged_hashed_visitors AS MATERIALIZED (
  SELECT daily_visitor_hash, visit_date
  FROM hashed_visitor_days
  WHERE is_engaged
)`;
}

/**
 * The first page view of each `web` series visitor in the unit the series counts them once in: the
 * bucket for an identified visitor, the hash day for a cookieless one. Two CTEs,
 * `identified_first_views` and `hashed_first_views`, each a `bucket_date` plus the columns
 * `columnsSqlOf` selects off the view. Engagement keeps or drops a visitor's views whole, by
 * `buildSiteEngagedVisitorKeysCtesSql`, so their first view is their first page view of that unit.
 * `siteFilters` is tested on that first view only after it is picked, so it keeps or drops the
 * visitor whole rather than moving them to a later view that matches.
 */
export function buildSiteFirstViewsCtesSql(
  columnsSqlOf: (rowAlias: string) => string,
  range: AnalyticsDateRange,
  period: ReportPeriod,
  siteFilters: SiteVisitorFilterState,
): string {
  const identifiedBucketSql = buildReportBucketSql(period, "(site_view.occurred_at AT TIME ZONE 'UTC')::date");
  const hashedVisitorDaySql = buildHashedVisitorDaySql("hashed_view");
  return `${buildSiteEngagedVisitorKeysCtesSql(range, period)}, identified_first_views AS (
  SELECT first_view.* FROM (
    SELECT DISTINCT ON (${identifiedBucketSql}, site_view.actor_id)
      ${identifiedBucketSql} AS bucket_date,
      ${buildSiteVisitorFilterSql("site_view", siteFilters)} AS passes_site_filters,
      ${columnsSqlOf("site_view")}
    FROM analytics.product_events_resolved AS site_view
    WHERE ${buildIdentifiedSiteViewFilterSql("site_view", range)}
    AND (${identifiedBucketSql}, site_view.actor_id) IN (SELECT bucket_date, actor_id FROM engaged_identified_visitors)
    ORDER BY ${identifiedBucketSql}, site_view.actor_id, site_view.occurred_at, site_view.event_id
  ) AS first_view
  WHERE first_view.passes_site_filters
), hashed_first_views AS (
  SELECT first_view.* FROM (
    SELECT DISTINCT ON (${hashedVisitorDaySql}, hashed_view.daily_visitor_hash)
      ${buildReportBucketSql(period, hashedVisitorDaySql)} AS bucket_date,
      ${buildSiteVisitorFilterSql("hashed_view", siteFilters)} AS passes_site_filters,
      ${columnsSqlOf("hashed_view")}
    FROM analytics.product_events_resolved AS hashed_view
    WHERE ${buildHashedSiteViewFilterSql("hashed_view", range)}
    AND (hashed_view.daily_visitor_hash, ${hashedVisitorDaySql}) IN (SELECT daily_visitor_hash, visit_date FROM engaged_hashed_visitors)
    ORDER BY ${hashedVisitorDaySql}, hashed_view.daily_visitor_hash, hashed_view.occurred_at, hashed_view.event_id
  ) AS first_view
  WHERE first_view.passes_site_filters
)`;
}

/**
 * `measured_buckets` over `buildSiteVisitorDaysCtesSql`'s CTEs: the bars with a site visitor-day,
 * engaged or not, so a bar without an engaged visitor counts zero, as on the `web` series.
 */
export function buildSiteMeasuredBucketsCteSql(period: ReportPeriod): string {
  return `measured_buckets AS (
  SELECT ${buildReportBucketSql(period, "visit_date")} AS bucket_date FROM identified_visitor_days
  UNION
  SELECT ${buildReportBucketSql(period, "visit_date")} AS bucket_date FROM hashed_visitor_days
)`;
}

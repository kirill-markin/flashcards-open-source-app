import type { ChartNote } from "../../charts/chartNotes";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import { buildHashedVisitorDaySql } from "../funnels/funnelAudienceSql";
import { buildHashedSiteFactFilterSql, buildIdentifiedSiteFactFilterSql, buildSiteEventNamesSql } from "./siteFactSql";

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

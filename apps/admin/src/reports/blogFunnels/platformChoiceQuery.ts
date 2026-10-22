import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange, AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { buildHashedPageViewFilterSqlLines, buildHashedVisitorDaySql } from "../funnels/funnelAudienceSql";
import { assertValidDateRange, laterCalendarDate, toInteger } from "../reportValues";
import { buildSiteEngagementFactSql, siteFactEventNames } from "../whoSawUs/engagedVisitorsQuery";
import {
  buildHashedSiteFactFilterSql,
  buildIdentifiedSiteFactFilterSql,
  buildSiteEventNamesSql,
} from "../whoSawUs/siteFactSql";
import { blogFunnelStartDate } from "./blogFunnelEntry";

/** Step four's rows: a QR card shown on a store button's hover or focus, or a click on any platform. */
const platformHoverOrClickEventNames: ReadonlyArray<string> = ["site_store_qr_shown", "site_app_entry_clicked"];

/** Every row any step reads, so each identity's rows are read once for all five steps. */
const stepEventNames: ReadonlyArray<string> = [...new Set([...siteFactEventNames, ...platformHoverOrClickEventNames])];

export type BlogPlatformChoiceFunnelCounts = Readonly<{
  articleViewCount: number;
  engagedCount: number;
  homeViewCount: number;
  platformHoverOrClickCount: number;
  platformClickCount: number;
}>;

export type BlogPlatformChoiceFunnelReport = Readonly<{
  generatedAtUtc: string;
  counts: BlogPlatformChoiceFunnelCounts;
}>;

function buildPageViewSql(rowAlias: string, pageKind: string): string {
  return `${rowAlias}.event_name = 'site_page_viewed' AND ${rowAlias}.event_properties ->> 'page_kind' = ${escapeSqlStringLiteral(pageKind)}`;
}

/** Steps two to five of one identity, as aggregate columns over that identity's rows in the range. */
function buildReaderStepSqlLines(rowAlias: string): ReadonlyArray<string> {
  return [
    `    COUNT(*) FILTER (WHERE ${buildSiteEngagementFactSql(rowAlias)}) >= 2 AS engaged,`,
    `    COUNT(*) FILTER (WHERE ${buildPageViewSql(rowAlias, "home")}) > 0 AS viewed_home,`,
    `    COUNT(*) FILTER (WHERE ${buildSiteEventNamesSql(rowAlias, platformHoverOrClickEventNames)}) > 0 AS hovered_or_clicked,`,
    `    COUNT(*) FILTER (WHERE ${rowAlias}.event_name = 'site_app_entry_clicked') > 0 AS clicked`,
  ];
}

const readerStepColumnNames: ReadonlyArray<string> = ["engaged", "viewed_home", "hovered_or_clicked", "clicked"];

/**
 * People per step. A person is an identity that viewed a blog article in the range: an `actor_id`, or
 * for a cookieless visitor one `daily_visitor_hash` on its salt day, so a reader who consents partway
 * through is two people. Every later step tests that same identity's marketing-site rows in the range,
 * with no order between steps and no window, so a step can count someone the step above it does not:
 * - engaged: at least two rows Level 1 counts toward engagement (`buildSiteEngagementFactSql` in
 *   `../whoSawUs/engagedVisitorsQuery.ts`), the article view included;
 * - a `site_page_viewed` with `page_kind = 'home'`;
 * - a `site_store_qr_shown` or a `site_app_entry_clicked` with any `target`;
 * - a `site_app_entry_clicked` with any `target`.
 *
 * The rows are Who saw us's `web` series rows, with its exclusions. The platform selection applies to
 * the article view; the country and language keep an identified person as on General, and a cookieless
 * one by the article view's own row.
 */
export function buildBlogPlatformChoiceFunnelSql(
  filters: AnalyticsFilterState,
  reportLabel: string,
): string {
  const { from: selectedFrom, to } = assertValidDateRange(filters.dateRange, reportLabel);
  // A range ending before the start date leaves `from` after `to`, so nobody is counted.
  const range: AnalyticsDateRange = { from: laterCalendarDate(selectedFrom, blogFunnelStartDate), to };
  const hashedVisitorDaySql = buildHashedVisitorDaySql("hashed_fact");
  const readerColumnsSql = (readerAlias: string): string => readerStepColumnNames
    .map((columnName) => `${readerAlias}.${columnName}`)
    .join(", ");

  return [
    "WITH identified_readers AS (",
    "  SELECT",
    "    site_fact.actor_id,",
    ...buildReaderStepSqlLines("site_fact"),
    "  FROM analytics.product_events_resolved AS site_fact",
    `  WHERE ${buildIdentifiedSiteFactFilterSql("site_fact", stepEventNames, range)}`,
    "  GROUP BY site_fact.actor_id",
    "  HAVING COUNT(*) FILTER (",
    `    WHERE ${buildPageViewSql("site_fact", "blog_article")}`,
    `      AND ${buildEventPlatformsFilterSql("site_fact.platform", filters.eventPlatforms)}`,
    "  ) > 0",
    "), hashed_readers AS (",
    "  SELECT",
    ...buildReaderStepSqlLines("hashed_fact"),
    "  FROM analytics.product_events_resolved AS hashed_fact",
    `  WHERE ${buildHashedSiteFactFilterSql("hashed_fact", stepEventNames, range)}`,
    `  GROUP BY hashed_fact.daily_visitor_hash, ${hashedVisitorDaySql}`,
    "  HAVING COUNT(*) FILTER (",
    `    WHERE ${buildPageViewSql("hashed_fact", "blog_article")}`,
    `      AND ${buildHashedPageViewFilterSqlLines("hashed_fact", "hashed_fact.platform", filters).join("\n      AND ")}`,
    "  ) > 0",
    "), readers AS (",
    `  SELECT ${readerColumnsSql("identified_reader")}`,
    "  FROM identified_readers AS identified_reader",
    `  WHERE ${buildConnectionCountriesFilterSql("identified_reader.actor_id::text", filters.connectionCountries, filters.dateRange)}`,
    `    AND ${buildAppUiLanguagesFilterSql("identified_reader.actor_id::text", filters.appUiLanguages, filters.dateRange)}`,
    "  UNION ALL",
    `  SELECT ${readerColumnsSql("hashed_reader")}`,
    "  FROM hashed_readers AS hashed_reader",
    ")",
    "SELECT",
    "  COUNT(*)::int AS article_view_count,",
    "  (COUNT(*) FILTER (WHERE reader.engaged))::int AS engaged_count,",
    "  (COUNT(*) FILTER (WHERE reader.viewed_home))::int AS home_view_count,",
    "  (COUNT(*) FILTER (WHERE reader.hovered_or_clicked))::int AS platform_hover_or_click_count,",
    "  (COUNT(*) FILTER (WHERE reader.clicked))::int AS platform_click_count",
    "FROM readers AS reader",
  ].join("\n");
}

export async function loadBlogPlatformChoiceFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  reportLabel: string,
  signal: AbortSignal,
): Promise<BlogPlatformChoiceFunnelReport> {
  const response = await runAdminQuery(config, buildBlogPlatformChoiceFunnelSql(filters, reportLabel), signal);
  const resultSet = response.resultSets[0];
  const row = resultSet?.rows[0];
  if (response.resultSets.length !== 1 || resultSet === undefined || resultSet.rows.length !== 1 || row === undefined) {
    throw new Error(`${reportLabel} must return exactly one result set with exactly one row.`);
  }

  const count = (fieldName: string): number => toInteger(row[fieldName] ?? null, reportLabel, fieldName);
  return {
    generatedAtUtc: response.executedAtUtc,
    counts: {
      articleViewCount: count("article_view_count"),
      engagedCount: count("engaged_count"),
      homeViewCount: count("home_view_count"),
      platformHoverOrClickCount: count("platform_hover_or_click_count"),
      platformClickCount: count("platform_click_count"),
    },
  };
}

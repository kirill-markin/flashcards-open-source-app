import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import {
  buildHashedSiteRowSqlLines,
  buildHashedVisitorDayRangeSqlLines,
  buildHashedVisitorDaySql,
} from "../funnels/funnelAudienceSql";
import type { FunnelGroupByDimension } from "../funnels/funnelGroupBy";
import { assertIsString, toInteger } from "../reportValues";
import {
  buildHashedSiteEntryCohortCteSqlLines,
  buildSiteEntryCohortCteSqlLines,
  buildSiteEntryFunnelGroupKeySql,
  buildSiteEntryFunnelRangeSql,
  buildSiteFactSourceSql,
  type SiteEntryFunnelRangeSql,
} from "../siteEntryFunnel/query";
import { siteFactEventNames as engagementEventNames } from "../whoSawUs/engagedVisitorsQuery";
import { buildHashedSiteFactFilterSql } from "../whoSawUs/query";
import { blogFunnelEntryPageKind, blogFunnelStartDate } from "./blogFunnelEntry";

/** Step four's rows: a QR card shown on a store button's hover or focus, or a click on any platform. */
const platformHoverOrClickEventNames: ReadonlyArray<string> = ["site_store_qr_shown", "site_app_entry_clicked"];

/** Every row a later identified step reads, so the window join runs once for all of them. */
const stepEventNames: ReadonlyArray<string> = [...engagementEventNames, "site_store_qr_shown"];

/**
 * People per step, each step a subset of the one before it: one group's, or the funnel's own sum.
 *
 * THIS IS THE ONE FUNNEL WHOSE COOKIELESS COHORT REACHES EVERY STEP. Every step is a marketing-site
 * fact, so the hashed people are measured the whole way down rather than disappearing into
 * construction partway, and the `hashed` counts below are that cohort's own.
 */
export type BlogPlatformChoiceFunnelCounts = Readonly<{
  entryViewCount: number;
  engagedCount: number;
  homeViewCount: number;
  platformHoverOrClickCount: number;
  platformClickCount: number;
  hashedEntryViewCount: number;
  hashedEngagedCount: number;
  hashedHomeViewCount: number;
  hashedPlatformHoverOrClickCount: number;
  hashedPlatformClickCount: number;
  /** Entries whose seven-day window had not closed when the query ran; a hashed person has none. */
  maturingCount: number;
}>;

/**
 * One group's counts under the key the SQL produced, keyed on the entry page view itself and on both
 * cohorts alike: the locale that page was read in, or the path of the article it was
 * (`blogFunnelGroupByDimensions` in `./blogFunnelEntry.ts`).
 */
export type BlogPlatformChoiceFunnelGroup = BlogPlatformChoiceFunnelCounts & Readonly<{ key: string }>;

/**
 * One entry per group, and exactly one while no dimension is selected.
 *
 * EVERY COUNT IS GROUPED, so a range nobody entered returns no groups at all rather than a row of
 * zeros; the section sums the groups it did get, which is zero people and its own empty state.
 */
export type BlogPlatformChoiceFunnelReport = Readonly<{
  generatedAtUtc: string;
  groups: ReadonlyArray<BlogPlatformChoiceFunnelGroup>;
}>;

/**
 * One counted column of this funnel, as the expression each cohort's arm reads it from.
 *
 * ONE LIST FOR BOTH ARMS AND FOR THE OUTER SUM, because `UNION ALL` matches columns by position: a
 * count added to one arm alone, or added in a different place, would be summed into the column beside
 * it rather than fail. The two arms name their joins with the same aliases, so most expressions are the
 * same text on both sides and the others are an explicit zero.
 */
type BlogPlatformChoiceCountColumn = Readonly<{
  name: string;
  identifiedSql: string;
  hashedSql: string;
}>;

function buildCountColumns(
  range: SiteEntryFunnelRangeSql,
): ReadonlyArray<BlogPlatformChoiceCountColumn> {
  return [
    { name: "entry_view_count", identifiedSql: "COUNT(*)", hashedSql: "0" },
    { name: "engaged_count", identifiedSql: "COUNT(engaged.engaged_at)", hashedSql: "0" },
    { name: "home_view_count", identifiedSql: "COUNT(home_view.viewed_at)", hashedSql: "0" },
    {
      name: "platform_hover_or_click_count",
      identifiedSql: "COUNT(hovered_or_clicked.hovered_or_clicked_at)",
      hashedSql: "0",
    },
    { name: "platform_click_count", identifiedSql: "COUNT(clicked.clicked_at)", hashedSql: "0" },
    {
      name: "maturing_count",
      identifiedSql: `(COUNT(*) FILTER (WHERE cohort.entered_at + ${range.windowSql} > now()))`,
      // A hashed person ceases to exist at the end of their UTC day, so they have no window to fill.
      hashedSql: "0",
    },
    { name: "hashed_entry_view_count", identifiedSql: "0", hashedSql: "COUNT(*)" },
    { name: "hashed_engaged_count", identifiedSql: "0", hashedSql: "COUNT(engaged.engaged_at)" },
    { name: "hashed_home_view_count", identifiedSql: "0", hashedSql: "COUNT(home_view.viewed_at)" },
    {
      name: "hashed_platform_hover_or_click_count",
      identifiedSql: "0",
      hashedSql: "COUNT(hovered_or_clicked.hovered_or_clicked_at)",
    },
    {
      name: "hashed_platform_click_count",
      identifiedSql: "0",
      hashedSql: "COUNT(clicked.clicked_at)",
    },
  ];
}

function buildGroupCountSqlLines(
  countColumns: ReadonlyArray<BlogPlatformChoiceCountColumn>,
  readCountSql: (column: BlogPlatformChoiceCountColumn) => string,
): ReadonlyArray<string> {
  return countColumns.map((column, index) => {
    const separator = index === countColumns.length - 1 ? "" : ",";
    return `  ${readCountSql(column)}::int AS ${column.name}${separator}`;
  });
}

function buildEventNameInSql(rowAlias: string, eventNames: ReadonlyArray<string>): string {
  return `${rowAlias}.event_name IN (${eventNames.map(escapeSqlStringLiteral).join(", ")})`;
}

/**
 * The instant of the first engagement row that is not the entry page view, over one person's rows from
 * the entry on, which always include the entry itself: a second row at the entry instant, else the
 * first row after it. The caller keeps only people with `COUNT(*) >= 2`, so it is never NULL.
 */
function buildEngagedAtSql(rowAlias: string, enteredAtSql: string): string {
  return [
    "CASE",
    `      WHEN COUNT(*) FILTER (WHERE ${rowAlias}.occurred_at = ${enteredAtSql}) >= 2 THEN ${enteredAtSql}`,
    `      ELSE MIN(${rowAlias}.occurred_at) FILTER (WHERE ${rowAlias}.occurred_at > ${enteredAtSql})`,
    "    END",
  ].join("\n");
}

/**
 * The five steps a blog reader takes to a platform, reduced in SQL to one row of counts per group that
 * follow the funnel rule in `../funnels/funnelSections.ts`.
 *
 * The cohort is the shared one in `../siteEntryFunnel/query.ts` on `blog_article`: one person is one
 * visitor identity whose first identified marketing-site page view is a blog article on a selected day.
 * The four steps below it are that same person within seven days of the entry, each at or after the
 * step above it:
 * - engaged: the first row other than the entry page view that Level 1 counts toward engagement
 *   (`siteFactEventNames` in `../whoSawUs/engagedVisitorsQuery.ts`), so a QR card alone is not one;
 * - a `site_page_viewed` with `page_kind = 'home'`, itself such a row, so it always lies at or after
 *   the engaged one;
 * - a `site_store_qr_shown` or a `site_app_entry_clicked` with any `target`;
 * - a `site_app_entry_clicked` with any `target`.
 *
 * THE HOME PAGE VIEW IS A STEP RATHER THAN ONE WAY OF REACHING THE PLATFORM. The blog's calls to action
 * all lead to the home page, so that is the designed path, and a reader who hovers or clicks a footer
 * store badge on the article without ever seeing the home page is deliberately outside this funnel
 * rather than widening the platform steps into a union of every route to a platform. It reads
 * `site_internal_cta_clicked` only as engagement, never as the home step: the home page view that click
 * produces is the step, so a site bundle that stops reporting the click cannot move it.
 *
 * THE STEPS JOIN ON THE VISITOR IDENTITY ALONE AND NEVER ON `source`. The site classifies a page view's
 * source from the page previously reported, while a click on that same page classifies it from the
 * document's own referrer, so after a client-side navigation the two rows legitimately disagree on it
 * and a join including it would drop real conversions.
 */
export function buildBlogPlatformChoiceFunnelSql(
  filters: AnalyticsFilterState,
  reportLabel: string,
  groupByDimension: FunnelGroupByDimension | null,
): string {
  const range = buildSiteEntryFunnelRangeSql(filters, reportLabel, blogFunnelStartDate);
  const countColumns = buildCountColumns(range);
  const cteSqlLines = [
    ...buildSiteEntryCohortCteSqlLines(filters, blogFunnelEntryPageKind, range),
    "), step_events AS MATERIALIZED (",
    "  SELECT",
    "    history.actor_id,",
    "    history.first_entry_viewed_at AS entered_at,",
    "    step_event.event_name,",
    "    step_event.event_properties ->> 'page_kind' AS page_kind,",
    "    step_event.occurred_at",
    "  FROM analytics.product_events_resolved AS step_event",
    "  INNER JOIN actor_first_events AS history",
    "    ON history.actor_id = step_event.actor_id",
    "    AND step_event.occurred_at >= history.first_entry_viewed_at",
    `    AND step_event.occurred_at <= history.first_entry_viewed_at + ${range.windowSql}`,
    `  WHERE ${buildEventNameInSql("step_event", stepEventNames)}`,
    `    AND ${buildSiteFactSourceSql("step_event")}`,
    `    AND step_event.occurred_at >= ${range.rangeStartSql}`,
    `    AND step_event.occurred_at < ${range.stepWindowEndSql}`,
    "), engagements AS MATERIALIZED (",
    "  SELECT",
    "    engagement.actor_id,",
    `    ${buildEngagedAtSql("engagement", "engagement.entered_at")} AS engaged_at`,
    "  FROM step_events AS engagement",
    `  WHERE ${buildEventNameInSql("engagement", engagementEventNames)}`,
    "  GROUP BY engagement.actor_id, engagement.entered_at",
    "  HAVING COUNT(*) >= 2",
    "), home_views AS MATERIALIZED (",
    "  SELECT home_view.actor_id, MIN(home_view.occurred_at) AS viewed_at",
    "  FROM step_events AS home_view",
    "  INNER JOIN engagements AS engaged",
    "    ON engaged.actor_id = home_view.actor_id",
    "    AND home_view.occurred_at >= engaged.engaged_at",
    "  WHERE home_view.event_name = 'site_page_viewed'",
    "    AND home_view.page_kind = 'home'",
    "  GROUP BY home_view.actor_id",
    "), platform_hovers_or_clicks AS MATERIALIZED (",
    "  SELECT reach.actor_id, MIN(reach.occurred_at) AS hovered_or_clicked_at",
    "  FROM step_events AS reach",
    "  INNER JOIN home_views AS home_view",
    "    ON home_view.actor_id = reach.actor_id",
    "    AND reach.occurred_at >= home_view.viewed_at",
    `  WHERE ${buildEventNameInSql("reach", platformHoverOrClickEventNames)}`,
    "  GROUP BY reach.actor_id",
    "), platform_clicks AS MATERIALIZED (",
    "  SELECT click.actor_id, MIN(click.occurred_at) AS clicked_at",
    "  FROM step_events AS click",
    "  INNER JOIN platform_hovers_or_clicks AS reach",
    "    ON reach.actor_id = click.actor_id",
    "    AND click.occurred_at >= reach.hovered_or_clicked_at",
    "  WHERE click.event_name = 'site_app_entry_clicked'",
    "  GROUP BY click.actor_id",
    ...buildHashedSiteEntryCohortCteSqlLines(filters, blogFunnelEntryPageKind, range),
    // The same four steps on the hashed person key, one hash on one UTC day, each a `MIN` over that
    // pair so no step can grow by more than one per person and each is read only for a person the
    // step above kept.
    "), hashed_engagements AS MATERIALIZED (",
    "  SELECT",
    "    entry.daily_visitor_hash,",
    "    entry.visitor_day,",
    `    ${buildEngagedAtSql("hashed_engagement", "entry.first_entry_viewed_at")} AS engaged_at`,
    "  FROM hashed_cohort AS entry",
    "  INNER JOIN analytics.product_events_resolved AS hashed_engagement",
    "    ON hashed_engagement.daily_visitor_hash = entry.daily_visitor_hash",
    `    AND ${buildHashedVisitorDaySql("hashed_engagement")} = entry.visitor_day`,
    "    AND hashed_engagement.occurred_at >= entry.first_entry_viewed_at",
    `  WHERE ${buildHashedSiteFactFilterSql("hashed_engagement", engagementEventNames, range)}`,
    "  GROUP BY entry.daily_visitor_hash, entry.visitor_day, entry.first_entry_viewed_at",
    "  HAVING COUNT(*) >= 2",
    "), hashed_home_views AS MATERIALIZED (",
    "  SELECT",
    "    engaged.daily_visitor_hash,",
    "    engaged.visitor_day,",
    "    MIN(hashed_home_view.occurred_at) AS viewed_at",
    "  FROM hashed_engagements AS engaged",
    "  INNER JOIN analytics.product_events_resolved AS hashed_home_view",
    "    ON hashed_home_view.daily_visitor_hash = engaged.daily_visitor_hash",
    `    AND ${buildHashedVisitorDaySql("hashed_home_view")} = engaged.visitor_day`,
    "    AND hashed_home_view.occurred_at >= engaged.engaged_at",
    `  WHERE ${buildHashedSiteRowSqlLines("hashed_home_view", "site_page_viewed").join("\n    AND ")}`,
    "    AND hashed_home_view.event_properties ->> 'page_kind' = 'home'",
    `    AND ${buildHashedVisitorDayRangeSqlLines("hashed_home_view", range.from, range.to).join("\n    AND ")}`,
    "  GROUP BY engaged.daily_visitor_hash, engaged.visitor_day",
    "), hashed_platform_hovers_or_clicks AS MATERIALIZED (",
    "  SELECT",
    "    home_view.daily_visitor_hash,",
    "    home_view.visitor_day,",
    "    MIN(hashed_reach.occurred_at) AS hovered_or_clicked_at",
    "  FROM hashed_home_views AS home_view",
    "  INNER JOIN analytics.product_events_resolved AS hashed_reach",
    "    ON hashed_reach.daily_visitor_hash = home_view.daily_visitor_hash",
    `    AND ${buildHashedVisitorDaySql("hashed_reach")} = home_view.visitor_day`,
    "    AND hashed_reach.occurred_at >= home_view.viewed_at",
    `  WHERE ${buildHashedSiteFactFilterSql("hashed_reach", platformHoverOrClickEventNames, range)}`,
    "  GROUP BY home_view.daily_visitor_hash, home_view.visitor_day",
    "), hashed_platform_clicks AS MATERIALIZED (",
    "  SELECT",
    "    reach.daily_visitor_hash,",
    "    reach.visitor_day,",
    "    MIN(hashed_click.occurred_at) AS clicked_at",
    "  FROM hashed_platform_hovers_or_clicks AS reach",
    "  INNER JOIN analytics.product_events_resolved AS hashed_click",
    "    ON hashed_click.daily_visitor_hash = reach.daily_visitor_hash",
    `    AND ${buildHashedVisitorDaySql("hashed_click")} = reach.visitor_day`,
    "    AND hashed_click.occurred_at >= reach.hovered_or_clicked_at",
    `  WHERE ${buildHashedSiteRowSqlLines("hashed_click", "site_app_entry_clicked").join("\n    AND ")}`,
    `    AND ${buildHashedVisitorDayRangeSqlLines("hashed_click", range.from, range.to).join("\n    AND ")}`,
    "  GROUP BY reach.daily_visitor_hash, reach.visitor_day",
    ")",
  ];
  const groupKeySql = buildSiteEntryFunnelGroupKeySql(filters, groupByDimension);
  const identifiedGroupSqlLines = [
    "SELECT",
    `  ${groupKeySql} AS group_key,`,
    ...buildGroupCountSqlLines(countColumns, (column) => column.identifiedSql),
    "FROM cohort",
    "LEFT JOIN engagements AS engaged ON engaged.actor_id = cohort.actor_id",
    "LEFT JOIN home_views AS home_view ON home_view.actor_id = cohort.actor_id",
    "LEFT JOIN platform_hovers_or_clicks AS hovered_or_clicked ON hovered_or_clicked.actor_id = cohort.actor_id",
    "LEFT JOIN platform_clicks AS clicked ON clicked.actor_id = cohort.actor_id",
    "GROUP BY group_key",
  ];

  return [
    ...cteSqlLines,
    "SELECT",
    "  funnel_group.group_key,",
    ...countColumns.map((column, index) => {
      const separator = index === countColumns.length - 1 ? "" : ",";
      return `  SUM(funnel_group.${column.name})::int AS ${column.name}${separator}`;
    }),
    "FROM (",
    ...identifiedGroupSqlLines,
    "  UNION ALL",
    // The cookieless people are rows of their own rather than scalars on the identified rows, because a
    // grouped aggregate returns no row at all when nobody identified entered, and their counts may not
    // disappear with them; the outer aggregate then merges each of these rows into the identified group
    // of the same key. `hashed_cohort` is aliased `cohort` so that the dimension's one key expression
    // reads the same column here as it does above, and every count is an aggregate over that cohort
    // joined to its own steps rather than an uncorrelated scalar, which at one row per key would
    // attribute every hashed step to every group at once.
    "  SELECT",
    `    ${groupKeySql} AS group_key,`,
    ...buildGroupCountSqlLines(countColumns, (column) => column.hashedSql),
    "  FROM hashed_cohort AS cohort",
    "  LEFT JOIN hashed_engagements AS engaged",
    "    ON engaged.daily_visitor_hash = cohort.daily_visitor_hash",
    "    AND engaged.visitor_day = cohort.visitor_day",
    "  LEFT JOIN hashed_home_views AS home_view",
    "    ON home_view.daily_visitor_hash = cohort.daily_visitor_hash",
    "    AND home_view.visitor_day = cohort.visitor_day",
    "  LEFT JOIN hashed_platform_hovers_or_clicks AS hovered_or_clicked",
    "    ON hovered_or_clicked.daily_visitor_hash = cohort.daily_visitor_hash",
    "    AND hovered_or_clicked.visitor_day = cohort.visitor_day",
    "  LEFT JOIN hashed_platform_clicks AS clicked",
    "    ON clicked.daily_visitor_hash = cohort.daily_visitor_hash",
    "    AND clicked.visitor_day = cohort.visitor_day",
    "  GROUP BY group_key",
    ") AS funnel_group",
    "GROUP BY funnel_group.group_key",
    // A group nobody entered is not a group: it would spend a legend entry, a band slot that narrows
    // every real bar, and a table row on nobody. Both arms aggregate over people, so every group they
    // emit already holds one; this states the rule on the statement rather than leaving it to the two
    // arms continuing to agree.
    "HAVING SUM(funnel_group.entry_view_count) + SUM(funnel_group.hashed_entry_view_count) > 0",
  ].join("\n");
}

export async function loadBlogPlatformChoiceFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  reportLabel: string,
  groupByDimension: FunnelGroupByDimension | null,
  signal: AbortSignal,
): Promise<BlogPlatformChoiceFunnelReport> {
  const response = await runAdminQuery(
    config,
    buildBlogPlatformChoiceFunnelSql(filters, reportLabel, groupByDimension),
    signal,
  );
  if (response.resultSets.length !== 1) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  // No row is a legal answer and means nobody entered the funnel, because every count is grouped.
  const rows = response.resultSets[0]?.rows ?? [];

  return {
    generatedAtUtc: response.executedAtUtc,
    groups: rows.map((row) => {
      const count = (fieldName: string): number => toInteger(row[fieldName] ?? null, reportLabel, fieldName);

      return {
        key: assertIsString(row.group_key ?? null, reportLabel, "group_key"),
        entryViewCount: count("entry_view_count"),
        engagedCount: count("engaged_count"),
        homeViewCount: count("home_view_count"),
        platformHoverOrClickCount: count("platform_hover_or_click_count"),
        platformClickCount: count("platform_click_count"),
        hashedEntryViewCount: count("hashed_entry_view_count"),
        hashedEngagedCount: count("hashed_engaged_count"),
        hashedHomeViewCount: count("hashed_home_view_count"),
        hashedPlatformHoverOrClickCount: count("hashed_platform_hover_or_click_count"),
        hashedPlatformClickCount: count("hashed_platform_click_count"),
        maturingCount: count("maturing_count"),
      };
    }),
  };
}

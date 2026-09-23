import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import {
  buildHashedSiteRowSqlLines,
  buildHashedVisitorDayRangeSqlLines,
  buildHashedVisitorDaySql,
  isFunnelHashedCohortRead,
} from "../funnels/funnelAudienceSql";
import type { FunnelGroupByDimension } from "../funnels/funnelGroupBy";
import { assertIsString, toInteger } from "../reportValues";
import {
  buildHashedSiteEntryCohortCteSqlLines,
  buildSiteEntryCohortCteSqlLines,
  buildSiteEntryFunnelGroupKeySql,
  buildSiteEntryFunnelRangeSql,
  buildSiteFactSql,
  type SiteEntryFunnelRangeSql,
} from "../siteEntryFunnel/query";
import { blogFunnelEntryPageKind, blogFunnelStartDate } from "./blogFunnelEntry";

/**
 * Where a blog reader can go, which is the whole of `site_app_entry_clicked.target`
 * (`productAnalyticsSiteAppEntryProperties` in `apps/backend/src/productAnalytics/catalog.ts`).
 *
 * The three are read as a breakdown of one step rather than as three steps or three group keys: they
 * are alternatives one person picks between, so nesting them would claim an order they do not have.
 */
export const blogPlatformChoiceTargets = ["web_app", "app_store", "google_play"] as const;

export type BlogPlatformChoiceTarget = (typeof blogPlatformChoiceTargets)[number];

/** People at the platform step by the target of their first qualifying click; they sum to that step. */
export type BlogPlatformChoiceTargetCounts = Readonly<Record<BlogPlatformChoiceTarget, number>>;

/**
 * People per step, each step a subset of the one before it: one group's, or the funnel's own sum.
 *
 * THIS IS THE ONE FUNNEL WHOSE COOKIELESS COHORT REACHES EVERY STEP. All three steps are marketing-site
 * facts, so the `all` mode's hashed people are measured the whole way down rather than disappearing
 * into construction partway, and the three `hashed` counts below are that cohort's own. They are zero
 * outside that mode and zero whenever a connection country is selected, because a hashed row carries no
 * country.
 */
export type BlogPlatformChoiceFunnelCounts = Readonly<{
  entryViewCount: number;
  homeViewCount: number;
  platformClickCount: number;
  targetCounts: BlogPlatformChoiceTargetCounts;
  hashedEntryViewCount: number;
  hashedHomeViewCount: number;
  hashedPlatformClickCount: number;
  hashedTargetCounts: BlogPlatformChoiceTargetCounts;
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

function buildTargetCountColumnName(target: BlogPlatformChoiceTarget): string {
  return `${target}_click_count`;
}

function buildHashedTargetCountColumnName(target: BlogPlatformChoiceTarget): string {
  return `hashed_${target}_click_count`;
}

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
  const targetCountSql = (target: BlogPlatformChoiceTarget): string => (
    `(COUNT(*) FILTER (WHERE click_target.target = ${escapeSqlStringLiteral(target)}))`
  );

  return [
    { name: "entry_view_count", identifiedSql: "COUNT(*)", hashedSql: "0" },
    { name: "home_view_count", identifiedSql: "COUNT(home_view.viewed_at)", hashedSql: "0" },
    { name: "platform_click_count", identifiedSql: "COUNT(clicked.clicked_at)", hashedSql: "0" },
    ...blogPlatformChoiceTargets.map((target) => ({
      name: buildTargetCountColumnName(target),
      identifiedSql: targetCountSql(target),
      hashedSql: "0",
    })),
    {
      name: "maturing_count",
      identifiedSql: `(COUNT(*) FILTER (WHERE cohort.entered_at + ${range.windowSql} > now()))`,
      // A hashed person ceases to exist at the end of their UTC day, so they have no window to fill.
      hashedSql: "0",
    },
    { name: "hashed_entry_view_count", identifiedSql: "0", hashedSql: "COUNT(*)" },
    { name: "hashed_home_view_count", identifiedSql: "0", hashedSql: "COUNT(home_view.viewed_at)" },
    {
      name: "hashed_platform_click_count",
      identifiedSql: "0",
      hashedSql: "COUNT(clicked.clicked_at)",
    },
    ...blogPlatformChoiceTargets.map((target) => ({
      name: buildHashedTargetCountColumnName(target),
      identifiedSql: "0",
      hashedSql: targetCountSql(target),
    })),
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

/**
 * The three steps a blog reader takes to a platform, reduced in SQL to one row of counts per group that
 * follow the funnel rule in `../funnels/funnelSections.ts`.
 *
 * The cohort is the shared one in `../siteEntryFunnel/query.ts` on `blog_article`: one person is one
 * visitor identity whose first identified marketing-site page view is a blog article on a selected day.
 * The two steps below it are that same person within seven days of the entry, at or after the step above
 * it: a `site_page_viewed` with `page_kind = 'home'`, then a `site_app_entry_clicked` with any `target`.
 *
 * THE HOME PAGE VIEW IS A STEP RATHER THAN ONE WAY OF REACHING THE CLICK. The blog's calls to action all
 * lead to the home page, so that is the designed path, and a reader who somehow clicks a platform badge
 * without ever seeing the home page is deliberately outside this funnel rather than widening step two
 * into a union of every route to a platform.
 *
 * THE STEPS JOIN ON THE VISITOR IDENTITY ALONE AND NEVER ON `source`. The site classifies a page view's
 * source from the page previously reported, while a click on that same page classifies it from the
 * document's own referrer, so after a client-side navigation the two rows legitimately disagree on it
 * and a join including it would drop real conversions.
 *
 * The per-target breakdown is one row per person in `platform_click_targets`, the target of the very
 * click that `platform_clicks` counted, so the three numbers are a partition of the step and sum to it.
 * `MIN` over the target resolves the only tie it can have - two clicks of that one person at the same
 * instant on different targets - the same way `entry_group_keys` resolves a tied locale, so the answer is
 * the same on every run.
 */
export function buildBlogPlatformChoiceFunnelSql(
  filters: AnalyticsFilterState,
  reportLabel: string,
  groupByDimension: FunnelGroupByDimension | null,
): string {
  const range = buildSiteEntryFunnelRangeSql(filters, reportLabel, blogFunnelStartDate);
  // Left out of the statement entirely rather than executed and discarded, so the default mode costs
  // nothing for a cohort it does not count.
  const isHashedCohortRead = isFunnelHashedCohortRead(filters);
  const homeViewSql = [
    buildSiteFactSql("step_event", "site_page_viewed"),
    "step_event.event_properties ->> 'page_kind' = 'home'",
  ].join(" AND ");
  const platformClickSql = buildSiteFactSql("step_event", "site_app_entry_clicked");
  const countColumns = buildCountColumns(range);
  const cteSqlLines = [
    ...buildSiteEntryCohortCteSqlLines(filters, blogFunnelEntryPageKind, range),
    "), step_events AS MATERIALIZED (",
    "  SELECT",
    "    history.actor_id,",
    // The `WHERE` below admits these two rows and nothing else, so the `ELSE` arm is the home page view.
    `    CASE WHEN ${platformClickSql} THEN 'platform_click' ELSE 'home_view' END AS step,`,
    "    step_event.event_properties ->> 'target' AS target,",
    "    step_event.occurred_at",
    "  FROM analytics.product_events_resolved AS step_event",
    "  INNER JOIN actor_first_events AS history",
    "    ON history.actor_id = step_event.actor_id",
    "    AND step_event.occurred_at >= history.first_entry_viewed_at",
    `    AND step_event.occurred_at <= history.first_entry_viewed_at + ${range.windowSql}`,
    `  WHERE ((${homeViewSql}) OR (${platformClickSql}))`,
    `    AND step_event.occurred_at >= ${range.rangeStartSql}`,
    `    AND step_event.occurred_at < ${range.stepWindowEndSql}`,
    "), home_views AS MATERIALIZED (",
    "  SELECT home_view.actor_id, MIN(home_view.occurred_at) AS viewed_at",
    "  FROM step_events AS home_view",
    "  WHERE home_view.step = 'home_view'",
    "  GROUP BY home_view.actor_id",
    "), platform_clicks AS MATERIALIZED (",
    "  SELECT click.actor_id, MIN(click.occurred_at) AS clicked_at",
    "  FROM step_events AS click",
    "  INNER JOIN home_views AS home_view",
    "    ON home_view.actor_id = click.actor_id",
    "    AND click.occurred_at >= home_view.viewed_at",
    "  WHERE click.step = 'platform_click'",
    "  GROUP BY click.actor_id",
    // A lookup rather than a reduction: `clicked_at` already names the row, so this is the target of
    // the click the step counted.
    "), platform_click_targets AS MATERIALIZED (",
    "  SELECT first_click.actor_id, MIN(click.target) AS target",
    "  FROM platform_clicks AS first_click",
    "  INNER JOIN step_events AS click",
    "    ON click.actor_id = first_click.actor_id",
    "    AND click.occurred_at = first_click.clicked_at",
    "  WHERE click.step = 'platform_click'",
    "  GROUP BY first_click.actor_id",
    ...(isHashedCohortRead
      ? [
        ...buildHashedSiteEntryCohortCteSqlLines(filters, blogFunnelEntryPageKind, range),
        // The same two steps on the hashed person key, one hash on one UTC day, each a `MIN` over that
        // pair so no step can grow by more than one per person and each is read only for a person the
        // step above kept.
        "), hashed_home_views AS MATERIALIZED (",
        "  SELECT",
        "    entry.daily_visitor_hash,",
        "    entry.visitor_day,",
        "    MIN(hashed_home_view.occurred_at) AS viewed_at",
        "  FROM hashed_cohort AS entry",
        "  INNER JOIN analytics.product_events_resolved AS hashed_home_view",
        "    ON hashed_home_view.daily_visitor_hash = entry.daily_visitor_hash",
        `    AND ${buildHashedVisitorDaySql("hashed_home_view")} = entry.visitor_day`,
        "    AND hashed_home_view.occurred_at >= entry.first_entry_viewed_at",
        `  WHERE ${buildHashedSiteRowSqlLines("hashed_home_view", "site_page_viewed").join("\n    AND ")}`,
        "    AND hashed_home_view.event_properties ->> 'page_kind' = 'home'",
        `    AND ${buildHashedVisitorDayRangeSqlLines("hashed_home_view", range.from, range.to).join("\n    AND ")}`,
        "  GROUP BY entry.daily_visitor_hash, entry.visitor_day",
        "), hashed_platform_clicks AS MATERIALIZED (",
        "  SELECT",
        "    home_view.daily_visitor_hash,",
        "    home_view.visitor_day,",
        "    MIN(hashed_click.occurred_at) AS clicked_at",
        "  FROM hashed_home_views AS home_view",
        "  INNER JOIN analytics.product_events_resolved AS hashed_click",
        "    ON hashed_click.daily_visitor_hash = home_view.daily_visitor_hash",
        `    AND ${buildHashedVisitorDaySql("hashed_click")} = home_view.visitor_day`,
        "    AND hashed_click.occurred_at >= home_view.viewed_at",
        `  WHERE ${buildHashedSiteRowSqlLines("hashed_click", "site_app_entry_clicked").join("\n    AND ")}`,
        `    AND ${buildHashedVisitorDayRangeSqlLines("hashed_click", range.from, range.to).join("\n    AND ")}`,
        "  GROUP BY home_view.daily_visitor_hash, home_view.visitor_day",
        "), hashed_platform_click_targets AS MATERIALIZED (",
        "  SELECT",
        "    first_click.daily_visitor_hash,",
        "    first_click.visitor_day,",
        "    MIN(hashed_click.event_properties ->> 'target') AS target",
        "  FROM hashed_platform_clicks AS first_click",
        "  INNER JOIN analytics.product_events_resolved AS hashed_click",
        "    ON hashed_click.daily_visitor_hash = first_click.daily_visitor_hash",
        `    AND ${buildHashedVisitorDaySql("hashed_click")} = first_click.visitor_day`,
        "    AND hashed_click.occurred_at = first_click.clicked_at",
        `  WHERE ${buildHashedSiteRowSqlLines("hashed_click", "site_app_entry_clicked").join("\n    AND ")}`,
        `    AND ${buildHashedVisitorDayRangeSqlLines("hashed_click", range.from, range.to).join("\n    AND ")}`,
        "  GROUP BY first_click.daily_visitor_hash, first_click.visitor_day",
      ]
      : []),
    ")",
  ];
  const groupKeySql = buildSiteEntryFunnelGroupKeySql(filters, groupByDimension);
  const identifiedGroupSqlLines = [
    "SELECT",
    `  ${groupKeySql} AS group_key,`,
    ...buildGroupCountSqlLines(countColumns, (column) => column.identifiedSql),
    "FROM cohort",
    "LEFT JOIN home_views AS home_view ON home_view.actor_id = cohort.actor_id",
    "LEFT JOIN platform_clicks AS clicked ON clicked.actor_id = cohort.actor_id",
    "LEFT JOIN platform_click_targets AS click_target ON click_target.actor_id = cohort.actor_id",
    "GROUP BY group_key",
  ];
  if (isHashedCohortRead === false) {
    return [...cteSqlLines, ...identifiedGroupSqlLines].join("\n");
  }

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
    "  LEFT JOIN hashed_home_views AS home_view",
    "    ON home_view.daily_visitor_hash = cohort.daily_visitor_hash",
    "    AND home_view.visitor_day = cohort.visitor_day",
    "  LEFT JOIN hashed_platform_clicks AS clicked",
    "    ON clicked.daily_visitor_hash = cohort.daily_visitor_hash",
    "    AND clicked.visitor_day = cohort.visitor_day",
    "  LEFT JOIN hashed_platform_click_targets AS click_target",
    "    ON click_target.daily_visitor_hash = cohort.daily_visitor_hash",
    "    AND click_target.visitor_day = cohort.visitor_day",
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
): Promise<BlogPlatformChoiceFunnelReport> {
  const response = await runAdminQuery(
    config,
    buildBlogPlatformChoiceFunnelSql(filters, reportLabel, groupByDimension),
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
        homeViewCount: count("home_view_count"),
        platformClickCount: count("platform_click_count"),
        targetCounts: {
          web_app: count(buildTargetCountColumnName("web_app")),
          app_store: count(buildTargetCountColumnName("app_store")),
          google_play: count(buildTargetCountColumnName("google_play")),
        },
        hashedEntryViewCount: count("hashed_entry_view_count"),
        hashedHomeViewCount: count("hashed_home_view_count"),
        hashedPlatformClickCount: count("hashed_platform_click_count"),
        hashedTargetCounts: {
          web_app: count(buildHashedTargetCountColumnName("web_app")),
          app_store: count(buildHashedTargetCountColumnName("app_store")),
          google_play: count(buildHashedTargetCountColumnName("google_play")),
        },
        maturingCount: count("maturing_count"),
      };
    }),
  };
}

import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelGroupByDimension } from "../funnels/funnelGroupBy";
import { assertIsString, toInteger } from "../reportValues";
import {
  buildSiteEntryCohortCteSqlLines,
  buildSiteEntryFunnelGroupKeySql,
  buildSiteEntryFunnelRangeSql,
  buildSiteEntryWebAppStepCteSqlLines,
  siteEntryEngagedReviewThreshold,
} from "../siteEntryFunnel/query";
import { blogFunnelEntryPageKind, blogFunnelStartDate } from "./blogFunnelEntry";

/**
 * People per step, each step a subset of the one before it: one group's, or the funnel's own sum.
 *
 * THE FIRST STEP IS THE CLICK, NOT THE BLOG VISIT, so every share below is taken over people who did
 * choose the web app and the tail reads as activation rather than as a mixture of activation and of
 * blog readers who went to a store instead. Where blog readers go is the other blog funnel's question.
 *
 * There is no `hashed` count here, and the `all` audience therefore counts exactly who the default
 * counts: a cookieless visitor can reach the click and nothing below it, so their clicks would inflate
 * the base of four steps they can never appear in and understate every share taken over it. Those
 * people are measured in `./platformChoiceQuery.ts`, whose every step they can reach.
 */
export type BlogToWebAppFunnelCounts = Readonly<{
  appEntryClickCount: number;
  signedInCount: number;
  oneReviewCount: number;
  engagedCount: number;
  engagedReturningCount: number;
  /** Clickers whose entry's seven-day window had not closed when the query ran. */
  maturingCount: number;
}>;

/**
 * One group's counts under the key the SQL produced, keyed on the blog article the person entered on:
 * the locale that page was read in, or its own path (`blogFunnelGroupByDimensions` in
 * `./blogFunnelEntry.ts`).
 */
export type BlogToWebAppFunnelGroup = BlogToWebAppFunnelCounts & Readonly<{ key: string }>;

/**
 * One entry per group, and exactly one while no dimension is selected.
 *
 * EVERY COUNT IS GROUPED, so a range in which nobody clicked returns no groups at all rather than a row
 * of zeros; the section sums the groups it did get, which is zero people and its own empty state.
 */
export type BlogToWebAppFunnelReport = Readonly<{
  generatedAtUtc: string;
  groups: ReadonlyArray<BlogToWebAppFunnelGroup>;
}>;

/**
 * The web-app activation of a blog reader, reduced in SQL to one row of counts per group that follow the
 * funnel rule in `../funnels/funnelSections.ts`.
 *
 * The cohort is the shared one in `../siteEntryFunnel/query.ts` on `blog_article` and the steps are the
 * shared web-app tail, so this funnel and the home funnel share that cohort rule and that tail fragment.
 * They differ in three things: the entry page, whether the entry page view is itself a counted step - here
 * it is only the cohort - and the hashed cohort, which the home funnel counts and this one does not read.
 * A HOME PAGE VIEW IS DELIBERATELY NOT REQUIRED between the two: the click is this funnel's own first
 * step, so whichever page the reader clicked from, they are in it with a full base under them.
 *
 * The seven-day window stays anchored on the entry page view, exactly as the home funnel anchors it, so
 * a reader who clicks late in that window has less of it left for the steps below - which is what
 * `maturing_count` and the warning it feeds are about, counted over the clickers rather than over every
 * blog entrant, so it can never exceed the first step.
 *
 * A group with no click is not a group: the first step is the click, so such a group would draw a band
 * of zero bars and spend a legend entry on nobody.
 */
export function buildBlogToWebAppFunnelSql(
  filters: AnalyticsFilterState,
  reportLabel: string,
  groupByDimension: FunnelGroupByDimension | null,
): string {
  const range = buildSiteEntryFunnelRangeSql(filters, reportLabel, blogFunnelStartDate);
  const groupKeySql = buildSiteEntryFunnelGroupKeySql(filters, groupByDimension);

  return [
    ...buildSiteEntryCohortCteSqlLines(filters, blogFunnelEntryPageKind, range),
    ...buildSiteEntryWebAppStepCteSqlLines(range),
    ")",
    "SELECT",
    `  ${groupKeySql} AS group_key,`,
    "  COUNT(clicked.clicked_at)::int AS app_entry_click_count,",
    "  COUNT(signed_in.signed_in_at)::int AS signed_in_count,",
    "  COUNT(first_review.first_review_at)::int AS one_review_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE engagement.review_count >= ${siteEntryEngagedReviewThreshold}`,
    "  ))::int AS engaged_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE engagement.review_count >= ${siteEntryEngagedReviewThreshold}`,
    "      AND engagement.has_return_day",
    "  ))::int AS engaged_returning_count,",
    "  (COUNT(*) FILTER (",
    "    WHERE clicked.clicked_at IS NOT NULL",
    `      AND cohort.entered_at + ${range.windowSql} > now()`,
    "  ))::int AS maturing_count",
    "FROM cohort",
    "LEFT JOIN app_entry_clicks AS clicked ON clicked.actor_id = cohort.actor_id",
    "LEFT JOIN sessions AS signed_in ON signed_in.actor_id = cohort.actor_id",
    "LEFT JOIN first_reviews AS first_review ON first_review.actor_id = cohort.actor_id",
    "LEFT JOIN person_engagement AS engagement ON engagement.actor_id = cohort.actor_id",
    "GROUP BY group_key",
    "HAVING COUNT(clicked.clicked_at) > 0",
  ].join("\n");
}

export async function loadBlogToWebAppFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  reportLabel: string,
  groupByDimension: FunnelGroupByDimension | null,
): Promise<BlogToWebAppFunnelReport> {
  const response = await runAdminQuery(
    config,
    buildBlogToWebAppFunnelSql(filters, reportLabel, groupByDimension),
  );
  if (response.resultSets.length !== 1) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  // No row is a legal answer and means nobody clicked through, because every count is grouped.
  const rows = response.resultSets[0]?.rows ?? [];

  return {
    generatedAtUtc: response.executedAtUtc,
    groups: rows.map((row) => {
      const count = (fieldName: string): number => toInteger(row[fieldName] ?? null, reportLabel, fieldName);

      return {
        key: assertIsString(row.group_key ?? null, reportLabel, "group_key"),
        appEntryClickCount: count("app_entry_click_count"),
        signedInCount: count("signed_in_count"),
        oneReviewCount: count("one_review_count"),
        engagedCount: count("engaged_count"),
        engagedReturningCount: count("engaged_returning_count"),
        maturingCount: count("maturing_count"),
      };
    }),
  };
}

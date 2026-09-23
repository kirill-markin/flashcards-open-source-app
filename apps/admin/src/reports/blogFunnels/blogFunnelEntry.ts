import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelGroupByDimension } from "../funnels/funnelGroupBy";
import {
  siteEntryFunnelGroupByDimensions,
  siteEntryPagePathColumnName,
  type SiteFunnelEntryPageKind,
} from "../siteEntryFunnel/query";

// What the two funnels that start on a blog article share: the day they count from, the page kind they
// enter on, the `Group by` dimensions they offer, and the note a range reaching back past that day
// shows. Everything else is per funnel: `./platformChoiceQuery.ts` ends where the reader picks a
// platform, `./webAppQuery.ts` starts at the web app click and follows that person into the product.

/** The one `page_kind` both blog funnels enter on. */
export const blogFunnelEntryPageKind: SiteFunnelEntryPageKind = "blog_article";

/**
 * What both blog funnels offer in their `Group by` field: every dimension a site-entry funnel offers,
 * plus the article the reader entered on, which answers which posts pull people into the product on the
 * same chart that measures the flow.
 *
 * THE BLOG FUNNELS ALONE GET THE ARTICLE. The home funnel keys the same cohort rule on `page_kind =
 * 'home'`, whose `page_path` is always `/`, so the dimension would draw one bar of everybody there; it
 * is declared here rather than in the shared list for that reason.
 *
 * It is the second dimension keyed on the entry page view itself rather than on a per-actor source, so
 * like `language` - and unlike anything read from a person's history, which can say nothing at all about
 * a cookieless visitor - it places the `all` cohort's hashed people too: their entry row carries the path
 * as an identified one does, and both cohorts project it under the same name and the same `cohort` alias,
 * so one key expression reads them both and the platform-choice funnel's lighter segments sit inside
 * their own article.
 *
 * The key is its own label and needs no option list: the site sends the route with its locale prefix
 * already stripped, lowercase and with a leading and a trailing slash, so one article reads as one group
 * across every language and no value can collide with `unresolvedFunnelGroupKey`, which has no slashes.
 * An entry row that carried no path at all - a site bundle released before the property, or a route
 * whose shape the site could not report - is `Unresolved`, pinned outside the five largest articles the
 * chart draws while everything below them folds into `Other`.
 */
export const blogFunnelGroupByDimensions: ReadonlyArray<FunnelGroupByDimension> = [
  ...siteEntryFunnelGroupByDimensions,
  {
    id: "article",
    label: "Entry article",
    buildGroupKeySql: () => `cohort.${siteEntryPagePathColumnName}`,
  },
];

/**
 * The first UTC day a blog entry counts from, whatever range is selected.
 *
 * IT IS ONE DAY LATER THAN `siteEntryFunnelStartDate`, and deliberately its own constant. The blog
 * article CTAs began leading to the localized home page and reporting `site_internal_cta_clicked`
 * instead of `site_app_entry_clicked` partway through 2026-09-23, at about 09:51 UTC, so on that day a
 * blog reader's path down either funnel depends on which side of the deploy their visit fell, and
 * 2026-09-24 is the first whole day of the current path. The home funnel is unaffected and keeps
 * counting from its own first full day of identified page views, which is why the two families cannot
 * be compared over a range that starts before this one.
 */
export const blogFunnelStartDate = "2026-09-24";

/** The short note shown when the selected range starts before `blogFunnelStartDate`, or `null`. */
export function buildBlogFunnelStartDateNote(
  dateRange: AnalyticsFilterState["dateRange"],
): string | null {
  if (dateRange.to < blogFunnelStartDate) {
    return `Blog visits count from ${blogFunnelStartDate}, the first full UTC day the blog's calls to action led to the home page, so the selected range has no data.`;
  }

  return dateRange.from < blogFunnelStartDate
    ? `Blog visits count from ${blogFunnelStartDate}, the first full UTC day the blog's calls to action led to the home page, so there is no data before that day.`
    : null;
}

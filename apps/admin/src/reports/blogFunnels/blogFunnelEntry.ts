import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { SiteFunnelEntryPageKind } from "../siteEntryFunnel/query";

// What the two funnels that start on a blog article share: the day they count from, the page kind they
// enter on, and the note a range reaching back past that day shows. Everything else is per funnel:
// `./platformChoiceQuery.ts` ends where the reader picks a platform, `./webAppQuery.ts` starts at the
// web app click and follows that person into the product.

/** The one `page_kind` both blog funnels enter on. */
export const blogFunnelEntryPageKind: SiteFunnelEntryPageKind = "blog_article";

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

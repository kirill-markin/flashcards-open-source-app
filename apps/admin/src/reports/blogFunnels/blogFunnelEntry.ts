import type { AnalyticsFilterState } from "../../filters/analyticsFilters";

/**
 * The first UTC day the blog funnel counts from, whatever range is selected.
 *
 * IT IS ONE DAY LATER THAN THE SITE'S FIRST FULL DAY OF IDENTIFIED PAGE VIEWS. The blog article CTAs
 * began leading to the localized home page and reporting `site_internal_cta_clicked` instead of
 * `site_app_entry_clicked` partway through 2026-09-23, at about 09:51 UTC, so on that day a blog
 * reader's path depends on which side of the deploy their visit fell, and 2026-09-24 is the first
 * whole day of the current path.
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

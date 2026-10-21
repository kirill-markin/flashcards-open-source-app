import { useMemo, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import { FunnelEmptyRangeNotes } from "../funnels/FunnelEmptyRangeNotes";
import {
  buildFunnelRangeGroups,
  formatFunnelRangeNote,
  useFunnelRangeReports,
} from "../funnels/funnelRangeReports";
import { FunnelSectionHeader } from "../funnels/FunnelSectionHeader";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import {
  FunnelStepsChart,
  FunnelStepsEmptyChart,
  FunnelStepsLoadingChart,
  type FunnelStage,
} from "../funnels/FunnelStepsChart";
import { pageReadEngagementStartDate } from "../whoSawUs/engagedVisitorsQuery";
import {
  blogFunnelStartDate,
  buildBlogFunnelStartDateNote,
} from "./blogFunnelEntry";
import {
  loadBlogPlatformChoiceFunnelReport,
  type BlogPlatformChoiceFunnelCounts,
  type BlogPlatformChoiceFunnelReport,
} from "./platformChoiceQuery";

/** The funnel steps in chart order; `buildStages` takes its order from this list. */
const funnelStepIds = ["entry-view", "engaged", "home-view", "platform-hover-or-click", "platform-click"] as const;

type FunnelStepId = (typeof funnelStepIds)[number];

// The funnel id is `blog`, so this funnel keeps the `blogFrom` parameter shared links already carry.
export const blogPlatformChoiceFunnelAnchor: FunnelAnchor<FunnelStepId> = {
  funnelId: "blog",
  stepIds: funnelStepIds,
};

export const blogPlatformChoiceFunnelTitle = "Blog article to platform choice";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected blog platform choice funnel error.";
}

function loadReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  signal: AbortSignal,
): Promise<BlogPlatformChoiceFunnelReport> {
  return loadBlogPlatformChoiceFunnelReport(config, filters, `${blogPlatformChoiceFunnelTitle} funnel`, signal);
}

function buildStages(counts: BlogPlatformChoiceFunnelCounts): ReadonlyArray<FunnelStage<FunnelStepId>> {
  const stages = {
    "entry-view": { label: "Viewed a blog article", count: counts.articleViewCount, hashedCount: 0 },
    engaged: { label: "Engaged", count: counts.engagedCount, hashedCount: 0 },
    "home-view": { label: "Home page viewed", count: counts.homeViewCount, hashedCount: 0 },
    "platform-hover-or-click": { label: "Platform hovered or clicked", count: counts.platformHoverOrClickCount, hashedCount: 0 },
    "platform-click": { label: "Platform clicked", count: counts.platformClickCount, hashedCount: 0 },
  } satisfies Record<FunnelStepId, Readonly<{ label: string; count: number; hashedCount: number }>>;

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

export function BlogPlatformChoiceFunnelSection(props: FunnelSectionProps): JSX.Element {
  const { state: loadState, retry } = useFunnelRangeReports(props, loadReport, getErrorMessage);
  const rangeViews = useMemo(
    () => (loadState.status === "ready" ? loadState.ranges : []).map((range) => ({
      ...range,
      stages: buildStages(range.report.counts),
      hasEntries: range.report.counts.articleViewCount > 0,
    })),
    [loadState],
  );
  const groups = useMemo(() => buildFunnelRangeGroups(rangeViews), [rangeViews]);
  const primaryRange = rangeViews[0];
  const hasEntries = rangeViews.some((range) => range.hasEntries);
  const isComparing = props.filters.comparisonDateRange !== null;

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={blogPlatformChoiceFunnelAnchor.funnelId} title={blogPlatformChoiceFunnelTitle} onDetailsNavigate={props.onDetailsNavigate} />

      {loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={retry}>Retry</button></div> : null}
      {rangeViews.map((range) => {
        const startDateNote = buildBlogFunnelStartDateNote(range.dateRange);
        return startDateNote === null ? null : <p key={range.key} className="report-state" aria-live="polite">{formatFunnelRangeNote(range.seriesLabel, startDateNote)}</p>;
      })}
      {rangeViews.map((range) => (range.dateRange.from < pageReadEngagementStartDate ? <p key={range.key} className="report-state" aria-live="polite">{formatFunnelRangeNote(range.seriesLabel, `From ${pageReadEngagementStartDate}, a one-page read of 10+ seconds with a scroll, click or key press also counts as Engaged, so a range starting before that day mixes both definitions and its Engaged step reads lower by definition.`)}</p> : null))}

      <FunnelEmptyRangeNotes ranges={rangeViews} />

      {loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={isComparing}
          label="Loading blog article to platform choice funnel…"
        />
      ) : null}
      {loadState.status === "ready" && hasEntries === false ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={isComparing}
          note={<><strong>No blog article views match these filters.</strong><span>A person enters this funnel by viewing a blog article on a selected day.</span></>}
        />
      ) : null}

      {primaryRange !== undefined && hasEntries ? (
        <FunnelStepsChart
          anchor={blogPlatformChoiceFunnelAnchor}
          stages={primaryRange.stages}
          groups={groups}
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
        />
      ) : null}

      {primaryRange !== undefined ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <p>Every step counts people, and a person adds at most one to each step. One person is one visitor identity that viewed a blog article in the selected UTC dates: the site&rsquo;s visitor cookie, or for a visitor who has not consented to a cookie, one daily hash on one UTC day, so a visitor who consents partway through counts as two people. Blog visits count from {blogFunnelStartDate}, the first full UTC day the blog&rsquo;s calls to action led to the home page.</p>
          <p>Every later step counts those same people by what they did on the marketing site in the selected dates, in any order and on any page, so a step can count people the step above it does not. <strong>Engaged</strong> is at least two site events of the kinds Level 1 counts as engagement, the article view included: page views, a 10-second read (from {pageReadEngagementStartDate}), a click, a search or similar; a QR code shown on hover is not one. <strong>Home page viewed</strong> is a home page view. <strong>Platform hovered or clicked</strong> is a <code>site_store_qr_shown</code>, sent when an App Store or Google Play button shows its QR code after a short hover or keyboard focus, or a <code>site_app_entry_clicked</code> with any target. <strong>Platform clicked</strong> is a <code>site_app_entry_clicked</code> with any target, so a web app click counts at both of the last steps, and a reader who only scans the QR code counts at the step before but not here. The funnel ends at the platform choice on purpose, because a store badge click or a QR scan leaves the browser and cannot be matched to anything after it.</p>
          <p>The platform is the article page view&rsquo;s, which the site always reports as web, so a selection without web empties this funnel. The country and language keep a person the way they do on General, and keep a cookieless visitor by the country and interface language of that visitor&rsquo;s article page view. Test accounts, admins, excluded actors and detected automation are left out; a cookieless visitor has no identity for the account rules to test, so only the automation and scraper rules reach them.</p>
        </details>
      ) : null}
    </section>
  );
}

import { useMemo, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { buildFunnelAudienceEmptyStateNote, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import { isFunnelAllAudienceSelected, isFunnelHashedCohortRead } from "../funnels/funnelAudienceSql";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import { FunnelEmptyRangeNotes } from "../funnels/FunnelEmptyRangeNotes";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
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
  type BlogPlatformChoiceFunnelGroup,
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
  return loadBlogPlatformChoiceFunnelReport(config, filters, `${blogPlatformChoiceFunnelTitle} funnel`, null, signal);
}

/**
 * The steps of one group, or of the funnel as a whole, each as the audience the mode asks for.
 *
 * EVERY STEP CAN HAVE A HASHED PART HERE, because every step is a marketing-site fact: the cookieless
 * cohort of `all` is measured the whole way down this funnel rather than ending partway through it.
 */
function buildStages(counts: BlogPlatformChoiceFunnelCounts): ReadonlyArray<FunnelStage<FunnelStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelStepIds`.
  const stages: Readonly<
    Record<FunnelStepId, Readonly<{ label: string; count: number; hashedCount: number }>>
  > = {
    "entry-view": {
      label: "First page: blog article",
      count: counts.entryViewCount + counts.hashedEntryViewCount,
      hashedCount: counts.hashedEntryViewCount,
    },
    engaged: {
      label: "Engaged",
      count: counts.engagedCount + counts.hashedEngagedCount,
      hashedCount: counts.hashedEngagedCount,
    },
    "home-view": {
      label: "Home page viewed",
      count: counts.homeViewCount + counts.hashedHomeViewCount,
      hashedCount: counts.hashedHomeViewCount,
    },
    "platform-hover-or-click": {
      label: "Platform hovered or clicked",
      count: counts.platformHoverOrClickCount + counts.hashedPlatformHoverOrClickCount,
      hashedCount: counts.hashedPlatformHoverOrClickCount,
    },
    "platform-click": {
      label: "Platform clicked",
      count: counts.platformClickCount + counts.hashedPlatformClickCount,
      hashedCount: counts.hashedPlatformClickCount,
    },
  };

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

/** The funnel as a whole: the groups are a partition of both cohorts, so it is their sum. */
function sumFunnelGroups(
  groups: ReadonlyArray<BlogPlatformChoiceFunnelGroup>,
): BlogPlatformChoiceFunnelCounts {
  return groups.reduce<BlogPlatformChoiceFunnelCounts>((totals, group) => ({
    entryViewCount: totals.entryViewCount + group.entryViewCount,
    engagedCount: totals.engagedCount + group.engagedCount,
    homeViewCount: totals.homeViewCount + group.homeViewCount,
    platformHoverOrClickCount: totals.platformHoverOrClickCount + group.platformHoverOrClickCount,
    platformClickCount: totals.platformClickCount + group.platformClickCount,
    hashedEntryViewCount: totals.hashedEntryViewCount + group.hashedEntryViewCount,
    hashedEngagedCount: totals.hashedEngagedCount + group.hashedEngagedCount,
    hashedHomeViewCount: totals.hashedHomeViewCount + group.hashedHomeViewCount,
    hashedPlatformHoverOrClickCount: totals.hashedPlatformHoverOrClickCount + group.hashedPlatformHoverOrClickCount,
    hashedPlatformClickCount: totals.hashedPlatformClickCount + group.hashedPlatformClickCount,
    maturingCount: totals.maturingCount + group.maturingCount,
  }), {
    entryViewCount: 0,
    engagedCount: 0,
    homeViewCount: 0,
    platformHoverOrClickCount: 0,
    platformClickCount: 0,
    hashedEntryViewCount: 0,
    hashedEngagedCount: 0,
    hashedHomeViewCount: 0,
    hashedPlatformHoverOrClickCount: 0,
    hashedPlatformClickCount: 0,
    maturingCount: 0,
  });
}

export function BlogPlatformChoiceFunnelSection(props: FunnelSectionProps): JSX.Element {
  const { state: loadState, retry } = useFunnelRangeReports(props, loadReport, getErrorMessage);
  const rangeViews = useMemo(
    () => (loadState.status === "ready" ? loadState.ranges : []).map((range) => {
      // The groups partition both cohorts, so the funnel-wide numbers are their sum.
      const totals = sumFunnelGroups(range.report.groups);
      return {
        ...range,
        totals,
        stages: buildStages(totals),
        // The whole first step, so a range in which only cookieless visitors arrived draws the funnel
        // instead of claiming nobody came.
        hasEntries: totals.entryViewCount + totals.hashedEntryViewCount > 0,
      };
    }),
    [loadState],
  );
  const groups = useMemo(() => buildFunnelRangeGroups(rangeViews), [rangeViews]);
  // A, whose figures the explainer shows.
  const primaryRange = rangeViews[0];
  const hasEntries = rangeViews.some((range) => range.hasEntries);
  const isComparing = props.filters.comparisonDateRange !== null;
  // The mode alone, never the chart's `showsHashedSplit` prop: that one is the read gate below, and the
  // two differ exactly in the `all`-with-a-country case this note exists to explain.
  const wantsHashedCohort = isFunnelAllAudienceSelected(props.filters);
  const readsHashedCohort = isFunnelHashedCohortRead(props.filters);
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);
  const hashedCountryNote = primaryRange !== undefined
    && wantsHashedCohort
    && props.filters.connectionCountries.length > 0
    ? "A connection country is selected, so the cookieless visitors are left out of these bars entirely: that filter places a person by the connection samples kept for an actor, and these rows have neither an actor nor an installation, so the ingest-time country stored on them answers a different question rather than narrowing this one."
    : null;

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={blogPlatformChoiceFunnelAnchor.funnelId} title={blogPlatformChoiceFunnelTitle} onDetailsNavigate={props.onDetailsNavigate} />

      {loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={retry}>Retry</button></div> : null}
      {rangeViews.map((range) => {
        const startDateNote = buildBlogFunnelStartDateNote(range.dateRange);
        return startDateNote === null ? null : <p key={range.key} className="report-state" aria-live="polite">{formatFunnelRangeNote(range.seriesLabel, startDateNote)}</p>;
      })}
      {rangeViews.map((range) => (range.dateRange.from < pageReadEngagementStartDate ? <p key={range.key} className="report-state" aria-live="polite">{formatFunnelRangeNote(range.seriesLabel, `From ${pageReadEngagementStartDate}, a one-page read of 10+ seconds with a scroll, click or key press also counts as Engaged, so a range starting before that day mixes both definitions and its Engaged step reads lower by definition.`)}</p> : null))}
      {hashedCountryNote !== null ? <p className="report-state" aria-live="polite">{hashedCountryNote}</p> : null}

      {rangeViews.map((range) => <FunnelMaturingWarning key={range.key} seriesLabel={range.seriesLabel} maturingCount={range.totals.maturingCount} entryCount={range.totals.entryViewCount} />)}
      <FunnelEmptyRangeNotes ranges={rangeViews} />

      {loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
          isGrouped={isComparing}
          label="Loading blog article to platform choice funnel…"
        />
      ) : null}
      {/* The audience mode is named here because it is not one of the filters the heading blames and `Reset all` does not clear it. */}
      {loadState.status === "ready" && hasEntries === false ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
          isGrouped={isComparing}
          note={<><strong>No first visits on a blog article match these filters.</strong><span>Only a person whose first site page is a blog article viewed on a selected day enters this funnel.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</>}
        />
      ) : null}

      {primaryRange !== undefined && hasEntries ? (
        <FunnelStepsChart
          anchor={blogPlatformChoiceFunnelAnchor}
          stages={primaryRange.stages}
          groups={groups}
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
        />
      ) : null}

      {primaryRange !== undefined ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>People still inside 7-day window</span><strong>{primaryRange.totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one person, the site&rsquo;s visitor cookie, anchored at their first <code>site_page_viewed</code> on the marketing site, and only when that first page is a blog article viewed in the selected UTC dates with no trusted event anywhere before it. Blog visits count from {blogFunnelStartDate}, the first full UTC day the blog&rsquo;s calls to action led to the home page. A page viewed before the visitor consents to a cookie carries no visitor id, so such a visitor enters at the first page they view after consenting.</p>
          <p>Every later step is that same person within seven days of the entry, each at or after the step above it. <strong>Engaged</strong> is the first site event after the entry page view that Level 1 counts as engagement: another page view, a 10-second read (from {pageReadEngagementStartDate}), a click, a search or similar; a QR code shown on hover is not one. <strong>Home page viewed</strong> is the designed path every call to action in an article leads to, so a reader who uses the footer store badges on the article without visiting the home page is outside this funnel. <strong>Platform hovered or clicked</strong> is a <code>site_store_qr_shown</code>, sent when an App Store or Google Play button shows its QR code after a short hover or keyboard focus, or a <code>site_app_entry_clicked</code> with any target. <strong>Platform clicked</strong> is a <code>site_app_entry_clicked</code> with any target, so a web app click counts at both of the last steps, and a reader who scans the QR code without clicking stops at the step before. The funnel ends at the platform choice on purpose, because a store badge click or a QR scan leaves the browser and cannot be matched to anything after it. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p>The platform is the entry page view&rsquo;s, which the site always reports as web, so a selection without web empties this funnel. The country and language keep a person the way they do on General, so narrowing either keeps only people who signed in. Test accounts, admins and excluded actors are left out.</p>
          <p><strong>Signed-in only</strong> keeps people who resolve to a real, non-guest account. <strong>All</strong> adds cookieless visitors, one person per daily hash, as the lighter part of every bar, and they can reach every step because every step is a marketing-site fact. <strong>All</strong> is an upper bound rather than a count, because a visitor who consents partway through a day can appear once in each part of a step; that is why <strong>With anonymous ID</strong> is the default.</p>
        </details>
      ) : null}
    </section>
  );
}

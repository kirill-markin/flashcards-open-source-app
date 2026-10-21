import { useMemo, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
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
import {
  firstLaunchDemoCardAllowanceSeconds,
  firstLaunchEngagedReviewThreshold,
  firstLaunchFunnelStartDate,
  loadFirstLaunchFunnelReport,
  type FirstLaunchFunnelCounts,
  type FirstLaunchFunnelGroup,
  type FirstLaunchFunnelReport,
} from "./query";

/** The seven funnel steps in chart order; `buildFirstLaunchFunnelStages` takes its order from this list. */
const funnelStepIds = [
  "first-launch",
  "review-screen",
  "revealed",
  "one-review",
  "two-reviews",
  "two-review-days",
  "engaged-returning",
] as const;

export type FirstLaunchFunnelStepId = (typeof funnelStepIds)[number];

export const firstLaunchFunnelAnchor: FunnelAnchor<FirstLaunchFunnelStepId> = {
  funnelId: "first-launch",
  stepIds: funnelStepIds,
};

export const firstLaunchFunnelTitle = "First launch";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected first launch funnel error.";
}

function loadReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  signal: AbortSignal,
): Promise<FirstLaunchFunnelReport> {
  return loadFirstLaunchFunnelReport(config, filters, null, signal);
}

/** The short note shown when the selected range starts before `firstLaunchFunnelStartDate`, or `null`. */
function buildStartDateNote(dateRange: AnalyticsFilterState["dateRange"]): string | null {
  if (dateRange.to < firstLaunchFunnelStartDate) {
    return `First launches count from ${firstLaunchFunnelStartDate}, the first day every app reported every step, so the selected range has no data.`;
  }

  return dateRange.from < firstLaunchFunnelStartDate
    ? `First launches count from ${firstLaunchFunnelStartDate}, the first day every app reported every step, so there is no data before that day.`
    : null;
}

/**
 * The seven steps of one group. Every `hashedCount` is zero and the chart is never told to show a
 * split, because the daily visitor hash exists only on credential-free collector rows, which this
 * funnel never reads.
 */
export function buildFirstLaunchFunnelStages(
  counts: FirstLaunchFunnelCounts,
): ReadonlyArray<FunnelStage<FirstLaunchFunnelStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelStepIds`.
  const stages: Readonly<
    Record<FirstLaunchFunnelStepId, Readonly<{ label: string; count: number; hashedCount: number }>>
  > = {
    "first-launch": { label: "First app launch", count: counts.firstLaunchCount, hashedCount: 0 },
    "review-screen": { label: "Review screen", count: counts.reviewScreenCount, hashedCount: 0 },
    revealed: { label: "Answer revealed", count: counts.revealedCount, hashedCount: 0 },
    "one-review": { label: "1+ review", count: counts.oneReviewCount, hashedCount: 0 },
    "two-reviews": { label: "2+ reviews", count: counts.twoReviewsCount, hashedCount: 0 },
    "two-review-days": {
      label: "Reviews on 2+ days",
      count: counts.twoReviewDaysCount,
      hashedCount: 0,
    },
    "engaged-returning": {
      label: `${firstLaunchEngagedReviewThreshold}+ reviews on 3+ days`,
      count: counts.engagedReturningCount,
      hashedCount: 0,
    },
  };

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

/** The funnel as a whole: the groups are a partition of the cohort, so it is their sum. */
function sumFunnelGroups(
  groups: ReadonlyArray<FirstLaunchFunnelGroup>,
): FirstLaunchFunnelCounts {
  return groups.reduce<FirstLaunchFunnelCounts>((totals, group) => ({
    firstLaunchCount: totals.firstLaunchCount + group.firstLaunchCount,
    reviewScreenCount: totals.reviewScreenCount + group.reviewScreenCount,
    revealedCount: totals.revealedCount + group.revealedCount,
    oneReviewCount: totals.oneReviewCount + group.oneReviewCount,
    twoReviewsCount: totals.twoReviewsCount + group.twoReviewsCount,
    twoReviewDaysCount: totals.twoReviewDaysCount + group.twoReviewDaysCount,
    engagedReturningCount: totals.engagedReturningCount + group.engagedReturningCount,
    maturingCount: totals.maturingCount + group.maturingCount,
  }), {
    firstLaunchCount: 0,
    reviewScreenCount: 0,
    revealedCount: 0,
    oneReviewCount: 0,
    twoReviewsCount: 0,
    twoReviewDaysCount: 0,
    engagedReturningCount: 0,
    maturingCount: 0,
  });
}

export function FirstLaunchFunnelSection(props: FunnelSectionProps): JSX.Element {
  const { state: loadState, retry } = useFunnelRangeReports(props, loadReport, getErrorMessage);
  const rangeViews = useMemo(
    () => (loadState.status === "ready" ? loadState.ranges : []).map((range) => {
      const totals = sumFunnelGroups(range.report.groups);
      return { ...range, totals, stages: buildFirstLaunchFunnelStages(totals), hasEntries: totals.firstLaunchCount > 0 };
    }),
    [loadState],
  );
  const groups = useMemo(() => buildFunnelRangeGroups(rangeViews), [rangeViews]);
  // A, whose figures the explainer shows.
  const primaryRange = rangeViews[0];
  const hasEntries = rangeViews.some((range) => range.hasEntries);
  const isComparing = props.filters.comparisonDateRange !== null;

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={firstLaunchFunnelAnchor.funnelId} title={firstLaunchFunnelTitle} onDetailsNavigate={props.onDetailsNavigate} />

      {loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={retry}>Retry</button></div> : null}
      {rangeViews.map((range) => {
        const startDateNote = buildStartDateNote(range.dateRange);
        return startDateNote === null ? null : <p key={range.key} className="report-state" aria-live="polite">{formatFunnelRangeNote(range.seriesLabel, startDateNote)}</p>;
      })}

      {rangeViews.map((range) => <FunnelMaturingWarning key={range.key} seriesLabel={range.seriesLabel} maturingCount={range.totals.maturingCount} entryCount={range.totals.firstLaunchCount} />)}
      <FunnelEmptyRangeNotes ranges={rangeViews} />

      {loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={isComparing}
          label="Loading first launch funnel…"
        />
      ) : null}
      {loadState.status === "ready" && hasEntries === false ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={isComparing}
          note={<><strong>No first app launches match these filters.</strong><span>Only a person whose first event anywhere is launching the iOS, Android or web app on a selected day enters this funnel; a website visit, a sign-in page and a reconstructed open are not launches.</span></>}
        />
      ) : null}

      {primaryRange !== undefined && hasEntries ? (
        <FunnelStepsChart
          anchor={firstLaunchFunnelAnchor}
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
          <div className="funnel-detail-row funnel-explainer-figure"><span>First launches still inside 7-day window</span><strong>{primaryRange.totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one person, anchored at their first app launch on iOS, Android or web in the selected UTC dates, and only when that launch is their first trusted event anywhere. The one exception is a <code>card_created</code> up to {firstLaunchDemoCardAllowanceSeconds} seconds before it, the demo card the app seeds on first launch. A launch is an <code>app_opened</code> or a <code>screen_viewed</code> the app itself sent, whichever came first. The auth service&rsquo;s sign-in page is not the app, so its rows are ignored entirely; a reconstructed <code>app_opened</code> (origin <code>backfill</code>) is never a launch but still counts as earlier activity. First launches count from {firstLaunchFunnelStartDate}, the first UTC day every app reported every step.</p>
          <p>Every later step is that same person within seven days of the first launch, each at or after the step above it: the review screen, which the launch itself may be, a revealed answer, a first answered review, then two reviews, reviews on two UTC days, and {firstLaunchEngagedReviewThreshold} reviews over three days, on any device. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p>The platform is the first launch&rsquo;s, so a selection without iOS, Android or web empties this funnel; the country and language keep a person the way they do on General. Test accounts, admins and excluded actors are left out.</p>
        </details>
      ) : null}
    </section>
  );
}

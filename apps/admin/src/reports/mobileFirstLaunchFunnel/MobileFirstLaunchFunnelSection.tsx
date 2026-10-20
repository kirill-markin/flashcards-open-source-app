import { useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
import { FunnelSectionHeader } from "../funnels/FunnelSectionHeader";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import {
  FunnelStepsChart,
  FunnelStepsEmptyChart,
  FunnelStepsLoadingChart,
  type FunnelStage,
} from "../funnels/FunnelStepsChart";
import {
  loadMobileFirstLaunchFunnelReport,
  mobileFirstLaunchEngagedReviewThreshold,
  mobileFirstLaunchFunnelStartDate,
  type MobileFirstLaunchFunnelCounts,
  type MobileFirstLaunchFunnelGroup,
  type MobileFirstLaunchFunnelReport,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: MobileFirstLaunchFunnelReport }>;

/** The seven funnel steps in chart order; `buildStages` takes its order from this list. */
const funnelStepIds = [
  "first-open",
  "review-screen",
  "revealed",
  "one-review",
  "two-reviews",
  "two-review-days",
  "engaged-returning",
] as const;

type FunnelStepId = (typeof funnelStepIds)[number];

export const mobileFirstLaunchFunnelAnchor: FunnelAnchor<FunnelStepId> = {
  funnelId: "mobile",
  stepIds: funnelStepIds,
};

export const mobileFirstLaunchFunnelTitle = "Mobile first launch";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected mobile first launch funnel error.";
}

/** The short note shown when the selected range starts before `mobileFirstLaunchFunnelStartDate`, or `null`. */
function buildStartDateNote(dateRange: AnalyticsFilterState["dateRange"]): string | null {
  if (dateRange.to < mobileFirstLaunchFunnelStartDate) {
    return `First launches count from ${mobileFirstLaunchFunnelStartDate}, the first day the apps reported every step, so the selected range has no data.`;
  }

  return dateRange.from < mobileFirstLaunchFunnelStartDate
    ? `First launches count from ${mobileFirstLaunchFunnelStartDate}, the first day the apps reported every step, so there is no data before that day.`
    : null;
}

/**
 * The seven steps of one group. Every `hashedCount` is zero and the chart is never told to show a
 * split, because the daily visitor hash exists only on marketing-site rows: there are no cookieless
 * people on mobile, so the `all` audience mode counts exactly who `with-anonymous-id` counts here.
 */
function buildStages(counts: MobileFirstLaunchFunnelCounts): ReadonlyArray<FunnelStage<FunnelStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelStepIds`.
  const stages: Readonly<
    Record<FunnelStepId, Readonly<{ label: string; count: number; hashedCount: number }>>
  > = {
    "first-open": { label: "First app open", count: counts.firstOpenCount, hashedCount: 0 },
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
      label: `${mobileFirstLaunchEngagedReviewThreshold}+ reviews on 3+ days`,
      count: counts.engagedReturningCount,
      hashedCount: 0,
    },
  };

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

/** The funnel as a whole: the groups are a partition of the cohort, so it is their sum. */
function sumFunnelGroups(
  groups: ReadonlyArray<MobileFirstLaunchFunnelGroup>,
): MobileFirstLaunchFunnelCounts {
  return groups.reduce<MobileFirstLaunchFunnelCounts>((totals, group) => ({
    firstOpenCount: totals.firstOpenCount + group.firstOpenCount,
    reviewScreenCount: totals.reviewScreenCount + group.reviewScreenCount,
    revealedCount: totals.revealedCount + group.revealedCount,
    oneReviewCount: totals.oneReviewCount + group.oneReviewCount,
    twoReviewsCount: totals.twoReviewsCount + group.twoReviewsCount,
    twoReviewDaysCount: totals.twoReviewDaysCount + group.twoReviewDaysCount,
    engagedReturningCount: totals.engagedReturningCount + group.engagedReturningCount,
    maturingCount: totals.maturingCount + group.maturingCount,
  }), {
    firstOpenCount: 0,
    reviewScreenCount: 0,
    revealedCount: 0,
    oneReviewCount: 0,
    twoReviewsCount: 0,
    twoReviewDaysCount: 0,
    engagedReturningCount: 0,
    maturingCount: 0,
  });
}

export function MobileFirstLaunchFunnelSection(props: FunnelSectionProps): JSX.Element {
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    const abortController = new AbortController();
    void loadMobileFirstLaunchFunnelReport(props.config, props.filters, null, abortController.signal)
      .then((report) => {
        if (cancelled === false) {
          setLoadState({ status: "ready", report });
        }
      })
      .catch((error: unknown) => {
        if (cancelled || props.onTerminalAdminError(error, props.config)) {
          return;
        }

        setLoadState({ status: "error", message: getErrorMessage(error) });
      });

    return () => { cancelled = true; abortController.abort(); };
  }, [loadRevision, props.config, props.filters, props.isRangeLoading, props.onTerminalAdminError]);

  const report = props.isRangeLoading === false && loadState.status === "ready" ? loadState.report : null;
  const totals = useMemo(
    () => (report === null ? null : sumFunnelGroups(report.groups)),
    [report],
  );
  const stages = useMemo(() => (totals === null ? [] : buildStages(totals)), [totals]);
  const startDateNote = report === null ? null : buildStartDateNote(props.filters.dateRange);
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={mobileFirstLaunchFunnelAnchor.funnelId} title={mobileFirstLaunchFunnelTitle} />

      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}

      {totals !== null ? <FunnelMaturingWarning maturingCount={totals.maturingCount} entryCount={totals.firstOpenCount} /> : null}

      {props.isRangeLoading || loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={false}
          label="Loading mobile first launch funnel…"
        />
      ) : null}
      {/* The audience mode is named here because it is not one of the filters the heading blames and `Reset all` does not clear it. */}
      {totals !== null && totals.firstOpenCount === 0 ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={false}
          note={<><strong>No first mobile app opens match these filters.</strong><span>Only a person whose first event anywhere is opening the iOS or Android app on a selected day enters this funnel.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</>}
        />
      ) : null}

      {totals !== null && totals.firstOpenCount > 0 ? (
        <FunnelStepsChart
          anchor={mobileFirstLaunchFunnelAnchor}
          stages={stages}
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
        />
      ) : null}

      {totals !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>First opens still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one person, anchored at their first <code>app_opened</code> on iOS or Android in the selected UTC dates, and only when that app open is their first trusted event anywhere. The one exception is a <code>card_created</code> up to 60 seconds before it, the demo card the app seeds on first launch. First opens count from {mobileFirstLaunchFunnelStartDate}, the first UTC day both apps reported every step.</p>
          <p>Every later step is that same person within seven days of the first app open, each at or after the step above it: the review screen, a revealed answer, a first answered review, then two reviews, reviews on two UTC days, and {mobileFirstLaunchEngagedReviewThreshold} reviews over three days, on any device. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p>The platform is the first app open&rsquo;s, so a selection without iOS or Android empties this funnel; the country and language keep a person the way they do on General. Test accounts, admins and excluded actors are left out. <strong>Signed-in only</strong> keeps people who resolve to a real, non-guest account; <strong>All</strong> counts the same people as <strong>With anonymous ID</strong>, because there are no cookieless people in a mobile app.</p>
        </details>
      ) : null}
    </section>
  );
}

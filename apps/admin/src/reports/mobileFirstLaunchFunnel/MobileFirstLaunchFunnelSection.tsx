import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import { FunnelGroupByPicker } from "../funnels/FunnelGroupByPicker";
import {
  buildFunnelGroupLabel,
  foldFunnelGroups,
  parseFunnelGroupByDimension,
  writeFunnelGroupByToUrl,
  type FunnelGroup,
  type FunnelGroupByDimension,
} from "../funnels/funnelGroupBy";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import { FunnelStepsChart, type FunnelStage } from "../funnels/FunnelStepsChart";
import {
  loadMobileFirstLaunchFunnelReport,
  mobileFirstLaunchEngagedReviewThreshold,
  mobileFirstLaunchFunnelGroupByDimensions,
  mobileFirstLaunchFunnelStartDate,
  type MobileFirstLaunchFunnelCounts,
  type MobileFirstLaunchFunnelGroup,
  type MobileFirstLaunchFunnelReport,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  /**
   * The report and the dimension it was loaded with, which are only meaningful together: the group
   * keys in the report are that dimension's, and nothing else may read them as another's.
   */
  | Readonly<{
    status: "ready";
    report: MobileFirstLaunchFunnelReport;
    dimension: FunnelGroupByDimension | null;
  }>;

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

/**
 * The funnel as a whole. The groups are a partition of the cohort, so every funnel-wide figure - the
 * empty state, the maturing warning and the explainer - is their sum, whichever way `Group by` is set.
 */
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
  // The field is this funnel's own, seeded from the URL on mount and written back on every pick, so a
  // reload or a shared link reopens the same grouping; `null` is the ungrouped default.
  const [groupByDimension, setGroupByDimension] = useState<FunnelGroupByDimension | null>(
    () => parseFunnelGroupByDimension(
      new URLSearchParams(window.location.search),
      mobileFirstLaunchFunnelAnchor.funnelId,
      mobileFirstLaunchFunnelGroupByDimensions,
    ),
  );

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    void loadMobileFirstLaunchFunnelReport(props.config, props.filters, groupByDimension)
      .then((report) => {
        if (cancelled === false) {
          setLoadState({ status: "ready", report, dimension: groupByDimension });
        }
      })
      .catch((error: unknown) => {
        if (cancelled || props.onTerminalAdminError(error, props.config)) {
          return;
        }

        setLoadState({ status: "error", message: getErrorMessage(error) });
      });

    return () => { cancelled = true; };
  }, [
    groupByDimension,
    loadRevision,
    props.config,
    props.filters,
    props.isRangeLoading,
    props.onTerminalAdminError,
  ]);

  // The group key is a property of the person, so regrouping re-reads the cohort rather than
  // re-cutting numbers the browser already has.
  const selectGroupByDimension = useCallback((dimension: FunnelGroupByDimension | null): void => {
    setGroupByDimension(dimension);
    writeFunnelGroupByToUrl(mobileFirstLaunchFunnelAnchor.funnelId, dimension?.id ?? null);
  }, []);

  // The report and the dimension it was loaded with, read as the pair they are.
  const readyState = props.isRangeLoading === false && loadState.status === "ready" ? loadState : null;
  const report = readyState === null ? null : readyState.report;
  const totals = useMemo(
    () => (report === null ? null : sumFunnelGroups(report.groups)),
    [report],
  );
  const stages = useMemo(() => (totals === null ? [] : buildStages(totals)), [totals]);
  // THE LOADED DIMENSION RATHER THAN THE SELECTED ONE DECIDES WHETHER THERE ARE GROUPS TO DRAW.
  // Picking one re-renders this section before the load effect runs, so for that one render the field
  // already says `Platform` while the report in hand is still the previous dimension's - or the
  // ungrouped `all` - and reading those keys as the new dimension's would name and colour them as
  // platforms they never were. The chart keeps its ungrouped shape for that render, until the report
  // the field asked for arrives. The funnel-wide totals above are unaffected, because the groups of
  // any dimension are a partition of the same cohort and sum to the same numbers.
  const groups = useMemo<ReadonlyArray<FunnelGroup<FunnelStepId>> | null>(() => {
    const loadedDimension = readyState === null ? null : readyState.dimension;
    if (readyState === null || loadedDimension === null || loadedDimension !== groupByDimension) {
      return null;
    }

    return foldFunnelGroups(loadedDimension, readyState.report.groups.map((group) => ({
      key: group.key,
      label: buildFunnelGroupLabel(loadedDimension, group.key),
      stages: buildStages(group),
    })));
  }, [groupByDimension, readyState]);
  const startDateNote = report === null ? null : buildStartDateNote(props.filters.dateRange);
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);

  return (
    <section className="dashboard-section funnel-report">
      <header className="dashboard-section-header">
        <p className="eyebrow">Funnel report</p>
        <h2>{mobileFirstLaunchFunnelTitle}</h2>
      </header>

      {props.filterRow}

      {/* OUTSIDE EVERY STATE GATE BELOW, because the chart is not mounted while the report loads and
          not mounted at all while the funnel is empty. A field that unmounts on its own use drops
          keyboard focus on every pick, and once a narrowed range leaves no first opens a grouping
          already in the URL could only be cleared by editing the URL by hand. */}
      <div className="funnel-group-by-row">
        <FunnelGroupByPicker
          funnelId={mobileFirstLaunchFunnelAnchor.funnelId}
          dimensions={mobileFirstLaunchFunnelGroupByDimensions}
          selectedDimensionId={groupByDimension === null ? null : groupByDimension.id}
          isReportLoading={props.isRangeLoading || loadState.status === "loading"}
          onSelect={selectGroupByDimension}
        />
      </div>

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading mobile first launch funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {/* The audience mode is named here because it is not one of the filters the heading blames and `Reset all` does not clear it. */}
      {totals !== null && totals.firstOpenCount === 0 ? <div className="report-state"><strong>No first mobile app opens match these filters.</strong><span>Only a person whose first event anywhere is opening the iOS or Android app on a selected day enters this funnel.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</div> : null}

      {totals !== null ? <FunnelMaturingWarning maturingCount={totals.maturingCount} entryCount={totals.firstOpenCount} /> : null}

      {totals !== null && totals.firstOpenCount > 0 ? (
        <FunnelStepsChart
          anchor={mobileFirstLaunchFunnelAnchor}
          stages={stages}
          groups={groups ?? undefined}
          countLabel="People"
          tableCaption="Mobile first launch funnel steps"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
        />
      ) : null}

      {totals !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>First opens still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one person, anchored at their first <code>app_opened</code> on iOS or Android in the selected UTC dates, and only when that app open is their first trusted event anywhere, over every event name and all of history. A person who first used the web app, the agent API or an earlier app version before the range is not here. A signed-out marketing-site visit is not a trusted event, so it does not keep anyone out. One event is let through: a <code>card_created</code> up to 60 seconds before that app open, which is the demo onboarding card the app seeds during its first launch. A <code>card_created</code> any earlier, or any other earlier event, still keeps the person out, so someone who first created cards through the agent API or MCP is not counted as new. First opens count only from {mobileFirstLaunchFunnelStartDate}, the first UTC day on which the iOS and Android apps had reported both a review-screen <code>screen_viewed</code> and a <code>review_card_revealed</code>, so a range starting earlier does not show drop-off at steps the apps were not yet reporting.</p>
          <p>Every later step is that same person within seven days of the first app open, each at or after the step above it: a <code>screen_viewed</code> of the review screen, a <code>review_card_revealed</code>, then a first <code>review_answered</code>. The review count runs from that first answer, and the day steps count the distinct UTC dates those same reviews fall on, so the tail is two reviews, then reviews on two different days, then {mobileFirstLaunchEngagedReviewThreshold} reviews spread over three different days. Neither the count nor the days are limited to the device the person started on. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p>The date range, the client platform, the connection country and the app interface language are applied in SQL. The platform is the first app open&rsquo;s, so any selection without iOS or Android empties this funnel; the country and language keep a person the way they do on General, from their events in the selected dates. An <code>@example.com</code> account, an admin and an actor on the analytics exclusion list are excluded.</p>
          <p>&ldquo;Who the funnels count&rdquo; reaches this funnel in one way only. <strong>Signed-in only</strong> keeps just the people whose identity resolves to a real, non-guest account at some point up to now, read from a Cognito row in <code>auth.user_identities</code>, so a guest who never registered drops out while one who registered later stays, first launch and all. <strong>All</strong> and <strong>With anonymous ID</strong> count the same people here: the daily visitor hash that widens the site funnels exists only on marketing-site rows, and there are no cookieless people in a mobile app.</p>
          <p><strong>Group by</strong> splits exactly those people and measures each group inside itself: one bar per group at every step, every percentage taken from that group&rsquo;s own first step, and a selected step re-bases each group on its own count there, so two groups of very different size are compared by their rates. The key is a property of the person over the selected dates - the platform of their first app open, the alphabetically first connection country or app interface language their events in range carry - so the groups always sum back to the numbers above. Somebody no country or language can be placed in is kept in <strong>Unresolved</strong> rather than dropped, and beyond the five largest groups the rest are summed into <strong>Other</strong>. A group key is not narrowed by the filter of the same name: a person whose events in range carry two countries is kept by a <strong>Connection country</strong> selection that matches either of them and is still grouped under the alphabetically first, so a grouped chart can show a country - or a language - that the filter above it did not select.</p>
        </details>
      ) : null}
    </section>
  );
}

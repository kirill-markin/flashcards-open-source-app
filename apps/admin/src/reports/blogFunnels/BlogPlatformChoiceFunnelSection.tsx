import { useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote } from "../../filters/analyticsFilters";
import { isFunnelAllAudienceSelected, isFunnelHashedCohortRead } from "../funnels/funnelAudienceSql";
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
  blogFunnelStartDate,
  buildBlogFunnelStartDateNote,
} from "./blogFunnelEntry";
import {
  loadBlogPlatformChoiceFunnelReport,
  type BlogPlatformChoiceFunnelCounts,
  type BlogPlatformChoiceFunnelGroup,
  type BlogPlatformChoiceFunnelReport,
  type BlogPlatformChoiceTargetCounts,
} from "./platformChoiceQuery";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: BlogPlatformChoiceFunnelReport }>;

/** The three funnel steps in chart order; `buildStages` takes its order from this list. */
const funnelStepIds = ["entry-view", "home-view", "platform-click"] as const;

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

/**
 * The three steps of one group, or of the funnel as a whole, each as the audience the mode asks for.
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
    "home-view": {
      label: "Home page viewed",
      count: counts.homeViewCount + counts.hashedHomeViewCount,
      hashedCount: counts.hashedHomeViewCount,
    },
    "platform-click": {
      label: "Platform picked",
      count: counts.platformClickCount + counts.hashedPlatformClickCount,
      hashedCount: counts.hashedPlatformClickCount,
    },
  };

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

function sumTargetCounts(
  totals: BlogPlatformChoiceTargetCounts,
  group: BlogPlatformChoiceTargetCounts,
): BlogPlatformChoiceTargetCounts {
  return {
    web_app: totals.web_app + group.web_app,
    app_store: totals.app_store + group.app_store,
    google_play: totals.google_play + group.google_play,
  };
}

const emptyTargetCounts: BlogPlatformChoiceTargetCounts = {
  web_app: 0,
  app_store: 0,
  google_play: 0,
};

/** The funnel as a whole: the groups are a partition of both cohorts, so it is their sum. */
function sumFunnelGroups(
  groups: ReadonlyArray<BlogPlatformChoiceFunnelGroup>,
): BlogPlatformChoiceFunnelCounts {
  return groups.reduce<BlogPlatformChoiceFunnelCounts>((totals, group) => ({
    entryViewCount: totals.entryViewCount + group.entryViewCount,
    homeViewCount: totals.homeViewCount + group.homeViewCount,
    platformClickCount: totals.platformClickCount + group.platformClickCount,
    targetCounts: sumTargetCounts(totals.targetCounts, group.targetCounts),
    hashedEntryViewCount: totals.hashedEntryViewCount + group.hashedEntryViewCount,
    hashedHomeViewCount: totals.hashedHomeViewCount + group.hashedHomeViewCount,
    hashedPlatformClickCount: totals.hashedPlatformClickCount + group.hashedPlatformClickCount,
    hashedTargetCounts: sumTargetCounts(totals.hashedTargetCounts, group.hashedTargetCounts),
    maturingCount: totals.maturingCount + group.maturingCount,
  }), {
    entryViewCount: 0,
    homeViewCount: 0,
    platformClickCount: 0,
    targetCounts: emptyTargetCounts,
    hashedEntryViewCount: 0,
    hashedHomeViewCount: 0,
    hashedPlatformClickCount: 0,
    hashedTargetCounts: emptyTargetCounts,
    maturingCount: 0,
  });
}

export function BlogPlatformChoiceFunnelSection(props: FunnelSectionProps): JSX.Element {
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    const abortController = new AbortController();
    void loadBlogPlatformChoiceFunnelReport(
      props.config,
      props.filters,
      `${blogPlatformChoiceFunnelTitle} funnel`,
      null,
      abortController.signal,
    )
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
  // The groups partition both cohorts, so the funnel-wide numbers are their sum.
  const totals = useMemo(() => (report === null ? null : sumFunnelGroups(report.groups)), [report]);
  const stages = useMemo(() => (totals === null ? [] : buildStages(totals)), [totals]);
  const startDateNote = totals === null ? null : buildBlogFunnelStartDateNote(props.filters.dateRange);
  // The whole first step, so a range in which only cookieless visitors arrived draws the funnel instead
  // of claiming nobody came.
  const entryCount = totals === null ? 0 : totals.entryViewCount + totals.hashedEntryViewCount;
  // The mode alone, never the chart's `showsHashedSplit` prop: that one is the read gate below, and the
  // two differ exactly in the `all`-with-a-country case this note exists to explain.
  const wantsHashedCohort = isFunnelAllAudienceSelected(props.filters);
  const readsHashedCohort = isFunnelHashedCohortRead(props.filters);
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);
  const hashedCountryNote = totals !== null
    && wantsHashedCohort
    && props.filters.connectionCountries.length > 0
    ? "A connection country is selected, so the cookieless visitors are left out of these bars entirely: that filter places a person by the connection samples kept for an actor, and these rows have neither an actor nor an installation, so the ingest-time country stored on them answers a different question rather than narrowing this one."
    : null;

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={blogPlatformChoiceFunnelAnchor.funnelId} title={blogPlatformChoiceFunnelTitle} />

      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {hashedCountryNote !== null ? <p className="report-state" aria-live="polite">{hashedCountryNote}</p> : null}

      {totals !== null ? <FunnelMaturingWarning maturingCount={totals.maturingCount} entryCount={totals.entryViewCount} /> : null}

      {props.isRangeLoading || loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
          isGrouped={false}
          label="Loading blog article to platform choice funnel…"
        />
      ) : null}
      {/* The audience mode is named here because it is not one of the filters the heading blames and `Reset all` does not clear it. */}
      {totals !== null && entryCount === 0 ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
          isGrouped={false}
          note={<><strong>No first visits on a blog article match these filters.</strong><span>Only a person whose first site page is a blog article viewed on a selected day enters this funnel.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</>}
        />
      ) : null}

      {totals !== null && entryCount > 0 ? (
        <FunnelStepsChart
          anchor={blogPlatformChoiceFunnelAnchor}
          stages={stages}
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
        />
      ) : null}

      {totals !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>People still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one person, the site&rsquo;s visitor cookie, anchored at their first <code>site_page_viewed</code> on the marketing site, and only when that first page is a blog article viewed in the selected UTC dates with no trusted event anywhere before it. Blog visits count from {blogFunnelStartDate}, the first full UTC day the blog&rsquo;s calls to action led to the home page. A page viewed before the visitor consents to a cookie carries no visitor id, so such a visitor enters at the first page they view after consenting.</p>
          <p>Both later steps are that same person within seven days of the entry, each at or after the step above it: a home page view, the designed path every call to action in an article leads to, then a <code>site_app_entry_clicked</code> with any target. The funnel ends at the platform choice on purpose, because a store badge click leaves the browser and cannot be matched to anything after it. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p>The platform is the entry page view&rsquo;s, which the site always reports as web, so a selection without web empties this funnel. The country and language keep a person the way they do on General, so narrowing either keeps only people who signed in. Test accounts, admins and excluded actors are left out.</p>
          <p><strong>Signed-in only</strong> keeps people who resolve to a real, non-guest account. <strong>All</strong> adds cookieless visitors, one person per daily hash, as the lighter part of every bar, and they can reach every step because all three are marketing-site facts. <strong>All</strong> is an upper bound rather than a count, because a visitor who consents partway through a day can appear once in each part of a step; that is why <strong>With anonymous ID</strong> is the default.</p>
        </details>
      ) : null}
    </section>
  );
}

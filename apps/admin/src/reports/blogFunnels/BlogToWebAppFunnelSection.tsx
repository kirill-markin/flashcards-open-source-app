import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote } from "../../filters/analyticsFilters";
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
import { siteEntryEngagedReviewThreshold } from "../siteEntryFunnel/query";
import {
  blogFunnelGroupByDimensions,
  blogFunnelStartDate,
  buildBlogFunnelStartDateNote,
} from "./blogFunnelEntry";
import {
  loadBlogToWebAppFunnelReport,
  type BlogToWebAppFunnelCounts,
  type BlogToWebAppFunnelGroup,
  type BlogToWebAppFunnelReport,
} from "./webAppQuery";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  /**
   * The report and the dimension it was loaded with, which are only meaningful together: the group
   * keys in the report are that dimension's, and nothing else may read them as another's.
   */
  | Readonly<{
    status: "ready";
    report: BlogToWebAppFunnelReport;
    dimension: FunnelGroupByDimension | null;
  }>;

/** The five funnel steps in chart order; `buildStages` takes its order from this list. */
const funnelStepIds = [
  "app-entry-click",
  "signed-in",
  "one-review",
  "engaged",
  "engaged-returning",
] as const;

type FunnelStepId = (typeof funnelStepIds)[number];

// A funnel id of its own, so this funnel's anchor and grouping ride in `blogWebFrom` and
// `blogWebGroupBy` while the platform-choice funnel keeps the `blogFrom` and `blogGroupBy` that shared
// links already carry.
export const blogToWebAppFunnelAnchor: FunnelAnchor<FunnelStepId> = {
  funnelId: "blogWeb",
  stepIds: funnelStepIds,
};

export const blogToWebAppFunnelTitle = "Blog article to web app";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected blog to web app funnel error.";
}

/**
 * The five steps of one group, or of the funnel as a whole.
 *
 * Every `hashedCount` is zero and the chart is never told to show a split: a cookieless visitor can
 * reach the click and nothing under it, so counting their clicks in the first step would inflate the
 * base of the four steps they can never appear in. They are counted in the platform-choice funnel above,
 * whose every step they can reach.
 */
function buildStages(counts: BlogToWebAppFunnelCounts): ReadonlyArray<FunnelStage<FunnelStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelStepIds`.
  const stages: Readonly<
    Record<FunnelStepId, Readonly<{ label: string; count: number; hashedCount: number }>>
  > = {
    "app-entry-click": {
      label: "Web app link clicked",
      count: counts.appEntryClickCount,
      hashedCount: 0,
    },
    "signed-in": { label: "Signed in on the web app", count: counts.signedInCount, hashedCount: 0 },
    "one-review": { label: "1+ review", count: counts.oneReviewCount, hashedCount: 0 },
    engaged: {
      label: `${siteEntryEngagedReviewThreshold}+ reviews`,
      count: counts.engagedCount,
      hashedCount: 0,
    },
    "engaged-returning": {
      label: `${siteEntryEngagedReviewThreshold}+ reviews with a return day`,
      count: counts.engagedReturningCount,
      hashedCount: 0,
    },
  };

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

/**
 * The funnel as a whole. The groups are a partition of its people, so every funnel-wide figure - the
 * empty state, the maturing warning and the explainer - is their sum, whichever way `Group by` is set.
 */
function sumFunnelGroups(groups: ReadonlyArray<BlogToWebAppFunnelGroup>): BlogToWebAppFunnelCounts {
  return groups.reduce<BlogToWebAppFunnelCounts>((totals, group) => ({
    appEntryClickCount: totals.appEntryClickCount + group.appEntryClickCount,
    signedInCount: totals.signedInCount + group.signedInCount,
    oneReviewCount: totals.oneReviewCount + group.oneReviewCount,
    engagedCount: totals.engagedCount + group.engagedCount,
    engagedReturningCount: totals.engagedReturningCount + group.engagedReturningCount,
    maturingCount: totals.maturingCount + group.maturingCount,
  }), {
    appEntryClickCount: 0,
    signedInCount: 0,
    oneReviewCount: 0,
    engagedCount: 0,
    engagedReturningCount: 0,
    maturingCount: 0,
  });
}

export function BlogToWebAppFunnelSection(props: FunnelSectionProps): JSX.Element {
  const funnelId = blogToWebAppFunnelAnchor.funnelId;
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });
  // The field is this funnel's own, seeded from the URL on mount and written back on every pick, so a
  // reload or a shared link reopens the same grouping; `null` is the ungrouped default.
  const [groupByDimension, setGroupByDimension] = useState<FunnelGroupByDimension | null>(
    () => parseFunnelGroupByDimension(
      new URLSearchParams(window.location.search),
      funnelId,
      blogFunnelGroupByDimensions,
    ),
  );

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    void loadBlogToWebAppFunnelReport(
      props.config,
      props.filters,
      `${blogToWebAppFunnelTitle} funnel`,
      groupByDimension,
    )
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

  // The group key is a property of the person, so regrouping re-reads the cohort rather than re-cutting
  // numbers the browser already has.
  const selectGroupByDimension = useCallback((dimension: FunnelGroupByDimension | null): void => {
    setGroupByDimension(dimension);
    writeFunnelGroupByToUrl(funnelId, dimension?.id ?? null);
  }, [funnelId]);

  // The report and the dimension it was loaded with, read as the pair they are.
  const readyState = props.isRangeLoading === false && loadState.status === "ready" ? loadState : null;
  const report = readyState === null ? null : readyState.report;
  const totals = useMemo(() => (report === null ? null : sumFunnelGroups(report.groups)), [report]);
  const stages = useMemo(() => (totals === null ? [] : buildStages(totals)), [totals]);
  // THE LOADED DIMENSION RATHER THAN THE SELECTED ONE DECIDES WHETHER THERE ARE GROUPS TO DRAW. Picking
  // one re-renders this section before the load effect runs, so for that one render the field already
  // says `Entry page language` while the report in hand is still the ungrouped `all`, and reading that
  // one key as a language would draw a bar of everybody named after a language nobody was in.
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
  const startDateNote = totals === null ? null : buildBlogFunnelStartDateNote(props.filters.dateRange);
  const clickCount = totals === null ? 0 : totals.appEntryClickCount;
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);

  return (
    <section className="dashboard-section funnel-report">
      <header className="dashboard-section-header">
        <p className="eyebrow">Funnel report</p>
        <h2>{blogToWebAppFunnelTitle}</h2>
      </header>

      {props.filterRow}

      {/* OUTSIDE EVERY STATE GATE BELOW, because the chart is not mounted while the report loads and
          not mounted at all while the funnel is empty. A field that unmounts on its own use drops
          keyboard focus on every pick, and once a narrowed range leaves nobody a grouping already in
          the URL could only be cleared by editing the URL by hand. */}
      <div className="funnel-group-by-row">
        <FunnelGroupByPicker
          funnelId={funnelId}
          dimensions={blogFunnelGroupByDimensions}
          selectedDimensionId={groupByDimension === null ? null : groupByDimension.id}
          isReportLoading={props.isRangeLoading || loadState.status === "loading"}
          onSelect={selectGroupByDimension}
        />
      </div>

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading blog article to web app funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {/* The audience mode is named here because it is not one of the filters the heading blames and `Reset all` does not clear it. */}
      {totals !== null && clickCount === 0 ? <div className="report-state"><strong>No blog reader clicked the web app link under these filters.</strong><span>This funnel starts at that click, by a person whose first site page was a blog article viewed on a selected day.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</div> : null}

      {totals !== null ? <FunnelMaturingWarning maturingCount={totals.maturingCount} entryCount={clickCount} /> : null}

      {totals !== null && clickCount > 0 ? (
        <FunnelStepsChart
          anchor={blogToWebAppFunnelAnchor}
          stages={stages}
          groups={groups ?? undefined}
          countLabel="People"
          tableCaption={`${blogToWebAppFunnelTitle} funnel steps`}
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
        />
      ) : null}

      {totals !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>People still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p><strong>The first step is the click, so this funnel has a full base under every step below it.</strong> One row is one person who clicked a <code>site_app_entry_clicked</code> with <code>target = &apos;web_app&apos;</code> and whose first <code>site_page_viewed</code> on the marketing site was a blog article (<code>page_kind = &apos;blog_article&apos;</code>) in the selected UTC dates, with no trusted event anywhere before it. The blog visit is the cohort rather than a step, and a home page view between the two is deliberately not required: whichever page the reader clicked from, they are here. How many blog readers reach a platform at all, and which one they pick, is the platform-choice funnel above.</p>
          <p>Blog visits count from {blogFunnelStartDate}, the first full UTC day the blog&rsquo;s calls to action led to the home page instead of straight into the web app, so an earlier range shows a note rather than drop-off; the home page funnel counts from a day earlier, so comparing the two families needs a range inside this one. Pre-consent visits cannot join: where the site has to ask first (the EEA and the UK), a page viewed before the visitor consents carries no visitor id, so that visitor enters at the first page they view after consenting.</p>
          <p>Every later step is that same person within seven days of the blog visit, each at or after the step above it: a web <code>app_opened</code> sent on a signed-in account, then a first <code>review_answered</code>, {siteEntryEngagedReviewThreshold} reviews, and {siteEntryEngagedReviewThreshold} reviews with one of them on a later UTC day than the blog visit. The window is anchored on that visit and not on the click, exactly as the home page funnel anchors it, so a reader who clicks late in the window has less of it left; the figure above counts the clickers still inside theirs, and a person inside it is not a confirmed drop-off. The review count runs from the first answer and is not limited to the web.</p>
          <p>The site and the app join only through sign-in. The web app&rsquo;s first analytics batch sent on the account carries the visitor cookie and links it to that account; until then the in-app steps have nothing trusted to read. Opening the web app and signing in are one step, &ldquo;Signed in on the web app&rdquo;, because a signed-out web app open is held in the browser and reported under the account only after the sign-in, and the web app has no guest mode. If the browser&rsquo;s cookie was already linked to another account, its visits stay with that first account.</p>
          <p>The date range, the client platform, the connection country and the app interface language are applied in SQL. The platform is the blog page view&rsquo;s, and the site always reports as web, so a selection without web empties this funnel. The country and language keep a person the way they do on General, from their trusted events in the selected dates, so narrowing either keeps only people who signed in. An <code>@example.com</code> account, an admin and an actor on the analytics exclusion list are excluded.</p>
          <p>&ldquo;Who the funnels count&rdquo; picks the audience. <strong>With anonymous ID</strong>, the default, is everything described above: a person is the site&rsquo;s visitor cookie. <strong>Signed-in only</strong> keeps just the people whose identity resolves to a real, non-guest account at some point up to now, read from a Cognito row in <code>auth.user_identities</code>; their steps from before they registered still count. <strong>All</strong> counts exactly the same people here as the default: a cookieless visitor reports a daily hash rather than a cookie, so they can produce the click and nothing below it, and adding their clicks to the first step would raise the base of four steps they can never appear in and read as a collapse in activation. They are counted in the platform-choice funnel above, where every step is a marketing-site fact they can reach.</p>
          <p><strong>Group by</strong> splits exactly these people and measures each group inside itself: one bar per group at every step, every percentage taken from that group&rsquo;s own first step, so two groups of very different size are compared by their rates. There are two dimensions, and both are read off the blog article the person entered on rather than off anything in their history. <strong>Entry page language</strong> is the language that page view was read in, taken off that very row, exactly as on the funnels above. <strong>Entry article</strong> is the post itself, keyed on that same row&rsquo;s own <code>page_path</code> — the route the site reports with its locale prefix already stripped, lowercase and with a leading and a trailing slash, so one post is one group across every language — which is how this funnel answers which posts bring the readers who go on to activate. Everyone enters on exactly one page view, so whichever dimension is selected the groups always sum back to the numbers above; <strong>Unresolved</strong> is a visit whose page view reported no language at all under the first dimension and no path at all under the second, and beyond the five largest groups the rest are summed into <strong>Other</strong>. Neither dimension places a cookieless visitor here, unlike on the platform-choice funnel above, because this funnel does not read that cohort at all. A group in which nobody clicked is not drawn at all, because the click is this funnel&rsquo;s first step. Neither a person&rsquo;s connection country nor their app interface language is offered: both read trusted events, so under either dimension the readers who never signed in would all be <strong>Unresolved</strong>. The groups are not the <strong>App interface language</strong> filter&rsquo;s answer either: that field reads the locale of a person&rsquo;s trusted events in the dates, so narrowing it keeps only people who signed in, while their group is the article&rsquo;s own language.</p>
        </details>
      ) : null}
    </section>
  );
}

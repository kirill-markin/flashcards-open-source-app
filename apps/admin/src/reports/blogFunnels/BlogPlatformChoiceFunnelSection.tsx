import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote } from "../../filters/analyticsFilters";
import { isFunnelAllAudienceSelected, isFunnelHashedCohortRead } from "../funnels/funnelAudienceSql";
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
import { formatPercentage, FunnelStepsChart, type FunnelStage } from "../funnels/FunnelStepsChart";
import { siteEntryFunnelGroupByDimensions } from "../siteEntryFunnel/query";
import { blogFunnelStartDate, buildBlogFunnelStartDateNote } from "./blogFunnelEntry";
import {
  blogPlatformChoiceTargets,
  loadBlogPlatformChoiceFunnelReport,
  type BlogPlatformChoiceFunnelCounts,
  type BlogPlatformChoiceFunnelGroup,
  type BlogPlatformChoiceFunnelReport,
  type BlogPlatformChoiceTarget,
  type BlogPlatformChoiceTargetCounts,
} from "./platformChoiceQuery";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  /**
   * The report and the dimension it was loaded with, which are only meaningful together: the group
   * keys in the report are that dimension's, and nothing else may read them as another's.
   */
  | Readonly<{
    status: "ready";
    report: BlogPlatformChoiceFunnelReport;
    dimension: FunnelGroupByDimension | null;
  }>;

/** The three funnel steps in chart order; `buildStages` takes its order from this list. */
const funnelStepIds = ["entry-view", "home-view", "platform-click"] as const;

type FunnelStepId = (typeof funnelStepIds)[number];

// The funnel id is `blog`, so this funnel keeps the `blogFrom` and `blogGroupBy` parameters shared links
// already carry; the web-app blog funnel beside it takes its own.
export const blogPlatformChoiceFunnelAnchor: FunnelAnchor<FunnelStepId> = {
  funnelId: "blog",
  stepIds: funnelStepIds,
};

export const blogPlatformChoiceFunnelTitle = "Blog article to platform choice";

/** What each `site_app_entry_clicked` target is called on screen. */
const blogPlatformChoiceTargetLabels: Readonly<Record<BlogPlatformChoiceTarget, string>> = {
  web_app: "Web app",
  app_store: "App Store",
  google_play: "Google Play",
};

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

/**
 * The funnel as a whole. The groups are a partition of both cohorts, so every funnel-wide figure - the
 * empty state, the maturing warning, the per-target breakdown and the explainer - is their sum,
 * whichever way `Group by` is set.
 */
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
  const funnelId = blogPlatformChoiceFunnelAnchor.funnelId;
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });
  // The field is this funnel's own, seeded from the URL on mount and written back on every pick, so a
  // reload or a shared link reopens the same grouping; `null` is the ungrouped default.
  const [groupByDimension, setGroupByDimension] = useState<FunnelGroupByDimension | null>(
    () => parseFunnelGroupByDimension(
      new URLSearchParams(window.location.search),
      funnelId,
      siteEntryFunnelGroupByDimensions,
    ),
  );

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    void loadBlogPlatformChoiceFunnelReport(
      props.config,
      props.filters,
      `${blogPlatformChoiceFunnelTitle} funnel`,
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
  // The groups partition both cohorts, so the funnel-wide numbers are their sum.
  const totals = useMemo(() => (report === null ? null : sumFunnelGroups(report.groups)), [report]);
  const stages = useMemo(() => (totals === null ? [] : buildStages(totals)), [totals]);
  // THE LOADED DIMENSION RATHER THAN THE SELECTED ONE DECIDES WHETHER THERE ARE GROUPS TO DRAW. Picking
  // one re-renders this section before the load effect runs, so for that one render the field already
  // says `Entry page language` while the report in hand is still the ungrouped `all`, and reading that
  // one key as a language would draw a bar of everybody named after a language nobody was in. The chart
  // keeps its ungrouped shape for that render, until the report the field asked for arrives.
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
  // The whole first step, so a range in which only cookieless visitors arrived draws the funnel instead
  // of claiming nobody came.
  const entryCount = totals === null ? 0 : totals.entryViewCount + totals.hashedEntryViewCount;
  const platformClickCount = totals === null
    ? 0
    : totals.platformClickCount + totals.hashedPlatformClickCount;
  // The breakdown of the last step, both cohorts added per target, in the order the targets are declared
  // in. Each person is under exactly one target, so these rows are a split of that step and add to it.
  const targetBreakdown = useMemo<ReadonlyArray<Readonly<{ target: BlogPlatformChoiceTarget; count: number }>>>(() => {
    if (totals === null) {
      return [];
    }

    const { targetCounts, hashedTargetCounts } = totals;
    return blogPlatformChoiceTargets.map((target) => ({
      target,
      count: targetCounts[target] + hashedTargetCounts[target],
    }));
  }, [totals]);
  // The mode alone, never the chart's `showsHashedSplit` prop: that one is the read gate below, and the
  // two differ exactly in the `all`-with-a-country case this note exists to explain.
  const wantsHashedCohort = isFunnelAllAudienceSelected(props.filters);
  const readsHashedCohort = isFunnelHashedCohortRead(props.filters);
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);
  const hashedCountryNote = totals !== null
    && wantsHashedCohort
    && props.filters.connectionCountries.length > 0
    ? "A connection country is selected, so the cookieless visitors are left out of these bars entirely: their rows carry no country, and keeping them would answer a country question with people whose country is unknown."
    : null;

  return (
    <section className="dashboard-section funnel-report">
      <header className="dashboard-section-header">
        <p className="eyebrow">Funnel report</p>
        <h2>{blogPlatformChoiceFunnelTitle}</h2>
      </header>

      {props.filterRow}

      {/* OUTSIDE EVERY STATE GATE BELOW, because the chart is not mounted while the report loads and
          not mounted at all while the funnel is empty. A field that unmounts on its own use drops
          keyboard focus on every pick, and once a narrowed range leaves nobody a grouping already in
          the URL could only be cleared by editing the URL by hand. */}
      <div className="funnel-group-by-row">
        <FunnelGroupByPicker
          funnelId={funnelId}
          dimensions={siteEntryFunnelGroupByDimensions}
          selectedDimensionId={groupByDimension === null ? null : groupByDimension.id}
          isReportLoading={props.isRangeLoading || loadState.status === "loading"}
          onSelect={selectGroupByDimension}
        />
      </div>

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading blog article to platform choice funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {hashedCountryNote !== null ? <p className="report-state" aria-live="polite">{hashedCountryNote}</p> : null}
      {/* The audience mode is named here because it is not one of the filters the heading blames and `Reset all` does not clear it. */}
      {totals !== null && entryCount === 0 ? <div className="report-state"><strong>No first visits on a blog article match these filters.</strong><span>Only a person whose first site page is a blog article viewed on a selected day enters this funnel.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</div> : null}

      {totals !== null ? <FunnelMaturingWarning maturingCount={totals.maturingCount} entryCount={totals.entryViewCount} /> : null}

      {totals !== null && entryCount > 0 ? (
        <FunnelStepsChart
          anchor={blogPlatformChoiceFunnelAnchor}
          stages={stages}
          groups={groups ?? undefined}
          countLabel="People"
          tableCaption={`${blogPlatformChoiceFunnelTitle} funnel steps`}
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
        />
      ) : null}

      {totals !== null && entryCount > 0 ? (
        <div className="funnel-detail-grid funnel-detail-grid-collapsible">
          <details className="funnel-detail-card">
            <summary><h3>Which platform they picked</h3></summary>
            {targetBreakdown.map((row) => (
              <div className="funnel-detail-row" key={row.target}>
                <span>{blogPlatformChoiceTargetLabels[row.target]}</span>
                <strong>{row.count.toLocaleString("en-US")} · {formatPercentage(row.count, platformClickCount)}</strong>
              </div>
            ))}
            <p>Denominator: the people at <strong>Platform picked</strong>. Each person is counted once, under the target of the very click that step counted, so the three lines are a split of that step and add up to it. They are alternatives rather than steps, which is why they are here instead of below the bars, and <strong>Group by</strong> deliberately does not offer the target: only a person who clicked has one, so every reader who did not would land in <strong>Unresolved</strong> and each real group would read 100% at the last step.</p>
          </details>
        </div>
      ) : null}

      {totals !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>People still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one person, anchored at their first <code>site_page_viewed</code> on the marketing site, and only when that first page is a blog article (<code>page_kind = &apos;blog_article&apos;</code>) viewed in the selected UTC dates, with no trusted event anywhere before it. The person is the site&rsquo;s visitor cookie. Blog visits count from {blogFunnelStartDate}, the first full UTC day the blog&rsquo;s calls to action led to the home page instead of straight into the web app, so an earlier range shows a note rather than drop-off; the home page funnel counts from a day earlier, so comparing the two families needs a range inside this one.</p>
          <p>Pre-consent visits cannot join: where the site has to ask first (the EEA and the UK), a page viewed before the visitor consents carries no visitor id, so it is not in this funnel at all, and such a visitor enters at the first page they view after consenting.</p>
          <p>Both later steps are that same person within seven days of the entry, each at or after the step above it: a <code>site_page_viewed</code> with <code>page_kind = &apos;home&apos;</code>, then a <code>site_app_entry_clicked</code> with any target. The home page view is a step because it is the designed path — every call to action in an article leads there — rather than one of several ways of reaching a platform link, so a reader who picks a platform without ever seeing the home page is outside this funnel by design. The steps are joined on the visitor identity alone and never on the traffic source, because the site reads a page view&rsquo;s source from the page reported before it and a click&rsquo;s source from the document&rsquo;s own referrer, so the two rows can disagree after a client-side navigation. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p><strong>This funnel ends at the platform choice on purpose.</strong> A click on the App Store or Google Play badge leaves the browser, and nothing that survives into the installed app can be matched back to the visitor who clicked, so what those people did next is unjoinable rather than missing: it is construction, not drop-off. A step below the choice could therefore only ever resolve for the web app, which would be the same problem one level down — the whole reason this funnel stops here and the web app&rsquo;s own activation is the funnel beside it, with its click as its first step.</p>
          <p>The date range, the client platform, the connection country and the app interface language are applied in SQL. The platform is the entry page view&rsquo;s, and the site always reports as web, so a selection without web empties this funnel. The country and language keep a person the way they do on General, from their trusted events in the selected dates, so narrowing either keeps only people who signed in. An <code>@example.com</code> account, an admin and an actor on the analytics exclusion list are excluded.</p>
          <p>&ldquo;Who the funnels count&rdquo; picks the audience. <strong>With anonymous ID</strong>, the default, is everything described above: a person is the visitor cookie. <strong>Signed-in only</strong> keeps just the people whose identity resolves to a real, non-guest account at some point up to now, read from a Cognito row in <code>auth.user_identities</code>. <strong>All</strong> adds the cookieless visitors, drawn as the lighter part of every bar: where the site may not set a cookie it still reports a daily hash, and one hash on one UTC day is one person. <strong>This is the one funnel those people reach the bottom of</strong>, because all three steps are marketing-site facts that a browser with no cookie reports exactly as an identified one does; on every other funnel their segment ends partway down against a step that needs an identity the app or the server can meet again. They carry no actor, so the exclusion list and the test-account and admin rules cannot reach them, and their language is the one their own page view recorded.</p>
          <p><strong>All counts people at most once per cohort, not once per person, so it is an upper bound.</strong> A hash and a visitor cookie are never linked, by design: the daily salt is unreadable and no query may resolve one to the other. Where the site must ask before setting a cookie (the EEA and the UK), the same human sends hashed page views before consenting and cookie-bearing ones after, so when the first page they see after consenting is a blog article they can enter once in each part of a step and be added. Nothing here can subtract that overlap, which is why <strong>With anonymous ID</strong> is the default and <strong>All</strong> is a ceiling to read against it rather than a better count.</p>
          <p><strong>Group by</strong> splits exactly those people and measures each group inside itself: one bar per group at every step, every percentage taken from that group&rsquo;s own first step, and a selected step re-bases each group on its own count there, so two groups of very different size are compared by their rates. <strong>Entry page language</strong> is the one dimension here, and its key is the language the entry page view itself was read in, taken off that very row, exactly as on the home page funnel. Everyone enters on exactly one page view, so everyone carries exactly one key and the groups always sum back to the numbers above; only a visit whose page view reported no language at all is <strong>Unresolved</strong>, and beyond the five largest groups the rest are summed into <strong>Other</strong>. The cookieless visitors of <strong>All</strong> are grouped on the same key, read from their own page view the same way. Neither a person&rsquo;s connection country nor their app interface language is offered, because both are read from trusted events that a visitor who never signs in never sends; nor is the client platform, because the entry is a site page view and the site always reports as web. The clicked target is not offered either, for the reason the breakdown above gives.</p>
        </details>
      ) : null}
    </section>
  );
}

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote, type AnalyticsFilterState } from "../../filters/analyticsFilters";
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
import { FunnelStepsChart, type FunnelStage } from "../funnels/FunnelStepsChart";
import {
  loadSiteEntryFunnelReport,
  siteEntryEngagedReviewThreshold,
  siteEntryFunnelGroupByDimensions,
  siteEntryFunnelStartDate,
  type SiteEntryFunnelCounts,
  type SiteEntryFunnelGroup,
  type SiteEntryFunnelReport,
  type SiteEntryPageKind,
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
    report: SiteEntryFunnelReport;
    dimension: FunnelGroupByDimension | null;
  }>;

/** The six funnel steps in chart order; `buildStages` takes its order from this list. */
const funnelStepIds = [
  "entry-view",
  "app-entry-click",
  "signed-in",
  "one-review",
  "engaged",
  "engaged-returning",
] as const;

type FunnelStepId = (typeof funnelStepIds)[number];

/** What differs between the funnels that start on a marketing-site page. */
type SiteEntryFunnelDefinition = Readonly<{
  pageKind: SiteEntryPageKind;
  anchor: FunnelAnchor<FunnelStepId>;
  title: string;
  /** The entry page in running text, such as "home page". */
  pageName: string;
}>;

export const homeToWebAppFunnelAnchor: FunnelAnchor<FunnelStepId> = {
  funnelId: "home",
  stepIds: funnelStepIds,
};

export const blogToWebAppFunnelAnchor: FunnelAnchor<FunnelStepId> = {
  funnelId: "blog",
  stepIds: funnelStepIds,
};

export const homeToWebAppFunnelTitle = "Home page to web app";
export const blogToWebAppFunnelTitle = "Blog article to web app";

const homeToWebAppFunnel: SiteEntryFunnelDefinition = {
  pageKind: "home",
  anchor: homeToWebAppFunnelAnchor,
  title: homeToWebAppFunnelTitle,
  pageName: "home page",
};

const blogToWebAppFunnel: SiteEntryFunnelDefinition = {
  pageKind: "blog_article",
  anchor: blogToWebAppFunnelAnchor,
  title: blogToWebAppFunnelTitle,
  pageName: "blog article",
};

function getErrorMessage(error: unknown, definition: SiteEntryFunnelDefinition): string {
  return error instanceof Error ? error.message : `Unexpected ${definition.title} funnel error.`;
}

/** The short note shown when the selected range starts before `siteEntryFunnelStartDate`, or `null`. */
function buildStartDateNote(dateRange: AnalyticsFilterState["dateRange"]): string | null {
  if (dateRange.to < siteEntryFunnelStartDate) {
    return `Visits count from ${siteEntryFunnelStartDate}, the site's first full day of identified page views, so the selected range has no data.`;
  }

  return dateRange.from < siteEntryFunnelStartDate
    ? `Visits count from ${siteEntryFunnelStartDate}, the site's first full day of identified page views, so there is no data before that day.`
    : null;
}

/**
 * The six steps of one group, or of the funnel as a whole, each as the audience the mode asks for.
 *
 * The query returns the identified cohort and the cookieless one separately, so a step's `count` is
 * their sum and its `hashedCount` is the cookieless part. Only the two site steps can have one: the
 * steps below them all read a trusted in-app row, which a browser with no cookie never produces.
 */
function buildStages(
  counts: SiteEntryFunnelCounts,
  definition: SiteEntryFunnelDefinition,
): ReadonlyArray<FunnelStage<FunnelStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelStepIds`.
  const stages: Readonly<
    Record<FunnelStepId, Readonly<{ label: string; count: number; hashedCount: number }>>
  > = {
    "entry-view": {
      label: `First page: ${definition.pageName}`,
      count: counts.entryViewCount + counts.hashedEntryViewCount,
      hashedCount: counts.hashedEntryViewCount,
    },
    "app-entry-click": {
      label: "Web app link clicked",
      count: counts.appEntryClickCount + counts.hashedAppEntryClickCount,
      hashedCount: counts.hashedAppEntryClickCount,
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
 * The funnel as a whole. The groups are a partition of both cohorts, so every funnel-wide figure -
 * the empty state, the maturing warning and the explainer - is their sum, whichever way `Group by`
 * is set.
 */
function sumFunnelGroups(groups: ReadonlyArray<SiteEntryFunnelGroup>): SiteEntryFunnelCounts {
  return groups.reduce<SiteEntryFunnelCounts>((totals, group) => ({
    entryViewCount: totals.entryViewCount + group.entryViewCount,
    appEntryClickCount: totals.appEntryClickCount + group.appEntryClickCount,
    signedInCount: totals.signedInCount + group.signedInCount,
    oneReviewCount: totals.oneReviewCount + group.oneReviewCount,
    engagedCount: totals.engagedCount + group.engagedCount,
    engagedReturningCount: totals.engagedReturningCount + group.engagedReturningCount,
    hashedEntryViewCount: totals.hashedEntryViewCount + group.hashedEntryViewCount,
    hashedAppEntryClickCount: totals.hashedAppEntryClickCount + group.hashedAppEntryClickCount,
    maturingCount: totals.maturingCount + group.maturingCount,
  }), {
    entryViewCount: 0,
    appEntryClickCount: 0,
    signedInCount: 0,
    oneReviewCount: 0,
    engagedCount: 0,
    engagedReturningCount: 0,
    hashedEntryViewCount: 0,
    hashedAppEntryClickCount: 0,
    maturingCount: 0,
  });
}

function SiteEntryFunnelSection(
  props: FunnelSectionProps & Readonly<{ definition: SiteEntryFunnelDefinition }>,
): JSX.Element {
  const { definition } = props;
  const funnelId = definition.anchor.funnelId;
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });
  // The field is this funnel's own, seeded from the URL on mount and written back on every pick, so
  // a reload or a shared link reopens the same grouping; `null` is the ungrouped default. Both site
  // funnels are this one component, so every read and write of the field goes through the funnel's
  // own id and picking on one never moves the other.
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

    void loadSiteEntryFunnelReport(
      props.config,
      props.filters,
      definition.pageKind,
      `${definition.title} funnel`,
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

        setLoadState({ status: "error", message: getErrorMessage(error, definition) });
      });

    return () => { cancelled = true; };
  }, [
    definition,
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
    writeFunnelGroupByToUrl(funnelId, dimension?.id ?? null);
  }, [funnelId]);

  // The report and the dimension it was loaded with, read as the pair they are.
  const readyState = props.isRangeLoading === false && loadState.status === "ready" ? loadState : null;
  const report = readyState === null ? null : readyState.report;
  // The groups partition both cohorts, so the funnel-wide numbers are their sum.
  const totals = useMemo(() => (report === null ? null : sumFunnelGroups(report.groups)), [report]);
  const stages = useMemo(() => (totals === null ? [] : buildStages(totals, definition)), [totals, definition]);
  // THE LOADED DIMENSION RATHER THAN THE SELECTED ONE DECIDES WHETHER THERE ARE GROUPS TO DRAW.
  // Picking one re-renders this section before the load effect runs, so for that one render the
  // field already says `Entry page language` while the report in hand is still the ungrouped `all`,
  // and reading that one key as a language would draw a bar of everybody named after a language
  // nobody was in. The chart keeps its ungrouped shape for that render, until the report the field
  // asked for arrives. The funnel-wide totals above are unaffected, because the groups of any
  // dimension are a partition of the same people.
  const groups = useMemo<ReadonlyArray<FunnelGroup<FunnelStepId>> | null>(() => {
    const loadedDimension = readyState === null ? null : readyState.dimension;
    if (readyState === null || loadedDimension === null || loadedDimension !== groupByDimension) {
      return null;
    }

    return foldFunnelGroups(loadedDimension, readyState.report.groups.map((group) => ({
      key: group.key,
      label: buildFunnelGroupLabel(loadedDimension, group.key),
      stages: buildStages(group, definition),
    })));
  }, [definition, groupByDimension, readyState]);
  const startDateNote = totals === null ? null : buildStartDateNote(props.filters.dateRange);
  // The whole first step, so a range in which only cookieless visitors arrived draws the funnel
  // instead of claiming nobody came.
  const entryCount = totals === null ? 0 : totals.entryViewCount + totals.hashedEntryViewCount;
  // The mode alone, never the chart's `showsHashedSplit` prop: that one is the read gate below,
  // and the two differ exactly in the `all`-with-a-country case this note exists to explain.
  const wantsHashedCohort = isFunnelAllAudienceSelected(props.filters);
  // What the query actually read, which is what every sentence and column about the cookieless
  // segment is chosen on: with a country selected the mode is still `all` and the cohort is not read.
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
        <h2>{definition.title}</h2>
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

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading {definition.title.toLowerCase()} funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {hashedCountryNote !== null ? <p className="report-state" aria-live="polite">{hashedCountryNote}</p> : null}
      {/* The audience mode is named here because it is not one of the filters the heading blames and `Reset all` does not clear it. */}
      {totals !== null && entryCount === 0 ? <div className="report-state"><strong>No first visits on a {definition.pageName} match these filters.</strong><span>Only a person whose first site page is a {definition.pageName} viewed on a selected day enters this funnel.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</div> : null}

      {totals !== null ? <FunnelMaturingWarning maturingCount={totals.maturingCount} entryCount={totals.entryViewCount} /> : null}

      {totals !== null && entryCount > 0 ? (
        <FunnelStepsChart
          anchor={definition.anchor}
          stages={stages}
          groups={groups ?? undefined}
          countLabel="People"
          tableCaption={`${definition.title} funnel steps`}
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
        />
      ) : null}

      {totals !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>People still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one person, anchored at their first <code>site_page_viewed</code> on the marketing site, and only when that first page is a {definition.pageName} (<code>page_kind = &apos;{definition.pageKind}&apos;</code>) viewed in the selected UTC dates, with no trusted event anywhere before it. The person is the site&rsquo;s visitor cookie, which the web app on the same domain reports under too. Someone who was already using the product is not here once their cookie resolves to their account. Visits count from {siteEntryFunnelStartDate}, the first full UTC day the site reported page views with a visitor id, so an earlier range shows a note rather than drop-off.</p>
          <p>Pre-consent visits cannot join: where the site has to ask first (the EEA and the UK), a page viewed before the visitor consents carries no visitor id, so it is not in this funnel at all, and such a visitor enters at the first page they view after consenting.</p>
          <p>Every later step is that same person within seven days of the entry, each at or after the step above it: a <code>site_app_entry_clicked</code> with <code>target = &apos;web_app&apos;</code> from any site page, a web <code>app_opened</code> sent on a signed-in account, then a first <code>review_answered</code>. The review count runs from that first answer, the return day is one of those answers on a later UTC day than the entry, and neither is limited to the web. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p>The site and the app join only through sign-in. The web app&rsquo;s first analytics batch sent on the account carries the visitor cookie and links it to that account; until then the in-app steps have nothing trusted to read. Opening the web app and signing in are one step, &ldquo;Signed in on the web app&rdquo;, because a signed-out web app open is held in the browser and reported under the account only after the sign-in, and the web app has no guest mode, so every open that can be counted is already a signed-in one. If the browser&rsquo;s cookie was already linked to another account, its visits stay with that first account.</p>
          <p>The date range, the client platform, the connection country and the app interface language are applied in SQL. The platform is the entry page view&rsquo;s, and the site always reports as web, so a selection without web empties this funnel. The country and language keep a person the way they do on General, from their trusted events in the selected dates, so narrowing either keeps only people who signed in. An <code>@example.com</code> account, an admin and an actor on the analytics exclusion list are excluded. The seven-day note above counts only people with an identifier, who are the only ones with a window still to fill.</p>
          <p>&ldquo;Who the funnels count&rdquo; picks the audience. <strong>With anonymous ID</strong>, the default, is everything described above: a person is the visitor cookie. <strong>Signed-in only</strong> keeps just the people whose identity resolves to a real, non-guest account at some point up to now, read from a Cognito row in <code>auth.user_identities</code>; their steps from before they registered still count, and somebody who has since deleted their account does not. <strong>All</strong> adds the cookieless visitors, drawn as the lighter part of the first two bars: where the site may not set a cookie it still reports a daily hash, and one hash on one UTC day is one person. Those people can reach the page view and the web app link click and nothing else, because every step below reads a trusted in-app row that a browser with no cookie never sends, so their segment ends there by construction rather than as drop-off. They also carry no actor, so the exclusion list and the test-account and admin rules cannot reach them, and their language is the one their own page view recorded.</p>
          <p><strong>All counts people at most once per cohort, not once per person, so it is an upper bound.</strong> A hash and a visitor cookie are never linked, by design: the daily salt is unreadable and no query may resolve one to the other. Where the site must ask before setting a cookie (the EEA and the UK), the same human sends hashed page views before consenting and cookie-bearing ones after, and when the first page they see after consenting is a {definition.pageName} they can enter once in each part of step one, and of the click step, and be added. Nothing here can subtract that overlap, which is why <strong>With anonymous ID</strong> is the default and <strong>All</strong> is a ceiling to read against it rather than a better count.</p>
          <p><strong>Group by</strong> splits exactly those people and measures each group inside itself: one bar per group at every step, every percentage taken from that group&rsquo;s own first step, and a selected step re-bases each group on its own count there, so two groups of very different size are compared by their rates. <strong>Entry page language</strong> is the one dimension here, and its key is the language the entry page view itself was read in, taken off that very row. Everyone enters on exactly one page view, so everyone carries exactly one key and the groups always sum back to the numbers above; only a visit whose page view reported no language at all is <strong>Unresolved</strong>, and beyond the five largest groups the rest are summed into <strong>Other</strong>. The cookieless visitors of <strong>All</strong> are grouped on the same key, read from their own page view the same way, so their lighter segment sits inside the language they browsed in rather than apart from it. Neither a person&rsquo;s connection country nor their app interface language is offered: both are read from a person&rsquo;s trusted events, and no entrant here has ever sent one - of the 201 visitors the site has identified so far, not one has produced a trusted row - so under either dimension every entrant lands in <strong>Unresolved</strong> today. The entry rule only bars a trusted event before the entry, so somebody who signs in afterwards could carry such a key; it is the measurement and not the rule that leaves these two with nothing to say here. The client platform is not offered either, because the entry is a site page view and the site always reports as web. The groups are not the <strong>App interface language</strong> filter&rsquo;s answer, and the two halves of <strong>All</strong> differ in how. For a person with an identifier, that field reads the locale their trusted events in the dates carry, so narrowing it keeps only people who signed in, while their group is the entry page&rsquo;s own language, and a grouped chart can show a language the filter above it did not select. For a cookieless visitor the same selection is applied to the entry page view itself, the very row they are grouped by, so their lighter segment can only ever appear inside the selected languages.</p>
        </details>
      ) : null}
    </section>
  );
}

export function HomeToWebAppFunnelSection(props: FunnelSectionProps): JSX.Element {
  return <SiteEntryFunnelSection {...props} definition={homeToWebAppFunnel} />;
}

export function BlogToWebAppFunnelSection(props: FunnelSectionProps): JSX.Element {
  return <SiteEntryFunnelSection {...props} definition={blogToWebAppFunnel} />;
}

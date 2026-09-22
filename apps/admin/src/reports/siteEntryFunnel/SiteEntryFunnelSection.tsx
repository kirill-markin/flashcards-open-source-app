import { useEffect, useMemo, useState, type JSX } from "react";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { isFunnelHashedCohortRead, isFunnelHashedSplitShown } from "../funnels/funnelAudienceSql";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import { FunnelStepsChart, type FunnelStage } from "../funnels/FunnelStepsChart";
import {
  loadSiteEntryFunnelReport,
  siteEntryEngagedReviewThreshold,
  siteEntryFunnelStartDate,
  type SiteEntryFunnelReport,
  type SiteEntryPageKind,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: SiteEntryFunnelReport }>;

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
 * The six steps, each as the whole audience the mode asks for.
 *
 * The query returns the identified cohort and the cookieless one separately, so a step's `count` is
 * their sum and its `hashedCount` is the cookieless part. Only the two site steps can have one: the
 * steps below them all read a trusted in-app row, which a browser with no cookie never produces.
 */
function buildStages(
  report: SiteEntryFunnelReport,
  definition: SiteEntryFunnelDefinition,
): ReadonlyArray<FunnelStage<FunnelStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelStepIds`.
  const stages: Readonly<
    Record<FunnelStepId, Readonly<{ label: string; count: number; hashedCount: number }>>
  > = {
    "entry-view": {
      label: `First page: ${definition.pageName}`,
      count: report.entryViewCount + report.hashedEntryViewCount,
      hashedCount: report.hashedEntryViewCount,
    },
    "app-entry-click": {
      label: "Web app link clicked",
      count: report.appEntryClickCount + report.hashedAppEntryClickCount,
      hashedCount: report.hashedAppEntryClickCount,
    },
    "signed-in": { label: "Signed in on the web app", count: report.signedInCount, hashedCount: 0 },
    "one-review": { label: "1+ review", count: report.oneReviewCount, hashedCount: 0 },
    engaged: {
      label: `${siteEntryEngagedReviewThreshold}+ reviews`,
      count: report.engagedCount,
      hashedCount: 0,
    },
    "engaged-returning": {
      label: `${siteEntryEngagedReviewThreshold}+ reviews with a return day`,
      count: report.engagedReturningCount,
      hashedCount: 0,
    },
  };

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

function SiteEntryFunnelSection(
  props: FunnelSectionProps & Readonly<{ definition: SiteEntryFunnelDefinition }>,
): JSX.Element {
  const { definition } = props;
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    void loadSiteEntryFunnelReport(props.config, props.filters, definition.pageKind, `${definition.title} funnel`)
      .then((report) => {
        if (cancelled === false) {
          setLoadState({ status: "ready", report });
        }
      })
      .catch((error: unknown) => {
        if (cancelled || props.onTerminalAdminError(error, props.config)) {
          return;
        }

        setLoadState({ status: "error", message: getErrorMessage(error, definition) });
      });

    return () => { cancelled = true; };
  }, [definition, loadRevision, props.config, props.filters, props.isRangeLoading, props.onTerminalAdminError]);

  const report = props.isRangeLoading === false && loadState.status === "ready" ? loadState.report : null;
  const stages = useMemo(() => (report === null ? [] : buildStages(report, definition)), [report, definition]);
  const startDateNote = report === null ? null : buildStartDateNote(props.filters.dateRange);
  // The whole first step, so a range in which only cookieless visitors arrived draws the funnel
  // instead of claiming nobody came.
  const entryCount = report === null ? 0 : report.entryViewCount + report.hashedEntryViewCount;
  // The mode alone, never the chart's `showsHashedSplit` prop: that one is the read gate below,
  // and the two differ exactly in the `all`-with-a-country case this note exists to explain.
  const wantsHashedCohort = isFunnelHashedSplitShown(props.filters);
  // What the query actually read, which is what every sentence and column about the cookieless
  // segment is chosen on: with a country selected the mode is still `all` and the cohort is not read.
  const readsHashedCohort = isFunnelHashedCohortRead(props.filters);
  const hashedCountryNote = report !== null
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

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading {definition.title.toLowerCase()} funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {hashedCountryNote !== null ? <p className="report-state" aria-live="polite">{hashedCountryNote}</p> : null}
      {report !== null && entryCount === 0 ? <div className="report-state"><strong>No first visits on a {definition.pageName} match these filters.</strong><span>Only a person whose first site page is a {definition.pageName} viewed on a selected day enters this funnel.</span></div> : null}

      {report !== null ? <FunnelMaturingWarning maturingCount={report.maturingCount} entryCount={report.entryViewCount} /> : null}

      {report !== null && entryCount > 0 ? (
        <FunnelStepsChart
          anchor={definition.anchor}
          stages={stages}
          countLabel="People"
          tableCaption={`${definition.title} funnel steps`}
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
        />
      ) : null}

      {report !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>People still inside 7-day window</span><strong>{report.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one person, anchored at their first <code>site_page_viewed</code> on the marketing site, and only when that first page is a {definition.pageName} (<code>page_kind = &apos;{definition.pageKind}&apos;</code>) viewed in the selected UTC dates, with no trusted event anywhere before it. The person is the site&rsquo;s visitor cookie, which the web app on the same domain reports under too. Someone who was already using the product is not here once their cookie resolves to their account. Visits count from {siteEntryFunnelStartDate}, the first full UTC day the site reported page views with a visitor id, so an earlier range shows a note rather than drop-off.</p>
          <p>Pre-consent visits cannot join: where the site has to ask first (the EEA and the UK), a page viewed before the visitor consents carries no visitor id, so it is not in this funnel at all, and such a visitor enters at the first page they view after consenting.</p>
          <p>Every later step is that same person within seven days of the entry, each at or after the step above it: a <code>site_app_entry_clicked</code> with <code>target = &apos;web_app&apos;</code> from any site page, a web <code>app_opened</code> sent on a signed-in account, then a first <code>review_answered</code>. The review count runs from that first answer, the return day is one of those answers on a later UTC day than the entry, and neither is limited to the web. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p>The site and the app join only through sign-in. The web app&rsquo;s first analytics batch sent on the account carries the visitor cookie and links it to that account; until then the in-app steps have nothing trusted to read. Opening the web app and signing in are one step, &ldquo;Signed in on the web app&rdquo;, because a signed-out web app open is held in the browser and reported under the account only after the sign-in, and the web app has no guest mode, so every open that can be counted is already a signed-in one. If the browser&rsquo;s cookie was already linked to another account, its visits stay with that first account.</p>
          <p>The date range, the client platform, the connection country and the app interface language are applied in SQL. The platform is the entry page view&rsquo;s, and the site always reports as web, so a selection without web empties this funnel. The country and language keep a person the way they do on General, from their trusted events in the selected dates, so narrowing either keeps only people who signed in. An <code>@example.com</code> account, an admin and an actor on the analytics exclusion list are excluded. The seven-day note above counts only people with an identifier, who are the only ones with a window still to fill.</p>
          <p>&ldquo;Who the funnels count&rdquo; picks the audience. <strong>With anonymous ID</strong>, the default, is everything described above: a person is the visitor cookie. <strong>Signed-in only</strong> keeps just the people whose identity resolves to a real, non-guest account at some point up to now, read from a Cognito row in <code>auth.user_identities</code>; their steps from before they registered still count, and somebody who has since deleted their account does not. <strong>All</strong> adds the cookieless visitors, drawn as the lighter part of the first two bars: where the site may not set a cookie it still reports a daily hash, and one hash on one UTC day is one person. Those people can reach the page view and the web app link click and nothing else, because every step below reads a trusted in-app row that a browser with no cookie never sends, so their segment ends there by construction rather than as drop-off. They also carry no actor, so the exclusion list and the test-account and admin rules cannot reach them, and their language is the one their own page view recorded.</p>
          <p><strong>All counts people at most once per cohort, not once per person, so it is an upper bound.</strong> A hash and a visitor cookie are never linked, by design: the daily salt is unreadable and no query may resolve one to the other. Where the site must ask before setting a cookie (the EEA and the UK), the same human sends hashed page views before consenting and cookie-bearing ones after, and when the first page they see after consenting is a {definition.pageName} they can enter once in each part of step one, and of the click step, and be added. Nothing here can subtract that overlap, which is why <strong>With anonymous ID</strong> is the default and <strong>All</strong> is a ceiling to read against it rather than a better count.</p>
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

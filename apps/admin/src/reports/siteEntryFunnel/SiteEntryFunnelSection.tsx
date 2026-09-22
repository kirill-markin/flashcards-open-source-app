import { useEffect, useMemo, useState, type JSX } from "react";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import { FunnelStepsChart, type FunnelStage } from "../funnels/FunnelStepsChart";
import {
  loadSiteEntryFunnelReport,
  siteEntryEngagedReviewThreshold,
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

const homeToWebAppFunnel: SiteEntryFunnelDefinition = {
  pageKind: "home",
  anchor: homeToWebAppFunnelAnchor,
  title: "Home page to web app",
  pageName: "home page",
};

const blogToWebAppFunnel: SiteEntryFunnelDefinition = {
  pageKind: "blog_article",
  anchor: blogToWebAppFunnelAnchor,
  title: "Blog article to web app",
  pageName: "blog article",
};

function getErrorMessage(error: unknown, definition: SiteEntryFunnelDefinition): string {
  return error instanceof Error ? error.message : `Unexpected ${definition.title} funnel error.`;
}

/** The short note shown when the site's page views start after the selected range does, or `null`. */
function buildLateSiteFactsNote(report: SiteEntryFunnelReport, selectedFrom: string): string | null {
  if (report.effectiveFromDate === null) {
    return "The site had not begun reporting page views by the end of the selected range, so no visits are counted.";
  }

  return report.effectiveFromDate > selectedFrom
    ? `The site began reporting page views on ${report.effectiveFromDate}, so there are no visits to count before that day.`
    : null;
}

function buildStages(
  report: SiteEntryFunnelReport,
  definition: SiteEntryFunnelDefinition,
): ReadonlyArray<FunnelStage<FunnelStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelStepIds`.
  const stages: Readonly<Record<FunnelStepId, Readonly<{ label: string; count: number }>>> = {
    "entry-view": { label: `First page: ${definition.pageName}`, count: report.entryViewCount },
    "app-entry-click": { label: "Web app link clicked", count: report.appEntryClickCount },
    "signed-in": { label: "Signed in on the web app", count: report.signedInCount },
    "one-review": { label: "1+ review", count: report.oneReviewCount },
    engaged: { label: `${siteEntryEngagedReviewThreshold}+ reviews`, count: report.engagedCount },
    "engaged-returning": {
      label: `${siteEntryEngagedReviewThreshold}+ reviews with a return day`,
      count: report.engagedReturningCount,
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
  const lateSiteFactsNote = report === null ? null : buildLateSiteFactsNote(report, props.filters.dateRange.from);

  return (
    <section className="dashboard-section funnel-report">
      <header className="dashboard-section-header">
        <p className="eyebrow">Funnel report</p>
        <h2>{definition.title}</h2>
      </header>

      {props.filterRow}

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading {definition.title.toLowerCase()} funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {lateSiteFactsNote !== null ? <p className="report-state" aria-live="polite">{lateSiteFactsNote}</p> : null}
      {report !== null && report.entryViewCount === 0 ? <div className="report-state"><strong>No first visits on a {definition.pageName} match these filters.</strong><span>Only a person whose first site page is a {definition.pageName} viewed on a selected day enters this funnel.</span></div> : null}

      {report !== null && report.entryViewCount > 0 ? (
        <FunnelStepsChart
          anchor={definition.anchor}
          stages={stages}
          countLabel="People"
          tableCaption={`${definition.title} funnel steps`}
          dateRange={props.filters.dateRange}
        />
      ) : null}

      {report !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Visits still inside 7-day window</span><strong>{report.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>One row is one person, anchored at their first <code>site_page_viewed</code> on the marketing site, and only when that first page is a {definition.pageName} (<code>page_kind = &apos;{definition.pageKind}&apos;</code>) viewed in the selected UTC dates, with no trusted event anywhere before it. The person is the site&rsquo;s visitor cookie, which the web app on the same domain reports under too. Someone who was already using the product is not here once their cookie resolves to their account. Visits count from the first UTC day the site reported a page view with a visitor id, so an earlier range shows a note rather than drop-off.</p>
          <p>Pre-consent visits cannot join: where the site has to ask first (the EEA and the UK), a page viewed before the visitor consents carries no visitor id, so it is not in this funnel at all, and such a visitor enters at the first page they view after consenting.</p>
          <p>Every later step is that same person within seven days of the entry, each at or after the step above it: a <code>site_app_entry_clicked</code> with <code>target = &apos;web_app&apos;</code> from any site page, a web <code>app_opened</code> sent on a signed-in account, then a first <code>review_answered</code>. The review count runs from that first answer, the return day is one of those answers on a later UTC day than the entry, and neither is limited to the web. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p>The site and the app join only through sign-in. The web app&rsquo;s first analytics batch sent on the account carries the visitor cookie and links it to that account; until then the in-app steps have nothing trusted to read. Opening the web app and signing in are one step, &ldquo;Signed in on the web app&rdquo;, because a signed-out web app open is held in the browser and reported under the account only after the sign-in, and the web app has no guest mode, so every open that can be counted is already a signed-in one. If the browser&rsquo;s cookie was already linked to another account, its visits stay with that first account.</p>
          <p>The date range, the client platform, the connection country and the app interface language are applied in SQL. The platform is the entry page view&rsquo;s, and the site always reports as web, so a selection without web empties this funnel. The country and language keep a person the way they do on General, from their trusted events in the selected dates, so narrowing either keeps only people who signed in. An <code>@example.com</code> account, an active admin and an actor on the analytics exclusion list are excluded.</p>
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

import { useEffect, useMemo, useState, type JSX } from "react";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import { formatPercentage, FunnelStepsChart, type FunnelStage } from "../funnels/FunnelStepsChart";
import {
  catalogInstallConversionWindowDays,
  loadCatalogInstallFunnelReport,
  type CatalogInstallFailureBucket,
  type CatalogInstallFunnelReport,
  type CatalogInstallFunnelVisit,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: CatalogInstallFunnelReport }>;

/** The nine main funnel steps in chart order; `buildMainStages` takes its order from this list. */
const funnelMainStepIds = [
  "deck-page-view",
  "install-click",
  "import-screen",
  "import-confirm",
  "install-started",
  "installed",
  "one-review",
  "engaged",
  "engaged-returning",
] as const;

type FunnelMainStepId = (typeof funnelMainStepIds)[number];

export const catalogInstallFunnelAnchor: FunnelAnchor<FunnelMainStepId> = {
  funnelId: "deck",
  stepIds: funnelMainStepIds,
};

type StepCount = Readonly<{ label: string; count: number }>;
type FailureTotal = CatalogInstallFailureBucket & Readonly<{ count: number }>;

/** Where "studied it properly" is drawn, rather than merely opened the deck once. */
const engagedReviewThreshold = 20;

/** One identity for every render without a report, so the derived counts below are memoized once. */
const noVisits: ReadonlyArray<CatalogInstallFunnelVisit> = [];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected deck page to install funnel error.";
}

/** The short note shown when the site's deck page views start after the selected range does, or `null`. */
function buildLateSiteFactsNote(report: CatalogInstallFunnelReport, selectedFrom: string): string | null {
  if (report.effectiveFromDate === null) {
    return "The site had not begun reporting deck page views by the end of the selected range, so no visits are counted.";
  }

  return report.effectiveFromDate > selectedFrom
    ? `The site began reporting deck page views on ${report.effectiveFromDate}, so there are no visits to count before that day.`
    : null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }

  if (seconds < 60) {
    return `${Math.round(seconds)} sec`;
  }

  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} min`;
  }

  return `${(seconds / 3600).toFixed(1)} hr`;
}

function getMedianInstallSeconds(visits: ReadonlyArray<CatalogInstallFunnelVisit>): number | null {
  const values = visits
    .filter((visit) => visit.installedAt !== null)
    .map((visit) => (
      (new Date(visit.installedAt ?? visit.visitedAt).getTime() - new Date(visit.visitedAt).getTime()) / 1000
    ))
    .sort((left, right) => left - right);
  if (values.length === 0) {
    return null;
  }

  const middleIndex = Math.floor(values.length / 2);
  const middle = values[middleIndex];
  if (middle === undefined) {
    return null;
  }

  if (values.length % 2 === 1) {
    return middle;
  }

  return ((values[middleIndex - 1] ?? middle) + middle) / 2;
}

/**
 * The nine steps of one funnel, from the first deck page view to a person who kept studying.
 *
 * The three engagement steps are measurable only on a visit that reached a server install, so a
 * visit with no install carries null review facts and is absent from all three. That keeps them
 * subsets of the install step above them rather than an independent test, and the last one carries
 * both its conditions together for the same reason.
 */
function buildMainStages(
  visits: ReadonlyArray<CatalogInstallFunnelVisit>,
): ReadonlyArray<FunnelStage<FunnelMainStepId>> {
  const countWhere = (matches: (visit: CatalogInstallFunnelVisit) => boolean): number => (
    visits.filter(matches).length
  );

  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelMainStepIds`,
  // which is also where the URL codec reads its default, the first step.
  const stages: Readonly<Record<FunnelMainStepId, StepCount>> = {
    "deck-page-view": { label: "Deck page viewed", count: visits.length },
    "install-click": { label: "Install clicked", count: countWhere((visit) => visit.installClickedAt !== null) },
    "import-screen": { label: "Import screen", count: countWhere((visit) => visit.importScreenAt !== null) },
    "import-confirm": { label: "Import confirm", count: countWhere((visit) => visit.importConfirmAt !== null) },
    "install-started": { label: "Install started", count: countWhere((visit) => visit.installStartedAt !== null) },
    installed: { label: "Installed (server)", count: countWhere((visit) => visit.installedAt !== null) },
    "one-review": { label: "1+ review", count: countWhere((visit) => (visit.installReviewCount ?? 0) >= 1) },
    engaged: {
      label: `${engagedReviewThreshold}+ reviews`,
      count: countWhere((visit) => (visit.installReviewCount ?? 0) >= engagedReviewThreshold),
    },
    "engaged-returning": {
      label: `${engagedReviewThreshold}+ reviews with a return day`,
      count: countWhere((visit) => (
        (visit.installReviewCount ?? 0) >= engagedReviewThreshold && visit.installHasReturnDay === true
      )),
    },
  };

  return funnelMainStepIds.map((id) => ({ id, ...stages[id] }));
}

function buildAuthStages(visits: ReadonlyArray<CatalogInstallFunnelVisit>): ReadonlyArray<StepCount> {
  return [
    { label: "Signed-out import gate", count: visits.filter((visit) => visit.signedOutGateAt !== null).length },
    { label: "Signed in on this browser", count: visits.filter((visit) => visit.signedInAt !== null).length },
    { label: "Import confirm after sign-in", count: visits.filter((visit) => visit.signedOutImportConfirmAt !== null).length },
  ];
}

function buildFailureTotals(visits: ReadonlyArray<CatalogInstallFunnelVisit>): ReadonlyArray<FailureTotal> {
  const totals = new Map<string, FailureTotal>();
  for (const visit of visits) {
    for (const bucket of visit.failureBuckets) {
      const key = `${bucket.stage}:${bucket.reason}`;
      totals.set(key, { ...bucket, count: (totals.get(key)?.count ?? 0) + 1 });
    }
  }

  return Array.from(totals.values()).sort((left, right) => (
    right.count - left.count
    || left.stage.localeCompare(right.stage)
    || left.reason.localeCompare(right.reason)
  ));
}

export function CatalogInstallFunnelSection(props: FunnelSectionProps): JSX.Element {
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    void loadCatalogInstallFunnelReport(props.config, props.filters)
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

    return () => { cancelled = true; };
  }, [loadRevision, props.config, props.filters, props.isRangeLoading, props.onTerminalAdminError]);

  const report = loadState.status === "ready" ? loadState.report : null;
  const visits = report === null ? noVisits : report.visits;
  const mainStages = useMemo(() => buildMainStages(visits), [visits]);
  const authStages = useMemo(() => buildAuthStages(visits), [visits]);
  const failureTotals = useMemo(() => buildFailureTotals(visits), [visits]);

  const newIdentityInstallCount = visits.filter((visit) => visit.installActorIsNew === true).length;
  const returningIdentityInstallCount = visits.filter((visit) => visit.installActorIsNew === false).length;
  const directVisitCount = visits.filter((visit) => visit.source === "direct").length;
  const maturingCount = report === null ? 0 : visits.filter((visit) => (
    new Date(visit.visitedAt).getTime() + catalogInstallConversionWindowDays * 86_400_000
      > new Date(report.generatedAtUtc).getTime()
  )).length;
  const previewsWithoutVisitCount = report === null ? 0 : report.previewsWithoutVisitCounts
    .reduce((total, row) => total + row.visitorCount, 0);
  const installsWithoutVisitCount = report === null ? 0 : report.installsWithoutVisitCount;
  const isReady = props.isRangeLoading === false && loadState.status === "ready";
  const hasVisits = isReady && visits.length > 0;
  const lateSiteFactsNote = isReady && report !== null
    ? buildLateSiteFactsNote(report, props.filters.dateRange.from)
    : null;

  return (
    <section className="dashboard-section funnel-report">
      <header className="dashboard-section-header">
        <p className="eyebrow">Funnel report</p>
        <h2>Deck page to install</h2>
      </header>

      {props.filterRow}

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading deck page to install funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {lateSiteFactsNote !== null ? <p className="report-state" aria-live="polite">{lateSiteFactsNote}</p> : null}
      {isReady && visits.length === 0 ? <div className="report-state"><strong>No identified deck page views match these filters.</strong><span>A page view from a browser that refused consent carries no identity and is not counted, and no earlier traffic history is inferred from Vercel aggregates.</span></div> : null}

      {hasVisits ? (
        <FunnelStepsChart
          anchor={catalogInstallFunnelAnchor}
          stages={mainStages}
          countLabel="Visitors"
          tableCaption="Deck page to install funnel steps"
          dateRange={props.filters.dateRange}
        />
      ) : null}

      {isReady ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Median page view to install</span><strong>{formatDuration(getMedianInstallSeconds(visits))}</strong></div>
          <p>One row is one visitor identity and one deck version, anchored at that identity&rsquo;s first <code>site_page_viewed</code> of that deck&rsquo;s marketing-site page (<code>page_kind = &apos;catalog_package&apos;</code>) in the selected UTC dates. Step two is a <code>catalog_install_clicked</code> on the same deck version. Every step is joined by that same identity — the shared <code>analytics_visitor</code> cookie the site and the app both send, which resolves to the person&rsquo;s account once the app has linked it to a sign-in — and must arrive within seven days of the page view, each at or after the step above it. Only server-origin <code>catalog_deck_installed</code> is success.</p>
          <p>Visits count from the first UTC day the site reported an identified deck page view, so an earlier range shows a note rather than drop-off. Earlier click-only history is not shown here: this funnel starts at the page view. Pre-consent visits cannot join: where the site has to ask first (the EEA and the UK), a page viewed before the visitor consents carries no visitor id, so it is not in this funnel at all.</p>
          <p>The last three steps read the installing person&rsquo;s reviews anywhere in the product rather than in the installed deck, because <code>review_answered</code> names no deck or card; say so wherever they are quoted. They are counted from the install to seven days after the page view, so a late install leaves less of that window, and the return day is a later UTC day than the install&rsquo;s. A visit still inside its seven-day window is not a confirmed drop-off.</p>
          <p>The date range, the client platform and the installed deck are read off the anchoring page view; the site always reports as web, so a selection without web empties this funnel. The connection country and the app interface language keep an identity the way they keep a person on General, from their trusted events in the selected dates, so narrowing either keeps only visitors who signed in. <strong>The placement, source, device category and browser language describe the install click, so they narrow step two and everything below it, never the deck page views above it:</strong> a narrowed selection reads as a lower click rate, not a smaller top. Test-deck visits are excluded, and so is an identity belonging to an <code>@example.com</code> account, an active admin or an actor on the analytics exclusion list — reaching backwards over every row of theirs, including the ones sent before they signed in.</p>
          <p>The import-screen, import-confirm, signed-out-gate and confirm-after-sign-in steps come from <code>screen_viewed</code>, which carries no deck, so a visitor who clicked two deck versions in range has those steps satisfied on both rows by the same view. Import confirm is that screen view rather than <code>catalog_install_preview_ready</code>, which marks the same moment: the screen view is reported by the signed-in app with the account&rsquo;s own credential, so it needs no identity link to meet the install.</p>
          <p>A browser that refused consent is given no identifier at all and appears nowhere here.</p>
        </details>
      ) : null}

      {isReady ? (
        <div className="funnel-detail-grid funnel-detail-grid-collapsible">
          <details className="funnel-detail-card">
            <summary><h3>Signed-out authentication branch</h3></summary>
            {authStages.map((stage) => <div className="funnel-detail-row" key={stage.label}><span>{stage.label}</span><strong>{stage.count.toLocaleString("en-US")} · {formatPercentage(stage.count, authStages[0]?.count ?? 0)}</strong></div>)}
            <p>Denominator: visits that reached the signed-out import gate. &ldquo;Signed in on this browser&rdquo; is the first screen view the same browser sent with an account credential after the gate, so it is the person&rsquo;s sign-in rather than this deck&rsquo;s, and a person who already had an account counts only when this browser signed in, not when they used the app elsewhere. It is read from the app rather than from the sign-in page, whose own events reach the account through a link that a first-ever sign-in usually does not complete in time. The sign-in screen and the code request are not shown for the same reason: a person who gave up there can never be matched to this visit, so those steps could only count people who went on to succeed. Gate to signed in is therefore the whole sign-in drop-off this report can see.</p>
          </details>
          <details className="funnel-detail-card">
            <summary><h3>Diagnostics</h3></summary>
            <div className="funnel-detail-row"><span>Direct-source deck page views (inside denominator)</span><strong>{directVisitCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>Server installs by an identity first seen at its deck page view</span><strong>{newIdentityInstallCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>Server installs by an already-seen identity</span><strong>{returningIdentityInstallCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>Import previews with no deck page view in the selected dates (outside denominator)</span><strong>{previewsWithoutVisitCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>Server installs with no deck page view in the selected dates (outside denominator)</span><strong>{installsWithoutVisitCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>Visits still inside 7-day window</span><strong>{maturingCount.toLocaleString("en-US")}</strong></div>
            <p>&ldquo;First seen&rdquo; is that identity having produced no trusted event at all before its deck page view, over every event name; rows the credential-free public collector wrote are evidence that an event happened, not evidence that a person exists, and are excluded from that test — including the anchoring page view itself, which is one of them. The two no-visit lines can use the date range, the installed deck, the client platform, the connection country and the app interface language, but none of the click dimensions, which a row with no click carries none of; narrowing placement, source, device category or browser language therefore leaves them wider than the funnel above. A deck page view before the first selected day counts as no visit on both lines, as it does in the funnel. Each is a lower bound on what the funnel cannot hold rather than the whole of it: a person whose click was dropped by a selection, or whose step chain is broken, is equally unheld and counted by neither. A server install carries no platform, so selecting any device platform empties its line.</p>
          </details>
          <details className="funnel-detail-card">
            <summary><h3>Observed failures</h3></summary>
            {failureTotals.length === 0 ? <div className="funnel-detail-row"><span>No failures observed</span><strong>0</strong></div> : failureTotals.map((total) => <div className="funnel-detail-row" key={`${total.stage}:${total.reason}`}><span>{total.stage} · {total.reason}</span><strong>{total.count.toLocaleString("en-US")}</strong></div>)}
            <p>Counts are distinct visits per stage/reason; one visit may appear in more than one bucket. Missing telemetry is not classified as abandonment.</p>
          </details>
        </div>
      ) : null}
    </section>
  );
}

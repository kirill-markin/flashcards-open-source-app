import { useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import { isFunnelAllAudienceSelected, isFunnelHashedCohortRead } from "../funnels/funnelAudienceSql";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
import { FunnelSectionHeader } from "../funnels/FunnelSectionHeader";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import {
  FunnelStepsChart,
  FunnelStepsEmptyChart,
  FunnelStepsLoadingChart,
} from "../funnels/FunnelStepsChart";
import {
  catalogInstallFunnelStartDate,
  loadCatalogInstallFunnelReport,
  type CatalogInstallFunnelReport,
} from "./query";
import {
  buildCatalogInstallFunnelReportModel,
  catalogInstallFunnelAnchor,
} from "./reportModel";

export { catalogInstallFunnelAnchor } from "./reportModel";
export const catalogInstallFunnelTitle = "Deck page to install";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: CatalogInstallFunnelReport }>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected deck page to install funnel error.";
}

function buildStartDateNote(dateRange: AnalyticsFilterState["dateRange"]): string | null {
  if (dateRange.to < catalogInstallFunnelStartDate) {
    return `People count from ${catalogInstallFunnelStartDate}, the site's first full day of identified deck page views, so the selected range has no data.`;
  }

  return dateRange.from < catalogInstallFunnelStartDate
    ? `People count from ${catalogInstallFunnelStartDate}, the site's first full day of identified deck page views, so there is no data before that day.`
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

export function CatalogInstallFunnelSection(props: FunnelSectionProps): JSX.Element {
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    const abortController = new AbortController();
    void loadCatalogInstallFunnelReport(props.config, props.filters, abortController.signal)
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

  const report = loadState.status === "ready" ? loadState.report : null;
  const {
    mainStages,
    medianInstallSeconds,
    maturingCount,
    maturityEntryCount,
    hasVisits: reportHasVisits,
  } = useMemo(() => buildCatalogInstallFunnelReportModel(report, null), [report]);

  const isReady = props.isRangeLoading === false && loadState.status === "ready";
  const hasVisits = isReady && reportHasVisits;
  const startDateNote = isReady ? buildStartDateNote(props.filters.dateRange) : null;
  // The mode alone, never the chart's `showsHashedSplit` prop: that one is the read gate below,
  // and the two differ exactly in the `all`-with-a-country case this note exists to explain.
  const wantsHashedCohort = isFunnelAllAudienceSelected(props.filters);
  // What the query actually read, which is what every sentence about the cookieless
  // segment is chosen on: with a country selected the mode is still `all` and the cohort is not read.
  const readsHashedCohort = isFunnelHashedCohortRead(props.filters);
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);
  const hashedCountryNote = isReady
    && wantsHashedCohort
    && props.filters.connectionCountries.length > 0
    ? "A connection country is selected, so the cookieless visitors are left out of these bars entirely: that filter places a person by the connection samples kept for an actor, and these rows have neither an actor nor an installation, so the ingest-time country stored on them answers a different question rather than narrowing this one."
    : null;

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={catalogInstallFunnelAnchor.funnelId} title={catalogInstallFunnelTitle} />

      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {hashedCountryNote !== null ? <p className="report-state" aria-live="polite">{hashedCountryNote}</p> : null}

      {isReady ? <FunnelMaturingWarning maturingCount={maturingCount} entryCount={maturityEntryCount} /> : null}

      {props.isRangeLoading || loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="Visitors"
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
          isGrouped={false}
          label="Loading deck page to install funnel…"
        />
      ) : null}
      {/* Chosen on the read gate, not the mode: with a country selected the cookieless rows were not read, and the note above already says so. The audience mode is named as well, because it is not one of the filters the heading blames and `Reset all` does not clear it. */}
      {isReady && hasVisits === false ? (
        <FunnelStepsEmptyChart
          countLabel="Visitors"
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
          isGrouped={false}
          note={<><strong>No deck page views match these filters.</strong><span>{readsHashedCohort ? "Cookieless visitors are counted here through their daily hash, so this is every deck page view in range, and no earlier traffic history is inferred from Vercel aggregates." : "A page view from a browser that refused consent carries no identity and is not counted, and no earlier traffic history is inferred from Vercel aggregates."}</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</>}
        />
      ) : null}

      {hasVisits ? (
        <FunnelStepsChart
          anchor={catalogInstallFunnelAnchor}
          stages={mainStages}
          countLabel="Visitors"
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
        />
      ) : null}

      {isReady ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Median page view to install</span><strong>{formatDuration(medianInstallSeconds)}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it. Step one is a person who viewed the page of any deck; below it, a person counts at a step when one deck whose page they viewed carried them through every step down to it. Every step is joined by the same visitor identity, the <code>analytics_visitor</code> cookie the site and the app share, and must arrive within seven days of the page view, each at or after the step above it. Only a server-origin <code>catalog_deck_installed</code> is success, and the median is each person&rsquo;s earliest server install measured from that deck&rsquo;s page view.</p>
          <p>People count from {catalogInstallFunnelStartDate}, the first full UTC day the site reported identified deck page views. A page viewed before the visitor consents to a cookie carries no visitor id, so it is not in this funnel. The last three steps read the installing person&rsquo;s reviews anywhere in the product rather than in the installed deck, because <code>review_answered</code> names no deck. A person whose deck page view is still inside its seven-day window is not a confirmed drop-off.</p>
          <p>The client platform is read off the anchoring page view, which the site always reports as web, so a selection without web empties this funnel. The connection country and the app interface language keep an identity the way they keep a person on General, so narrowing either keeps only people who signed in. Test-deck rows, test accounts, admins and excluded actors are left out.</p>
          <p><strong>Signed-in only</strong> keeps the visits whose identity resolves to a real, non-guest account. <strong>All</strong> adds cookieless visitors, one person per daily hash, as the lighter part of the first two bars; they reach no later step, the exclusion rules cannot reach them, and a selected connection country removes them. <strong>All</strong> is an upper bound rather than a count, because a visitor who consents partway through a day can appear once in each part of a step; that is why <strong>With anonymous ID</strong> is the default.</p>
        </details>
      ) : null}
    </section>
  );
}

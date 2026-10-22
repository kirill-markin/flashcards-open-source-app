import { useMemo, type JSX } from "react";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { buildHashedVisitorCountryStartDateNote } from "../funnels/funnelAudienceSql";
import {
  buildFunnelRangeGroups,
  useFunnelRangeReports,
} from "../funnels/funnelRangeReports";
import { FunnelSectionHeader } from "../funnels/FunnelSectionHeader";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import {
  FunnelStepsChart,
  FunnelStepsEmptyChart,
  FunnelStepsLoadingChart,
} from "../funnels/FunnelStepsChart";
import { buildFunnelEmptyRangeNote, buildFunnelRangeWarnings } from "../funnels/funnelWarnings";
import { firstLaunchEngagedReviewThreshold } from "../firstLaunchFunnel/query";
import {
  catalogInstallConversionWindowDays,
  catalogInstallFunnelStartDate,
  loadCatalogInstallFunnelReport,
} from "./query";
import {
  buildCatalogInstallFunnelReportModel,
  catalogInstallFunnelAnchor,
} from "./reportModel";

export { catalogInstallFunnelAnchor } from "./reportModel";
export const catalogInstallFunnelTitle = "Deck page to install";

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

export function CatalogInstallFunnelSection(props: FunnelSectionProps): JSX.Element {
  const { state: loadState, retry } = useFunnelRangeReports(props, loadCatalogInstallFunnelReport, getErrorMessage);
  const rangeViews = useMemo(
    () => (loadState.status === "ready" ? loadState.ranges : []).map((range) => {
      const model = buildCatalogInstallFunnelReportModel(range.report);
      return { ...range, stages: model.mainStages, hasEntries: model.hasEntries };
    }),
    [loadState],
  );
  const groups = useMemo(() => buildFunnelRangeGroups(rangeViews), [rangeViews]);
  const connectionCountries = props.filters.connectionCountries;
  const warnings = useMemo(() => rangeViews.flatMap((range) => buildFunnelRangeWarnings(range, {
    "start-date": buildStartDateNote(range.dateRange),
    "country-start-date": buildHashedVisitorCountryStartDateNote(connectionCountries, range.dateRange),
    maturing: range.report.maturingInstallerCount === 0
      ? null
      : `${range.report.maturingInstallerCount.toLocaleString("en-US")} of ${range.report.installerCount.toLocaleString("en-US")} installers first installed less than ${catalogInstallConversionWindowDays} days ago; their review steps are still filling in.`,
    empty: buildFunnelEmptyRangeNote(rangeViews, range),
  })), [connectionCountries, rangeViews]);
  const primaryRange = rangeViews[0];
  const isReady = loadState.status === "ready";
  const hasEntries = rangeViews.some((range) => range.hasEntries);
  const isComparing = props.filters.comparisonDateRange !== null;

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={catalogInstallFunnelAnchor.funnelId} title={catalogInstallFunnelTitle} warnings={warnings} onDetailsNavigate={props.onDetailsNavigate} />

      {loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={retry}>Retry</button></div> : null}

      {loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="Visitors"
          dateRange={props.filters.dateRange}
          isGrouped={isComparing}
          label="Loading deck page to install funnel…"
        />
      ) : null}
      {isReady && hasEntries === false ? (
        <FunnelStepsEmptyChart
          countLabel="Visitors"
          dateRange={props.filters.dateRange}
          isGrouped={isComparing}
          note={<><strong>No deck page views, install clicks or installs match these filters.</strong><span>Cookieless visitors are counted here through their daily hash, so this is every deck page view in range, and no earlier traffic history is inferred from Vercel aggregates.</span></>}
        />
      ) : null}

      {primaryRange !== undefined && hasEntries ? (
        <FunnelStepsChart
          anchor={catalogInstallFunnelAnchor}
          stages={primaryRange.stages}
          groups={groups}
          countLabel="Visitors"
          dateRange={props.filters.dateRange}
        />
      ) : null}

      {isReady ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <p>The first three steps are each counted on their own over the selected UTC days, from {catalogInstallFunnelStartDate}, with no link, order or time window between them, so a later step can be larger than an earlier one and a share can pass 100%. A deck page view and an install click count each visitor once: by the <code>analytics_visitor</code> cookie or account they carry, or, for a cookieless visitor, once per daily hash per UTC day, so a visitor who consents partway through a day counts twice. An install counts each person with a server-origin <code>catalog_deck_installed</code> once; every install comes through the web import page.</p>
          <p>Only the four review steps are linked, to the people counted at the install: each person&rsquo;s reviews from their first install in range to seven days after it, anywhere in the product rather than in the installed deck, because <code>review_answered</code> names no deck: one review, two reviews, reviews on two UTC days, then {firstLaunchEngagedReviewThreshold} reviews over three UTC days. A person whose first install is less than seven days old is not a confirmed drop-off.</p>
          <p>The client platform narrows the deck page views and install clicks, which the site always reports as web, so a selection without web empties those two steps; a server install carries no platform, so the install and review steps ignore it. The connection country and the app interface language keep an identified visitor or installer the way they keep a person on General, and keep a cookieless visitor by that row&rsquo;s own country and interface language.</p>
          <p>The delisted test deck, test accounts, admins, excluded actors and detected automation are left out of every step. A cookieless visitor has no actor, so only the test-deck, automated-client and scraper-fleet rules reach them.</p>
        </details>
      ) : null}
    </section>
  );
}

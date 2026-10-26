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
  formatPercentage,
  FunnelStepsChart,
  FunnelStepsEmptyChart,
  FunnelStepsLoadingChart,
} from "../funnels/FunnelStepsChart";
import { buildFunnelEmptyRangeNote, buildFunnelRangeWarnings } from "../funnels/funnelWarnings";
import { firstLaunchEngagedReviewThreshold } from "../firstLaunchFunnel/query";
import {
  catalogInstallActivationWindowHours,
  catalogInstallConversionWindowDays,
  catalogInstallFunnelStartDate,
  loadCatalogInstallFunnelReport,
} from "./query";
import {
  buildCatalogInstallFunnelReportModel,
  catalogInstallFunnelAnchor,
} from "./reportModel";

export { catalogInstallFunnelAnchor } from "./reportModel";
export const catalogInstallFunnelTitle = "Deck click to activation";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected deck click to activation funnel error.";
}

function buildStartDateNote(dateRange: AnalyticsFilterState["dateRange"]): string | null {
  return dateRange.from < catalogInstallFunnelStartDate
    ? `Deck-page traffic coverage starts on ${catalogInstallFunnelStartDate}, the first full day of identified deck page views. Earlier traffic is unavailable; the click cohort still uses its recorded click history.`
    : null;
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

function formatRepeatCount(count: number, matureCount: number): string {
  return matureCount === 0 ? "—" : `${formatCount(count)} (${formatPercentage(count, matureCount)})`;
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
    maturing: range.report.maturingClickerCount === 0
      ? null
      : `${formatCount(range.report.maturingClickerCount)} clickers are still inside their ${catalogInstallActivationWindowHours}-hour activation window; their remaining steps are not confirmed drop-offs.`,
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
          countLabel="First-ever clickers"
          dateRange={props.filters.dateRange}
          isGrouped={isComparing}
          label="Loading deck click to activation funnel…"
        />
      ) : null}
      {isReady && hasEntries === false ? (
        <FunnelStepsEmptyChart
          countLabel="First-ever clickers"
          dateRange={props.filters.dateRange}
          isGrouped={isComparing}
          note={<><strong>No first-ever eligible identified clicks match these filters.</strong><span>Independent traffic and installs appear in coverage below; missing identity cannot establish conversion.</span></>}
        />
      ) : null}

      {primaryRange !== undefined && hasEntries ? (
        <FunnelStepsChart
          anchor={catalogInstallFunnelAnchor}
          stages={primaryRange.stages}
          groups={groups}
          countLabel="First-ever clickers"
          dateRange={props.filters.dateRange}
        />
      ) : null}

      {isReady ? (
        <>
          {rangeViews.map((range) => (
            <p key={range.key} className="report-note">
              <strong>{range.seriesLabel ?? `${range.dateRange.from} – ${range.dateRange.to}`}: </strong>
              {formatCount(range.report.cohortClickerCount)} first-ever eligible identified clickers; {formatCount(range.report.maturingClickerCount)} still maturing at {range.report.observedAtUtc}.
              {" "}Activation counts and shares are observed so far within {catalogInstallActivationWindowHours} hours of each click. Maturing clickers remain in the denominator; unfinished steps are not confirmed drop-offs.
            </p>
          ))}

          <h3>Seven-day study after first click</h3>
          <p>Any-card activity in the {catalogInstallConversionWindowDays} days after the same cohort&rsquo;s first click, whether or not a linked install was observed. Only clickers with full follow-up enter these counts and shares; maturing clickers are shown separately.</p>
          <div className="table-scroll">
            <table className="funnel-group-table">
              <thead><tr><th scope="col">Click cohort (UTC)</th><th scope="col">Full 7 days</th><th scope="col">Maturing</th><th scope="col">1+ review</th><th scope="col">2+ reviews</th><th scope="col">2+ review days</th><th scope="col">{firstLaunchEngagedReviewThreshold}+ reviews on 3+ days</th></tr></thead>
              <tbody>
                {rangeViews.map(({ key, seriesLabel, dateRange, report }) => (
                  <tr key={key}>
                    <th scope="row">{seriesLabel ?? `${dateRange.from} – ${dateRange.to}`}</th>
                    <td>{formatCount(report.matureRepeatClickerCount)}</td>
                    <td>{formatCount(report.cohortClickerCount - report.matureRepeatClickerCount)}</td>
                    <td>{formatRepeatCount(report.oneReviewClickerCount, report.matureRepeatClickerCount)}</td>
                    <td>{formatRepeatCount(report.twoReviewsClickerCount, report.matureRepeatClickerCount)}</td>
                    <td>{formatRepeatCount(report.twoReviewDaysClickerCount, report.matureRepeatClickerCount)}</td>
                    <td>{formatRepeatCount(report.engagedReturningClickerCount, report.matureRepeatClickerCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Independent coverage counts</h3>
          <p>Each total counts its selected UTC days independently. These are coverage counts with no conversion ratios: installs may have no attributable click. Traffic combines identified visitors and cookieless visitor-days; consent partway through a day can count twice. Daily hashes cannot link a visitor across hosts.</p>
          <div className="table-scroll">
            <table className="funnel-group-table">
              <thead><tr><th scope="col">Event range (UTC)</th><th scope="col">Deck-page visitors</th><th scope="col">Cookieless viewer-days</th><th scope="col">Install-click visitors</th><th scope="col">Cookieless clicker-days</th><th scope="col">Server installers (all acquisition platforms)</th></tr></thead>
              <tbody>
                {rangeViews.map(({ key, seriesLabel, dateRange, report }) => (
                  <tr key={key}>
                    <th scope="row">{seriesLabel ?? `${dateRange.from} – ${dateRange.to}`}</th>
                    <td>{formatCount(report.deckPageViewerCount)}</td>
                    <td>{formatCount(report.cookielessDeckPageViewerCount)}</td>
                    <td>{formatCount(report.installClickerCount)}</td>
                    <td>{formatCount(report.cookielessInstallClickerCount)}</td>
                    <td>{formatCount(report.installerCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="funnel-explainer">
            <summary>How it&rsquo;s counted</summary>
            <p>The activation cohort contains each resolved actor&rsquo;s first-ever eligible web <code>catalog_install_clicked</code>, selected before the date and audience filters. It requires an actor, the original visitor <code>anonymous_id</code> and a package version. Every matching clicker stays in the denominator even if nothing else is observed. Repeated clicks do not create new cohort members.</p>
            <p>A server <code>catalog_deck_installed</code> must name the clicked package version and occur after the click, within {catalogInstallActivationWindowHours} hours. Activation then requires a persisted <code>review_answered</code> at or after that installation and within the same {catalogInstallActivationWindowHours} hours from the click. Each clicker counts at most once per stage. This ordered activation metric differs from the experiment&rsquo;s any-review metric, which does not require installation.</p>
            <p>Direct resolved actor matches count. A guest or account can also match through the click&rsquo;s original visitor id on a trusted web observation or a server installation of the clicked package, after the click and within follow-up. Activation uses only associations observed within {catalogInstallActivationWindowHours} hours; seven-day study can use associations observed within {catalogInstallConversionWindowDays} days. This is browser attribution, including possible account switches, without new identity links. Missing visitor identity and unlinked installs remain unattributable.</p>
            <p>Reviews can be of any card: the facts carry no card or deck identity, so neither activation nor seven-day study measures retention in the installed deck. Review days are UTC dates. Follow-up can extend past the selected range end, up to the report observation time.</p>
            <p>Client platform selects the acquisition click and all its outcomes; without web the cohort is empty. Independent server-install coverage has no acquisition platform and ignores that filter. Country and app interface language select the click actor using the shared person filters; independent identified traffic and install coverage use their own actors, and cookieless coverage uses each row&rsquo;s country and language.</p>
            <p>The delisted test deck and the shared test-account, admin, excluded-actor and automation rules are excluded from the cohort and its study actors. Cookieless coverage has no actor, so only its test-deck, automated-client and scraper-fleet rules can reach it. Historical facts are read directly.</p>
          </details>
        </>
      ) : null}
    </section>
  );
}

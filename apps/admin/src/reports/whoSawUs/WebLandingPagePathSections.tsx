import { useEffect, useState, type JSX } from "react";
import * as d3 from "d3";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownLoadingChart } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import type { SiteVisitorCohort } from "./breakdownQuery";
import {
  loadLandingPagePathReport,
  loadTopLandingPageKinds,
  loadTopLandingPages,
  topLandingPageCount,
  topLandingPageKindCount,
  type LandingPageVisitors,
} from "./landingPagePathQuery";
import {
  WhoSawUsBreakdownSection,
  webEngagedVisitorCounting,
  webVisitorCounting,
  whoSawUsCountLabel,
} from "./WhoSawUsBreakdownSections";

type TopLandingPagesLoader = (
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  signal: AbortSignal,
) => Promise<ReadonlyArray<LandingPageVisitors>>;

type LandingPagePathBreakdown = Readonly<{
  pageKind: string;
  title: string;
  loadReport: BreakdownReportLoader;
  topPagesTitle: string;
  loadTopPages: TopLandingPagesLoader;
}>;

/**
 * The ranked kinds keep the selection they were ranked over, so a chart never queries a range its
 * kind was not chosen for.
 */
type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
    status: "ready";
    dateRange: AnalyticsDateRange;
    period: ReportPeriod;
    breakdowns: ReadonlyArray<LandingPagePathBreakdown>;
  }>;

type TopPagesLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; pages: ReadonlyArray<LandingPageVisitors> }>;

/** The words that tell one cohort's landing page path charts from the other's. */
type CohortCopy = Readonly<{
  testIdPrefix: string;
  topKindsTitle: string;
  sectionsTitle: string;
  /** Opens a chart title, as in "Web visitors landing on home pages, by page". */
  visitorsTitle: string;
  /** Closes a top pages table title. */
  topPagesSuffix: string;
  /** The visitors a chart holds, to open a sentence. */
  visitors: string;
  pageTypeChartTitle: string;
  counting: string;
  /** The visitors the top landing page types rank by, to close a sentence. */
  rankedVisitors: string;
}>;

const cohortCopy: Readonly<Record<SiteVisitorCohort, CohortCopy>> = {
  all: {
    testIdPrefix: "who-saw-us-landing-page-paths",
    topKindsTitle: "Top landing page types",
    sectionsTitle: "Web visitors by page, for the top landing page types",
    visitorsTitle: "Web visitors",
    topPagesSuffix: "",
    visitors: "The Who saw us Web visitors",
    pageTypeChartTitle: "Web visitors by landing page type",
    counting: webVisitorCounting,
    rankedVisitors: "landing visitors",
  },
  engaged: {
    testIdPrefix: "who-saw-us-engaged-landing-page-paths",
    topKindsTitle: "Top engaged landing page types",
    sectionsTitle: "Engaged visitors by page, for the top landing page types",
    visitorsTitle: "Engaged visitors",
    topPagesSuffix: " of engaged visitors",
    visitors: "The Who saw us Web Engaged visitors",
    pageTypeChartTitle: "Engaged visitors by landing page type",
    counting: webEngagedVisitorCounting,
    rankedVisitors: "engaged landing visitors",
  },
};

const formatCount = d3.format(",d");

function buildLandingPagePathBreakdown(cohort: SiteVisitorCohort, pageKind: string): LandingPagePathBreakdown {
  const copy = cohortCopy[cohort];
  const title = `${copy.visitorsTitle} landing on ${pageKind} pages, by page`;
  const topPagesTitle = `Top ${topLandingPageCount} ${pageKind} landing pages${copy.topPagesSuffix}`;
  return {
    pageKind,
    title,
    loadReport: (config, dateRange, period, signal) => loadLandingPagePathReport(config, cohort, pageKind, dateRange, period, `${title} report`, signal),
    topPagesTitle,
    loadTopPages: (config, dateRange, period, signal) => loadTopLandingPages(config, cohort, pageKind, dateRange, period, `${topPagesTitle} report`, signal),
  };
}

/** The pages of one by-page chart with the most visitors over the selection, in that chart's order. */
function TopLandingPagesTable(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  title: string;
  testId: string;
  /** Must be stable. */
  loadTopPages: TopLandingPagesLoader;
}>): JSX.Element {
  const [state, setState] = useState<TopPagesLoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const abortController = new AbortController();
    void props.loadTopPages(props.config, props.dateRange, props.period, abortController.signal).then((pages) => {
      if (!cancelled) setState({ status: "ready", pages });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${props.title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, props.loadTopPages, props.title, revision]);

  return (
    <div className="landing-page-path-top-pages" data-testid={props.testId}>
      {state.status === "loading" ? <p className="report-state" aria-live="polite">Loading {props.title}…</p> : null}
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{props.title} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <div className="funnel-group-table-shell">
          <table className="funnel-group-table">
            <caption>{props.title}</caption>
            <thead><tr><th scope="col">Rank</th><th scope="col">Page</th><th scope="col">Visitors</th></tr></thead>
            <tbody>{state.pages.map((page, index) => (
              <tr key={page.pagePath}>
                <th scope="row">{index + 1}</th>
                <td className="funnel-group-table-name">{page.pagePath}</td>
                <td>{formatCount(page.visitors)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One chart per top landing page type of the selection, splitting its `cohort` visitors by the exact
 * page, with that type's top pages listed beneath it in the same grid cell.
 */
export function WebLandingPagePathSections(props: Readonly<{
  cohort: SiteVisitorCohort;
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const copy = cohortCopy[props.cohort];
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    const { topKindsTitle } = cohortCopy[props.cohort];
    setState({ status: "loading" });
    const abortController = new AbortController();
    void loadTopLandingPageKinds(props.config, props.cohort, props.dateRange, props.period, `${topKindsTitle} report`, abortController.signal).then((pageKinds) => {
      if (!cancelled) {
        setState({
          status: "ready",
          dateRange: props.dateRange,
          period: props.period,
          breakdowns: pageKinds.map((pageKind) => buildLandingPagePathBreakdown(props.cohort, pageKind)),
        });
      }
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${topKindsTitle} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.cohort, props.config, props.dateRange, props.period, props.onTerminalAdminError, revision]);

  if (state.status === "loading") {
    return (
      <>
        {Array.from({ length: topLandingPageKindCount }, (_, index) => (
          <section key={index} className="dashboard-section" data-testid={`${copy.testIdPrefix}-placeholder-${index + 1}-section`}>
            <header className="dashboard-section-header level-1-metric-section-header">
              <h2>{copy.sectionsTitle}</h2>
            </header>
            <BreakdownLoadingChart countLabel={whoSawUsCountLabel} period={props.period} label={`Loading ${copy.topKindsTitle}…`} />
          </section>
        ))}
      </>
    );
  }

  if (state.status === "error") {
    return (
      <section className="dashboard-section" data-testid={`${copy.testIdPrefix}-section`}>
        <header className="dashboard-section-header level-1-metric-section-header">
          <h2>{copy.sectionsTitle}</h2>
        </header>
        <div className="report-state report-state-error">
          <strong>{copy.topKindsTitle} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      </section>
    );
  }

  return (
    <>
      {state.breakdowns.map((breakdown, index) => (
        <div key={breakdown.pageKind}>
          <WhoSawUsBreakdownSection
            config={props.config}
            dateRange={state.dateRange}
            period={state.period}
            onTerminalAdminError={props.onTerminalAdminError}
            title={breakdown.title}
            testId={`${copy.testIdPrefix}-${index + 1}-section`}
            explanationId={`${copy.testIdPrefix}-${index + 1}-explanation`}
            explanation={<>
              <li>{copy.visitors} whose first page view in that bar or day is a {breakdown.pageKind} page, so each bar adds up to the {breakdown.pageKind} visitors in {copy.pageTypeChartTitle} for the same day, week or month: {copy.counting}. When {breakdown.pageKind} is not one of that chart’s five coloured values, those visitors sit inside its Other.</li>
              <li>A visitor counts under the path of that first page view, which the site reports with the language prefix removed, so one page in every language is one path. Views stored before the site began sending a path, on 2026-09-23, and pages whose route it could not report are Unknown.</li>
              <li>{breakdown.pageKind} is one of the three page types with the most {copy.rankedVisitors} over the selection, among the types with more than one page.</li>
              <li>The table beneath lists the {topLandingPageCount} pages with the most visitors summed over the selection’s bars, so a visitor counts as many times as the bars count them: by day, landing on a page on 3 days counts 3 times. Its order is the chart’s, so its first five rows are the chart’s coloured pages.</li>
            </>}
            loadReport={breakdown.loadReport}
          />
          <TopLandingPagesTable
            config={props.config}
            dateRange={state.dateRange}
            period={state.period}
            onTerminalAdminError={props.onTerminalAdminError}
            title={breakdown.topPagesTitle}
            testId={`${copy.testIdPrefix}-${index + 1}-top-pages`}
            loadTopPages={breakdown.loadTopPages}
          />
        </div>
      ))}
    </>
  );
}

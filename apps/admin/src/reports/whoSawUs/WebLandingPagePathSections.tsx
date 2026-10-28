import { useEffect, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownLoadingChart } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { topValueCount } from "./breakdownQuery";
import { loadLandingPagePathReport, loadTopLandingPageKinds, loadTopLandingPages, topLandingPageKindCount } from "./landingPagePathQuery";
import {
  TopValuesTable,
  WhoSawUsBreakdownSection,
  buildWebEngagedBreakdownChartNotes,
  webEngagedVisitorCounting,
  whoSawUsCountLabel,
  type TopValuesLoader,
} from "./WhoSawUsBreakdownSections";

type LandingPagePathBreakdown = Readonly<{
  pageKind: string;
  title: string;
  loadReport: BreakdownReportLoader;
  topPagesTitle: string;
  loadTopPages: TopValuesLoader;
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

const testIdPrefix = "who-saw-us-engaged-landing-page-paths";
const topKindsTitle = "Top engaged landing page types";
const sectionsTitle = "Web engaged visitors by page, for the top landing page types";

function buildLandingPagePathBreakdown(pageKind: string): LandingPagePathBreakdown {
  const title = `Web engaged visitors landing on ${pageKind} pages, by page`;
  const topPagesTitle = `Top ${topValueCount} ${pageKind} landing pages of Web engaged visitors`;
  return {
    pageKind,
    title,
    loadReport: (config, dateRange, period, signal) => loadLandingPagePathReport(config, pageKind, dateRange, period, `${title} report`, signal),
    topPagesTitle,
    loadTopPages: (config, dateRange, period, signal) => loadTopLandingPages(config, pageKind, dateRange, period, `${topPagesTitle} report`, signal),
  };
}

/**
 * One chart per top landing page type of the selection, splitting its visitors by the exact page,
 * with that type's top pages listed beneath it in the same grid cell.
 */
export function WebLandingPagePathSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const abortController = new AbortController();
    void loadTopLandingPageKinds(props.config, props.dateRange, props.period, `${topKindsTitle} report`, abortController.signal).then((pageKinds) => {
      if (!cancelled) {
        setState({
          status: "ready",
          dateRange: props.dateRange,
          period: props.period,
          breakdowns: pageKinds.map((pageKind) => buildLandingPagePathBreakdown(pageKind)),
        });
      }
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${topKindsTitle} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, revision]);

  if (state.status === "loading") {
    return (
      <>
        {Array.from({ length: topLandingPageKindCount }, (_, index) => (
          <section key={index} className="dashboard-section" data-testid={`${testIdPrefix}-placeholder-${index + 1}-section`}>
            <header className="dashboard-section-header level-1-metric-section-header">
              <h2>{sectionsTitle}</h2>
            </header>
            <BreakdownLoadingChart countLabel={whoSawUsCountLabel} period={props.period} label={`Loading ${topKindsTitle}…`} />
          </section>
        ))}
      </>
    );
  }

  if (state.status === "error") {
    return (
      <section className="dashboard-section" data-testid={`${testIdPrefix}-section`}>
        <header className="dashboard-section-header level-1-metric-section-header">
          <h2>{sectionsTitle}</h2>
        </header>
        <div className="report-state report-state-error">
          <strong>{topKindsTitle} query failed.</strong><span>{state.message}</span>
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
            testId={`${testIdPrefix}-${index + 1}-section`}
            explanationId={`${testIdPrefix}-${index + 1}-explanation`}
            explanation={<>
              <li>The Who saw us Web engaged visitors whose first page view in that bar or day is a {breakdown.pageKind} page, so each bar adds up to the {breakdown.pageKind} visitors in Web engaged visitors by landing page type for the same day, week or month: {webEngagedVisitorCounting}. When {breakdown.pageKind} is not one of that chart’s five coloured values, those visitors sit inside its Other.</li>
              <li>A visitor counts under the path of that first page view, which the site reports with the language prefix removed, so one page in every language is one path. Views stored before the site began sending a path, on 2026-09-23, and pages whose route it could not report are Unknown.</li>
              <li>{breakdown.pageKind} is one of the three page types with the most engaged landing visitors over the selection, among the types with more than one page.</li>
              <li>The table beneath lists the {topValueCount} pages with the most visitors summed over the selection’s bars, so a visitor counts as many times as the bars count them: by day, landing on a page on 3 days counts 3 times. Its order is the chart’s, so its first five rows are the chart’s coloured pages.</li>
            </>}
            loadReport={breakdown.loadReport}
            buildExtraNotes={buildWebEngagedBreakdownChartNotes}
          />
          <TopValuesTable
            config={props.config}
            dateRange={state.dateRange}
            period={state.period}
            onTerminalAdminError={props.onTerminalAdminError}
            title={breakdown.topPagesTitle}
            valueHeader="Page"
            testId={`${testIdPrefix}-${index + 1}-top-pages`}
            loadTopValues={breakdown.loadTopPages}
          />
        </div>
      ))}
    </>
  );
}

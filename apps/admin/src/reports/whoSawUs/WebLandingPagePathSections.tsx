import { useEffect, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownLoadingChart } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { loadLandingPagePathReport, loadTopLandingPageKinds, topLandingPageKindCount } from "./landingPagePathQuery";
import { WhoSawUsBreakdownSection, webVisitorCounting, whoSawUsCountLabel } from "./WhoSawUsBreakdownSections";

type LandingPagePathBreakdown = Readonly<{
  pageKind: string;
  title: string;
  loadReport: BreakdownReportLoader;
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

const topKindsTitle = "Top landing page types";
const sectionsTitle = "Web visitors by page, for the top landing page types";

function buildLandingPagePathBreakdown(pageKind: string): LandingPagePathBreakdown {
  const title = `Web visitors landing on ${pageKind} pages, by page`;
  return {
    pageKind,
    title,
    loadReport: (config, dateRange, period) => loadLandingPagePathReport(config, pageKind, dateRange, period, `${title} report`),
  };
}

/** One chart per top landing page type of the selection, splitting its visitors by the exact page. */
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
    void loadTopLandingPageKinds(props.config, props.dateRange, props.period, `${topKindsTitle} report`).then((pageKinds) => {
      if (!cancelled) {
        setState({
          status: "ready",
          dateRange: props.dateRange,
          period: props.period,
          breakdowns: pageKinds.map(buildLandingPagePathBreakdown),
        });
      }
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${topKindsTitle} query error.` });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, revision]);

  if (state.status === "loading") {
    return (
      <>
        {Array.from({ length: topLandingPageKindCount }, (_, index) => (
          <section key={index} className="dashboard-section" data-testid={`who-saw-us-landing-page-paths-placeholder-${index + 1}-section`}>
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
      <section className="dashboard-section" data-testid="who-saw-us-landing-page-paths-section">
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
        <WhoSawUsBreakdownSection
          key={breakdown.pageKind}
          config={props.config}
          dateRange={state.dateRange}
          period={state.period}
          onTerminalAdminError={props.onTerminalAdminError}
          title={breakdown.title}
          testId={`who-saw-us-landing-page-paths-${index + 1}-section`}
          explanationId={`who-saw-us-landing-page-paths-${index + 1}-explanation`}
          explanation={<>
            <li>The Who saw us Web visitors whose first page view in that bar or day is a {breakdown.pageKind} page, so each bar adds up to the {breakdown.pageKind} visitors in Web visitors by landing page type for the same day, week or month: {webVisitorCounting}. When {breakdown.pageKind} is not one of that chart’s five coloured values, those visitors sit inside its Other.</li>
            <li>A visitor counts under the path of that first page view, which the site reports with the language prefix removed, so one page in every language is one path. Views stored before the site began sending a path, on 2026-09-23, and pages whose route it could not report are Unknown.</li>
            <li>{breakdown.pageKind} is one of the three page types with the most landing visitors over the selection, among the types with more than one page.</li>
          </>}
          loadReport={breakdown.loadReport}
        />
      ))}
    </>
  );
}

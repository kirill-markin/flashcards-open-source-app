import { useEffect, useState, type JSX } from "react";
import * as d3 from "d3";
import { formatGeneratedAt } from "../../charts/formatting";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import {
  engagedShareKeptValueCount,
  loadEngagedShareTable,
  type EngagedShareDimension,
  type EngagedShareTable,
} from "./engagedShareTableQuery";
import { engagedRuleSwitchLabel } from "./engagedVisitorsQuery";

type EngagedShareTableCopy = Readonly<{
  title: string;
  testId: string;
  segmentHeader: string;
  webChartTitle: string;
  engagedChartTitle: string;
}>;

const engagedShareTableCopy: Readonly<Record<EngagedShareDimension, EngagedShareTableCopy>> = {
  country: {
    title: "Engaged share by country",
    testId: "who-saw-us-web-engaged-share-by-country",
    segmentHeader: "Country",
    webChartTitle: "Web visitors by country",
    engagedChartTitle: "Engaged visitors by country",
  },
  "landing-page-type": {
    title: "Engaged share by landing page type",
    testId: "who-saw-us-web-engaged-share-by-landing-page-type",
    segmentHeader: "Landing page type",
    webChartTitle: "Web visitors by landing page type",
    engagedChartTitle: "Engaged visitors by landing page type",
  },
};

const engagedShareDimensions: ReadonlyArray<EngagedShareDimension> = ["country", "landing-page-type"];

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; table: EngagedShareTable }>;

const formatCount = d3.format(",d");
const formatShare = d3.format(".1%");

function formatEngagedShare(webVisitors: number, engagedVisitors: number): string {
  return webVisitors === 0 ? "—" : formatShare(engagedVisitors / webVisitors);
}

/** One range table: each value's Web and engaged visitors summed over the selection's bars. */
function WebEngagedShareTableSection(props: Readonly<{
  dimension: EngagedShareDimension;
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const copy = engagedShareTableCopy[props.dimension];
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    const { title } = engagedShareTableCopy[props.dimension];
    setState({ status: "loading" });
    const abortController = new AbortController();
    void loadEngagedShareTable(props.config, props.dimension, props.dateRange, props.period, `${title} report`, abortController.signal).then((table) => {
      if (!cancelled) setState({ status: "ready", table });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.dimension, props.config, props.dateRange, props.period, props.onTerminalAdminError, revision]);

  return (
    <section className="dashboard-section" data-testid={`${copy.testId}-section`}>
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{copy.title}</h2>
          <ExplanationTip label={`What ${copy.title} shows`} explanationId={`${copy.testId}-explanation`}>
            <ul>
              <li>
                <strong>What it shows:</strong> per {copy.segmentHeader.toLowerCase()}, over the selection
                <ul>
                  <li><strong>Web visitors:</strong> the sum of that value’s bars in {copy.webChartTitle}</li>
                  <li><strong>Engaged visitors:</strong> the sum of that value’s bars in {copy.engagedChartTitle}</li>
                  <li><strong>Engaged %:</strong> Engaged visitors ÷ Web visitors, — when there is no Web visitor</li>
                </ul>
              </li>
              <li>The counts follow <strong>Group by</strong> like the charts: a visitor counts once in each bar that counts them, so an identified visitor seen on 3 days of one week counts 3 times by day and once by week, and a cookieless one counts once per day under every Group by.</li>
              <li>The {engagedShareKeptValueCount} values with the most Web visitors get their own row; the rest are summed into Other. A missing value is Unknown and ranks like any other. Total sums every value, so it equals the Web chart’s and the Engaged visitors chart’s bars summed over the selection.</li>
              <li>Before {engagedRuleSwitchLabel}, when the site did not send page reads yet, a page view plus any other site event counted as engaged, impressions such as a shown app button or cookie prompt included; from then only a second page view or a site action counts, a 10+ second page read with a scroll, click or key press included, so a selection across that time mixes the looser and the stricter rule.</li>
              {state.status === "ready" ? <li>Generated {formatGeneratedAt(state.table.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>
      {state.status === "loading" ? <p className="report-state" aria-live="polite">Loading {copy.title}…</p> : null}
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{copy.title} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <div className="funnel-group-table-shell">
          <table className="funnel-group-table engaged-share-table">
            <caption>Visitors summed over the selection’s {props.period} bars</caption>
            <thead>
              <tr>
                <th scope="col">{copy.segmentHeader}</th>
                <th scope="col">Web visitors</th>
                <th scope="col">Engaged visitors</th>
                <th scope="col">Engaged %</th>
              </tr>
            </thead>
            <tbody>
              {state.table.rows.map((row) => (
                <tr key={row.value}>
                  <th scope="row" className="funnel-group-table-name">{row.value}</th>
                  <td>{formatCount(row.webVisitors)}</td>
                  <td>{formatCount(row.engagedVisitors)}</td>
                  <td>{formatEngagedShare(row.webVisitors, row.engagedVisitors)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Total</th>
                <td>{formatCount(state.table.total.webVisitors)}</td>
                <td>{formatCount(state.table.total.engagedVisitors)}</td>
                <td>{formatEngagedShare(state.table.total.webVisitors, state.table.total.engagedVisitors)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** The engaged share tables of the Web page, one grid cell each. */
export function WebEngagedShareTableSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <>
      {engagedShareDimensions.map((dimension) => (
        <WebEngagedShareTableSection
          key={dimension}
          dimension={dimension}
          config={props.config}
          dateRange={props.dateRange}
          period={props.period}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      ))}
    </>
  );
}

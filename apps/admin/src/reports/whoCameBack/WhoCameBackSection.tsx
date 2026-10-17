import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { renderWhoCameBackChart, retentionColors, retentionLabels, retentionSeries } from "../../charts/whoCameBackChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { formatCalendarDate, parseCalendarDate } from "../reportValues";
import { loadWhoCameBackReport, type RetentionCounts, type WhoCameBackReport, type WhoCameBackWeek } from "./query";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WhoCameBackReport }>;
const formatCount = d3.format(",d");
const formatRate = d3.format(".1%");

function describeRetention(counts: RetentionCounts | null, week: WhoCameBackWeek, report: WhoCameBackReport, offset: number): string {
  if (counts !== null) return `${formatRate(counts.returned / counts.base)} (${formatCount(counts.returned)} / ${formatCount(counts.base)})`;
  if (report.historyFrom === null || week.week < report.historyFrom) return "Unavailable: cohort predates retained source history.";
  const matureDate = parseCalendarDate(week.week, "Who came back");
  matureDate.setUTCDate(matureDate.getUTCDate() + offset);
  const matureOn = formatCalendarDate(matureDate);
  if (matureOn > report.latestCompleteDate) return `Unavailable: needs complete UTC days through ${matureOn}.`;
  return "Unavailable: no users in this cohort.";
}

export function WhoCameBackSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  useEffect(() => {
    let cancelled = false;
    tooltipHandlers.hideTooltip();
    setState({ status: "loading" });
    void loadWhoCameBackReport(props.config, props.dateRange).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Who came back query error." });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.onTerminalAdminError, revision, tooltipHandlers]);
  const weeksByDate = useMemo(() => new Map(state.status === "ready" ? state.report.weeks.map((week) => [week.week, week]) : []), [state]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready") return;
    const getDescription = (date: string): string => {
      const week = weeksByDate.get(date);
      if (week === undefined) throw new Error(`Who came back chart has no week for ${date}.`);
      return `Selected first-use dates: ${week.selectedFrom} to ${week.selectedTo}. Recorded cohort: ${week.cohortUsers === null ? "unavailable" : formatCount(week.cohortUsers)}. W1: ${describeRetention(week.w1, week, state.report, 19)} W4: ${describeRetention(week.w4, week, state.report, 40)}`;
    };
    renderWhoCameBackChart({
      svgElement: chartRef.current,
      weeks: state.report.weeks,
      getLabel: (date) => `Week of ${date} UTC. ${getDescription(date)}`,
      getTooltipHtml: (date) => `<p class="tooltip-title">First-use week: ${escapeHtml(date)} UTC</p><p>${escapeHtml(getDescription(date))}</p>`,
      tooltipHandlers,
    });
  }, [state, weeksByDate, tooltipHandlers]);
  return (
    <section className="dashboard-section" data-testid="who-came-back-section">
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>Who came back</h2>
          <ExplanationTip label="What Who came back shows" explanationId="who-came-back-explanation">
            <ul>
              <li>Cohorts are Monday–Sunday UTC weeks of each person’s first-ever answered review, with any rating, using the same review history and actor exclusions as Who studied. Cohorts and returns count answered reviews only.</li>
              <li>W1 is any answered review on days 7–13 after each person’s first-use day; W4 is days 28–34. The tooltip and table show returned users / cohort users.</li>
              <li>A rate appears only after every possible first-use day of the cohort week has its full return window. Recent or uncovered cohorts are unavailable, never zero.</li>
              <li>The date range selects first-use dates; edge weeks include only selected days. Returns after the selection end count through the latest complete UTC day.</li>
              <li>First use reads the full retained review history. Reviews never recorded in analytics cannot be reconstructed.</li>
              {state.status === "ready" ? <li>Generated {formatGeneratedAt(state.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>
      {state.status === "loading" ? <p className="report-state" aria-live="polite">Loading Who came back…</p> : null}
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>Who came back query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>Weekly cohorts · UTC</span>
              <div className="chart-meta-right">
                <ChartColorKey ariaLabel="Retention color key" keys={retentionSeries} getColor={(key) => retentionColors[key]} getLabel={(key) => retentionLabels[key]} />
              </div>
            </div>
            {state.report.weeks.every((week) => week.w1 === null && week.w4 === null) ? <p className="report-state">No non-empty, fully matured covered cohort is available in this range.</p> : null}
            <div className="chart-scroll"><svg ref={chartRef} role="group" aria-label="Who came back: W1 and W4 retention by first-use week" /></div>
            <details className="activity-chart-table">
              <summary>Chart data and coverage</summary>
              <p className="activity-coverage-note">
                {state.report.historyFrom === null ? "No retained review history." : `Recorded source history starts ${state.report.historyFrom}. Returns observed through ${state.report.latestCompleteDate} UTC.`}
              </p>
              <div className="chart-scroll"><table>
                <caption>Weekly first-use cohort retention, UTC; returned / base counts</caption>
                <thead><tr><th scope="col">Week of</th><th scope="col">Selected first-use dates</th><th scope="col">Recorded users</th><th scope="col">W1</th><th scope="col">W4</th></tr></thead>
                <tbody>{state.report.weeks.map((week) => <tr key={week.week}>
                  <th scope="row">{week.week}</th><td>{week.selectedFrom} – {week.selectedTo}</td><td>{week.cohortUsers === null ? "—" : formatCount(week.cohortUsers)}</td>
                  <td>{describeRetention(week.w1, week, state.report, 19)}</td><td>{describeRetention(week.w4, week, state.report, 40)}</td>
                </tr>)}</tbody>
              </table></div>
            </details>
          </div>
        </section>
      ) : null}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

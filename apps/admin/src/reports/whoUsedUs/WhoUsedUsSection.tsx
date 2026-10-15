import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { UniqueUserCohortKey } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { renderWhoUsedUsChart } from "../../charts/whoUsedUsChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { loadWhoUsedUsReport, type WhoUsedUsDay, type WhoUsedUsReport } from "./query";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WhoUsedUsReport }>;
const formatCount = d3.format(",d");

function describeDay(day: WhoUsedUsDay, report: WhoUsedUsReport): string {
  if (day.newUsers === null || day.returningUsers === null) {
    if (day.date > report.latestCompleteDate) return "Unavailable: UTC day is incomplete.";
    return "Unavailable: full rolling window predates retained source history.";
  }
  return `New: ${formatCount(day.newUsers)}; returning: ${formatCount(day.returningUsers)}; total: ${formatCount(day.newUsers + day.returningUsers)}.`;
}

export function WhoUsedUsSection(props: Readonly<{
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
    void loadWhoUsedUsReport(props.config, props.dateRange).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Who used us query error." });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.onTerminalAdminError, revision, tooltipHandlers]);
  const daysByDate = useMemo(() => new Map(state.status === "ready" ? state.report.days.map((day) => [day.date, day]) : []), [state]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready") return;
    const getDay = (date: string): WhoUsedUsDay => {
      const day = daysByDate.get(date);
      if (day === undefined) throw new Error(`Who used us chart has no day for ${date}.`);
      return day;
    };
    renderWhoUsedUsChart({
      svgElement: chartRef.current,
      days: state.report.days,
      getLabel: (date) => `${date} UTC. ${describeDay(getDay(date), state.report)}`,
      getTooltipHtml: (date) => `<p class="tooltip-title">${escapeHtml(date)} UTC</p><p>${escapeHtml(describeDay(getDay(date), state.report))}</p>`,
      tooltipHandlers,
    });
  }, [state, daysByDate, tooltipHandlers]);
  return (
    <section className="dashboard-section" data-testid="who-used-us-section">
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>Who used us</h2>
          <ExplanationTip label="What Who used us shows" explanationId="who-used-us-explanation">
            <ul>
              <li>Daily unique people with meaningful use in the seven UTC days ending on that date.</li>
              <li>Meaningful use is a trusted answered review or a user-authored hosted AI message, including attachment-only messages. Assistant, tool, background and polling activity alone do not count.</li>
              <li>New means first-ever recorded meaningful use within that window; returning means first use before it. Each resolved person appears once in exactly one bucket, including upgraded guests.</li>
              <li>The shared actor exclusions apply. Today and windows extending before retained source history are unavailable.</li>
              <li>Review analytics retain anonymized deletion history; deleted chats and reviews never recorded in analytics cannot be reconstructed. First use reads all retained history, regardless of this date selection.</li>
              {state.status === "ready" ? <li>Generated {formatGeneratedAt(state.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>
      {state.status === "loading" ? <p className="report-state" aria-live="polite">Loading Who used us…</p> : null}
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>Who used us query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>Rolling 7-day users · UTC</span>
              <div className="chart-meta-right"><UniqueUserCohortKey /></div>
            </div>
            {state.report.days.every((day) => day.newUsers === null) ? <p className="report-state">No complete seven-day window is available in this range.</p> : null}
            {state.report.days.some((day) => day.newUsers !== null) && state.report.days.every((day) => (day.newUsers ?? 0) + (day.returningUsers ?? 0) === 0) ? <p className="report-state">No meaningful users in the available windows after exclusions.</p> : null}
            <div className="chart-scroll"><svg ref={chartRef} role="group" aria-label="Who used us: rolling seven-day unique meaningful users" /></div>
            <details className="activity-chart-table">
              <summary>Chart data and coverage</summary>
              <p className="activity-coverage-note">
                {state.report.historyFrom === null ? "No retained meaningful-use history." : `Recorded source history starts ${state.report.historyFrom}. Complete UTC days through ${state.report.latestCompleteDate}.`}
              </p>
              <div className="chart-scroll"><table>
                <caption>Rolling seven-day unique meaningful users, UTC</caption>
                <thead><tr><th scope="col">Window ending</th><th scope="col">New</th><th scope="col">Returning</th><th scope="col">Total / availability</th></tr></thead>
                <tbody>{state.report.days.map((day) => <tr key={day.date}>
                  <th scope="row">{day.date}</th><td>{day.newUsers === null ? "—" : formatCount(day.newUsers)}</td>
                  <td>{day.returningUsers === null ? "—" : formatCount(day.returningUsers)}</td>
                  <td>{day.newUsers === null || day.returningUsers === null ? describeDay(day, state.report) : formatCount(day.newUsers + day.returningUsers)}</td>
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

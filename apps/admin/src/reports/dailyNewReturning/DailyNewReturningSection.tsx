import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import { UniqueUserCohortKey } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { renderDailyNewReturningChart } from "../../charts/dailyNewReturningChart";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  loadDailyNewReturningReport,
  type DailyActivitySource,
  type DailyNewReturningDay,
  type DailyNewReturningReport,
} from "./query";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: DailyNewReturningReport }>;
const formatCount = d3.format(",d");

function describeDay(day: DailyNewReturningDay, report: DailyNewReturningReport): string {
  if (day.newUsers === null || day.returningUsers === null) return "Unavailable: day predates retained source history.";
  return `${day.date === report.today ? "Today is in progress. " : ""}New: ${formatCount(day.newUsers)}; returning: ${formatCount(day.returningUsers)}; total: ${formatCount(day.newUsers + day.returningUsers)}.`;
}

/** One Level 1 daily chart of unique people, stacked new vs returning; `source` must be a stable constant. */
export function DailyNewReturningSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  title: string;
  testId: string;
  explanationId: string;
  source: DailyActivitySource;
  /** The `<li>` items of the (i) explanation. */
  explanation: ReactNode;
}>): JSX.Element {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const reportLabel = `${props.title} report`;
  useEffect(() => {
    let cancelled = false;
    tooltipHandlers.hideTooltip();
    setState({ status: "loading" });
    void loadDailyNewReturningReport(props.config, props.source, props.dateRange, reportLabel).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${props.title} query error.` });
    });
    return () => { cancelled = true; };
  }, [props.config, props.source, props.dateRange, props.onTerminalAdminError, props.title, reportLabel, revision, tooltipHandlers]);
  const daysByDate = useMemo(() => new Map(state.status === "ready" ? state.report.days.map((day) => [day.date, day]) : []), [state]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready") return;
    const getDay = (date: string): DailyNewReturningDay => {
      const day = daysByDate.get(date);
      if (day === undefined) throw new Error(`${props.title} chart has no day for ${date}.`);
      return day;
    };
    renderDailyNewReturningChart({
      svgElement: chartRef.current,
      days: state.report.days,
      today: state.report.today,
      getLabel: (date) => `${date} UTC. ${describeDay(getDay(date), state.report)}`,
      getTooltipHtml: (date) => `<p class="tooltip-title">${escapeHtml(date)} UTC${date === state.report.today ? " · in progress" : ""}</p><p>${escapeHtml(describeDay(getDay(date), state.report))}</p>`,
      tooltipHandlers,
    });
  }, [state, daysByDate, props.title, tooltipHandlers]);
  return (
    <section className="dashboard-section" data-testid={props.testId}>
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>{props.title}</h2>
          <ExplanationTip label={`What ${props.title} shows`} explanationId={props.explanationId}>
            <ul>
              {props.explanation}
              {state.status === "ready" ? <li>Generated {formatGeneratedAt(state.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>
      {state.status === "loading" ? <p className="report-state" aria-live="polite">Loading {props.title}…</p> : null}
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{props.title} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>Daily unique people · UTC</span>
              <div className="chart-meta-right"><UniqueUserCohortKey /></div>
            </div>
            {state.report.days.every((day) => day.newUsers === null) ? <p className="report-state">Retained source history does not cover this range.</p> : null}
            {state.report.days.some((day) => day.newUsers !== null) && state.report.days.every((day) => (day.newUsers ?? 0) + (day.returningUsers ?? 0) === 0) ? <p className="report-state">No people in the covered days after exclusions.</p> : null}
            <div className="chart-scroll"><svg ref={chartRef} role="group" aria-label={`${props.title}: daily unique people, new and returning`} /></div>
            <details className="activity-chart-table">
              <summary>Chart data and coverage</summary>
              <p className="activity-coverage-note">
                {state.report.historyFrom === null ? "No retained source history." : `Recorded source history starts ${state.report.historyFrom}. Today (${state.report.today} UTC) is in progress.`}
              </p>
              <div className="chart-scroll"><table>
                <caption>Daily unique people, UTC</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">New</th><th scope="col">Returning</th><th scope="col">Total / availability</th></tr></thead>
                <tbody>{state.report.days.map((day) => <tr key={day.date}>
                  <th scope="row">{day.date}{day.date === state.report.today ? " (in progress)" : ""}</th>
                  <td>{day.newUsers === null ? "—" : formatCount(day.newUsers)}</td>
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

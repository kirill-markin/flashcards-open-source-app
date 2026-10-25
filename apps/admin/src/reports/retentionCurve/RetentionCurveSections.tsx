import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { chartWidth, stackedChartHeight } from "../../charts/chartPrimitives";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { renderRateLineChart } from "../../charts/rateLineChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  buildAppOpenRetentionCurveSql,
  buildStudiedRetentionCurveSql,
  loadRetentionCurveReport,
  retentionCurveLastDay,
  type RetentionCurveDay,
  type RetentionCurveReport,
} from "./query";

type RetentionCurveCopy = Readonly<{
  title: string;
  testId: string;
  buildSql: (dateRange: AnalyticsDateRange, reportLabel: string) => string;
  /** The activity-specific `<li>` items of the (i) explanation. */
  explanation: ReactNode;
}>;

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: RetentionCurveReport }>;

const retentionCurveCopies: ReadonlyArray<RetentionCurveCopy> = [
  {
    title: "Retention curve by days: studied",
    testId: "retention-curve-studied",
    buildSql: buildStudiedRetentionCurveSql,
    explanation: <>
      <li>Day 0 is each person’s first-ever answered review, with any rating, on its UTC day.</li>
      <li>Active on day N means at least one answered review, with any rating, on exactly the UTC day N days after day 0. Opening the app or AI chat alone does not count.</li>
      <li>The same review history and actor exclusions as Who studied and Who came back.</li>
    </>,
  },
  {
    title: "Retention curve by days: opened the app",
    testId: "retention-curve-opened-the-app",
    buildSql: buildAppOpenRetentionCurveSql,
    explanation: <>
      <li>Day 0 is each person’s first recorded app open (<code>app_opened</code>) on iOS, Android, web or the agent API, on its UTC day.</li>
      <li>Active on day N means at least one app open on exactly the UTC day N days after day 0; reviews do not count.</li>
      <li>The same app-open history and actor exclusions as Who opened the app; early first opens are partly reconstructed, as there.</li>
    </>,
  },
];

const tileDays: ReadonlyArray<number> = [1, 7, 30];
const dayKeys: ReadonlyArray<string> = d3.range(retentionCurveLastDay + 1).map((dayNumber) => `${dayNumber}`);
const curveColor = "#4e79a7";
const formatCount = d3.format(",d");
const formatRate = d3.format(".1%");

function getDay(report: RetentionCurveReport, dayNumber: number): RetentionCurveDay {
  const day = report.days[dayNumber];
  if (day === undefined) throw new Error(`Retention curve has no day ${dayNumber}.`);
  return day;
}

function getRate(day: RetentionCurveDay): number | null {
  return day.activeUsers === null ? null : day.activeUsers / day.eligibleUsers;
}

function describeUnavailableDay(day: RetentionCurveDay, report: RetentionCurveReport): string {
  return report.cohortUsers === 0
    ? "Unavailable: nobody has day 0 in the covered, complete days of this range."
    : `Unavailable: no cohort member’s day ${day.dayNumber} is complete through ${report.latestCompleteDate}.`;
}

function describeDay(day: RetentionCurveDay, report: RetentionCurveReport): string {
  return day.activeUsers === null
    ? describeUnavailableDay(day, report)
    : `${formatRate(day.activeUsers / day.eligibleUsers)} active (${formatCount(day.activeUsers)} / ${formatCount(day.eligibleUsers)} eligible).`;
}

function RetentionCurveTile(props: Readonly<{ label: string; value: string; detail: string }>): JSX.Element {
  return (
    <article className="metric-card">
      <p className="metric-label">{props.label}</p>
      <p className="metric-value">{props.value}</p>
      <p className="metric-detail">{props.detail}</p>
    </article>
  );
}

function RetentionCurveSection(props: Readonly<{
  copy: RetentionCurveCopy;
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { copy } = props;
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  useEffect(() => {
    let cancelled = false;
    const reportLabel = `${copy.title} report`;
    tooltipHandlers.hideTooltip();
    setState({ status: "loading" });
    const abortController = new AbortController();
    void loadRetentionCurveReport(props.config, copy.buildSql(props.dateRange, reportLabel), reportLabel, abortController.signal).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${copy.title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [copy, props.config, props.dateRange, props.onTerminalAdminError, revision, tooltipHandlers]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready") return;
    const report = state.report;
    const getKeyDay = (key: string): RetentionCurveDay => getDay(report, Number(key));
    renderRateLineChart({
      svgElement: chartRef.current,
      keys: dayKeys,
      lines: [{ getRate: (key) => getRate(getKeyDay(key)), color: curveColor }],
      inProgressKey: null,
      yLabel: "Cohort active that day",
      xLabel: "Days since day 0 (UTC)",
      notes: [],
      formatTick: (key) => `D${key}`,
      getLabel: (key) => `Day ${key}. ${describeDay(getKeyDay(key), report)}`,
      getTooltipHtml: (key) => {
        const day = getKeyDay(key);
        return day.activeUsers === null
          ? `<p class="tooltip-title">Day ${escapeHtml(key)}</p><p>${escapeHtml(describeUnavailableDay(day, report))}</p>`
          : [
            `<p class="tooltip-title">Day ${escapeHtml(key)}</p>`,
            `<div class="tooltip-metric"><span>Active</span><strong>${escapeHtml(formatRate(day.activeUsers / day.eligibleUsers))}</strong></div>`,
            `<div class="tooltip-metric"><span>Active people</span><strong>${escapeHtml(formatCount(day.activeUsers))}</strong></div>`,
            `<div class="tooltip-metric"><span>Eligible people</span><strong>${escapeHtml(formatCount(day.eligibleUsers))}</strong></div>`,
          ].join("");
      },
      tooltipHandlers,
    });
  }, [state, tooltipHandlers]);
  return (
    <section className="dashboard-section" data-testid={`${copy.testId}-section`}>
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{copy.title}</h2>
          <ExplanationTip label={`What ${copy.title} shows`} explanationId={`${copy.testId}-explanation`}>
            <ul>
              {copy.explanation}
              <li>Each point is the share of the people eligible on day N who were active that day. D0 is 100% by definition.</li>
              <li>A person is eligible on day N only once that day is a complete UTC day, so the eligible group shrinks towards D{retentionCurveLastDay} for recent day 0s. A day with nobody eligible is unavailable, never 0%.</li>
              <li>The date range selects day 0, using only covered, complete UTC days; activity after the range end still counts through the latest complete UTC day. One curve covers the whole range, so Group by does not change it.</li>
              {state.status === "ready" ? <li>Generated {formatGeneratedAt(state.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{copy.title} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <section className="summary-grid">
          <RetentionCurveTile label="Cohort" value={formatCount(state.report.cohortUsers)} detail="People with day 0 in range" />
          {tileDays.map((dayNumber) => {
            const day = getDay(state.report, dayNumber);
            return day.activeUsers === null
              ? <RetentionCurveTile key={dayNumber} label={`D${dayNumber}`} value="Unavailable" detail={describeUnavailableDay(day, state.report)} />
              : <RetentionCurveTile key={dayNumber} label={`D${dayNumber}`} value={formatRate(day.activeUsers / day.eligibleUsers)} detail={`${formatCount(day.activeUsers)} / ${formatCount(day.eligibleUsers)} eligible`} />;
          })}
        </section>
      ) : null}
      {state.status === "error" ? null : (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>Share of the cohort active on day N · UTC</span>
            </div>
            <div className="chart-scroll">
              {state.status === "ready" ? (
                <ChartAreaWithNote
                  viewBoxWidth={chartWidth}
                  viewBoxHeight={stackedChartHeight}
                  note={state.report.cohortUsers === 0 ? "Nobody has day 0 in the covered, complete days of this range." : null}
                >
                  <svg ref={chartRef} role="group" aria-label={`${copy.title}: share of the cohort active on each day 0 to ${retentionCurveLastDay}`} />
                </ChartAreaWithNote>
              ) : <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label={`Loading ${copy.title}…`} />}
            </div>
            {state.status === "ready" ? (
              <details className="activity-chart-table">
                <summary>Data table</summary>
                <div className="funnel-group-table-shell retention-curve-table-shell">
                  <table className="funnel-group-table retention-curve-table">
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        <th scope="col">Eligible people</th>
                        <th scope="col">Active people</th>
                        <th scope="col">Active %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.report.days.map((day) => {
                        const rate = getRate(day);
                        return (
                          <tr key={day.dayNumber}>
                            <th scope="row">D{day.dayNumber}</th>
                            <td>{formatCount(day.eligibleUsers)}</td>
                            <td>{day.activeUsers === null ? "—" : formatCount(day.activeUsers)}</td>
                            <td>{rate === null ? "Unavailable" : formatRate(rate)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </div>
        </section>
      )}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

/** Classic N-day retention for the whole selected range, studied first, then opened the app. */
export function RetentionCurveSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <>
      {retentionCurveCopies.map((copy) => (
        <RetentionCurveSection
          key={copy.testId}
          copy={copy}
          config={props.config}
          dateRange={props.dateRange}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      ))}
    </>
  );
}

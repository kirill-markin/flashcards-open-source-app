import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { renderWhoCameBackChart, retentionColors, retentionLabels, retentionSeries } from "../../charts/whoCameBackChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  formatReportBucketLabel,
  formatReportBucketTick,
  formatReportBucketTitle,
  reportPeriodAxisLabels,
  reportPeriodColumnLabels,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { formatCalendarDate, parseCalendarDate } from "../reportValues";
import {
  loadWhoCameBackReport,
  retentionMaturityDays,
  type RetentionCounts,
  type WhoCameBackCohort,
  type WhoCameBackReport,
} from "./query";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WhoCameBackReport }>;
const formatCount = d3.format(",d");
const formatRate = d3.format(".1%");

function describeRetention(counts: RetentionCounts | null, cohort: WhoCameBackCohort, report: WhoCameBackReport, offset: number): string {
  if (counts !== null) return `${formatRate(counts.returned / counts.base)} (${formatCount(counts.returned)} / ${formatCount(counts.base)})`;
  if (report.historyFrom === null || cohort.bucket.from < report.historyFrom) return "Unavailable: cohort predates retained source history.";
  const matureDate = parseCalendarDate(cohort.bucket.to, "Who came back");
  matureDate.setUTCDate(matureDate.getUTCDate() + offset);
  const matureOn = formatCalendarDate(matureDate);
  if (matureOn > report.latestCompleteDate) return `Unavailable: needs complete UTC days through ${matureOn}.`;
  return "Unavailable: no users in this cohort.";
}

export function WhoCameBackSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
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
    void loadWhoCameBackReport(props.config, props.dateRange, props.period).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Who came back query error." });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, revision, tooltipHandlers]);
  const cohortsByKey = useMemo(() => new Map(state.status === "ready" ? state.report.cohorts.map((cohort) => [cohort.bucket.key, cohort]) : []), [state]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready") return;
    const getCohort = (key: string): WhoCameBackCohort => {
      const cohort = cohortsByKey.get(key);
      if (cohort === undefined) throw new Error(`Who came back chart has no cohort for ${key}.`);
      return cohort;
    };
    const getDescription = (key: string): string => {
      const cohort = getCohort(key);
      return `Selected first-use dates: ${cohort.bucket.from} to ${cohort.bucket.to}. Recorded cohort: ${cohort.cohortUsers === null ? "unavailable" : formatCount(cohort.cohortUsers)}. W1: ${describeRetention(cohort.w1, cohort, state.report, retentionMaturityDays.w1)} W4: ${describeRetention(cohort.w4, cohort, state.report, retentionMaturityDays.w4)}`;
    };
    renderWhoCameBackChart({
      svgElement: chartRef.current,
      cohorts: state.report.cohorts,
      xLabel: `First use: ${reportPeriodAxisLabels[state.report.period]}`,
      formatTick: (key) => formatReportBucketTick(state.report.period, key),
      getLabel: (key) => `First use ${formatReportBucketTitle(state.report.period, getCohort(key).bucket)} UTC. ${getDescription(key)}`,
      getTooltipHtml: (key) => `<p class="tooltip-title">First use: ${escapeHtml(formatReportBucketTitle(state.report.period, getCohort(key).bucket))} UTC${getCohort(key).bucket.to > state.report.latestCompleteDate ? " · in progress" : ""}</p><p>${escapeHtml(getDescription(key))}</p>`,
      tooltipHandlers,
    });
  }, [state, cohortsByKey, tooltipHandlers]);
  return (
    <section className="dashboard-section" data-testid="who-came-back-section">
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>Who came back</h2>
          <ExplanationTip label="What Who came back shows" explanationId="who-came-back-explanation">
            <ul>
              <li>Cohorts are the UTC days, Monday–Sunday weeks or months of each person’s first-ever answered review, with any rating, using the same review history and actor exclusions as Who studied. Cohorts and returns count answered reviews only.</li>
              <li>W1 is any answered review on days 7–13 after each person’s first-use day; W4 is days 28–34. The tooltip and table show returned users / cohort users.</li>
              <li>Grouping changes only the cohort size; the W1 and W4 windows stay counted from each person’s own first day. A rate appears only after the cohort’s last selected first-use day has its full return window. Recent or uncovered cohorts are unavailable, never zero.</li>
              <li>The date range selects first-use dates; edge cohorts include only selected days. Returns after the selection end count through the latest complete UTC day.</li>
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
              <span>First-use cohorts per {state.report.period} · UTC</span>
              <div className="chart-meta-right">
                <ChartColorKey ariaLabel="Retention color key" keys={retentionSeries} getColor={(key) => retentionColors[key]} getLabel={(key) => retentionLabels[key]} />
              </div>
            </div>
            {state.report.cohorts.every((cohort) => cohort.w1 === null && cohort.w4 === null) ? <p className="report-state">No non-empty, fully matured covered cohort is available in this range.</p> : null}
            <div className="chart-scroll"><svg ref={chartRef} role="group" aria-label={`Who came back: W1 and W4 retention by first-use ${state.report.period}`} /></div>
            <details className="activity-chart-table">
              <summary>Chart data and coverage</summary>
              <p className="activity-coverage-note">
                {state.report.historyFrom === null ? "No retained review history." : `Recorded source history starts ${state.report.historyFrom}. Returns observed through ${state.report.latestCompleteDate} UTC.`}
              </p>
              <div className="chart-scroll"><table>
                <caption>First-use cohort retention per {state.report.period}, UTC; returned / base counts</caption>
                <thead><tr><th scope="col">{reportPeriodColumnLabels[state.report.period]}</th><th scope="col">Selected first-use dates</th><th scope="col">Recorded users</th><th scope="col">W1</th><th scope="col">W4</th></tr></thead>
                <tbody>{state.report.cohorts.map((cohort) => <tr key={cohort.bucket.key}>
                  <th scope="row">{formatReportBucketLabel(state.report.period, cohort.bucket.key)}{cohort.bucket.to > state.report.latestCompleteDate ? " (in progress)" : ""}</th><td>{cohort.bucket.from} – {cohort.bucket.to}</td><td>{cohort.cohortUsers === null ? "—" : formatCount(cohort.cohortUsers)}</td>
                  <td>{describeRetention(cohort.w1, cohort, state.report, retentionMaturityDays.w1)}</td><td>{describeRetention(cohort.w4, cohort, state.report, retentionMaturityDays.w4)}</td>
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

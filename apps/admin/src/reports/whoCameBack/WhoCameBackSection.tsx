import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { chartWidth, stackedChartHeight } from "../../charts/chartPrimitives";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { renderWhoCameBackChart, retentionColors, retentionLabels, retentionSeries } from "../../charts/whoCameBackChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  formatReportBucketTick,
  formatReportBucketTitle,
  reportPeriodAxisLabels,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import {
  describeUnavailableRetention,
  loadWhoCameBackReport,
  type RetentionCounts,
  type RetentionWindow,
  type WhoCameBackCohort,
  type WhoCameBackReport,
} from "./query";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WhoCameBackReport }>;
const title = "Retention by first-use cohort: W1 and W4";
const formatCount = d3.format(",d");
const formatRate = d3.format(".1%");

function describeRetention(counts: RetentionCounts | null, cohort: WhoCameBackCohort, report: WhoCameBackReport, window: RetentionWindow): string {
  if (counts !== null) return `${formatRate(counts.returned / counts.base)} (${formatCount(counts.returned)} / ${formatCount(counts.base)})`;
  return describeUnavailableRetention(cohort.bucket, report.historyFrom, report.latestCompleteDate, window);
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
    const abortController = new AbortController();
    void loadWhoCameBackReport(props.config, props.dateRange, props.period, abortController.signal).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, revision, tooltipHandlers]);
  const cohortsByKey = useMemo(() => new Map(state.status === "ready" ? state.report.cohorts.map((cohort) => [cohort.bucket.key, cohort]) : []), [state]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready") return;
    const getCohort = (key: string): WhoCameBackCohort => {
      const cohort = cohortsByKey.get(key);
      if (cohort === undefined) throw new Error(`${title} chart has no cohort for ${key}.`);
      return cohort;
    };
    const getDescription = (key: string): string => {
      const cohort = getCohort(key);
      return `Selected first-use dates: ${cohort.bucket.from} to ${cohort.bucket.to}. Recorded cohort: ${cohort.cohortUsers === null ? "unavailable" : formatCount(cohort.cohortUsers)}. W1: ${describeRetention(cohort.w1, cohort, state.report, "w1")} W4: ${describeRetention(cohort.w4, cohort, state.report, "w4")}`;
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
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{title}</h2>
          <ExplanationTip label={`What ${title} shows`} explanationId="who-came-back-explanation">
            <ul>
              <li>Cohorts are the UTC days, Monday–Sunday weeks or months of each person’s first-ever answered review, with any rating, using the same review history and actor exclusions as Who studied. Cohorts and returns count answered reviews only.</li>
              <li>W1 is any answered review on days 7–13 after each person’s first-use day; W4 is days 28–34. The tooltip shows returned users / cohort users.</li>
              <li>Grouping changes only the cohort size; the W1 and W4 windows stay counted from each person’s own first day. A rate appears only after the cohort’s last selected first-use day has its full return window. Recent or uncovered cohorts are unavailable, never zero.</li>
              <li>The date range selects first-use dates; edge cohorts include only selected days. Returns after the selection end count through the latest complete UTC day.</li>
              <li>First use reads the full retained review history. Reviews never recorded in analytics cannot be reconstructed.</li>
              {state.status === "ready" ? <li>Generated {formatGeneratedAt(state.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{title} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "error" ? null : (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>First-use cohorts per {props.period} · UTC</span>
              <div className="chart-meta-right">
                <ChartColorKey ariaLabel="Retention color key" keys={retentionSeries} getColor={(key) => retentionColors[key]} getLabel={(key) => retentionLabels[key]} />
              </div>
            </div>
            <div className="chart-scroll">
              {state.status === "ready" ? (
                <ChartAreaWithNote
                  viewBoxWidth={chartWidth}
                  viewBoxHeight={stackedChartHeight}
                  note={state.report.cohorts.every((cohort) => cohort.w1 === null && cohort.w4 === null) ? "No non-empty, fully matured covered cohort is available in this range." : null}
                >
                  <svg ref={chartRef} role="group" aria-label={`${title}, first-use cohorts per ${state.report.period}`} />
                </ChartAreaWithNote>
              ) : <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label={`Loading ${title}…`} />}
            </div>
          </div>
        </section>
      )}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

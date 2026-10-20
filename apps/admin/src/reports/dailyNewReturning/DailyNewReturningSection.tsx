import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { UniqueUserCohortKey } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { chartWidth, stackedChartHeight } from "../../charts/chartPrimitives";
import { renderDailyNewReturningChart } from "../../charts/dailyNewReturningChart";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  LevelOneMetricDetailsButton,
  type LevelOneMetricDetailsLink,
} from "../levelOneMetrics/LevelOneMetricDetailsLink";
import {
  findInProgressBucketKey,
  formatReportBucketTick,
  formatReportBucketTitle,
  reportPeriodAxisLabels,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import {
  loadDailyNewReturningReport,
  type DailyActivitySource,
  type DailyNewReturningReport,
  type NewReturningBucket,
} from "./query";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: DailyNewReturningReport }>;
const formatCount = d3.format(",d");

function describeBucket(entry: NewReturningBucket, report: DailyNewReturningReport): string {
  if (entry.newUsers === null || entry.returningUsers === null) return "Unavailable: retained source history does not cover all of its days.";
  return `${entry.bucket.to === report.today ? "In progress through today. " : ""}New: ${formatCount(entry.newUsers)}; returning: ${formatCount(entry.returningUsers)}; total: ${formatCount(entry.newUsers + entry.returningUsers)}.`;
}

/** Why the chart draws no bar, or null when it draws one. */
function describeEmptyChart(report: DailyNewReturningReport): string | null {
  if (report.buckets.every((entry) => entry.newUsers === null)) return "Retained source history does not cover this range.";
  if (report.buckets.every((entry) => (entry.newUsers ?? 0) + (entry.returningUsers ?? 0) === 0)) return "No people in the covered days after exclusions.";
  return null;
}

/** One Level 1 chart of unique people per bucket, stacked new vs returning; `source` must be a stable constant. */
export function DailyNewReturningSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  title: string;
  testId: string;
  explanationId: string;
  source: DailyActivitySource;
  /** The `<li>` items of the (i) explanation. */
  explanation: ReactNode;
  detailsLink: LevelOneMetricDetailsLink | null;
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
    const abortController = new AbortController();
    void loadDailyNewReturningReport(props.config, props.source, props.dateRange, props.period, reportLabel, abortController.signal).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${props.title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.source, props.dateRange, props.period, props.onTerminalAdminError, props.title, reportLabel, revision, tooltipHandlers]);
  const bucketsByKey = useMemo(() => new Map(state.status === "ready" ? state.report.buckets.map((entry) => [entry.bucket.key, entry]) : []), [state]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready") return;
    const getBucket = (key: string): NewReturningBucket => {
      const entry = bucketsByKey.get(key);
      if (entry === undefined) throw new Error(`${props.title} chart has no bucket for ${key}.`);
      return entry;
    };
    const inProgressKey = findInProgressBucketKey(state.report.buckets.map((entry) => entry.bucket), state.report.today);
    renderDailyNewReturningChart({
      svgElement: chartRef.current,
      buckets: state.report.buckets,
      inProgressKey,
      xLabel: reportPeriodAxisLabels[state.report.period],
      formatTick: (key) => formatReportBucketTick(state.report.period, key),
      getLabel: (key) => `${formatReportBucketTitle(state.report.period, getBucket(key).bucket)} UTC. ${describeBucket(getBucket(key), state.report)}`,
      getTooltipHtml: (key) => `<p class="tooltip-title">${escapeHtml(formatReportBucketTitle(state.report.period, getBucket(key).bucket))} UTC${key === inProgressKey ? " · in progress" : ""}</p><p>${escapeHtml(describeBucket(getBucket(key), state.report))}</p>`,
      tooltipHandlers,
    });
  }, [state, bucketsByKey, props.title, tooltipHandlers]);
  return (
    <section className="dashboard-section" data-testid={props.testId}>
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{props.title}</h2>
          <ExplanationTip label={`What ${props.title} shows`} explanationId={props.explanationId}>
            <ul>
              {props.explanation}
              {state.status === "ready" ? <li>Generated {formatGeneratedAt(state.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
        {props.detailsLink !== null ? <LevelOneMetricDetailsButton link={props.detailsLink} /> : null}
      </header>
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{props.title} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "error" ? null : (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>Unique people per {props.period} · UTC</span>
              <div className="chart-meta-right"><UniqueUserCohortKey /></div>
            </div>
            <div className="chart-scroll">
              {state.status === "ready" ? (
                <ChartAreaWithNote viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} note={describeEmptyChart(state.report)}>
                  <svg ref={chartRef} role="group" aria-label={`${props.title}: unique people per ${state.report.period}, new and returning`} />
                </ChartAreaWithNote>
              ) : <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label={`Loading ${props.title}…`} />}
            </div>
          </div>
        </section>
      )}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

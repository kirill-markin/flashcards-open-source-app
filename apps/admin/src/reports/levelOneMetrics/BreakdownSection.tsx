import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import {
  buildBreakdownValueColors,
  renderStackedBreakdownChart,
  sumBreakdownBar,
} from "../../charts/stackedBreakdownChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import type { BreakdownBucket, BreakdownReport, BreakdownReportLoader } from "./breakdownReport";
import {
  findInProgressBucketKey,
  formatReportBucketTick,
  formatReportBucketTitle,
  reportPeriodAxisLabels,
  type ReportPeriod,
} from "./reportPeriod";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: BreakdownReport }>;

type BreakdownChartModel = Readonly<{
  report: BreakdownReport;
  bucketsByKey: ReadonlyMap<string, BreakdownBucket>;
  colorsByValue: ReadonlyMap<string, string>;
  inProgressKey: string | null;
}>;

const formatCount = d3.format(",d");

function getValueColor(model: BreakdownChartModel, value: string): string {
  const color = model.colorsByValue.get(value);
  if (color === undefined) throw new Error(`Breakdown chart has no colour for value ${value}.`);
  return color;
}

/** The values a bar holds, top of the stack first, as the eye reads the bar. */
function listBucketCounts(
  report: BreakdownReport,
  countsByValue: ReadonlyMap<string, number>,
): ReadonlyArray<Readonly<{ value: string; count: number }>> {
  return [...report.values].reverse()
    .map((value) => ({ value, count: countsByValue.get(value) ?? 0 }))
    .filter((entry) => entry.count > 0);
}

/**
 * One Level 1 chart split by one dimension, stacked per bucket in the report's value order.
 * `loadReport` and `formatValue` must be stable.
 */
export function BreakdownSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  title: string;
  testId: string;
  explanationId: string;
  /** The `<li>` items of the (i) explanation. */
  explanation: ReactNode;
  /** What a bar counts, as the y axis names it. */
  countLabel: string;
  /** Why a bar is unavailable, in its tooltip and accessible label. */
  unavailableBarText: string;
  /** Shown instead of the chart when every bar is unavailable. */
  noAvailableBarText: string;
  loadReport: BreakdownReportLoader;
  /** A value's name on screen. */
  formatValue: (value: string) => string;
}>): JSX.Element {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  useEffect(() => {
    let cancelled = false;
    tooltipHandlers.hideTooltip();
    setState({ status: "loading" });
    void props.loadReport(props.config, props.dateRange, props.period).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${props.title} query error.` });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, props.loadReport, props.title, revision, tooltipHandlers]);
  const model = useMemo<BreakdownChartModel | null>(() => (state.status === "ready" ? {
    report: state.report,
    bucketsByKey: new Map(state.report.buckets.map((entry) => [entry.bucket.key, entry])),
    colorsByValue: buildBreakdownValueColors(state.report.values),
    inProgressKey: findInProgressBucketKey(state.report.buckets.map((entry) => entry.bucket), state.report.today),
  } : null), [state]);
  useEffect(() => {
    if (chartRef.current === null || model === null) return;
    const report = model.report;
    const getBucket = (key: string): BreakdownBucket => {
      const entry = model.bucketsByKey.get(key);
      if (entry === undefined) throw new Error(`${props.title} chart has no bucket for ${key}.`);
      return entry;
    };
    const getTitle = (key: string): string => `${formatReportBucketTitle(report.period, getBucket(key).bucket)} UTC`;
    const describeBucket = (key: string): string => {
      const countsByValue = getBucket(key).countsByValue;
      if (countsByValue === null) return props.unavailableBarText;
      return [
        ...listBucketCounts(report, countsByValue).map((entry) => `${props.formatValue(entry.value)}: ${formatCount(entry.count)}`),
        `total: ${formatCount(sumBreakdownBar(countsByValue))}.`,
      ].join("; ");
    };
    const buildTooltipMetricsHtml = (key: string): string => {
      const countsByValue = getBucket(key).countsByValue;
      if (countsByValue === null) return `<p>${escapeHtml(describeBucket(key))}</p>`;
      return [
        ...listBucketCounts(report, countsByValue).map((entry) => `<div class="tooltip-metric"><span>${escapeHtml(props.formatValue(entry.value))}</span><strong>${formatCount(entry.count)}</strong></div>`),
        `<div class="tooltip-metric"><span>Total</span><strong>${formatCount(sumBreakdownBar(countsByValue))}</strong></div>`,
      ].join("");
    };
    renderStackedBreakdownChart({
      svgElement: chartRef.current,
      bars: report.buckets.map((entry) => ({ key: entry.bucket.key, countsByValue: entry.countsByValue })),
      values: report.values,
      getValueColor: (value) => getValueColor(model, value),
      inProgressKey: model.inProgressKey,
      yLabel: props.countLabel,
      xLabel: reportPeriodAxisLabels[report.period],
      formatTick: (key) => formatReportBucketTick(report.period, key),
      getLabel: (key) => `${getTitle(key)}${key === model.inProgressKey ? ", in progress" : ""}. ${describeBucket(key)}`,
      getTooltipHtml: (key) => `<p class="tooltip-title">${escapeHtml(getTitle(key))}${key === model.inProgressKey ? " · in progress" : ""}</p>${buildTooltipMetricsHtml(key)}`,
      tooltipHandlers,
    });
  }, [model, props.title, props.countLabel, props.unavailableBarText, props.formatValue, tooltipHandlers]);
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
      </header>
      {state.status === "loading" ? <p className="report-state" aria-live="polite">Loading {props.title}…</p> : null}
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{props.title} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {model !== null ? (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>{props.countLabel} per {model.report.period} · UTC</span>
              <div className="chart-meta-right">
                <ChartColorKey
                  ariaLabel={`${props.title} color key`}
                  keys={model.report.values}
                  getColor={(value) => getValueColor(model, value)}
                  getLabel={props.formatValue}
                />
              </div>
            </div>
            {model.report.buckets.every((entry) => entry.countsByValue === null) ? <p className="report-state">{props.noAvailableBarText}</p> : null}
            {model.report.buckets.some((entry) => entry.countsByValue !== null) && model.report.values.length === 0 ? <p className="report-state">Nothing counted in the covered days.</p> : null}
            <div className="chart-scroll"><svg ref={chartRef} role="group" aria-label={`${props.title}: ${props.countLabel.toLowerCase()} per ${model.report.period}`} /></div>
          </div>
        </section>
      ) : null}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

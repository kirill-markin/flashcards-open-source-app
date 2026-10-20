import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKey, ChartColorKeyPlaceholder, type ChartColorKeyLink } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes, type ChartNote, type PlacedChartNote } from "../../charts/chartNotes";
import { chartWidth, stackedChartHeight } from "../../charts/chartPrimitives";
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
  /** A value's name on screen: the report's label for it, else the section's `formatValue`. */
  formatValue: (value: string) => string;
  inProgressKey: string | null;
  notes: ReadonlyArray<PlacedChartNote>;
}>;

const formatCount = d3.format(",d");

const notArrivedBarText = "Not arrived yet: the source has delivered none of its days.";
const notFinalBarText = "Not final: the source's numbers for these days can still arrive or change.";

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

/** Why the chart draws no bar, or null when it draws one. */
function describeEmptyChart(report: BreakdownReport, noAvailableBarText: string): string | null {
  if (report.buckets.every((entry) => entry.countsByValue === null)) {
    return report.buckets.every((entry) => entry.freshness === "not-arrived") ? notArrivedBarText : noAvailableBarText;
  }
  if (report.values.length === 0) return "Nothing counted in the covered days.";
  return null;
}

/** A breakdown's chart panel, loading or ready. */
function BreakdownChartColumn(props: Readonly<{
  countLabel: string;
  period: ReportPeriod;
  colorKey: ReactNode;
  chartArea: ReactNode;
  notes: ReadonlyArray<PlacedChartNote> | null;
}>): JSX.Element {
  return (
    <section className="chart-column">
      <div className="chart-shell">
        <div className="chart-meta">
          <span>{props.countLabel} per {props.period} · UTC</span>
          <div className="chart-meta-right">{props.colorKey}</div>
        </div>
        <div className="chart-scroll">{props.chartArea}</div>
        <ChartNotesKey notes={props.notes} />
      </div>
    </section>
  );
}

/** A breakdown's chart panel while its report loads, at the size of a ready one with a one-row key. */
export function BreakdownLoadingChart(props: Readonly<{
  countLabel: string;
  period: ReportPeriod;
  label: string;
}>): JSX.Element {
  return (
    <BreakdownChartColumn
      countLabel={props.countLabel}
      period={props.period}
      colorKey={<ChartColorKeyPlaceholder />}
      chartArea={<ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label={props.label} />}
      notes={null}
    />
  );
}

/**
 * One Level 1 chart split by one dimension, stacked per bucket in the report's value order.
 * `loadReport`, `formatValue` and `buildExtraNotes` must be stable.
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
  /** Shown over the chart when every bar is unavailable. */
  noAvailableBarText: string;
  loadReport: BreakdownReportLoader;
  /** A value's name on screen. */
  formatValue: (value: string) => string;
  /** The notes besides In progress, from the report's today; null for none. */
  buildExtraNotes: ((today: string) => ReadonlyArray<ChartNote>) | null;
  /** Where the color key's entries link; null for a plain key. */
  keyLink: ChartColorKeyLink<string> | null;
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
    void props.loadReport(props.config, props.dateRange, props.period, abortController.signal).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${props.title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, props.loadReport, props.title, revision, tooltipHandlers]);
  const model = useMemo<BreakdownChartModel | null>(() => (state.status === "ready" ? {
    report: state.report,
    bucketsByKey: new Map(state.report.buckets.map((entry) => [entry.bucket.key, entry])),
    colorsByValue: buildBreakdownValueColors(state.report.values),
    formatValue: (value) => state.report.valueLabels?.get(value) ?? props.formatValue(value),
    inProgressKey: findInProgressBucketKey(state.report.buckets.map((entry) => entry.bucket), state.report.today),
    notes: placeChartNotes(
      [buildInProgressChartNote(state.report.today), ...(props.buildExtraNotes === null ? [] : props.buildExtraNotes(state.report.today))],
      state.report.buckets.map((entry) => entry.bucket),
    ),
  } : null), [state, props.buildExtraNotes, props.formatValue]);
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
      const entry = getBucket(key);
      if (entry.countsByValue === null && entry.freshness === "not-arrived") return notArrivedBarText;
      const valueText = entry.countsByValue === null ? props.unavailableBarText : [
        ...listBucketCounts(report, entry.countsByValue).map((count) => `${model.formatValue(count.value)}: ${formatCount(count.count)}`),
        `total: ${formatCount(sumBreakdownBar(entry.countsByValue))}.`,
      ].join("; ");
      return entry.freshness === "final" ? valueText : `${valueText} ${notFinalBarText}`;
    };
    const buildTooltipMetricsHtml = (key: string): string => {
      const entry = getBucket(key);
      if (entry.countsByValue === null) return `<p>${escapeHtml(describeBucket(key))}</p>`;
      return [
        ...listBucketCounts(report, entry.countsByValue).map((count) => `<div class="tooltip-metric"><span>${escapeHtml(model.formatValue(count.value))}</span><strong>${formatCount(count.count)}</strong></div>`),
        `<div class="tooltip-metric"><span>Total</span><strong>${formatCount(sumBreakdownBar(entry.countsByValue))}</strong></div>`,
        entry.freshness === "final" ? "" : `<p class="tooltip-hint">${escapeHtml(notFinalBarText)}</p>`,
      ].join("");
    };
    renderStackedBreakdownChart({
      svgElement: chartRef.current,
      bars: report.buckets.map((entry) => ({
        key: entry.bucket.key,
        countsByValue: entry.countsByValue,
        notFinal: entry.freshness !== "final",
      })),
      values: report.values,
      getValueColor: (value) => getValueColor(model, value),
      notes: model.notes,
      yLabel: props.countLabel,
      xLabel: reportPeriodAxisLabels[report.period],
      formatTick: (key) => formatReportBucketTick(report.period, key),
      getLabel: (key) => `${getTitle(key)}${key === model.inProgressKey ? ", in progress" : ""}. ${describeBucket(key)}`,
      getTooltipHtml: (key) => `<p class="tooltip-title">${escapeHtml(getTitle(key))}${key === model.inProgressKey ? " · in progress" : ""}</p>${buildTooltipMetricsHtml(key)}`,
      tooltipHandlers,
    });
  }, [model, props.title, props.countLabel, props.unavailableBarText, tooltipHandlers]);
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
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{props.title} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "loading" ? <BreakdownLoadingChart countLabel={props.countLabel} period={props.period} label={`Loading ${props.title}…`} /> : null}
      {model === null ? null : (
        <BreakdownChartColumn
          countLabel={props.countLabel}
          period={props.period}
          colorKey={(
            <ChartColorKey
              ariaLabel={`${props.title} color key`}
              keys={model.report.values}
              getColor={(value) => getValueColor(model, value)}
              getLabel={model.formatValue}
              link={props.keyLink ?? undefined}
            />
          )}
          chartArea={(
            <ChartAreaWithNote viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} note={describeEmptyChart(model.report, props.noAvailableBarText)}>
              <svg ref={chartRef} role="group" aria-label={`${props.title}: ${props.countLabel.toLowerCase()} per ${model.report.period}`} />
            </ChartAreaWithNote>
          )}
          notes={model.notes}
        />
      )}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

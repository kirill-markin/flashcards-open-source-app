import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { isReviewEventPlatform, platformLabels } from "../../charts/chartPrimitives";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { renderRetentionBreakdownChart } from "../../charts/retentionBreakdownChart";
import { buildBreakdownValueColors } from "../../charts/stackedBreakdownChart";
import { retentionLabels, retentionSeries } from "../../charts/whoCameBackChart";
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
  loadWhoCameBackBreakdownReport,
  type RetentionValueCounts,
  type WhoCameBackBreakdownBucket,
  type WhoCameBackBreakdownDimension,
  type WhoCameBackBreakdownReport,
} from "./breakdownQuery";
import { describeUnavailableRetention, type RetentionWindow } from "./query";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WhoCameBackBreakdownReport }>;

type RetentionBreakdown = Readonly<{
  dimension: WhoCameBackBreakdownDimension;
  /** What the chart splits by, as its title names it. */
  label: string;
  /** The `<li>` saying which value a person counts under. */
  placement: ReactNode;
  formatValue: (value: string) => string;
}>;

type RetentionBreakdownModel = Readonly<{
  report: WhoCameBackBreakdownReport;
  bucketsByKey: ReadonlyMap<string, WhoCameBackBreakdownBucket>;
  colorsByValue: ReadonlyMap<string, string>;
}>;

/** A value's point is hidden below this many people in its cohort, too few for a rate to mean anything. */
const minimumDrawnCohortUsers = 5;

const formatCount = d3.format(",d");
const formatRate = d3.format(".1%");

const retentionWindowDays: Readonly<Record<RetentionWindow, string>> = { w1: "7–13", w4: "28–34" };

const retentionBreakdowns: ReadonlyArray<RetentionBreakdown> = [
  {
    dimension: "platform",
    label: "platform of first use",
    placement: <li>A person counts under the platform of the answered review that was their first use: the earliest, ties broken by event id.</li>,
    formatValue: (value) => (isReviewEventPlatform(value) ? platformLabels[value] : value),
  },
  {
    dimension: "country",
    label: "country",
    placement: <li>Reviews carry no country, so a person counts under the one connection country a funnel’s Group by places them in over the whole selection: the alphabetically first of their retained connection samples. Samples are kept 90 days and agent requests carry none, so older cohorts and agent-only people are mostly Unknown.</li>,
    formatValue: (value) => value,
  },
];

function getValueColor(model: RetentionBreakdownModel, value: string): string {
  const color = model.colorsByValue.get(value);
  if (color === undefined) throw new Error(`Who came back breakdown chart has no colour for value ${value}.`);
  return color;
}

function isDrawn(counts: RetentionValueCounts): boolean {
  return counts.cohortUsers >= minimumDrawnCohortUsers;
}

function describeCounts(counts: RetentionValueCounts): string {
  const rate = `${formatRate(counts.returned / counts.cohortUsers)} (${formatCount(counts.returned)} / ${formatCount(counts.cohortUsers)})`;
  return isDrawn(counts) ? rate : `${rate}, under ${minimumDrawnCohortUsers} people, not drawn`;
}

/** Why the chart draws no point, or null when it draws one. */
function describeEmptyChart(report: WhoCameBackBreakdownReport, window: RetentionWindow): string | null {
  const windowCounts = report.buckets.flatMap((entry) => [...(entry.countsByWindow[window]?.values() ?? [])]);
  if (windowCounts.length === 0) return "No non-empty, fully matured covered cohort is available in this range.";
  if (!windowCounts.some(isDrawn)) {
    return `Every value is under ${minimumDrawnCohortUsers} people in each fully matured cohort of this range, so no point is drawn; the tooltip still lists them.`;
  }
  return null;
}

/** One window of one dimension's breakdown, on the report its pair loads. */
function RetentionWindowSection(props: Readonly<{
  breakdown: RetentionBreakdown;
  window: RetentionWindow;
  state: LoadState;
  onRetry: () => void;
}>): JSX.Element {
  const title = `Who came back ${retentionLabels[props.window]} by ${props.breakdown.label}`;
  const chartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const model = useMemo<RetentionBreakdownModel | null>(() => (props.state.status === "ready" ? {
    report: props.state.report,
    bucketsByKey: new Map(props.state.report.buckets.map((entry) => [entry.bucket.key, entry])),
    colorsByValue: buildBreakdownValueColors(props.state.report.values),
  } : null), [props.state]);
  useEffect(() => {
    tooltipHandlers.hideTooltip();
  }, [props.state, tooltipHandlers]);
  useEffect(() => {
    if (chartRef.current === null || model === null) return;
    const report = model.report;
    const getBucket = (key: string): WhoCameBackBreakdownBucket => {
      const entry = model.bucketsByKey.get(key);
      if (entry === undefined) throw new Error(`${title} chart has no cohort for ${key}.`);
      return entry;
    };
    const listCounts = (key: string): ReadonlyArray<Readonly<{ value: string; counts: RetentionValueCounts }>> => {
      const countsByValue = getBucket(key).countsByWindow[props.window];
      if (countsByValue === null) return [];
      return report.values.flatMap((value) => {
        const counts = countsByValue.get(value);
        return counts === undefined ? [] : [{ value, counts }];
      });
    };
    const getTitle = (key: string): string => {
      const bucket = getBucket(key).bucket;
      return `First use: ${formatReportBucketTitle(report.period, bucket)} UTC${bucket.to > report.latestCompleteDate ? " · in progress" : ""}`;
    };
    const describeUnavailable = (key: string): string => describeUnavailableRetention(
      getBucket(key).bucket,
      report.historyFrom,
      report.latestCompleteDate,
      props.window,
    );
    const describeBucket = (key: string): string => {
      const entries = listCounts(key);
      if (entries.length === 0) return describeUnavailable(key);
      return `${entries.map((entry) => `${props.breakdown.formatValue(entry.value)}: ${describeCounts(entry.counts)}`).join("; ")}.`;
    };
    const buildTooltipMetricsHtml = (key: string): string => {
      const entries = listCounts(key);
      if (entries.length === 0) return `<p>${escapeHtml(describeUnavailable(key))}</p>`;
      return entries.map((entry) => `<div class="tooltip-metric"><span>${escapeHtml(props.breakdown.formatValue(entry.value))}</span><strong>${escapeHtml(describeCounts(entry.counts))}</strong></div>`).join("");
    };
    renderRetentionBreakdownChart({
      svgElement: chartRef.current,
      keys: report.buckets.map((entry) => entry.bucket.key),
      values: report.values,
      getValueColor: (value) => getValueColor(model, value),
      getRate: (key, value) => {
        const counts = getBucket(key).countsByWindow[props.window]?.get(value);
        return counts === undefined || !isDrawn(counts) ? null : counts.returned / counts.cohortUsers;
      },
      xLabel: `First use: ${reportPeriodAxisLabels[report.period]}`,
      formatTick: (key) => formatReportBucketTick(report.period, key),
      getLabel: (key) => `${getTitle(key)}. ${retentionLabels[props.window]}: ${describeBucket(key)}`,
      getTooltipHtml: (key) => `<p class="tooltip-title">${escapeHtml(getTitle(key))}</p>${buildTooltipMetricsHtml(key)}`,
      tooltipHandlers,
    });
  }, [model, props.window, props.breakdown, title, tooltipHandlers]);
  const testId = `who-came-back-${props.window}-by-${props.breakdown.dimension}`;
  const emptyChartMessage = model === null ? null : describeEmptyChart(model.report, props.window);
  return (
    <section className="dashboard-section" data-testid={`${testId}-section`}>
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{title}</h2>
          <ExplanationTip label={`What ${title} shows`} explanationId={`${testId}-explanation`}>
            <ul>
              <li>The cohorts of Who came back: people whose first-ever answered review falls on the bucket’s selected days. A line is one value’s {retentionLabels[props.window]}: its people with any answered review on days {retentionWindowDays[props.window]} after their own first-use day, over its people in the cohort.</li>
              {props.breakdown.placement}
              <li>The five values with the most cohort people over the selected first-use dates get their own line; the rest are summed into Other. A missing value is Unknown and ranks like any other.</li>
              <li>A value’s point is hidden where it has fewer than {minimumDrawnCohortUsers} people in the cohort, so its line breaks there; the tooltip still lists its rate and returned / cohort users.</li>
              <li>A rate appears only after the cohort’s last selected first-use day has its full window. Recent or uncovered cohorts are unavailable, never zero.</li>
              {props.state.status === "ready" ? <li>Generated {formatGeneratedAt(props.state.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>
      {props.state.status === "loading" ? <p className="report-state" aria-live="polite">Loading {title}…</p> : null}
      {props.state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{title} query failed.</strong><span>{props.state.message}</span>
          <button className="filter-button" type="button" onClick={props.onRetry}>Retry</button>
        </div>
      ) : null}
      {model !== null ? (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>{retentionLabels[props.window]} per first-use {model.report.period} · UTC</span>
              <div className="chart-meta-right">
                <ChartColorKey
                  ariaLabel={`${title} color key`}
                  keys={model.report.values}
                  getColor={(value) => getValueColor(model, value)}
                  getLabel={props.breakdown.formatValue}
                />
              </div>
            </div>
            {emptyChartMessage === null ? null : <p className="report-state">{emptyChartMessage}</p>}
            <div className="chart-scroll"><svg ref={chartRef} role="group" aria-label={`${title}, by first-use ${model.report.period}`} /></div>
          </div>
        </section>
      ) : null}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

/** Both windows of one dimension, two grid cells over one query. */
function RetentionBreakdownPair(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  breakdown: RetentionBreakdown;
}>): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void loadWhoCameBackBreakdownReport(props.config, props.breakdown.dimension, props.dateRange, props.period, `Who came back by ${props.breakdown.label} report`).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected Who came back by ${props.breakdown.label} query error.` });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, props.breakdown, revision]);
  return (
    <>
      {retentionSeries.map((window) => (
        <RetentionWindowSection
          key={window}
          breakdown={props.breakdown}
          window={window}
          state={state}
          onRetry={() => setRevision((value) => value + 1)}
        />
      ))}
    </>
  );
}

/** The Who came back Details breakdowns, one grid cell per window and dimension. */
export function WhoCameBackBreakdownSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <>
      {retentionBreakdowns.map((breakdown) => (
        <RetentionBreakdownPair
          key={breakdown.dimension}
          config={props.config}
          dateRange={props.dateRange}
          period={props.period}
          onTerminalAdminError={props.onTerminalAdminError}
          breakdown={breakdown}
        />
      ))}
    </>
  );
}

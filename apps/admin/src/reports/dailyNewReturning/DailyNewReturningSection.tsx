import { useCallback, useEffect, useMemo, useRef, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { UniqueUserCohortKey } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes } from "../../charts/chartNotes";
import { chartWidth, stackedChartHeight } from "../../charts/chartPrimitives";
import { renderDailyNewReturningChart } from "../../charts/dailyNewReturningChart";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { ExplanationTip } from "../../explanations/ExplanationTip";
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
import {
  useDailyNewReturningReport,
  type DailyNewReturningLoadState,
  type DailyNewReturningReportLoader,
  type DailyNewReturningSelection,
} from "./useDailyNewReturningReport";

const formatCount = d3.format(",d");

function describeBucket(entry: NewReturningBucket, report: DailyNewReturningReport): string {
  if (entry.newUsers === null || entry.returningUsers === null) return "Unavailable: retained source history does not cover all of its days.";
  return `${entry.bucket.to === report.today ? "In progress through today. " : ""}New: ${formatCount(entry.newUsers)}; returning: ${formatCount(entry.returningUsers)}; total: ${formatCount(entry.newUsers + entry.returningUsers)}.`;
}

/** Why the chart draws no bar, or null when it draws one. */
function describeEmptyChart(report: DailyNewReturningReport): string | null {
  if (report.buckets.every((entry) => entry.newUsers === null)) return "Retained source history does not cover this range.";
  if (report.buckets.every((entry) => (entry.newUsers ?? 0) + (entry.returningUsers ?? 0) === 0)) return "No people in the covered days after exclusions and the filters.";
  return null;
}

type DailyNewReturningChartProps = Readonly<{
  period: ReportPeriod;
  title: string;
  testId: string;
  explanationId: string;
  explanation: ReactNode;
  detailsLink: LevelOneMetricDetailsLink | null;
}>;

export function DailyNewReturningSection(
  props: DailyNewReturningChartProps & DailyNewReturningSelection & Readonly<{ source: DailyActivitySource }>,
): JSX.Element {
  const { source } = props;
  const loadReport = useCallback<DailyNewReturningReportLoader<DailyNewReturningReport>>(
    (config, dateRange, period, eventPlatforms, appVersions, reportLabel, signal) =>
      loadDailyNewReturningReport(config, source, dateRange, period, eventPlatforms, appVersions, reportLabel, signal),
    [source],
  );
  const { state, retry } = useDailyNewReturningReport(props, props.title, loadReport);
  return <DailyNewReturningChartSection {...props} state={state} retry={retry} sharedPeak={null} />;
}

export function DailyNewReturningChartSection(props: DailyNewReturningChartProps & Readonly<{
  state: DailyNewReturningLoadState<DailyNewReturningReport>;
  retry: () => void;
  sharedPeak: number | null;
}>): JSX.Element {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const { state, sharedPeak } = props;
  const bucketsByKey = useMemo(() => new Map(state.status === "ready" ? state.report.buckets.map((entry) => [entry.bucket.key, entry]) : []), [state]);
  const chartNotes = useMemo(() => (state.status === "ready"
    ? placeChartNotes([buildInProgressChartNote(state.report.today)], state.report.buckets.map((entry) => entry.bucket))
    : null), [state]);
  useEffect(() => {
    tooltipHandlers.hideTooltip();
    if (chartRef.current === null || state.status !== "ready" || chartNotes === null) return;
    const getBucket = (key: string): NewReturningBucket => {
      const entry = bucketsByKey.get(key);
      if (entry === undefined) throw new Error(`${props.title} chart has no bucket for ${key}.`);
      return entry;
    };
    const inProgressKey = findInProgressBucketKey(state.report.buckets.map((entry) => entry.bucket), state.report.today);
    renderDailyNewReturningChart({
      svgElement: chartRef.current,
      buckets: state.report.buckets,
      notes: chartNotes,
      sharedPeak,
      inProgressKey,
      xLabel: reportPeriodAxisLabels[state.report.period],
      formatTick: (key) => formatReportBucketTick(state.report.period, key),
      getLabel: (key) => `${formatReportBucketTitle(state.report.period, getBucket(key).bucket)} UTC. ${describeBucket(getBucket(key), state.report)}`,
      getTooltipHtml: (key) => `<p class="tooltip-title">${escapeHtml(formatReportBucketTitle(state.report.period, getBucket(key).bucket))} UTC${key === inProgressKey ? " · in progress" : ""}</p><p>${escapeHtml(describeBucket(getBucket(key), state.report))}</p>`,
      tooltipHandlers,
    });
  }, [state, bucketsByKey, chartNotes, props.title, sharedPeak, tooltipHandlers]);
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
          <button className="filter-button" type="button" onClick={props.retry}>Retry</button>
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
            <ChartNotesKey notes={chartNotes} />
          </div>
        </section>
      )}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

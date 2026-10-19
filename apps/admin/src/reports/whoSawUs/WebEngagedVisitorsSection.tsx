import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { chartWidth, createTickDates, stackedChartHeight } from "../../charts/chartPrimitives";
import { renderWhoSawUsChart } from "../../charts/chartRenderers";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  findInProgressBucketKey,
  formatReportBucketTick,
  formatReportBucketTitle,
  reportPeriodAxisLabels,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { loadEngagedVisitorsReport, type EngagedVisitorsBucket, type EngagedVisitorsReport } from "./engagedVisitorsQuery";
import { whoSawUsSeriesColors } from "./WhoSawUsSection";

const title = "Engaged visitors";
const seriesKey = "engaged";
const seriesKeys = [seriesKey] as const;

const numberFormatter = d3.format(",");

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: EngagedVisitorsReport }>;

/** The Web visitors of each bucket who did more than open one page, drawn under the Web chart. */
export function WebEngagedVisitorsSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const { tooltipState, tooltipHandlers } = useChartTooltip();

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadEngagedVisitorsReport(props.config, props.dateRange, props.period).then((report) => {
      if (!cancelled) setLoadState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${title} query error.` });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, revision]);

  const bucketByKey = useMemo(
    () => new Map(loadState.status === "ready" ? loadState.report.buckets.map((entry) => [entry.bucket.key, entry]) : []),
    [loadState],
  );

  useEffect(() => {
    const svgElement = chartRef.current;
    if (svgElement === null || loadState.status !== "ready") {
      return;
    }

    const report = loadState.report;
    const getBucket = (key: string): EngagedVisitorsBucket => {
      const entry = bucketByKey.get(key);
      if (entry === undefined) {
        throw new Error(`${title} chart has no bucket for ${key}.`);
      }

      return entry;
    };
    const keys = report.buckets.map((entry) => entry.bucket.key);
    const inProgressKey = findInProgressBucketKey(report.buckets.map((entry) => entry.bucket), report.today);

    renderWhoSawUsChart({
      svgElement,
      dates: keys,
      tickDates: createTickDates(keys),
      matrix: report.buckets.map((entry) => ({
        date: entry.bucket.key,
        valuesByKey: { [seriesKey]: entry.engagedVisitors ?? 0 },
      })),
      keys: seriesKeys,
      getKeyColor: () => whoSawUsSeriesColors.web,
      getKeyLabel: () => title,
      peakDailyTotal: d3.max(report.buckets, (entry) => entry.engagedVisitors ?? 0) ?? 0,
      xAxisLabel: reportPeriodAxisLabels[report.period],
      isNotFinalSegment: () => false,
      formatTickLabel: (key) => formatReportBucketTick(report.period, key),
      formatTitleLabel: (key) => `${formatReportBucketTitle(report.period, getBucket(key).bucket)} UTC${key === inProgressKey ? " · in progress" : ""}`,
      buildTooltipMetricsHtml: (entry) => {
        const value = getBucket(entry.date).engagedVisitors;
        return `<div class="tooltip-metric"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value === null ? "No data" : numberFormatter(value))}</strong></div>`;
      },
      tooltipHandlers,
    });
  }, [loadState, bucketByKey, tooltipHandlers]);

  return (
    <section className="dashboard-section" data-testid="who-saw-us-web-engaged-visitors-section">
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{title}</h2>
          <ExplanationTip label={`What ${title} shows`} explanationId="who-saw-us-web-engaged-visitors-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> the Web visitors above who did more than open one page, per UTC day, week or month
                <ul>
                  <li>Engaged on a day: 2 or more page views, or a page view plus any site action, such as a click, a deck install click, a catalog search, a copy, an answered language suggestion or a cookie consent grant</li>
                  <li>Impressions are not actions: an app button, store QR code, language suggestion or cookie banner shown, a declined banner, or collection switched on or off</li>
                  <li>The same visitors and exclusions as the Web chart, so each bar is at most the Web bar for the same day, week or month; one-page visitors stay counted there</li>
                  <li><strong>Weeks and months:</strong> an identified visitor engaged on any of the bar's days counts once; cookieless visitors are summed over the bar's days, because the cookieless id changes every day</li>
                </ul>
              </li>
              {loadState.status === "ready" ? <li>Generated {formatGeneratedAt(loadState.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>

      {loadState.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{title} query failed.</strong>
          <span>{loadState.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}

      {loadState.status === "error" ? null : (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>Engaged visitors per {props.period} · UTC</span>
              <div className="chart-meta-right">
                <ChartColorKey
                  ariaLabel={`${title} color key`}
                  keys={seriesKeys}
                  getColor={() => whoSawUsSeriesColors.web}
                  getLabel={() => title}
                />
              </div>
            </div>
            <div className="chart-scroll">
              {loadState.status === "ready" ? (
                <ChartAreaWithNote viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} note={null}>
                  <svg ref={chartRef} />
                </ChartAreaWithNote>
              ) : (
                <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label={`Loading ${title}…`} />
              )}
            </div>
          </div>
        </section>
      )}

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

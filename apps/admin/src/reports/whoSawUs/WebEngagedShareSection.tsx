import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { chartWidth, stackedChartHeight } from "../../charts/chartPrimitives";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { renderRateLineChart } from "../../charts/rateLineChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  findInProgressBucketKey,
  formatReportBucketTick,
  formatReportBucketTitle,
  reportPeriodAxisLabels,
  type ReportBucket,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { loadEngagedVisitorsReport, pageReadEngagementStartDate, type EngagedVisitorsReport } from "./engagedVisitorsQuery";
import { loadWhoSawUsReport, type WhoSawUsReport } from "./query";
import { whoSawUsSeriesColors } from "./WhoSawUsSection";

const title = "Engaged share of Web visitors";
const seriesKeys = ["share"] as const;

const pageReadEngagementMarkerLabel = "Page reads count from here";

const numberFormatter = d3.format(",");
const shareFormatter = d3.format(".1%");

type EngagedShareBucket = Readonly<{
  bucket: ReportBucket;
  webVisitors: number | null;
  engagedVisitors: number | null;
  /** Null where the bar has no Web visitor, so there is nothing to divide by. */
  share: number | null;
}>;

type EngagedShareReport = Readonly<{
  generatedAtUtc: string;
  period: ReportPeriod;
  today: string;
  buckets: ReadonlyArray<EngagedShareBucket>;
}>;

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: EngagedShareReport }>;

/** Both series count each bar's visitors in the same unit, so the ratio is a true share of the Web bar. */
function buildEngagedShareReport(webReport: WhoSawUsReport, engagedReport: EngagedVisitorsReport): EngagedShareReport {
  const webKeys = webReport.buckets.map((entry) => entry.bucket.key);
  const engagedKeys = engagedReport.buckets.map((entry) => entry.bucket.key);
  if (webKeys.join(",") !== engagedKeys.join(",")) {
    throw new Error(`${title} needs the same buckets in both reports. Web: ${webKeys.join(", ")}. Engaged: ${engagedKeys.join(", ")}.`);
  }

  return {
    generatedAtUtc: webReport.generatedAtUtc < engagedReport.generatedAtUtc ? webReport.generatedAtUtc : engagedReport.generatedAtUtc,
    period: engagedReport.period,
    today: engagedReport.today,
    buckets: engagedReport.buckets.map((entry, index) => {
      const webEntry = webReport.buckets[index];
      if (webEntry === undefined) {
        throw new Error(`${title} has no Web bucket for ${entry.bucket.key}.`);
      }

      const webVisitors = webEntry.visitorsBySeries.web;
      return {
        bucket: entry.bucket,
        webVisitors,
        engagedVisitors: entry.engagedVisitors,
        share: webVisitors === null || webVisitors === 0 || entry.engagedVisitors === null ? null : entry.engagedVisitors / webVisitors,
      };
    }),
  };
}

/** The share of each bucket's Web visitors who were engaged, drawn under the Engaged visitors chart. */
export function WebEngagedShareSection(props: Readonly<{
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
    const abortController = new AbortController();
    void Promise.all([
      loadWhoSawUsReport(props.config, props.dateRange, props.period, abortController.signal),
      loadEngagedVisitorsReport(props.config, props.dateRange, props.period, abortController.signal),
    ]).then(([webReport, engagedReport]) => {
      if (!cancelled) setLoadState({ status: "ready", report: buildEngagedShareReport(webReport, engagedReport) });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
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
    const getBucket = (key: string): EngagedShareBucket => {
      const entry = bucketByKey.get(key);
      if (entry === undefined) {
        throw new Error(`${title} chart has no bucket for ${key}.`);
      }

      return entry;
    };
    const inProgressKey = findInProgressBucketKey(report.buckets.map((entry) => entry.bucket), report.today);
    const formatTitle = (key: string): string =>
      `${formatReportBucketTitle(report.period, getBucket(key).bucket)} UTC${key === inProgressKey ? " · in progress" : ""}`;
    const formatCount = (value: number | null): string => value === null ? "No data" : numberFormatter(value);
    const formatShare = (key: string): string => {
      const share = getBucket(key).share;
      return share === null ? "No data" : shareFormatter(share);
    };

    renderRateLineChart({
      svgElement,
      keys: report.buckets.map((entry) => entry.bucket.key),
      getRate: (key) => getBucket(key).share,
      color: whoSawUsSeriesColors.web,
      yLabel: "Engaged share",
      xLabel: reportPeriodAxisLabels[report.period],
      markerKey: report.buckets.find((entry) =>
        entry.bucket.from <= pageReadEngagementStartDate && pageReadEngagementStartDate <= entry.bucket.to)?.bucket.key ?? null,
      markerLabel: pageReadEngagementMarkerLabel,
      formatTick: (key) => formatReportBucketTick(report.period, key),
      getLabel: (key) => `${formatTitle(key)}. ${title}: ${formatShare(key)}`,
      getTooltipHtml: (key) => {
        const entry = getBucket(key);
        return [
          `<p class="tooltip-title">${escapeHtml(formatTitle(key))}</p>`,
          `<div class="tooltip-metric"><span>Engaged share</span><strong>${escapeHtml(formatShare(key))}</strong></div>`,
          `<div class="tooltip-metric"><span>Engaged visitors</span><strong>${escapeHtml(formatCount(entry.engagedVisitors))}</strong></div>`,
          `<div class="tooltip-metric"><span>Web visitors</span><strong>${escapeHtml(formatCount(entry.webVisitors))}</strong></div>`,
        ].join("");
      },
      tooltipHandlers,
    });
  }, [loadState, bucketByKey, tooltipHandlers]);

  return (
    <section className="dashboard-section" data-testid="who-saw-us-web-engaged-share-section">
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{title}</h2>
          <ExplanationTip label={`What ${title} shows`} explanationId="who-saw-us-web-engaged-share-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> Engaged visitors ÷ Web visitors of the same UTC day, week or month, from the two charts above
                <ul>
                  <li>A bar with no Web visitor has no share</li>
                  <li><strong>Weeks and months:</strong> counted as in the two charts above, so the share stays at most 100%</li>
                  <li><strong>The dashed line:</strong> from {pageReadEngagementStartDate}, a visitor who reads one page for 10+ seconds with a scroll, click or key press also counts as engaged, so the share steps up there by definition, not because visitors changed</li>
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
              <span>Engaged share per {props.period} · UTC</span>
              <div className="chart-meta-right">
                <ChartColorKey
                  ariaLabel={`${title} color key`}
                  keys={seriesKeys}
                  getColor={() => whoSawUsSeriesColors.web}
                  getLabel={() => "Engaged share"}
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

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes, type PlacedChartNote } from "../../charts/chartNotes";
import { chartWidth, stackedChartHeight } from "../../charts/chartPrimitives";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { renderRateLineChart } from "../../charts/rateLineChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange, SiteVisitorFilterState } from "../../filters/analyticsFilters";
import {
  findInProgressBucketKey,
  formatReportBucketTick,
  formatReportBucketTitle,
  reportPeriodAxisLabels,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { pageReadEngagementChartNote } from "./engagedVisitorsQuery";
import { webDataStartChartNote } from "./query";
import {
  loadWebTrafficCategoriesReport,
  type WebTrafficCategoriesBucket,
  type WebTrafficCategoriesReport,
  type WebTrafficCategoryKey,
} from "./webTrafficCategoriesQuery";
import { getCategoriesTotal, webTrafficCategoriesTitle, webTrafficCategoryLabels } from "./WebTrafficCategoriesSection";
import { whoSawUsSeriesColors } from "./WhoSawUsSection";

const title = "Engaged share";

const engagedShareLineKeys = ["of-visitors-after-filters", "of-all-traffic"] as const;

type EngagedShareLineKey = (typeof engagedShareLineKeys)[number];

const engagedShareLineLabels: Readonly<Record<EngagedShareLineKey, string>> = {
  "of-visitors-after-filters": "Of visitors after filters",
  "of-all-traffic": "Of all traffic",
};

const engagedShareLineColors: Readonly<Record<EngagedShareLineKey, string>> = {
  "of-visitors-after-filters": whoSawUsSeriesColors.web,
  "of-all-traffic": "#e15759",
};

const numberFormatter = d3.format(",");
const shareFormatter = d3.format(".1%");

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WebTrafficCategoriesReport }>;

type EngagedShareChartModel = Readonly<{
  period: ReportPeriod;
  keys: ReadonlyArray<string>;
  bucketByKey: ReadonlyMap<string, WebTrafficCategoriesBucket>;
  inProgressKey: string | null;
  notes: ReadonlyArray<PlacedChartNote>;
}>;

function getShareDenominator(lineKey: EngagedShareLineKey, counts: Readonly<Record<WebTrafficCategoryKey, number>>): number {
  return lineKey === "of-visitors-after-filters" ? counts.engaged + counts["not-engaged"] : getCategoriesTotal(counts);
}

/** Null where the bucket has no site visitor or the line's denominator is 0. */
function getEngagedShare(lineKey: EngagedShareLineKey, entry: WebTrafficCategoriesBucket): number | null {
  const counts = entry.visitorsByCategory;
  if (counts === null) {
    return null;
  }

  const denominator = getShareDenominator(lineKey, counts);
  return denominator === 0 ? null : counts.engaged / denominator;
}

function formatEngagedShare(share: number | null): string {
  return share === null ? "No share" : shareFormatter(share);
}

function buildChartModel(report: WebTrafficCategoriesReport): EngagedShareChartModel {
  const buckets = report.buckets.map((entry) => entry.bucket);

  return {
    period: report.period,
    keys: buckets.map((bucket) => bucket.key),
    bucketByKey: new Map(report.buckets.map((entry) => [entry.bucket.key, entry])),
    inProgressKey: findInProgressBucketKey(buckets, report.today),
    notes: placeChartNotes(
      [buildInProgressChartNote(report.today), webDataStartChartNote, pageReadEngagementChartNote],
      buckets,
    ),
  };
}

function buildBucketTooltipMetricsHtml(entry: WebTrafficCategoriesBucket): string {
  const counts = entry.visitorsByCategory;
  if (counts === null) {
    return `<div class="tooltip-metric"><span>Total</span><strong>No data</strong></div>`;
  }

  return [
    ...engagedShareLineKeys.map((lineKey) => (
      `<div class="tooltip-metric"><span>${escapeHtml(engagedShareLineLabels[lineKey])}</span><strong>${escapeHtml(formatEngagedShare(getEngagedShare(lineKey, entry)))}</strong></div>`
    )),
    `<div class="tooltip-metric"><span>${escapeHtml(webTrafficCategoryLabels.engaged)}</span><strong>${numberFormatter(counts.engaged)}</strong></div>`,
    `<div class="tooltip-metric"><span>Visitors after filters</span><strong>${numberFormatter(getShareDenominator("of-visitors-after-filters", counts))}</strong></div>`,
    `<div class="tooltip-metric"><span>All traffic</span><strong>${numberFormatter(getShareDenominator("of-all-traffic", counts))}</strong></div>`,
  ].join("");
}

/** The Engaged category of `WebTrafficCategoriesSection` as a share of the visitors after filters and of all traffic. */
export function WebEngagedShareSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  siteFilters: SiteVisitorFilterState;
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
    void loadWebTrafficCategoriesReport(props.config, props.dateRange, props.period, props.siteFilters, abortController.signal).then((report) => {
      if (!cancelled) setLoadState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.dateRange, props.period, props.siteFilters, props.onTerminalAdminError, revision]);

  const chartModel = useMemo(
    () => (loadState.status === "ready" ? buildChartModel(loadState.report) : null),
    [loadState],
  );

  useEffect(() => {
    const svgElement = chartRef.current;
    if (svgElement === null || chartModel === null) {
      return;
    }

    const getBucket = (key: string): WebTrafficCategoriesBucket => {
      const entry = chartModel.bucketByKey.get(key);
      if (entry === undefined) {
        throw new Error(`${title} chart has no bucket for ${key}.`);
      }

      return entry;
    };
    const formatTitle = (key: string): string => (
      `${formatReportBucketTitle(chartModel.period, getBucket(key).bucket)} UTC${key === chartModel.inProgressKey ? " · in progress" : ""}`
    );

    renderRateLineChart({
      svgElement,
      keys: chartModel.keys,
      lines: engagedShareLineKeys.map((lineKey) => ({
        getRate: (key: string) => getEngagedShare(lineKey, getBucket(key)),
        color: engagedShareLineColors[lineKey],
      })),
      inProgressKey: chartModel.inProgressKey,
      yLabel: title,
      xLabel: reportPeriodAxisLabels[chartModel.period],
      notes: chartModel.notes,
      formatTick: (key) => formatReportBucketTick(chartModel.period, key),
      getLabel: (key) => [
        formatTitle(key),
        ...engagedShareLineKeys.map((lineKey) => `${engagedShareLineLabels[lineKey]}: ${formatEngagedShare(getEngagedShare(lineKey, getBucket(key)))}`),
      ].join(". "),
      getTooltipHtml: (key) => (
        `<p class="tooltip-title">${escapeHtml(formatTitle(key))}</p>${buildBucketTooltipMetricsHtml(getBucket(key))}`
      ),
      tooltipHandlers,
    });
  }, [chartModel, tooltipHandlers]);

  return (
    <section className="dashboard-section" data-testid="who-saw-us-web-engaged-share-section">
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{title}</h2>
          <ExplanationTip label={`What ${title} shows`} explanationId="who-saw-us-web-engaged-share-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> the {webTrafficCategoryLabels.engaged} visitors of {webTrafficCategoriesTitle}, per UTC day, week or month, as a share of two of its totals
                <ul>
                  <li><strong>{engagedShareLineLabels["of-visitors-after-filters"]}:</strong> {webTrafficCategoryLabels.engaged} ÷ ({webTrafficCategoryLabels.engaged} + {webTrafficCategoryLabels["not-engaged"]})</li>
                  <li><strong>{engagedShareLineLabels["of-all-traffic"]}:</strong> {webTrafficCategoryLabels.engaged} ÷ ({webTrafficCategoryLabels.engaged} + {webTrafficCategoryLabels["not-engaged"]} + {webTrafficCategoryLabels["own-and-test"]} + {webTrafficCategoryLabels.bots})</li>
                  <li>Both stay within 0–100%, because {webTrafficCategoryLabels.engaged} is part of both denominators</li>
                </ul>
              </li>
              <li>A bar with no site visitor at all has no share, so both lines break there; a bar whose visitors were all dropped has no {engagedShareLineLabels["of-visitors-after-filters"]} share</li>
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
                  keys={engagedShareLineKeys}
                  getColor={(key) => engagedShareLineColors[key]}
                  getLabel={(key) => engagedShareLineLabels[key]}
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
            <ChartNotesKey notes={chartModel === null ? null : chartModel.notes} />
          </div>
        </section>
      )}

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

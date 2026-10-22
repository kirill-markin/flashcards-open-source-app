import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes, type PlacedChartNote } from "../../charts/chartNotes";
import { chartWidth, createTickDates, stackedChartHeight, type MatrixChartEntry } from "../../charts/chartPrimitives";
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
import { pageReadEngagementChartNote } from "./engagedVisitorsQuery";
import { webDataStartChartNote } from "./query";
import {
  loadWebTrafficCategoriesReport,
  webTrafficCategoryKeys,
  type WebTrafficCategoriesBucket,
  type WebTrafficCategoriesReport,
  type WebTrafficCategoryKey,
} from "./webTrafficCategoriesQuery";
import { whoSawUsSeriesColors, whoSawUsSeriesLabels } from "./WhoSawUsSection";

export const webTrafficCategoriesTitle = "Web visitors by traffic category";
const title = webTrafficCategoriesTitle;

export const webTrafficCategoryLabels: Readonly<Record<WebTrafficCategoryKey, string>> = {
  engaged: "Engaged",
  "not-engaged": "Not engaged",
  "own-and-test": "Our own and test",
  bots: "Bots",
};

const webTrafficCategoryColors: Readonly<Record<WebTrafficCategoryKey, string>> = {
  engaged: whoSawUsSeriesColors.web,
  "not-engaged": "#a0cbe8",
  "own-and-test": "#b07aa1",
  bots: "#bab0ac",
};

const numberFormatter = d3.format(",");
const shareFormatter = d3.format(".1%");

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WebTrafficCategoriesReport }>;

type WebTrafficCategoriesChartModel = Readonly<{
  period: ReportPeriod;
  keys: ReadonlyArray<string>;
  tickKeys: ReadonlyArray<string>;
  matrix: ReadonlyArray<MatrixChartEntry>;
  bucketByKey: ReadonlyMap<string, WebTrafficCategoriesBucket>;
  peakTotal: number;
  inProgressKey: string | null;
  notes: ReadonlyArray<PlacedChartNote>;
}>;

function getCategoryKey(key: string): WebTrafficCategoryKey {
  const categoryKey = webTrafficCategoryKeys.find((candidate) => candidate === key);
  if (categoryKey === undefined) {
    throw new Error(`Unsupported web traffic category key: ${key}`);
  }

  return categoryKey;
}

export function getCategoriesTotal(counts: Readonly<Record<WebTrafficCategoryKey, number>>): number {
  return d3.sum(webTrafficCategoryKeys, (key) => counts[key]);
}

function buildChartModel(report: WebTrafficCategoriesReport): WebTrafficCategoriesChartModel {
  const keys = report.buckets.map((entry) => entry.bucket.key);
  const buckets = report.buckets.map((entry) => entry.bucket);

  return {
    period: report.period,
    keys,
    tickKeys: createTickDates(keys),
    matrix: report.buckets.map((entry) => ({
      date: entry.bucket.key,
      valuesByKey: Object.fromEntries(
        webTrafficCategoryKeys.map((key) => [key, entry.visitorsByCategory === null ? 0 : entry.visitorsByCategory[key]]),
      ),
    })),
    bucketByKey: new Map(report.buckets.map((entry) => [entry.bucket.key, entry])),
    peakTotal: d3.max(report.buckets, (entry) => (entry.visitorsByCategory === null ? 0 : getCategoriesTotal(entry.visitorsByCategory))) ?? 0,
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

  const total = getCategoriesTotal(counts);
  return [
    ...webTrafficCategoryKeys.map((key) => (
      `<div class="tooltip-metric"><span>${escapeHtml(webTrafficCategoryLabels[key])}</span><strong>${numberFormatter(counts[key])} · ${shareFormatter(counts[key] / total)}</strong></div>`
    )),
    `<div class="tooltip-metric"><span>Total</span><strong>${numberFormatter(total)}</strong></div>`,
  ].join("");
}

/**
 * Every site visitor of each bucket, before any cleanup, split into the four categories of
 * `buildWebTrafficCategoriesSql`, so the Engaged segment is the Web engaged series' bar.
 */
export function WebTrafficCategoriesSection(props: Readonly<{
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
    void loadWebTrafficCategoriesReport(props.config, props.dateRange, props.period, abortController.signal).then((report) => {
      if (!cancelled) setLoadState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, revision]);

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

    renderWhoSawUsChart({
      svgElement,
      dates: chartModel.keys,
      tickDates: chartModel.tickKeys,
      matrix: chartModel.matrix,
      keys: webTrafficCategoryKeys,
      getKeyColor: (key) => webTrafficCategoryColors[getCategoryKey(key)],
      getKeyLabel: (key) => webTrafficCategoryLabels[getCategoryKey(key)],
      peakDailyTotal: chartModel.peakTotal,
      xAxisLabel: reportPeriodAxisLabels[chartModel.period],
      isNotFinalSegment: (_key, date) => date === chartModel.inProgressKey,
      notes: chartModel.notes,
      formatTickLabel: (key) => formatReportBucketTick(chartModel.period, key),
      formatTitleLabel: (key) => `${formatReportBucketTitle(chartModel.period, getBucket(key).bucket)} UTC${key === chartModel.inProgressKey ? " · in progress" : ""}`,
      buildTooltipMetricsHtml: (entry) => buildBucketTooltipMetricsHtml(getBucket(entry.date)),
      tooltipHandlers,
    });
  }, [chartModel, tooltipHandlers]);

  return (
    <section className="dashboard-section" data-testid="who-saw-us-web-traffic-categories-section">
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{title}</h2>
          <ExplanationTip label={`What ${title} shows`} explanationId="who-saw-us-web-traffic-categories-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> every site visitor with a page view, per UTC day, week or month, before any cleanup, so the bar top is all web traffic; each visitor is in exactly one category, tested in this order
                <ul>
                  <li><strong>{webTrafficCategoryLabels.engaged}:</strong> kept by the {whoSawUsSeriesLabels.web} series and engaged, so it equals that series' bar</li>
                  <li><strong>{webTrafficCategoryLabels["not-engaged"]}:</strong> kept by the {whoSawUsSeriesLabels.web} series but not engaged; {webTrafficCategoryLabels.engaged} + {webTrafficCategoryLabels["not-engaged"]} is that series before its engaged filter</li>
                  <li><strong>{webTrafficCategoryLabels["own-and-test"]}:</strong> an identified visitor the shared exclusions drop for a test email, an admin email, an automation guest install, a test distribution install, sandbox billing, or a manual entry on the exclusion list</li>
                  <li><strong>{webTrafficCategoryLabels.bots}:</strong> every other dropped visitor: identified visitors dropped as an automated client, a probable Android test burst, the scraper fleet or an automatic exclusion list entry, and cookieless visitors whose day the series drops for automated rows or a scraper-fleet hash</li>
                  <li><strong>Weeks and months:</strong> an identified visitor counts once per bar, engaged if engaged on any of its days; cookieless visitors are summed over the bar's days, because the cookieless id changes every day</li>
                </ul>
              </li>
              <li>
                <strong>Caveats</strong>
                <ul>
                  <li>An admin browsing without consent is cookieless and carries no account, so they cannot be recognized as {webTrafficCategoryLabels["own-and-test"]} and count as {webTrafficCategoryLabels.engaged} or {webTrafficCategoryLabels["not-engaged"]}</li>
                  <li>A bar with no site visitor at all is No data</li>
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
              <span>Visitors per {props.period} · UTC</span>
              <div className="chart-meta-right">
                <ChartColorKey
                  ariaLabel={`${title} color key`}
                  keys={webTrafficCategoryKeys}
                  getColor={(key) => webTrafficCategoryColors[key]}
                  getLabel={(key) => webTrafficCategoryLabels[key]}
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

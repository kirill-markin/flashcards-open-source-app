import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { createTickDates, type MatrixChartEntry } from "../../charts/chartPrimitives";
import { renderWhoSawUsChart } from "../../charts/chartRenderers";
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
import { formatCalendarDate } from "../reportValues";
import {
  loadWhoSawUsReport,
  whoSawUsSeriesKeys,
  type WhoSawUsBucket,
  type WhoSawUsReport,
  type WhoSawUsSeriesKey,
} from "./query";

const whoSawUsSeriesLabels: Readonly<Record<WhoSawUsSeriesKey, string>> = {
  web: "Web",
  "app-store": "App Store",
  "google-play": "Google Play",
};

const whoSawUsSeriesColors: Readonly<Record<WhoSawUsSeriesKey, string>> = {
  web: "#4e79a7",
  "app-store": "#f28e2b",
  "google-play": "#59a14f",
};

// The store reports arrive late and are revised: Google Play lags three to seven days.
const notFinalDayCount = 3;

const numberFormatter = d3.format(",");

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WhoSawUsReport }>;

type WhoSawUsChartModel = Readonly<{
  period: ReportPeriod;
  keys: ReadonlyArray<string>;
  tickKeys: ReadonlyArray<string>;
  matrix: ReadonlyArray<MatrixChartEntry>;
  bucketByKey: ReadonlyMap<string, WhoSawUsBucket>;
  peakTotal: number;
  lastFinalDate: string;
  firstNotFinalKey: string | null;
  inProgressKey: string | null;
}>;

function getSeriesKey(key: string): WhoSawUsSeriesKey {
  const seriesKey = whoSawUsSeriesKeys.find((candidate) => candidate === key);
  if (seriesKey === undefined) {
    throw new Error(`Unsupported Who saw us series key: ${key}`);
  }

  return seriesKey;
}

function getBucketTotal(entry: WhoSawUsBucket): number {
  return d3.sum(whoSawUsSeriesKeys, (key) => entry.visitorsBySeries[key] ?? 0);
}

function buildUtcDateDaysBefore(generatedAtUtc: string, dayCount: number): string {
  const generatedAt = new Date(generatedAtUtc);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error(`Who saw us report generation time is invalid: ${generatedAtUtc}`);
  }

  return formatCalendarDate(new Date(Date.UTC(
    generatedAt.getUTCFullYear(),
    generatedAt.getUTCMonth(),
    generatedAt.getUTCDate() - dayCount,
  )));
}

function buildWhoSawUsChartModel(report: WhoSawUsReport): WhoSawUsChartModel {
  const keys = report.buckets.map((entry) => entry.bucket.key);
  const lastFinalDate = buildUtcDateDaysBefore(report.generatedAtUtc, notFinalDayCount);

  return {
    period: report.period,
    keys,
    tickKeys: createTickDates(keys),
    matrix: report.buckets.map((entry) => ({
      date: entry.bucket.key,
      valuesByKey: Object.fromEntries(
        whoSawUsSeriesKeys.map((key) => [key, entry.visitorsBySeries[key] ?? 0]),
      ),
    })),
    bucketByKey: new Map(report.buckets.map((entry) => [entry.bucket.key, entry])),
    peakTotal: d3.max(report.buckets, getBucketTotal) ?? 0,
    lastFinalDate,
    firstNotFinalKey: report.buckets.find((entry) => entry.bucket.to > lastFinalDate)?.bucket.key ?? null,
    inProgressKey: findInProgressBucketKey(
      report.buckets.map((entry) => entry.bucket),
      buildUtcDateDaysBefore(report.generatedAtUtc, 0),
    ),
  };
}

function buildBucketTooltipMetricsHtml(entry: WhoSawUsBucket, lastFinalDate: string): string {
  return [
    ...whoSawUsSeriesKeys.map((key) => {
      const value = entry.visitorsBySeries[key];
      return `<div class="tooltip-metric"><span>${escapeHtml(whoSawUsSeriesLabels[key])}</span><strong>${value === null ? "No data" : numberFormatter(value)}</strong></div>`;
    }),
    `<div class="tooltip-metric"><span>Total</span><strong>${numberFormatter(getBucketTotal(entry))}</strong></div>`,
    entry.bucket.to > lastFinalDate
      ? `<p class="tooltip-hint">Not final: store numbers for these days can still arrive or change.</p>`
      : "",
  ].join("");
}

export function WhoSawUsSection(
  props: Readonly<{
    config: AdminAppConfig;
    dateRange: AnalyticsDateRange;
    period: ReportPeriod;
    detailsLink: LevelOneMetricDetailsLink | null;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const { tooltipState, tooltipHandlers } = useChartTooltip();

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadWhoSawUsReport(props.config, props.dateRange, props.period).then((report) => {
      if (!cancelled) setLoadState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Who saw us query error." });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, revision]);

  const chartModel = useMemo(
    () => (loadState.status === "ready" ? buildWhoSawUsChartModel(loadState.report) : null),
    [loadState],
  );

  useEffect(() => {
    const svgElement = chartRef.current;
    if (svgElement === null || chartModel === null) {
      return;
    }

    const getBucket = (key: string): WhoSawUsBucket => {
      const entry = chartModel.bucketByKey.get(key);
      if (entry === undefined) {
        throw new Error(`Who saw us chart has no bucket for ${key}.`);
      }

      return entry;
    };

    renderWhoSawUsChart({
      svgElement,
      dates: chartModel.keys,
      tickDates: chartModel.tickKeys,
      matrix: chartModel.matrix,
      keys: whoSawUsSeriesKeys,
      getKeyColor: (key) => whoSawUsSeriesColors[getSeriesKey(key)],
      getKeyLabel: (key) => whoSawUsSeriesLabels[getSeriesKey(key)],
      peakDailyTotal: chartModel.peakTotal,
      xAxisLabel: reportPeriodAxisLabels[chartModel.period],
      firstNotFinalDate: chartModel.firstNotFinalKey,
      formatTickLabel: (key) => formatReportBucketTick(chartModel.period, key),
      formatTitleLabel: (key) => `${formatReportBucketTitle(chartModel.period, getBucket(key).bucket)} UTC${key === chartModel.inProgressKey ? " · in progress" : ""}`,
      buildTooltipMetricsHtml: (entry) => buildBucketTooltipMetricsHtml(getBucket(entry.date), chartModel.lastFinalDate),
      tooltipHandlers,
    });
  }, [chartModel, tooltipHandlers]);

  return (
    <section className="dashboard-section" data-testid="who-saw-us-section">
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>Who saw us</h2>
          <ExplanationTip label="What Who saw us shows" explanationId="who-saw-us-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> approximate unique visitors per surface, stacked, per UTC day, week or month
                <ul>
                  <li>
                    <strong>Web:</strong> identified site visitors after the shared exclusions, plus cookieless visitors (only automated traffic is dropped)
                    <ul>
                      <li>So an admin browsing without consent still counts</li>
                    </ul>
                  </li>
                  <li><strong>App Store:</strong> product page views by unique count, plus apps.apple.com browser views (Apple reports those without a unique count)</li>
                  <li><strong>Google Play:</strong> store listing visitors</li>
                  <li><strong>Weeks and months:</strong> an identified web visitor counts once per bar; cookieless and store visitors are summed over the bar's days, because the cookieless id changes every day and the stores send no visitor ids</li>
                </ul>
              </li>
              <li>
                <strong>Caveats</strong>
                <ul>
                  <li>Stores count per breakdown row, and the three surfaces overlap, so one person can be counted more than once</li>
                  <li>Someone who opens a store page from our website, by a store badge or the site's QR code, counts in both Web and App Store or Google Play; removing this overlap is a planned follow-up</li>
                  <li>No store bar = no data on any of its days, not zero; the tooltip says No data</li>
                  <li>Store numbers right of the dashed line are not final; Google Play can lag up to a week</li>
                </ul>
              </li>
              {loadState.status === "ready" ? <li>Generated {formatGeneratedAt(loadState.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
        {props.detailsLink !== null ? <LevelOneMetricDetailsButton link={props.detailsLink} /> : null}
      </header>

      {loadState.status === "loading" ? (
        <p className="report-state" aria-live="polite">Loading Who saw us…</p>
      ) : null}

      {loadState.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>Who saw us query failed.</strong>
          <span>{loadState.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}

      {loadState.status === "ready" ? (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>Visitors per {loadState.report.period} · UTC</span>
              <div className="chart-meta-right">
                <ChartColorKey
                  ariaLabel="Who saw us color key"
                  keys={whoSawUsSeriesKeys}
                  getColor={(key) => whoSawUsSeriesColors[key]}
                  getLabel={(key) => whoSawUsSeriesLabels[key]}
                />
              </div>
            </div>
            <div className="chart-scroll">
              <svg ref={chartRef} />
            </div>
          </div>
        </section>
      ) : null}

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

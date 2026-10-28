import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes, type ChartNote, type PlacedChartNote } from "../../charts/chartNotes";
import { chartWidth, createTickDates, stackedChartHeight, type MatrixChartEntry } from "../../charts/chartPrimitives";
import { renderWhoSawUsChart } from "../../charts/chartRenderers";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange, SiteVisitorFilterState } from "../../filters/analyticsFilters";
import type { BarFreshness } from "../levelOneMetrics/breakdownReport";
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
import { engagedRuleSwitchLabel, pageReadEngagementChartNote } from "./engagedVisitorsQuery";
import {
  loadWhoSawUsReport,
  webDataStartChartNote,
  whoSawUsSeriesKeys,
  whoSawUsStoreSeriesKeys,
  type WhoSawUsBucket,
  type WhoSawUsReport,
  type WhoSawUsSeriesKey,
  type WhoSawUsStoreSeriesKey,
} from "./query";
import { buildStoreNotFinalChartNote, getStoreBarFreshness, storeNotFinalDayCounts } from "./storeDataFreshness";

export const whoSawUsSeriesLabels: Readonly<Record<WhoSawUsSeriesKey, string>> = {
  web: "Web engaged",
  "app-store": "App Store",
  "google-play": "Google Play",
};

export const whoSawUsSeriesColors: Readonly<Record<WhoSawUsSeriesKey, string>> = {
  web: "#4e79a7",
  "app-store": "#f28e2b",
  "google-play": "#59a14f",
};

/** The main Level 1 chart stacks every series; a dataset page draws its own one alone. */
export type WhoSawUsChartSeries = "all" | WhoSawUsSeriesKey;

function getDrawnSeriesKeys(series: WhoSawUsChartSeries): ReadonlyArray<WhoSawUsSeriesKey> {
  return series === "all" ? whoSawUsSeriesKeys : [series];
}

function buildSeriesChartNotes(seriesKey: WhoSawUsSeriesKey, today: string): ReadonlyArray<ChartNote> {
  return seriesKey === "web"
    ? [webDataStartChartNote, pageReadEngagementChartNote]
    : [buildStoreNotFinalChartNote(seriesKey, today)];
}

const numberFormatter = d3.format(",");

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WhoSawUsReport }>;

type WhoSawUsChartModel = Readonly<{
  period: ReportPeriod;
  seriesKeys: ReadonlyArray<WhoSawUsSeriesKey>;
  keys: ReadonlyArray<string>;
  tickKeys: ReadonlyArray<string>;
  matrix: ReadonlyArray<MatrixChartEntry>;
  bucketByKey: ReadonlyMap<string, WhoSawUsBucket>;
  peakTotal: number;
  storeFreshnessByKey: ReadonlyMap<string, StoreFreshness>;
  inProgressKey: string | null;
  notes: ReadonlyArray<PlacedChartNote>;
}>;

type StoreFreshness = Readonly<Record<WhoSawUsStoreSeriesKey, BarFreshness>>;

function findStoreSeriesKey(key: WhoSawUsSeriesKey): WhoSawUsStoreSeriesKey | undefined {
  return whoSawUsStoreSeriesKeys.find((candidate) => candidate === key);
}

function getSeriesKey(key: string): WhoSawUsSeriesKey {
  const seriesKey = whoSawUsSeriesKeys.find((candidate) => candidate === key);
  if (seriesKey === undefined) {
    throw new Error(`Unsupported Who saw us series key: ${key}`);
  }

  return seriesKey;
}

function getBucketTotal(entry: WhoSawUsBucket, seriesKeys: ReadonlyArray<WhoSawUsSeriesKey>): number {
  return d3.sum(seriesKeys, (key) => entry.visitorsBySeries[key] ?? 0);
}

function buildWhoSawUsChartModel(
  report: WhoSawUsReport,
  seriesKeys: ReadonlyArray<WhoSawUsSeriesKey>,
): WhoSawUsChartModel {
  const keys = report.buckets.map((entry) => entry.bucket.key);
  const buckets = report.buckets.map((entry) => entry.bucket);
  const today = report.storeDelivery.today;

  return {
    period: report.period,
    seriesKeys,
    keys,
    tickKeys: createTickDates(keys),
    matrix: report.buckets.map((entry) => ({
      date: entry.bucket.key,
      valuesByKey: Object.fromEntries(
        seriesKeys.map((key) => [key, entry.visitorsBySeries[key] ?? 0]),
      ),
    })),
    bucketByKey: new Map(report.buckets.map((entry) => [entry.bucket.key, entry])),
    peakTotal: d3.max(report.buckets, (entry) => getBucketTotal(entry, seriesKeys)) ?? 0,
    storeFreshnessByKey: new Map(report.buckets.map((entry) => [entry.bucket.key, {
      "app-store": getStoreBarFreshness("app-store", report.storeDelivery, entry.bucket),
      "google-play": getStoreBarFreshness("google-play", report.storeDelivery, entry.bucket),
    }])),
    inProgressKey: findInProgressBucketKey(buckets, today),
    notes: placeChartNotes(
      [buildInProgressChartNote(today), ...seriesKeys.flatMap((key) => buildSeriesChartNotes(key, today))],
      buckets,
    ),
  };
}

function formatStoreValue(value: number | null, freshness: BarFreshness): string {
  if (value !== null) return `${numberFormatter(value)} · ${freshness === "final" ? "final" : "not final"}`;
  switch (freshness) {
    case "not-arrived":
      return "Not arrived yet";
    case "not-final":
      return "No data · not final";
    case "final":
      return "No data";
  }
}

function buildBucketTooltipMetricsHtml(
  entry: WhoSawUsBucket,
  storeFreshness: StoreFreshness,
  seriesKeys: ReadonlyArray<WhoSawUsSeriesKey>,
): string {
  const drawnStoreKeys = whoSawUsStoreSeriesKeys.filter((key) => seriesKeys.includes(key));
  return [
    ...seriesKeys.map((key) => {
      const value = entry.visitorsBySeries[key];
      const storeKey = findStoreSeriesKey(key);
      const valueText = storeKey === undefined
        ? (value === null ? "No data" : numberFormatter(value))
        : formatStoreValue(value, storeFreshness[storeKey]);
      return `<div class="tooltip-metric"><span>${escapeHtml(whoSawUsSeriesLabels[key])}</span><strong>${escapeHtml(valueText)}</strong></div>`;
    }),
    seriesKeys.length > 1
      ? `<div class="tooltip-metric"><span>Total</span><strong>${numberFormatter(getBucketTotal(entry, seriesKeys))}</strong></div>`
      : "",
    drawnStoreKeys.some((key) => storeFreshness[key] !== "final")
      ? `<p class="tooltip-hint">Not final: store numbers for these days can still arrive or change.</p>`
      : "",
  ].join("");
}

const whoSawUsSeriesDescriptions: Readonly<Record<WhoSawUsSeriesKey, ReactNode>> = {
  web: <>
    site visitors engaged on a day: identified visitors after the shared exclusions, plus cookieless visitors (only automated traffic is dropped)
    <ul>
      <li>So an admin browsing without consent still counts</li>
      <li>Engaged on a day = 2+ page views, or 1+ page view and 1+ site action, such as a page read (10+ seconds on one page with a scroll, click or key press), a click, a deck install click, a catalog search, a copy, an answered language suggestion or a cookie consent grant</li>
      <li>Impressions are not actions: an app button, store QR code, language suggestion or cookie banner shown, a declined banner, or collection switched on or off</li>
      <li>Before {engagedRuleSwitchLabel}, the dashed marker, the site did not send page reads yet, so 1+ page view and 1+ other site event counts, impressions included</li>
      <li>A bar with site visitors but no engaged one is 0; no site visitor at all is No data</li>
    </ul>
  </>,
  "app-store": "product page views by unique count, plus apps.apple.com browser views (Apple reports those without a unique count)",
  "google-play": "store listing visitors",
};

/** The (i) items of the main chart, which stacks every series. */
const allSeriesExplanation = <>
  <li>
    <strong>What it shows:</strong> approximate unique visitors per surface, stacked, per UTC day, week or month
    <ul>
      {whoSawUsSeriesKeys.map((key) => (
        <li key={key}><strong>{whoSawUsSeriesLabels[key]}:</strong> {whoSawUsSeriesDescriptions[key]}</li>
      ))}
      <li><strong>Weeks and months:</strong> an identified Web engaged visitor counts once per bar, engaged on any of its days; cookieless engaged visitors and store visitors are summed over the bar's days, because the cookieless id changes every day and the stores send no visitor ids</li>
    </ul>
  </li>
  <li>
    <strong>Caveats</strong>
    <ul>
      <li>Stores count per breakdown row, and the three surfaces overlap, so one person can be counted more than once</li>
      <li>Someone who opens a store page from our website, by a store badge or the site's QR code, can count in both Web engaged and App Store or Google Play; removing this overlap is a planned follow-up</li>
      <li>
        Faded store segment, or any segment of the bar holding today, = not final: its numbers can still arrive or change
        <ul>
          <li>App Store for {storeNotFinalDayCounts["app-store"]} days, Google Play for {storeNotFinalDayCounts["google-play"]} days, since Google posts daily data within 3 to 7 days</li>
          <li>Also a week or month that runs past the store's newest delivered day</li>
        </ul>
      </li>
      <li>No store segment, tooltip Not arrived yet = the store has delivered none of the bar's days, judged by its newest delivered day, so a stalled import never reads as zero or No data</li>
      <li>No store segment, tooltip No data = the store has no row on any of the bar's days, not zero</li>
    </ul>
  </li>
</>;

const oneSeriesWeeksAndMonthsTexts: Readonly<Record<WhoSawUsSeriesKey, string>> = {
  web: "Web engaged = identified visitors engaged on any of the bar's days, each once + cookieless engaged visitors summed over the bar's days, because the cookieless id changes every day",
  "app-store": "visitors are summed over the bar's days, because Apple sends no visitor ids",
  "google-play": "visitors are summed over the bar's days, because Google sends no visitor ids",
};

const storeNotFinalWindowTexts: Readonly<Record<WhoSawUsStoreSeriesKey, string>> = {
  "app-store": `For ${storeNotFinalDayCounts["app-store"]} days`,
  "google-play": `For ${storeNotFinalDayCounts["google-play"]} days, since Google posts daily data within 3 to 7 days`,
};

function renderStoreSeriesCaveats(storeKey: WhoSawUsStoreSeriesKey): JSX.Element {
  const label = whoSawUsSeriesLabels[storeKey];
  return (
    <li>
      <strong>Caveats</strong>
      <ul>
        <li>{label} counts per breakdown row, so one person can be counted more than once</li>
        <li>
          Faded bar = not final: its numbers can still arrive or change
          <ul>
            <li>{storeNotFinalWindowTexts[storeKey]}</li>
            <li>Also a week or month that runs past {label}'s newest delivered day</li>
          </ul>
        </li>
        <li>No bar, tooltip Not arrived yet = {label} has delivered none of the bar's days, judged by its newest delivered day, so a stalled import never reads as zero or No data</li>
        <li>No bar, tooltip No data = {label} has no row on any of the bar's days, not zero</li>
      </ul>
    </li>
  );
}

/** The (i) items of one series drawn alone on its dataset page. */
function renderOneSeriesExplanation(seriesKey: WhoSawUsSeriesKey): JSX.Element {
  const storeKey = findStoreSeriesKey(seriesKey);
  return (
    <>
      <li>
        <strong>What it shows:</strong> approximate unique {whoSawUsSeriesLabels[seriesKey]} visitors per UTC day, week or month
        <ul>
          <li>{whoSawUsSeriesDescriptions[seriesKey]}</li>
          <li><strong>Weeks and months:</strong> {oneSeriesWeeksAndMonthsTexts[seriesKey]}</li>
        </ul>
      </li>
      {storeKey === undefined ? null : renderStoreSeriesCaveats(storeKey)}
    </>
  );
}

export function WhoSawUsSection(
  props: Readonly<{
    config: AdminAppConfig;
    dateRange: AnalyticsDateRange;
    period: ReportPeriod;
    series: WhoSawUsChartSeries;
    /** Narrows the `web` series alone; a chart that draws a store series passes the default. */
    siteFilters: SiteVisitorFilterState;
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
    const abortController = new AbortController();
    void loadWhoSawUsReport(props.config, props.dateRange, props.period, props.siteFilters, abortController.signal).then((report) => {
      if (!cancelled) setLoadState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Who saw us query error." });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.dateRange, props.period, props.siteFilters, props.onTerminalAdminError, revision]);

  const seriesKeys = useMemo(() => getDrawnSeriesKeys(props.series), [props.series]);
  const chartModel = useMemo(
    () => (loadState.status === "ready" ? buildWhoSawUsChartModel(loadState.report, seriesKeys) : null),
    [loadState, seriesKeys],
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
    const getStoreFreshness = (key: string): StoreFreshness => {
      const storeFreshness = chartModel.storeFreshnessByKey.get(key);
      if (storeFreshness === undefined) {
        throw new Error(`Who saw us chart has no store freshness for ${key}.`);
      }

      return storeFreshness;
    };

    renderWhoSawUsChart({
      svgElement,
      dates: chartModel.keys,
      tickDates: chartModel.tickKeys,
      matrix: chartModel.matrix,
      keys: chartModel.seriesKeys,
      getKeyColor: (key) => whoSawUsSeriesColors[getSeriesKey(key)],
      getKeyLabel: (key) => whoSawUsSeriesLabels[getSeriesKey(key)],
      peakDailyTotal: chartModel.peakTotal,
      xAxisLabel: reportPeriodAxisLabels[chartModel.period],
      isNotFinalSegment: (key, date) => {
        if (date === chartModel.inProgressKey) return true;
        const storeKey = findStoreSeriesKey(getSeriesKey(key));
        return storeKey !== undefined && getStoreFreshness(date)[storeKey] !== "final";
      },
      notes: chartModel.notes,
      formatTickLabel: (key) => formatReportBucketTick(chartModel.period, key),
      formatTitleLabel: (key) => `${formatReportBucketTitle(chartModel.period, getBucket(key).bucket)} UTC${key === chartModel.inProgressKey ? " · in progress" : ""}`,
      buildTooltipMetricsHtml: (entry) => buildBucketTooltipMetricsHtml(getBucket(entry.date), getStoreFreshness(entry.date), chartModel.seriesKeys),
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
              {props.series === "all" ? allSeriesExplanation : renderOneSeriesExplanation(props.series)}
              {loadState.status === "ready" ? <li>Generated {formatGeneratedAt(loadState.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
        {props.detailsLink !== null ? <LevelOneMetricDetailsButton link={props.detailsLink} /> : null}
      </header>

      {loadState.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>Who saw us query failed.</strong>
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
                  ariaLabel="Who saw us color key"
                  keys={seriesKeys}
                  getColor={(key) => whoSawUsSeriesColors[key]}
                  getLabel={(key) => whoSawUsSeriesLabels[key]}
                />
              </div>
            </div>
            <div className="chart-scroll">
              {loadState.status === "ready" ? (
                <ChartAreaWithNote viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} note={null}>
                  <svg ref={chartRef} />
                </ChartAreaWithNote>
              ) : (
                <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading Who saw us…" />
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

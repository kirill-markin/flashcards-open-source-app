import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes } from "../../charts/chartNotes";
import { chartWidth, stackedChartHeight } from "../../charts/chartPrimitives";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { paymentColors, renderWhoPaidUsChart } from "../../charts/whoPaidUsChart";
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
import {
  getPaymentSeriesTotal, loadWhoPaidUsReport, paymentProviderLabels, paymentProviders,
  paymentSeries, paymentSeriesLabels, type PaymentSeries, type WhoPaidUsBucket, type WhoPaidUsReport,
} from "./query";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WhoPaidUsReport }>;
const formatCount = d3.format(",d");

function describeSeries(entry: WhoPaidUsBucket, series: PaymentSeries): string {
  const total = getPaymentSeriesTotal(entry, series);
  const complete = paymentProviders.every((provider) => entry.providers[provider].complete);
  return total === null ? "Unavailable" : `${formatCount(total)}${complete ? "" : " recorded; total incomplete"}`;
}

function describeProviderSeries(entry: WhoPaidUsBucket, series: PaymentSeries): string {
  return paymentProviders.map((provider) => {
    const value = entry.providers[provider].counts[series];
    return `${paymentProviderLabels[provider]}: ${value === null ? "unavailable" : formatCount(value)}${entry.providers[provider].complete ? "" : " (partial history)"}`;
  }).join("; ");
}

function describeRecordedTotal(entry: WhoPaidUsBucket): string {
  const classified = paymentSeries.reduce((sum, series) => sum + (getPaymentSeriesTotal(entry, series) ?? 0), 0);
  const unclassified = paymentProviders.reduce((sum, provider) => sum + entry.providers[provider].unclassified, 0);
  const nativeRepurchases = paymentProviders.reduce((sum, provider) => sum + entry.providers[provider].nativeRepurchases, 0);
  const total = classified + unclassified;
  return `Recorded event total: ${total > 0 ? formatCount(total) : "unavailable"}; merchant total incomplete.
    Paid periods with unavailable first/recurring classification: ${formatCount(unclassified)}.
    Apple subsequent payments labeled PURCHASE: ${formatCount(nativeRepurchases)} (included in recurring).`;
}

function describeBucket(entry: WhoPaidUsBucket, today: string): string {
  return `${entry.bucket.to === today ? "In progress through today. " : ""}${paymentSeries.map((series) => `${paymentSeriesLabels[series]}: ${describeSeries(entry, series)}. ${describeProviderSeries(entry, series)}.`).join(" ")} ${describeRecordedTotal(entry)}`;
}

function formatNullableCount(count: number | null): string {
  return count === null ? "—" : formatCount(count);
}

export function WhoPaidUsSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  detailsLink: LevelOneMetricDetailsLink | null;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
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
    void loadWhoPaidUsReport(props.config, props.dateRange, props.period, abortController.signal).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Who paid us query error." });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, revision, tooltipHandlers]);
  const bucketsByKey = useMemo(() => new Map(state.status === "ready" ? state.report.buckets.map((entry) => [entry.bucket.key, entry]) : []), [state]);
  const chartNotes = useMemo(() => (state.status === "ready"
    ? placeChartNotes([buildInProgressChartNote(state.report.today)], state.report.buckets.map((entry) => entry.bucket))
    : null), [state]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready" || chartNotes === null) return;
    const getBucket = (key: string): WhoPaidUsBucket => {
      const entry = bucketsByKey.get(key);
      if (entry === undefined) throw new Error(`Who paid us chart has no bucket for ${key}.`);
      return entry;
    };
    const inProgressKey = findInProgressBucketKey(state.report.buckets.map((entry) => entry.bucket), state.report.today);
    renderWhoPaidUsChart({
      svgElement: chartRef.current, buckets: state.report.buckets, notes: chartNotes, inProgressKey,
      xLabel: reportPeriodAxisLabels[state.report.period],
      formatTick: (key) => formatReportBucketTick(state.report.period, key),
      getLabel: (key) => `${formatReportBucketTitle(state.report.period, getBucket(key).bucket)} UTC. ${describeBucket(getBucket(key), state.report.today)}`,
      getTooltipHtml: (key) => {
        const entry = getBucket(key);
        const unclassified = paymentProviders.reduce((sum, provider) => sum + entry.providers[provider].unclassified, 0);
        return `<p class="tooltip-title">${escapeHtml(formatReportBucketTitle(state.report.period, entry.bucket))} UTC${key === inProgressKey ? " · in progress" : ""}</p>
          <table class="payment-tooltip-table"><thead><tr><th scope="col">Events</th><th scope="col">Recorded</th></tr></thead>
          <tbody>${paymentSeries.map((series) => `<tr><th scope="row">${paymentSeriesLabels[series]}</th><td>${formatNullableCount(getPaymentSeriesTotal(entry, series))}</td></tr>`).join("")}</tbody></table>
          ${unclassified > 0 ? `<p class="payment-tooltip-note">Unclassified paid periods: ${formatCount(unclassified)}</p>` : ""}
          <p class="payment-tooltip-note">Partial history; — means unavailable.</p>`;
      },
      tooltipHandlers,
    });
  }, [state, bucketsByKey, chartNotes, tooltipHandlers]);
  return (
    <section className="dashboard-section" data-testid="who-paid-us-section">
      <header className="dashboard-section-header level-1-metric-section-header"><div className="explained-heading-row">
        <h2>Who paid us</h2>
        <ExplanationTip label="What Who paid us shows" explanationId="who-paid-us-explanation">
          <ul>
            <li>Subscription events in production per UTC day, week or month, counted by their actual UTC time and summed over the bar’s days. These are events, not unique people, revenue or active paying customers.</li>
            <li>Trial starts require native free-trial evidence. First payment is the first successful positive paid period in verified original subscription history; later successful periods are recurring, even when a provider labels the first charge a renewal.</li>
            <li>New Google order roots and new Stripe subscriptions begin new histories. Apple PURCHASE after an earlier paid period stays recurring. Reactivations are not new globally unique customers.</li>
            <li>Refunds do not erase historical charges. Multiple Stripe invoice payments count once per paid invoice. Sandbox and gifts are excluded; real sales remain regardless of account attribution, erasure or analytics exclusions.</li>
            <li>Apple notification discovery and Google discoverable orders are partial merchant inventories. Known counts remain visible after an import failure; absent or unclassified history is unavailable. Stripe completed production catalog scans can prove zero only for a bar whose every day lies inside their covered window.</li>
            {state.status === "ready" ? <li>Generated {formatGeneratedAt(state.report.generatedAtUtc)}.</li> : null}
          </ul>
        </ExplanationTip>
      </div>
        {props.detailsLink !== null ? <LevelOneMetricDetailsButton link={props.detailsLink} /> : null}
      </header>
      {state.status === "error" ? <div className="report-state report-state-error">
        <strong>Who paid us query failed.</strong><span>{state.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {state.status === "error" ? null : <section className="chart-column"><div className="chart-shell">
        <div className="chart-meta"><span>Events per {props.period} · partial history</span>
          <div className="chart-meta-right"><ChartColorKey ariaLabel="Payment event color key" keys={paymentSeries}
            getColor={(series) => paymentColors[series]} getLabel={(series) => paymentSeriesLabels[series]} />
          </div>
        </div>
        <div className="chart-scroll">
          {state.status === "ready" ? <ChartAreaWithNote viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight}
            note={state.report.buckets.every((entry) => paymentSeries.every((series) => getPaymentSeriesTotal(entry, series) === null))
              ? "No classified events are available in this range." : null}>
            <svg ref={chartRef} role="group" aria-label={`Who paid us: recorded trial starts, first payments and recurring payments per ${state.report.period}`} />
          </ChartAreaWithNote> : <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading Who paid us…" />}
        </div>
        <ChartNotesKey notes={chartNotes} />
      </div></section>}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

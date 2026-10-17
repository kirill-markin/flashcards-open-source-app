import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { paymentColors, renderWhoPaidUsChart } from "../../charts/whoPaidUsChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  findInProgressBucketKey,
  formatReportBucketTick,
  formatReportBucketTitle,
  reportPeriodAxisLabels,
  reportPeriodColumnLabels,
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
const sourceLabels: Readonly<Record<string, string>> = {
  apple_transactions: "Apple retained notification discovery",
  google_orders: "Google discoverable orders",
  stripe_subscriptions: "Stripe catalog subscriptions",
  stripe_invoices: "Stripe catalog invoices",
  stripe_payments: "Stripe catalog payments",
};

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
    void loadWhoPaidUsReport(props.config, props.dateRange, props.period).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Who paid us query error." });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, revision, tooltipHandlers]);
  const bucketsByKey = useMemo(() => new Map(state.status === "ready" ? state.report.buckets.map((entry) => [entry.bucket.key, entry]) : []), [state]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready") return;
    const getBucket = (key: string): WhoPaidUsBucket => {
      const entry = bucketsByKey.get(key);
      if (entry === undefined) throw new Error(`Who paid us chart has no bucket for ${key}.`);
      return entry;
    };
    const inProgressKey = findInProgressBucketKey(state.report.buckets.map((entry) => entry.bucket), state.report.today);
    renderWhoPaidUsChart({
      svgElement: chartRef.current, buckets: state.report.buckets, inProgressKey,
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
  }, [state, bucketsByKey, tooltipHandlers]);
  return (
    <section className="dashboard-section" data-testid="who-paid-us-section">
      <header className="dashboard-section-header"><div className="explained-heading-row">
        <h2>Who paid us</h2>
        <ExplanationTip label="What Who paid us shows" explanationId="who-paid-us-explanation">
          <ul>
            <li>Subscription events in production per UTC day, week or month, counted by their actual UTC time and summed over the bar’s days. These are events, not unique people, revenue or active paying customers.</li>
            <li>Trial starts require native free-trial evidence. First payment is the first successful positive paid period in verified original subscription history; later successful periods are recurring, even when a provider labels the first charge a renewal.</li>
            <li>New Google order roots and new Stripe subscriptions begin new histories. Apple PURCHASE after an earlier paid period stays recurring and is labeled separately in the data. Reactivations are not new globally unique customers.</li>
            <li>Refunds do not erase historical charges. Multiple Stripe invoice payments count once per paid invoice. Sandbox and gifts are excluded; real sales remain regardless of account attribution, erasure or analytics exclusions.</li>
            <li>Apple notification discovery and Google discoverable orders are partial merchant inventories. Known counts remain visible after an import failure; absent or unclassified history is unavailable. Stripe completed production catalog scans can prove zero only for a bar whose every day lies inside their covered window.</li>
            {state.status === "ready" ? <li>Generated {formatGeneratedAt(state.report.generatedAtUtc)}.</li> : null}
          </ul>
        </ExplanationTip>
      </div></header>
      {state.status === "loading" ? <p className="report-state" aria-live="polite">Loading Who paid us…</p> : null}
      {state.status === "error" ? <div className="report-state report-state-error">
        <strong>Who paid us query failed.</strong><span>{state.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {state.status === "ready" ? <section className="chart-column"><div className="chart-shell">
        <div className="chart-meta"><span>Events per {state.report.period} · partial history</span>
          <div className="chart-meta-right"><ChartColorKey ariaLabel="Payment event color key" keys={paymentSeries}
            getColor={(series) => paymentColors[series]} getLabel={(series) => paymentSeriesLabels[series]} />
          </div>
        </div>
        {state.report.buckets.every((entry) => paymentSeries.every((series) => getPaymentSeriesTotal(entry, series) === null))
          ? <p className="report-state">No classified events are available in this range. Unclassified paid periods, if recorded, appear in the data table.</p> : null}
        <div className="chart-scroll"><svg ref={chartRef} role="group" aria-label={`Who paid us: recorded trial starts, first payments and recurring payments per ${state.report.period}`} /></div>
        <details className="activity-chart-table"><summary>Chart data and coverage</summary>
          <p className="activity-coverage-note">Recorded counts are partial totals. Missing history is unavailable. The bar holding today ({state.report.today} UTC) is in progress; verified events are shown as they arrive.</p>
          <ul className="activity-coverage-note">{state.report.sources.map((source) => <li key={source.source}>
            {sourceLabels[source.source]}: {source.status}.
            {source.failureCode === "GOOGLE_HISTORY_SALES_INVENTORY_INCOMPLETE" ? " Sales export discovery failed; verified native orders remain included." : null}
            {source.failureCode !== null ? ` Failure: ${source.failureCode}.` : null}
            {source.finishedAt !== null ? ` Finished ${formatGeneratedAt(source.finishedAt)}.` : source.startedAt !== null ? ` Started ${formatGeneratedAt(source.startedAt)}.` : " No import recorded."}
            {source.requestedTo !== null ? ` Requested through ${formatGeneratedAt(source.requestedTo)}.` : null}
          </li>)}</ul>
          <div className="chart-scroll"><table><caption>Recorded aggregates per {state.report.period}. Totals include unclassified paid periods; merchant history is incomplete.</caption>
            <thead><tr><th scope="col">{reportPeriodColumnLabels[state.report.period]}</th>{paymentSeries.map((series) => <th scope="col" key={series}>{paymentSeriesLabels[series]}</th>)}<th scope="col">Recorded total / availability</th></tr></thead>
            <tbody>{state.report.buckets.map((entry) => <tr key={entry.bucket.key}>
              <th scope="row">{formatReportBucketTitle(state.report.period, entry.bucket)}{entry.bucket.to === state.report.today ? " (in progress)" : ""}</th>
              {paymentSeries.map((series) => <td key={series}>{describeSeries(entry, series)}</td>)}
              <td>{describeRecordedTotal(entry)}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="chart-scroll"><table><caption>Production subscription events, UTC. Recorded partial counts; — means unavailable.</caption>
            <thead><tr><th scope="col">{reportPeriodColumnLabels[state.report.period]} / provider</th>{paymentSeries.map((series) => <th scope="col" key={series}>{paymentSeriesLabels[series]}</th>)}
              <th scope="col">Unclassified paid periods</th><th scope="col">Apple subsequent PURCHASE</th><th scope="col">Coverage</th></tr></thead>
            <tbody>{state.report.buckets.flatMap((entry) => paymentProviders.map((provider) => <tr key={`${entry.bucket.key}:${provider}`}>
              <th scope="row">{formatReportBucketTitle(state.report.period, entry.bucket)} / {paymentProviderLabels[provider]}{entry.bucket.to === state.report.today ? " (in progress)" : ""}</th>
              {paymentSeries.map((series) => <td key={series}>{formatNullableCount(entry.providers[provider].counts[series])}</td>)}
              <td>{formatCount(entry.providers[provider].unclassified)}</td><td>{provider === "apple" ? formatCount(entry.providers[provider].nativeRepurchases) : "—"}</td>
              <td>{entry.providers[provider].complete ? "Complete catalog inventory" : "Partial / unavailable merchant coverage"}</td>
            </tr>))}</tbody>
          </table></div>
          <div className="chart-scroll"><table><caption>Latest production source attempts; half-open UTC coverage windows.</caption>
            <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Covered from</th><th scope="col">Covered to (exclusive)</th></tr></thead>
            <tbody>{state.report.sources.map((source) => <tr key={source.source}><th scope="row">{sourceLabels[source.source]}</th>
              <td>{source.status}</td><td>{source.coveredFrom === null ? "Unavailable" : formatGeneratedAt(source.coveredFrom)}</td>
              <td>{source.coveredTo === null ? "Unavailable" : formatGeneratedAt(source.coveredTo)}</td></tr>)}</tbody>
          </table></div>
        </details>
      </div></section> : null}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

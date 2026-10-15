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
  getPaymentSeriesTotal, loadWhoPaidUsReport, paymentProviderLabels, paymentProviders,
  paymentSeries, paymentSeriesLabels, type PaymentSeries, type WhoPaidUsDay, type WhoPaidUsReport,
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

function describeSeries(day: WhoPaidUsDay, series: PaymentSeries): string {
  const total = getPaymentSeriesTotal(day, series);
  const complete = paymentProviders.every((provider) => day.providers[provider].complete);
  return total === null ? "Unavailable" : `${formatCount(total)}${complete ? "" : " recorded; total incomplete"}`;
}

function describeProviderSeries(day: WhoPaidUsDay, series: PaymentSeries): string {
  return paymentProviders.map((provider) => {
    const value = day.providers[provider].counts[series];
    return `${paymentProviderLabels[provider]}: ${value === null ? "unavailable" : formatCount(value)}${day.providers[provider].complete ? "" : " (partial history)"}`;
  }).join("; ");
}

function describeRecordedTotal(day: WhoPaidUsDay): string {
  const classified = paymentSeries.reduce((sum, series) => sum + (getPaymentSeriesTotal(day, series) ?? 0), 0);
  const unclassified = paymentProviders.reduce((sum, provider) => sum + day.providers[provider].unclassified, 0);
  const nativeRepurchases = paymentProviders.reduce((sum, provider) => sum + day.providers[provider].nativeRepurchases, 0);
  const total = classified + unclassified;
  return `Recorded event total: ${total > 0 ? formatCount(total) : "unavailable"}; merchant total incomplete.
    Paid periods with unavailable first/recurring classification: ${formatCount(unclassified)}.
    Apple subsequent payments labeled PURCHASE: ${formatCount(nativeRepurchases)} (included in recurring).`;
}

function describeDay(day: WhoPaidUsDay, today: string): string {
  return `${day.date === today ? "Today is in progress. " : ""}${paymentSeries.map((series) => `${paymentSeriesLabels[series]}: ${describeSeries(day, series)}. ${describeProviderSeries(day, series)}.`).join(" ")} ${describeRecordedTotal(day)}`;
}

function formatNullableCount(count: number | null): string {
  return count === null ? "—" : formatCount(count);
}

export function WhoPaidUsSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
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
    void loadWhoPaidUsReport(props.config, props.dateRange).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Who paid us query error." });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.onTerminalAdminError, revision, tooltipHandlers]);
  const daysByDate = useMemo(() => new Map(state.status === "ready" ? state.report.days.map((day) => [day.date, day]) : []), [state]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready") return;
    const getDay = (date: string): WhoPaidUsDay => {
      const day = daysByDate.get(date);
      if (day === undefined) throw new Error(`Who paid us chart has no day for ${date}.`);
      return day;
    };
    renderWhoPaidUsChart({
      svgElement: chartRef.current, days: state.report.days, today: state.report.today,
      getLabel: (date) => `${date} UTC. ${describeDay(getDay(date), state.report.today)}`,
      getTooltipHtml: (date) => {
        const day = getDay(date);
        const unclassified = paymentProviders.reduce((sum, provider) => sum + day.providers[provider].unclassified, 0);
        return `<p class="tooltip-title">${escapeHtml(date)} UTC${date === state.report.today ? " · in progress" : ""}</p>
          <table class="payment-tooltip-table"><thead><tr><th scope="col">Events</th><th scope="col">Recorded</th></tr></thead>
          <tbody>${paymentSeries.map((series) => `<tr><th scope="row">${paymentSeriesLabels[series]}</th><td>${formatNullableCount(getPaymentSeriesTotal(day, series))}</td></tr>`).join("")}</tbody></table>
          ${unclassified > 0 ? `<p class="payment-tooltip-note">Unclassified paid periods: ${formatCount(unclassified)}</p>` : ""}
          <p class="payment-tooltip-note">Partial history; — means unavailable.</p>`;
      },
      tooltipHandlers,
    });
  }, [state, daysByDate, tooltipHandlers]);
  return (
    <section className="dashboard-section" data-testid="who-paid-us-section">
      <header className="dashboard-section-header"><div className="explained-heading-row">
        <h2>Who paid us</h2>
        <ExplanationTip label="What Who paid us shows" explanationId="who-paid-us-explanation">
          <ul>
            <li>Daily subscription events in production, counted by their actual UTC time. These are events, not unique people, revenue or active paying customers.</li>
            <li>Trial starts require native free-trial evidence. First payment is the first successful positive paid period in verified original subscription history; later successful periods are recurring, even when a provider labels the first charge a renewal.</li>
            <li>New Google order roots and new Stripe subscriptions begin new histories. Apple PURCHASE after an earlier paid period stays recurring and is labeled separately in the data. Reactivations are not new globally unique customers.</li>
            <li>Refunds do not erase historical charges. Multiple Stripe invoice payments count once per paid invoice. Sandbox and gifts are excluded; real sales remain regardless of account attribution, erasure or analytics exclusions.</li>
            <li>Apple notification discovery and Google discoverable orders are partial merchant inventories. Known counts remain visible after an import failure; absent or unclassified history is unavailable. Stripe completed production catalog scans can prove zero inside their covered window.</li>
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
        <div className="chart-meta"><span>Daily events · partial history</span>
          <div className="chart-meta-right"><ChartColorKey ariaLabel="Payment event color key" keys={paymentSeries}
            getColor={(series) => paymentColors[series]} getLabel={(series) => paymentSeriesLabels[series]} />
          </div>
        </div>
        {state.report.days.every((day) => paymentSeries.every((series) => getPaymentSeriesTotal(day, series) === null))
          ? <p className="report-state">No classified events are available in this range. Unclassified paid periods, if recorded, appear in the data table.</p> : null}
        <div className="chart-scroll"><svg ref={chartRef} role="group" aria-label="Who paid us: recorded daily trial starts, first payments and recurring payments" /></div>
        <details className="activity-chart-table"><summary>Chart data and coverage</summary>
          <p className="activity-coverage-note">Recorded counts are partial totals. Missing history is unavailable. Today ({state.report.today} UTC) is in progress; verified events are shown as they arrive.</p>
          <ul className="activity-coverage-note">{state.report.sources.map((source) => <li key={source.source}>
            {sourceLabels[source.source]}: {source.status}.
            {source.failureCode === "GOOGLE_HISTORY_SALES_INVENTORY_INCOMPLETE" ? " Sales export discovery failed; verified native orders remain included." : null}
            {source.failureCode !== null ? ` Failure: ${source.failureCode}.` : null}
            {source.finishedAt !== null ? ` Finished ${formatGeneratedAt(source.finishedAt)}.` : source.startedAt !== null ? ` Started ${formatGeneratedAt(source.startedAt)}.` : " No import recorded."}
            {source.requestedTo !== null ? ` Requested through ${formatGeneratedAt(source.requestedTo)}.` : null}
          </li>)}</ul>
          <div className="chart-scroll"><table><caption>Recorded daily aggregates. Totals include unclassified paid periods; merchant history is incomplete.</caption>
            <thead><tr><th scope="col">Date</th>{paymentSeries.map((series) => <th scope="col" key={series}>{paymentSeriesLabels[series]}</th>)}<th scope="col">Recorded total / availability</th></tr></thead>
            <tbody>{state.report.days.map((day) => <tr key={day.date}>
              <th scope="row">{day.date}{day.date === state.report.today ? " (in progress)" : ""}</th>
              {paymentSeries.map((series) => <td key={series}>{describeSeries(day, series)}</td>)}
              <td>{describeRecordedTotal(day)}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="chart-scroll"><table><caption>Production subscription events, UTC. Recorded partial counts; — means unavailable.</caption>
            <thead><tr><th scope="col">Date / provider</th>{paymentSeries.map((series) => <th scope="col" key={series}>{paymentSeriesLabels[series]}</th>)}
              <th scope="col">Unclassified paid periods</th><th scope="col">Apple subsequent PURCHASE</th><th scope="col">Coverage</th></tr></thead>
            <tbody>{state.report.days.flatMap((day) => paymentProviders.map((provider) => <tr key={`${day.date}:${provider}`}>
              <th scope="row">{day.date} / {paymentProviderLabels[provider]}{day.date === state.report.today ? " (in progress)" : ""}</th>
              {paymentSeries.map((series) => <td key={series}>{formatNullableCount(day.providers[provider].counts[series])}</td>)}
              <td>{formatCount(day.providers[provider].unclassified)}</td><td>{provider === "apple" ? formatCount(day.providers[provider].nativeRepurchases) : "—"}</td>
              <td>{day.providers[provider].complete ? "Complete catalog inventory" : "Partial / unavailable merchant coverage"}</td>
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

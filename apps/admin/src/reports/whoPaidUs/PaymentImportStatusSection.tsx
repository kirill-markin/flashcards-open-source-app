import { useEffect, useState, type JSX } from "react";
import { formatGeneratedAt } from "../../charts/formatting";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { loadWhoPaidUsReport, type PaymentSourceCoverage, type WhoPaidUsReport } from "./query";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: WhoPaidUsReport }>;

const sourceLabels: Readonly<Record<PaymentSourceCoverage["source"], string>> = {
  apple_transactions: "Apple retained notification discovery",
  google_orders: "Google discoverable orders",
  stripe_subscriptions: "Stripe catalog subscriptions",
  stripe_invoices: "Stripe catalog invoices",
  stripe_payments: "Stripe catalog payments",
};

function describeLastAttempt(source: PaymentSourceCoverage): string {
  if (source.finishedAt !== null) return `Finished ${formatGeneratedAt(source.finishedAt)}`;
  if (source.startedAt !== null) return `Started ${formatGeneratedAt(source.startedAt)}`;
  return "No import recorded";
}

function formatNullableTime(value: string | null): string {
  return value === null ? "Unavailable" : formatGeneratedAt(value);
}

/** The latest production import attempt of every payment source behind Who paid us. */
export function PaymentImportStatusSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void loadWhoPaidUsReport(props.config, props.dateRange, props.period).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Payment import status query error." });
    });
    return () => { cancelled = true; };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, revision]);
  return (
    <section className="dashboard-section payment-import-status" data-testid="payment-import-status-section">
      <header className="dashboard-section-header"><h2>Payment import status</h2></header>
      {state.status === "loading" ? <p className="report-state" aria-live="polite">Loading Payment import status…</p> : null}
      {state.status === "error" ? <div className="report-state report-state-error">
        <strong>Payment import status query failed.</strong><span>{state.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {state.status === "ready" ? <div className="chart-scroll"><table className="payment-import-status-table">
        <caption>Latest production attempt per source, UTC. Generated {formatGeneratedAt(state.report.generatedAtUtc)}.</caption>
        <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Last attempt</th>
          <th scope="col">Requested through</th><th scope="col">Covered window (end exclusive)</th></tr></thead>
        <tbody>{state.report.sources.map((source) => <tr key={source.source}>
          <th scope="row">{sourceLabels[source.source]}</th>
          <td>{source.status}
            {source.failureCode === "GOOGLE_HISTORY_SALES_INVENTORY_INCOMPLETE" ? ". Sales export discovery failed; verified native orders remain included" : null}
            {source.failureCode !== null ? `. Failure: ${source.failureCode}` : null}
          </td>
          <td>{describeLastAttempt(source)}</td>
          <td>{formatNullableTime(source.requestedTo)}</td>
          <td>{source.coveredFrom === null && source.coveredTo === null ? "Unavailable" : `${formatNullableTime(source.coveredFrom)} – ${formatNullableTime(source.coveredTo)}`}</td>
        </tr>)}</tbody>
      </table></div> : null}
    </section>
  );
}

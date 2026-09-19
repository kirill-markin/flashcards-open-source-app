import { useEffect, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { audienceTotal, loadAudienceReport, type AudienceBucket, type AudienceReport } from "./query";
import "./audience.css";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: AudienceReport }>;

function percentage(count: number, total: number): string {
  return total === 0 ? "—" : `${(100 * count / total).toFixed(1)}%`;
}

function BucketTable(props: Readonly<{
  title: string;
  description: string;
  rows: ReadonlyArray<AudienceBucket>;
  total: number;
}>): JSX.Element {
  return <section className="funnel-detail-card">
    <h3>{props.title}</h3>
    <p>{props.description}</p>
    <table className="audience-bucket-table">
      <thead><tr><th scope="col">Bucket</th><th scope="col">Distinct users</th><th scope="col">% of cohort</th></tr></thead>
      <tbody>{props.rows.map((row) => <tr key={`${row.value}:${row.secondary}`}>
        <th scope="row">{row.secondary === "" ? row.value : `${row.value} × ${row.secondary}`}</th>
        <td>{row.users.toLocaleString("en-US")}</td><td>{percentage(row.users, props.total)}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

function AudienceResults(props: Readonly<{ report: AudienceReport; from: string }>): JSX.Element {
  const report = props.report;
  const total = audienceTotal(report, "total");
  const retainedSince = new Date(new Date(report.generatedAtUtc).getTime() - 90 * 86_400_000).toISOString();
  const tiles = [
    { label: "Distinct users in cohort", value: total.toLocaleString("en-US") },
    { label: "Known connection country", value: `${audienceTotal(report, "country_known")} / ${total} · ${percentage(audienceTotal(report, "country_known"), total)}` },
    { label: "Known event UI language", value: `${audienceTotal(report, "language_known")} / ${total} · ${percentage(audienceTotal(report, "language_known"), total)}` },
    { label: "Known upload pair", value: `${audienceTotal(report, "pair_known")} / ${total} · ${percentage(audienceTotal(report, "pair_known"), total)}` },
  ];

  return <>
    {new Date(`${props.from}T00:00:00.000Z`).getTime() < new Date(retainedSince).getTime() ? <p className="report-state">
      This range includes unavailable detailed country history. Samples before {retainedSince} are excluded; lifetime first-known country does not fill that gap.
    </p> : null}
    {total === 0 ? <p className="report-state">No users match this audience and these filters.</p> : null}
    <section className="summary-grid">
      {tiles.map((tile) => <article className="metric-card" key={tile.label}>
        <p className="metric-label">{tile.label}</p><p className="metric-value">{tile.value}</p>
      </article>)}
    </section>
    <div className="funnel-detail-grid">
      <BucketTable title="Observed connection country" total={total}
        description="Country codes at retained upload samples in this range. This is connection geography, not residence, nationality, or country when a queued event happened."
        rows={report.buckets.filter((row) => row.dimension === "country")} />
      <BucketTable title="Actual event UI language" total={total}
        description="UI locale captured before queuing on events in the selected period and platforms. Missing locale is never replaced with device language or English."
        rows={report.buckets.filter((row) => row.dimension === "language")} />
      <BucketTable title="Upload country × event UI language" total={total}
        description="Same installation and accepted sampling batch only: UI language of uploaded events × connection country at upload. Events may have been created offline elsewhere. Unknown × unknown means no fully known pair, even if one or both independent dimensions are known."
        rows={report.buckets.filter((row) => row.dimension === "pair")} />
      <BucketTable title="Cohort activity by platform" total={total}
        description="Agent and unattributed activity stay separate. Agent activity can include scheduled clients; cloud connections are not human geography."
        rows={report.buckets.filter((row) => row.dimension === "platform")} />
      <section className="funnel-detail-card">
        <h3>Coverage and overlapping users</h3>
        <div className="funnel-detail-row"><span>No known country</span><strong>{audienceTotal(report, "country_unknown")} / {total}</strong></div>
        <div className="funnel-detail-row"><span>No known UI language</span><strong>{audienceTotal(report, "language_unknown")} / {total}</strong></div>
        <div className="funnel-detail-row"><span>No known upload pair</span><strong>{audienceTotal(report, "pair_unknown")} / {total}</strong></div>
        <div className="funnel-detail-row"><span>Retained batch sample, including unknown lookup</span><strong>{audienceTotal(report, "sampled")} / {total}</strong></div>
        <div className="funnel-detail-row"><span>Multiple known countries</span><strong>{audienceTotal(report, "multi_country")}</strong></div>
        <div className="funnel-detail-row"><span>Multiple known UI languages</span><strong>{audienceTotal(report, "multi_language")}</strong></div>
        <div className="funnel-detail-row"><span>At least one event with missing UI locale</span><strong>{audienceTotal(report, "missing_language_events")}</strong></div>
        <p>Each table uses the same distinct-user denominator. Buckets overlap: do not sum them. Unknown means no known value for that dimension; users with both known and missing event language appear in the missing-locale diagnostic too.</p>
      </section>
    </div>
    <p className="funnel-disclosure">Sample coverage is a conservative lower bound. Only retained first/latest sample endpoints with a matching accepted event batch count; intermediate samples, empty or duplicate batches, and unsampled gaps cannot be reconstructed. Known counts for past ranges can shrink as endpoints advance or expire. Both event date and upload sample must be inside the selected range for country and pairs. Detailed country cutoff: {retainedSince}. Generated: {report.generatedAtUtc}.</p>
  </>;
}

export function AudienceSection(props: Readonly<{
  config: AdminAppConfig;
  /** The live selection, so this section answers a filter click even when a General report failed. */
  filters: AnalyticsFilterState;
  /** A General reload is pending or in flight; this section waits it out rather than querying per click. */
  isRangeLoading: boolean;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) return () => { cancelled = true; };
    void loadAudienceReport(props.config, props.filters).then((report) => {
      if (!cancelled) setLoadState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "Unexpected Audience query error." });
    });
    return () => { cancelled = true; };
  }, [props.config, props.filters, props.isRangeLoading, props.onTerminalAdminError, revision]);

  return <section className="dashboard-section" data-testid="audience-section">
    <header className="dashboard-section-header">
      <p className="eyebrow">Audience report</p><h2>Countries and UI languages</h2>
      <p className="dashboard-section-description">Distinct resolved users, including linked guests: everyone with at least one app open inside the selected range. Active admins, example.com test accounts and the actors on the analytics exclusion list are excluded.</p>
    </header>
    <div className="funnel-filter-panel">
      <span>{props.filters.dateRange.from} to {props.filters.dateRange.to}, inclusive</span>
    </div>
    <p className="funnel-disclosure">Every filter in the shared bar applies here, including the per-user event thresholds. New means activity on that person’s first recorded app-open day. A user may qualify as both new and returning during a range. Language describes that cohort’s events across selected platforms in the range, not only its app opens. Older clients and old queued events can have unknown UI language.</p>
    {props.isRangeLoading || loadState.status === "loading" ? <p className="report-state" aria-live="polite">Loading Audience…</p> : null}
    {!props.isRangeLoading && loadState.status === "error" ? <div className="report-state report-state-error">
      <strong>Audience query failed.</strong><span>{loadState.message}</span>
      <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
    </div> : null}
    {!props.isRangeLoading && loadState.status === "ready" ? <AudienceResults report={loadState.report} from={props.filters.dateRange.from} /> : null}
  </section>;
}

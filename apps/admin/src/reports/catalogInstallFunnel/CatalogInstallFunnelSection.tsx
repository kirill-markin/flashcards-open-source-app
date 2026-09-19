import { useEffect, useMemo, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  catalogInstallConversionWindowDays,
  loadCatalogInstallFunnelReport,
  type CatalogInstallFailureBucket,
  type CatalogInstallFunnelAttempt,
  type CatalogInstallFunnelReport,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: CatalogInstallFunnelReport }>;

type FunnelStage = Readonly<{ label: string; count: number }>;
type FailureTotal = CatalogInstallFailureBucket & Readonly<{ count: number }>;

/** One identity for every render without a report, so the derived counts below are memoized once. */
const noAttempts: ReadonlyArray<CatalogInstallFunnelAttempt> = [];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected catalog installation funnel error.";
}

function formatPercentage(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "—";
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }

  if (seconds < 60) {
    return `${Math.round(seconds)} sec`;
  }

  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} min`;
  }

  return `${(seconds / 3600).toFixed(1)} hr`;
}

function getMedianInstallSeconds(attempts: ReadonlyArray<CatalogInstallFunnelAttempt>): number | null {
  const values = attempts
    .filter((attempt) => attempt.installedAt !== null)
    .map((attempt) => (
      (new Date(attempt.installedAt ?? attempt.clickedAt).getTime() - new Date(attempt.clickedAt).getTime()) / 1000
    ))
    .sort((left, right) => left - right);
  if (values.length === 0) {
    return null;
  }

  const middleIndex = Math.floor(values.length / 2);
  const middle = values[middleIndex];
  if (middle === undefined) {
    return null;
  }

  if (values.length % 2 === 1) {
    return middle;
  }

  return ((values[middleIndex - 1] ?? middle) + middle) / 2;
}

function buildMainStages(attempts: ReadonlyArray<CatalogInstallFunnelAttempt>): ReadonlyArray<FunnelStage> {
  return [
    { label: "Clicked", count: attempts.length },
    { label: "Landed", count: attempts.filter((attempt) => attempt.landedAt !== null).length },
    { label: "Preview ready", count: attempts.filter((attempt) => attempt.previewReadyAt !== null).length },
    { label: "Install started", count: attempts.filter((attempt) => attempt.installStartedAt !== null).length },
    { label: "Installed (server)", count: attempts.filter((attempt) => attempt.installedAt !== null).length },
  ];
}

function buildAuthStages(attempts: ReadonlyArray<CatalogInstallFunnelAttempt>): ReadonlyArray<FunnelStage> {
  return [
    { label: "Signed-out landed", count: attempts.filter((attempt) => attempt.signedOutLandedAt !== null).length },
    { label: "Sign-in started", count: attempts.filter((attempt) => attempt.signInStartedAt !== null).length },
    { label: "Code requested", count: attempts.filter((attempt) => attempt.codeRequestedAt !== null).length },
    { label: "Sign-in succeeded", count: attempts.filter((attempt) => attempt.signInSucceededAt !== null).length },
    { label: "Preview after sign-in", count: attempts.filter((attempt) => attempt.signedOutPreviewReadyAt !== null).length },
  ];
}

function buildFailureTotals(attempts: ReadonlyArray<CatalogInstallFunnelAttempt>): ReadonlyArray<FailureTotal> {
  const totals = new Map<string, FailureTotal>();
  for (const attempt of attempts) {
    for (const bucket of attempt.failureBuckets) {
      const key = `${bucket.stage}:${bucket.reason}`;
      totals.set(key, { ...bucket, count: (totals.get(key)?.count ?? 0) + 1 });
    }
  }

  return Array.from(totals.values()).sort((left, right) => (
    right.count - left.count
    || left.stage.localeCompare(right.stage)
    || left.reason.localeCompare(right.reason)
  ));
}

function FunnelGraphic(props: Readonly<{ stages: ReadonlyArray<FunnelStage> }>): JSX.Element {
  const denominator = props.stages[0]?.count ?? 0;
  const description = props.stages.map((stage) => `${stage.label}: ${stage.count}`).join(", ");

  return (
    <svg className="funnel-graphic" viewBox="0 0 100 190" role="img" aria-label={description}>
      {props.stages.map((stage, index) => {
        const width = denominator === 0 ? 0 : (stage.count / denominator) * 100;
        return (
          <rect
            key={stage.label}
            x={(100 - width) / 2}
            y={index * 38}
            width={width}
            height="30"
            rx="3"
            className={`funnel-stage-shape funnel-stage-shape-${index + 1}`}
          />
        );
      })}
    </svg>
  );
}

function FunnelStageTable(props: Readonly<{ stages: ReadonlyArray<FunnelStage> }>): JSX.Element {
  const denominator = props.stages[0]?.count ?? 0;
  return (
    <div className="funnel-stage-table" role="table" aria-label="Main funnel conversions">
      <div className="funnel-stage-row funnel-stage-heading" role="row">
        <span role="columnheader">Stage</span><span role="columnheader">Attempts</span>
        <span role="columnheader">From prior</span><span role="columnheader">Overall</span>
      </div>
      {props.stages.map((stage, index) => (
        <div className="funnel-stage-row" role="row" key={stage.label}>
          <strong role="cell">{stage.label}</strong>
          <span role="cell">{stage.count.toLocaleString("en-US")}</span>
          <span role="cell">{index === 0 ? "100%" : formatPercentage(stage.count, props.stages[index - 1]?.count ?? 0)}</span>
          <span role="cell">{formatPercentage(stage.count, denominator)}</span>
        </div>
      ))}
    </div>
  );
}

export function CatalogInstallFunnelSection(
  props: Readonly<{
    config: AdminAppConfig;
    /** The live selection of the shared bar; every field it offers here is applied in SQL. */
    filters: AnalyticsFilterState;
    /** A General reload is pending or in flight; this section waits it out rather than querying per click. */
    isRangeLoading: boolean;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    void loadCatalogInstallFunnelReport(props.config, props.filters)
      .then((report) => {
        if (cancelled === false) {
          setLoadState({ status: "ready", report });
        }
      })
      .catch((error: unknown) => {
        if (cancelled || props.onTerminalAdminError(error, props.config)) {
          return;
        }

        setLoadState({ status: "error", message: getErrorMessage(error) });
      });

    return () => { cancelled = true; };
  }, [loadRevision, props.config, props.filters, props.isRangeLoading, props.onTerminalAdminError]);

  const report = loadState.status === "ready" ? loadState.report : null;
  const attempts = report === null ? noAttempts : report.attempts;
  const mainStages = useMemo(() => buildMainStages(attempts), [attempts]);
  const authStages = useMemo(() => buildAuthStages(attempts), [attempts]);
  const failureTotals = useMemo(() => buildFailureTotals(attempts), [attempts]);

  const installedCount = mainStages.at(-1)?.count ?? 0;
  const directClickCount = attempts.filter((attempt) => attempt.source === "direct").length;
  const bypassCount = attempts.filter((attempt) => (
    attempt.signInSucceededAt !== null
    && (attempt.codeRequestedAt === null
      || new Date(attempt.codeRequestedAt).getTime() > new Date(attempt.signInSucceededAt).getTime())
  )).length;
  const maturingCount = report === null ? 0 : attempts.filter((attempt) => (
    new Date(attempt.clickedAt).getTime() + catalogInstallConversionWindowDays * 86_400_000
      > new Date(report.generatedAtUtc).getTime()
  )).length;
  const missingClickCount = report === null ? 0 : report.missingClickCounts
    .reduce((total, row) => total + row.attemptCount, 0);

  return (
    <section className="dashboard-section funnel-report">
      <header className="dashboard-section-header">
        <p className="eyebrow">Funnel report</p>
        <h2>Catalog installation</h2>
        <p className="dashboard-section-description">
          Distinct install journey attempts cohort on an actual <code>catalog_install_clicked</code> event in the selected UTC dates. Later milestones must keep the same package version, occur in order, and arrive within seven days. Only server-origin <code>catalog_deck_installed</code> is success.
        </p>
      </header>

      <div className="funnel-filter-panel">
        <span>{props.filters.dateRange.from} to {props.filters.dateRange.to}, inclusive</span>
      </div>

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading catalog installation funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {props.isRangeLoading === false && loadState.status === "ready" && attempts.length === 0 ? <div className="report-state"><strong>No catalog click attempts match these filters.</strong><span>No earlier traffic history is inferred from Vercel aggregates.</span></div> : null}

      {props.isRangeLoading === false && loadState.status === "ready" && attempts.length > 0 ? (
        <>
          <section className="summary-grid">
            <article className="metric-card"><p className="metric-label">Click attempts</p><p className="metric-value">{attempts.length.toLocaleString("en-US")}</p></article>
            <article className="metric-card"><p className="metric-label">Server installs</p><p className="metric-value">{installedCount.toLocaleString("en-US")}</p></article>
            <article className="metric-card"><p className="metric-label">Overall conversion</p><p className="metric-value">{formatPercentage(installedCount, attempts.length)}</p></article>
            <article className="metric-card"><p className="metric-label">Median click to install</p><p className="metric-value">{formatDuration(getMedianInstallSeconds(attempts))}</p></article>
          </section>
          <div className="funnel-main-panel"><FunnelGraphic stages={mainStages} /><FunnelStageTable stages={mainStages} /></div>
        </>
      ) : null}

      {props.isRangeLoading === false && loadState.status === "ready" ? (
        <div className="funnel-detail-grid">
          <section className="funnel-detail-card">
            <h3>Signed-out authentication branch</h3>
            <p>Denominator: signed-out landings. Sign-in success may bypass code request or even sign-in start after a resumed session, so this branch is not treated as a strictly descending funnel.</p>
            {authStages.map((stage) => <div className="funnel-detail-row" key={stage.label}><span>{stage.label}</span><strong>{stage.count.toLocaleString("en-US")} · {formatPercentage(stage.count, authStages[0]?.count ?? 0)}</strong></div>)}
            <div className="funnel-detail-row"><span>Success without earlier code request</span><strong>{bypassCount.toLocaleString("en-US")}</strong></div>
          </section>
          <section className="funnel-detail-card">
            <h3>Diagnostics</h3>
            <div className="funnel-detail-row"><span>Direct-source click attempts (inside denominator)</span><strong>{directClickCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>Landings without a selected-range prior click (outside denominator)</span><strong>{missingClickCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>Attempts still inside 7-day window</span><strong>{maturingCount.toLocaleString("en-US")}</strong></div>
            <p>The no-click diagnostic can use only the date range, the installed deck and the client platform, because a landing with no click carries none of the click dimensions; narrowing placement, source, device category or browser language therefore leaves this line wider than the funnel above it. A still-maturing attempt is not a confirmed drop-off.</p>
          </section>
          <section className="funnel-detail-card">
            <h3>Observed failures</h3>
            {failureTotals.length === 0 ? <p>—</p> : failureTotals.map((total) => <div className="funnel-detail-row" key={`${total.stage}:${total.reason}`}><span>{total.stage} · {total.reason}</span><strong>{total.count.toLocaleString("en-US")}</strong></div>)}
            <p>Counts are distinct attempts per stage/reason; one attempt may appear in more than one bucket. Missing telemetry is not classified as abandonment.</p>
          </section>
        </div>
      ) : null}

      <p className="funnel-disclosure">Every field the shared bar offers here is applied in SQL, and each one reads the click attempt's own properties rather than a person: the five identity-derived fields are absent because a journey is keyed by an anonymous id whose first steps happen before sign-in. Test-deck journeys are excluded, and so is a journey that a server install or a signed-in install start links to an <code>@example.com</code> actor, an active admin or an actor on the analytics exclusion list. The <code>@example.com</code> and active-admin exclusions until now needed a completed server install, so these counts drop now that a signed-in install start names their actor too, before the exclusion list holds anybody. A journey that neither completed a server install nor started an install while signed in names nobody, so attempts that abandon before both cannot always be classified or excluded.</p>
    </section>
  );
}

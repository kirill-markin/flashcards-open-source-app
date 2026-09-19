import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { ReportRangePresetRow } from "../ReportRangePresetRow";
import { buildDefaultReportRange } from "../reportValues";
import {
  catalogInstallConversionWindowDays,
  catalogInstallDeviceCategories,
  catalogInstallFunnelReportLabel,
  catalogInstallPlacements,
  catalogInstallSources,
  filterCatalogInstallFunnelAttempts,
  loadCatalogInstallFunnelAvailableRange,
  loadCatalogInstallFunnelReport,
  validateCatalogInstallFunnelRange,
  type CatalogInstallFailureBucket,
  type CatalogInstallFunnelAttempt,
  type CatalogInstallFunnelFilters,
  type CatalogInstallFunnelRange,
  type CatalogInstallFunnelReport,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: CatalogInstallFunnelReport }>;

type FilterOption = Readonly<{ value: string; label: string }>;
type FunnelStage = Readonly<{ label: string; count: number }>;
type FailureTotal = CatalogInstallFailureBucket & Readonly<{ count: number }>;

const emptyFilters: CatalogInstallFunnelFilters = {
  packageVersionId: "",
  placement: "",
  source: "",
  deviceCategory: "",
  deviceLocale: "",
};

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

function insertSortedByLabel(
  options: ReadonlyArray<FilterOption>,
  option: FilterOption,
): ReadonlyArray<FilterOption> {
  const index = options.findIndex((existing) => existing.label.localeCompare(option.label) > 0);
  return index === -1
    ? [...options, option]
    : [...options.slice(0, index), option, ...options.slice(index)];
}

function FilterSelect(
  props: Readonly<{
    label: string;
    value: string;
    valueLabel?: string;
    options: ReadonlyArray<FilterOption>;
    onChange: (value: string, valueLabel: string) => void;
  }>,
): JSX.Element {
  // A preset keeps the sub-filters while reloading the report, so a selected value can outlive its option
  // list. Keep it listed, under the label the user picked it by and in its sorted place, instead of
  // rendering a blank select with an unexplained empty funnel or a bare identifier.
  const options = props.value !== "" && props.options.some((option) => option.value === props.value) === false
    ? insertSortedByLabel(props.options, { value: props.value, label: props.valueLabel ?? props.value })
    : props.options;

  return (
    <label className="funnel-filter-field">
      <span>{props.label}</span>
      <select
        value={props.value}
        onChange={(event) => props.onChange(
          event.target.value,
          options.find((option) => option.value === event.target.value)?.label ?? "",
        )}
      >
        <option value="">All</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function CatalogInstallFunnelSection(
  props: Readonly<{
    config: AdminAppConfig;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  const [availableRange, setAvailableRange] = useState<CatalogInstallFunnelRange | null>(null);
  const [defaultRange, setDefaultRange] = useState<CatalogInstallFunnelRange | null>(null);
  const [draftRange, setDraftRange] = useState<CatalogInstallFunnelRange | null>(null);
  const [appliedRange, setAppliedRange] = useState<CatalogInstallFunnelRange | null>(null);
  const [filters, setFilters] = useState<CatalogInstallFunnelFilters>(emptyFilters);
  // The label of the selected deck, so a preset reload can keep showing it while `packageOptions` is empty.
  const [packageVersionLabel, setPackageVersionLabel] = useState<string>("");
  const [rangeLoadRevision, setRangeLoadRevision] = useState<number>(0);
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [rangeError, setRangeError] = useState<string>("");
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    setAvailableRange(null);
    setDefaultRange(null);
    setDraftRange(null);
    setAppliedRange(null);
    void loadCatalogInstallFunnelAvailableRange(props.config)
      .then((loadedAvailableRange) => {
        if (cancelled) {
          return;
        }

        const loadedDefaultRange = buildDefaultReportRange(
          loadedAvailableRange,
          catalogInstallFunnelReportLabel,
        );
        setAvailableRange(loadedAvailableRange);
        setDefaultRange(loadedDefaultRange);
        setDraftRange(loadedDefaultRange);
        setAppliedRange(loadedDefaultRange);
      })
      .catch((error: unknown) => {
        if (props.onTerminalAdminError(error, props.config)) {
          return;
        }

        if (cancelled === false) {
          setLoadState({ status: "error", message: getErrorMessage(error) });
        }
      });

    return () => { cancelled = true; };
  }, [props.config, props.onTerminalAdminError, rangeLoadRevision]);

  useEffect(() => {
    if (appliedRange === null) {
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadCatalogInstallFunnelReport(props.config, appliedRange.from, appliedRange.to)
      .then((report) => {
        if (cancelled === false) {
          setLoadState({ status: "ready", report });
        }
      })
      .catch((error: unknown) => {
        if (props.onTerminalAdminError(error, props.config)) {
          return;
        }

        if (cancelled === false) {
          setLoadState({ status: "error", message: getErrorMessage(error) });
        }
      });

    return () => { cancelled = true; };
  }, [appliedRange, loadRevision, props.config, props.onTerminalAdminError]);

  const report = loadState.status === "ready" ? loadState.report : null;
  const filteredAttempts = useMemo(
    () => report === null ? [] : filterCatalogInstallFunnelAttempts(report.attempts, filters),
    [filters, report],
  );
  const mainStages = useMemo(() => buildMainStages(filteredAttempts), [filteredAttempts]);
  const authStages = useMemo(() => buildAuthStages(filteredAttempts), [filteredAttempts]);
  const failureTotals = useMemo(() => buildFailureTotals(filteredAttempts), [filteredAttempts]);
  const packageOptions = useMemo(() => {
    if (report === null) {
      return [];
    }

    const slugsByVersion = new Map<string, string>();
    for (const attempt of report.attempts) {
      if (attempt.packageSlug !== null) {
        slugsByVersion.set(attempt.packageVersionId, attempt.packageSlug);
      } else if (slugsByVersion.has(attempt.packageVersionId) === false) {
        slugsByVersion.set(attempt.packageVersionId, "Unknown deck");
      }
    }

    return Array.from(slugsByVersion.entries())
      .map(([value, slug]) => ({ value, label: `${slug} — ${value}` }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [report]);
  const localeOptions = useMemo(() => report === null ? [] : Array.from(
    new Set(report.attempts.map((attempt) => attempt.deviceLocale)),
  ).sort().map((value) => ({ value, label: value })), [report]);

  function applyRange(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (draftRange === null || availableRange === null) {
      return;
    }

    const validationError = validateCatalogInstallFunnelRange(draftRange, availableRange);
    if (validationError !== null) {
      setRangeError(validationError);
      return;
    }

    setRangeError("");
    setFilters(emptyFilters);
    setPackageVersionLabel("");
    setAppliedRange(draftRange);
  }

  // A preset is always inside the available range, so it applies straight away, and it moves only the
  // dates: the deck, placement, locale, source and device filters stay exactly as the user left them.
  function applyPresetRange(range: CatalogInstallFunnelRange): void {
    setRangeError("");
    setDraftRange(range);
    setAppliedRange(range);
  }

  function selectPackageVersion(packageVersionId: string, selectedLabel: string): void {
    setFilters({ ...filters, packageVersionId });
    setPackageVersionLabel(packageVersionId === "" ? "" : selectedLabel);
  }

  function resetAll(): void {
    if (defaultRange === null) {
      return;
    }

    setDraftRange(defaultRange);
    setAppliedRange(defaultRange);
    setFilters(emptyFilters);
    setPackageVersionLabel("");
    setRangeError("");
    setLoadRevision((revision) => revision + 1);
  }

  const installedCount = mainStages.at(-1)?.count ?? 0;
  const directClickCount = filteredAttempts.filter((attempt) => attempt.source === "direct").length;
  const bypassCount = filteredAttempts.filter((attempt) => (
    attempt.signInSucceededAt !== null
    && (attempt.codeRequestedAt === null
      || new Date(attempt.codeRequestedAt).getTime() > new Date(attempt.signInSucceededAt).getTime())
  )).length;
  const maturingCount = report === null ? 0 : filteredAttempts.filter((attempt) => (
    new Date(attempt.clickedAt).getTime() + catalogInstallConversionWindowDays * 86_400_000
      > new Date(report.generatedAtUtc).getTime()
  )).length;
  const missingClickCount = report === null ? 0 : report.missingClickCounts
    .filter((row) => filters.packageVersionId === "" || row.packageVersionId === filters.packageVersionId)
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

      {draftRange !== null && availableRange !== null ? <form className="funnel-filter-panel" onSubmit={applyRange}>
        <ReportRangePresetRow availableRange={availableRange} isDisabled={false} onPresetSelect={applyPresetRange} />
        <label className="funnel-filter-field"><span>From (UTC)</span><input type="date" min={availableRange.from} max={availableRange.to} value={draftRange.from} onChange={(event) => setDraftRange({ ...draftRange, from: event.target.value })} /></label>
        <label className="funnel-filter-field"><span>To (UTC)</span><input type="date" min={availableRange.from} max={availableRange.to} value={draftRange.to} onChange={(event) => setDraftRange({ ...draftRange, to: event.target.value })} /></label>
        <FilterSelect label="Deck / version" value={filters.packageVersionId} valueLabel={packageVersionLabel} options={packageOptions} onChange={selectPackageVersion} />
        <FilterSelect label="Placement" value={filters.placement} options={catalogInstallPlacements.map((value) => ({ value, label: value }))} onChange={(placement) => setFilters({ ...filters, placement })} />
        <FilterSelect label="Locale" value={filters.deviceLocale} options={localeOptions} onChange={(deviceLocale) => setFilters({ ...filters, deviceLocale })} />
        <FilterSelect label="Source" value={filters.source} options={catalogInstallSources.map((value) => ({ value, label: value }))} onChange={(source) => setFilters({ ...filters, source })} />
        <FilterSelect label="Device" value={filters.deviceCategory} options={catalogInstallDeviceCategories.map((value) => ({ value, label: value }))} onChange={(deviceCategory) => setFilters({ ...filters, deviceCategory })} />
        <div className="funnel-filter-actions"><button className="filter-button filter-button-primary" type="submit">Apply dates</button><button className="filter-button" type="button" onClick={resetAll}>Reset</button></div>
        {rangeError !== "" ? <p className="filter-error funnel-filter-error">{rangeError}</p> : null}
      </form> : null}

      {loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading catalog installation funnel…</div> : null}
      {loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => availableRange === null ? setRangeLoadRevision((revision) => revision + 1) : setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {loadState.status === "ready" && filteredAttempts.length === 0 ? <div className="report-state"><strong>No catalog click attempts match these filters.</strong><span>No earlier traffic history is inferred from Vercel aggregates.</span></div> : null}

      {loadState.status === "ready" && filteredAttempts.length > 0 ? (
        <>
          <section className="summary-grid">
            <article className="metric-card"><p className="metric-label">Click attempts</p><p className="metric-value">{filteredAttempts.length.toLocaleString("en-US")}</p></article>
            <article className="metric-card"><p className="metric-label">Server installs</p><p className="metric-value">{installedCount.toLocaleString("en-US")}</p></article>
            <article className="metric-card"><p className="metric-label">Overall conversion</p><p className="metric-value">{formatPercentage(installedCount, filteredAttempts.length)}</p></article>
            <article className="metric-card"><p className="metric-label">Median click to install</p><p className="metric-value">{formatDuration(getMedianInstallSeconds(filteredAttempts))}</p></article>
          </section>
          <div className="funnel-main-panel"><FunnelGraphic stages={mainStages} /><FunnelStageTable stages={mainStages} /></div>
        </>
      ) : null}

      {loadState.status === "ready" ? (
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
            <p>The no-click diagnostic can use only the date and deck/version filter because click attribution is absent. A still-maturing attempt is not a confirmed drop-off.</p>
          </section>
          <section className="funnel-detail-card">
            <h3>Observed failures</h3>
            {failureTotals.length === 0 ? <p>—</p> : failureTotals.map((total) => <div className="funnel-detail-row" key={`${total.stage}:${total.reason}`}><span>{total.stage} · {total.reason}</span><strong>{total.count.toLocaleString("en-US")}</strong></div>)}
            <p>Counts are distinct attempts per stage/reason; one attempt may appear in more than one bucket. Missing telemetry is not classified as abandonment.</p>
          </section>
        </div>
      ) : null}

      <p className="funnel-disclosure">General filters never apply here. Test-deck journeys and journeys linked by a server install to an <code>@example.com</code> or active-admin actor are excluded. Public collector rows carry no user identity, so anonymous attempts that never reach a server install cannot always be classified or excluded.</p>
    </section>
  );
}

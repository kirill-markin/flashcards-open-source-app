import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import { FunnelGroupByPicker } from "../funnels/FunnelGroupByPicker";
import {
  buildFunnelGroupLabel,
  foldFunnelGroups,
  parseFunnelGroupByDimension,
  writeFunnelGroupByToUrl,
  type FunnelGroup,
  type FunnelGroupByDimension,
} from "../funnels/funnelGroupBy";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import { FunnelStepsChart, type FunnelStage } from "../funnels/FunnelStepsChart";
import {
  loadPaywallFunnelReport,
  paywallFunnelGroupByDimensions,
  paywallFunnelStartDate,
  type PaywallFunnelCounts,
  type PaywallFunnelGroup,
  type PaywallFunnelReport,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  /** The report and the dimension it was loaded with, which are only meaningful together. */
  | Readonly<{
    status: "ready";
    report: PaywallFunnelReport;
    dimension: FunnelGroupByDimension | null;
  }>;

/** The three funnel steps in chart order; `buildStages` takes its order from this list. */
const funnelStepIds = ["paywall-shown", "purchase-started", "converted"] as const;

type FunnelStepId = (typeof funnelStepIds)[number];

export const paywallFunnelAnchor: FunnelAnchor<FunnelStepId> = {
  funnelId: "paywall",
  stepIds: funnelStepIds,
};

export const paywallFunnelTitle = "Paywall to purchase";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected paywall funnel error.";
}

/** The short note shown when the selected range starts before `paywallFunnelStartDate`, or `null`. */
function buildStartDateNote(dateRange: AnalyticsFilterState["dateRange"]): string | null {
  if (dateRange.to < paywallFunnelStartDate) {
    return `Paywall entries count from ${paywallFunnelStartDate}, the first day the paywall events could be reported, so the selected range has no data.`;
  }

  return dateRange.from < paywallFunnelStartDate
    ? `Paywall entries count from ${paywallFunnelStartDate}, the first day the paywall events could be reported, so there is no data before that day.`
    : null;
}

/** The three steps of one group. There are no cookieless people here, so every `hashedCount` is zero. */
function buildStages(counts: PaywallFunnelCounts): ReadonlyArray<FunnelStage<FunnelStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelStepIds`.
  const stages: Readonly<
    Record<FunnelStepId, Readonly<{ label: string; count: number; hashedCount: number }>>
  > = {
    "paywall-shown": { label: "Paywall shown", count: counts.paywallShownCount, hashedCount: 0 },
    "purchase-started": { label: "Purchase started", count: counts.purchaseStartedCount, hashedCount: 0 },
    converted: { label: "Trial or purchase", count: counts.convertedCount, hashedCount: 0 },
  };

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

/** The funnel as a whole: the groups partition the cohort, so every funnel-wide figure is their sum. */
function sumFunnelGroups(groups: ReadonlyArray<PaywallFunnelGroup>): PaywallFunnelCounts {
  return groups.reduce<PaywallFunnelCounts>((totals, group) => ({
    paywallShownCount: totals.paywallShownCount + group.paywallShownCount,
    purchaseStartedCount: totals.purchaseStartedCount + group.purchaseStartedCount,
    convertedCount: totals.convertedCount + group.convertedCount,
    maturingCount: totals.maturingCount + group.maturingCount,
  }), {
    paywallShownCount: 0,
    purchaseStartedCount: 0,
    convertedCount: 0,
    maturingCount: 0,
  });
}

export function PaywallFunnelSection(props: FunnelSectionProps): JSX.Element {
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });
  const [groupByDimension, setGroupByDimension] = useState<FunnelGroupByDimension | null>(
    () => parseFunnelGroupByDimension(
      new URLSearchParams(window.location.search),
      paywallFunnelAnchor.funnelId,
      paywallFunnelGroupByDimensions,
    ),
  );

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    void loadPaywallFunnelReport(props.config, props.filters, groupByDimension)
      .then((report) => {
        if (cancelled === false) {
          setLoadState({ status: "ready", report, dimension: groupByDimension });
        }
      })
      .catch((error: unknown) => {
        if (cancelled || props.onTerminalAdminError(error, props.config)) {
          return;
        }

        setLoadState({ status: "error", message: getErrorMessage(error) });
      });

    return () => { cancelled = true; };
  }, [
    groupByDimension,
    loadRevision,
    props.config,
    props.filters,
    props.isRangeLoading,
    props.onTerminalAdminError,
  ]);

  const selectGroupByDimension = useCallback((dimension: FunnelGroupByDimension | null): void => {
    setGroupByDimension(dimension);
    writeFunnelGroupByToUrl(paywallFunnelAnchor.funnelId, dimension?.id ?? null);
  }, []);

  const readyState = props.isRangeLoading === false && loadState.status === "ready" ? loadState : null;
  const report = readyState === null ? null : readyState.report;
  const totals = useMemo(
    () => (report === null ? null : sumFunnelGroups(report.groups)),
    [report],
  );
  const stages = useMemo(() => (totals === null ? [] : buildStages(totals)), [totals]);
  // The loaded dimension rather than the selected one decides whether there are groups to draw, for
  // the reason `MobileFirstLaunchFunnelSection` gives: for one render after a pick the report in hand
  // is still the previous dimension's.
  const groups = useMemo<ReadonlyArray<FunnelGroup<FunnelStepId>> | null>(() => {
    const loadedDimension = readyState === null ? null : readyState.dimension;
    if (readyState === null || loadedDimension === null || loadedDimension !== groupByDimension) {
      return null;
    }

    return foldFunnelGroups(loadedDimension, readyState.report.groups.map((group) => ({
      key: group.key,
      label: buildFunnelGroupLabel(loadedDimension, group.key),
      stages: buildStages(group),
    })));
  }, [groupByDimension, readyState]);
  const startDateNote = report === null ? null : buildStartDateNote(props.filters.dateRange);
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);

  return (
    <section className="dashboard-section funnel-report">
      <header className="dashboard-section-header">
        <p className="eyebrow">Funnel report</p>
        <h2>{paywallFunnelTitle}</h2>
      </header>

      {props.filterRow}

      {/* Outside every state gate below, so a grouping stays clearable while loading and when empty. */}
      <div className="funnel-group-by-row">
        <FunnelGroupByPicker
          funnelId={paywallFunnelAnchor.funnelId}
          dimensions={paywallFunnelGroupByDimensions}
          selectedDimensionId={groupByDimension === null ? null : groupByDimension.id}
          isReportLoading={props.isRangeLoading || loadState.status === "loading"}
          onSelect={selectGroupByDimension}
        />
      </div>

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading paywall funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {totals !== null && totals.paywallShownCount === 0 ? <div className="report-state"><strong>No paywall views match these filters.</strong><span>A person enters this funnel when a web, iOS or Android client reports the paywall reaching the screen on a selected day.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</div> : null}

      {totals !== null ? <FunnelMaturingWarning maturingCount={totals.maturingCount} entryCount={totals.paywallShownCount} /> : null}

      {totals !== null && totals.paywallShownCount > 0 ? (
        <FunnelStepsChart
          anchor={paywallFunnelAnchor}
          stages={stages}
          groups={groups ?? undefined}
          countLabel="People"
          tableCaption="Paywall funnel steps"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
        />
      ) : null}

      {totals !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Paywall entries still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one person, anchored at their first trusted <code>paywall_shown</code> in the selected UTC dates, counted only from {paywallFunnelStartDate}, the first day the paywall events could be reported. The later steps are that same person within seven days of it: a <code>purchase_started</code> at or after the paywall, then a <code>trial_started</code> or <code>purchase_completed</code> at or after that first start. <code>trial_started</code> and <code>purchase_completed</code> are the billing layer&rsquo;s own facts rather than what a client says the store answered, they carry no platform, and they count whichever of the person&rsquo;s devices the purchase was made on. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p>The date range, the client platform, the connection country and the app interface language are applied in SQL. The platform is the first paywall&rsquo;s, and one that carried none counts as unattributed; the country and language keep a person the way they do on General. An <code>@example.com</code> or <code>+test</code> account, an admin and an actor on the analytics exclusion list are excluded. <strong>Signed-in only</strong> keeps just the people who resolve to a real, non-guest account; <strong>All</strong> counts the same people as <strong>With anonymous ID</strong>, because there are no cookieless visitors on a paywall.</p>
          <p><strong>Group by</strong> splits those people by the platform or the entry point of their first paywall in range, so the groups sum back to the numbers above, and measures each group from its own first step. A first paywall that carried no value is kept in <strong>Unresolved</strong>.</p>
        </details>
      ) : null}
    </section>
  );
}

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
import { PaywallPresentations } from "./PaywallPresentations";
import {
  loadPaywallFunnelReport,
  paywallFirstPaymentWindowDays,
  paywallFunnelGroupByDimensions,
  paywallFunnelStartDate,
  type PaywallFunnelCounts,
  type PaywallFunnelGroup,
  type PaywallFunnelReport,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
    status: "ready";
    report: PaywallFunnelReport;
    dimension: FunnelGroupByDimension | null;
  }>;

const funnelStepIds = ["paywall-shown", "premium-clicked", "purchase-started", "converted"] as const;

type FunnelStepId = (typeof funnelStepIds)[number];

export const paywallFunnelAnchor: FunnelAnchor<FunnelStepId> = {
  funnelId: "paywall",
  stepIds: funnelStepIds,
};

export const paywallFunnelTitle = "Paywall to purchase";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected paywall funnel error.";
}

function buildStartDateNote(dateRange: AnalyticsFilterState["dateRange"]): string | null {
  if (dateRange.to < paywallFunnelStartDate) {
    return `Paywall entries count from ${paywallFunnelStartDate}, the first day the paywall events could be reported, so the selected range has no data.`;
  }

  return dateRange.from < paywallFunnelStartDate
    ? `Paywall entries count from ${paywallFunnelStartDate}, the first day the paywall events could be reported, so there is no data before that day.`
    : null;
}

function buildStages(counts: PaywallFunnelCounts): ReadonlyArray<FunnelStage<FunnelStepId>> {
  const stages: Readonly<
    Record<FunnelStepId, Readonly<{ label: string; count: number; hashedCount: number }>>
  > = {
    "paywall-shown": { label: "Paywall shown", count: counts.paywallShownCount, hashedCount: 0 },
    "premium-clicked": { label: "Premium clicked", count: counts.premiumCount, hashedCount: 0 },
    "purchase-started": { label: "Checkout requested", count: counts.purchaseStartedCount, hashedCount: 0 },
    converted: { label: "Server trial or first payment", count: counts.convertedCount, hashedCount: 0 },
  };

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

function sumFunnelGroups(groups: ReadonlyArray<PaywallFunnelGroup>): PaywallFunnelCounts {
  return groups.reduce<PaywallFunnelCounts>((totals, group) => ({
    paywallShownCount: totals.paywallShownCount + group.paywallShownCount,
    premiumCount: totals.premiumCount + group.premiumCount,
    purchaseStartedCount: totals.purchaseStartedCount + group.purchaseStartedCount,
    convertedCount: totals.convertedCount + group.convertedCount,
    trialCount: totals.trialCount + group.trialCount,
    paidCount: totals.paidCount + group.paidCount,
    freeCount: totals.freeCount + group.freeCount,
    dismissedCount: totals.dismissedCount + group.dismissedCount,
    unknownChoiceCount: totals.unknownChoiceCount + group.unknownChoiceCount,
    maturingCount: totals.maturingCount + group.maturingCount,
    firstPaymentPendingCount: totals.firstPaymentPendingCount + group.firstPaymentPendingCount,
  }), {
    paywallShownCount: 0,
    premiumCount: 0,
    purchaseStartedCount: 0,
    convertedCount: 0,
    trialCount: 0,
    paidCount: 0,
    freeCount: 0,
    dismissedCount: 0,
    unknownChoiceCount: 0,
    maturingCount: 0,
    firstPaymentPendingCount: 0,
  });
}

function FirstPaymentPendingWarning(
  props: Readonly<{ pendingCount: number; entryCount: number }>,
): JSX.Element | null {
  if (props.pendingCount === 0) {
    return null;
  }

  return (
    <p className="report-state report-state-warning" aria-live="polite">
      {props.pendingCount.toLocaleString("en-US")} of {props.entryCount.toLocaleString("en-US")} people entered less than {paywallFirstPaymentWindowDays} days ago; their first payments can still arrive.
    </p>
  );
}

const outcomeRows = [
  ["trialCount", "Server-confirmed trial"],
  ["paidCount", "Server-confirmed first payment"],
  ["freeCount", "Chose Free"],
  ["dismissedCount", "Dismissed"],
  ["unknownChoiceCount", "No observed choice / unknown"],
] as const;

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
      {totals !== null ? <FirstPaymentPendingWarning pendingCount={totals.firstPaymentPendingCount} entryCount={totals.paywallShownCount} /> : null}

      {totals !== null && totals.paywallShownCount > 0 ? (
        <>
          <FunnelStepsChart
            anchor={paywallFunnelAnchor}
            stages={stages}
            groups={groups ?? undefined}
            countLabel="People"
            tableCaption="Paywall funnel steps"
            dateRange={props.filters.dateRange}
            showsHashedSplit={false}
          />
          <div className="funnel-group-table-shell">
            <table className="funnel-group-table">
              <caption>Outcomes of the people shown a paywall in range — people</caption>
              <thead><tr><th scope="col">Observed outcome</th><th scope="col">People, out of {totals.paywallShownCount.toLocaleString("en-US")} shown</th></tr></thead>
              <tbody>
                {outcomeRows.map(([key, label]) => (
                  <tr key={key}><th scope="row">{label}</th><td>{totals[key].toLocaleString("en-US")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Trial and first payment are separate outcomes after checkout, and can overlap; payment does not require a trial. Free, dismissed and unknown are alternative observations, not steps toward purchase. Explicit choices can overlap after retries.</p>
        </>
      ) : null}

      {totals !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Paywall entries still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Paywall entries still inside {paywallFirstPaymentWindowDays}-day first-payment window</span><strong>{totals.firstPaymentPendingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one canonical actor, anchored at their first trusted paywall presentation in the selected UTC dates, counted only from {paywallFunnelStartDate}. Guest activity and the account it becomes resolve to the same person. Later steps can come from that first presentation or any later one of the same person; Premium and checkout must occur within seven days of the first. The Premium step requires an explicit <code>paywall_choice</code> with <code>outcome=premium</code>, and checkout a <code>purchase_started</code> after it on the same presentation. Each matches its impression by presentation UUID, actor and platform, plus the entry point when reported. Clients from before presentation UUIDs sent no UUID and no choice: their row matches the person&rsquo;s latest preceding impression without a UUID on the same platform, and their <code>purchase_started</code> also counts as the Premium tap, because every path to it began at the Premium button.</p>
          <p>Checkout requested means the client reported <code>purchase_started</code>; it does not prove a provider sheet appeared or the request succeeded. The final step requires a server <code>trial_started</code> or <code>purchase_completed</code> within fourteen days after that checkout, long enough for the seven-day free trial to reach its first payment. These are billing facts, not client purchase results. Trials and first payments are counted independently, with each person counted once in their union. The outcomes table uses the same people shown as its denominator.</p>
          <p>Billing attribution follows the presentation report&rsquo;s rule below, before filters. If the latest provider checkout is unlinked, its fact cannot credit this person. A server purchase never fills in a missing Premium click or checkout, so opted-out analytics can leave a known purchase outside the sequenced funnel. An open seven-day window is not a confirmed drop-off, and neither is an open {paywallFirstPaymentWindowDays}-day first-payment window: seven days to checkout, then fourteen for billing. Delayed events can change past results.</p>
          <p>The date range, the client platform, the connection country and the app interface language are applied in SQL. The platform is the first paywall&rsquo;s, and one that carried none counts as unattributed; the country and language keep a person the way they do on General. An <code>@example.com</code> or <code>+test</code> account, an admin and an actor on the analytics exclusion list are excluded. <strong>Signed-in only</strong> keeps just the people who resolve to a real, non-guest account; <strong>All</strong> counts the same people as <strong>With anonymous ID</strong>, because there are no cookieless visitors on a paywall.</p>
          <p><strong>Group by</strong> splits those people by the platform or the entry point of their first paywall in range, so the groups sum back to the numbers above, and measures each group from its own first step. A first paywall that carried no value is kept in <strong>Unresolved</strong>.</p>
        </details>
      ) : null}

      <PaywallPresentations {...props} />
    </section>
  );
}

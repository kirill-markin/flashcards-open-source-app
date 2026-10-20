import { useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
import { FunnelSectionHeader } from "../funnels/FunnelSectionHeader";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import {
  FunnelStepsChart,
  FunnelStepsEmptyChart,
  FunnelStepsLoadingChart,
  type FunnelStage,
} from "../funnels/FunnelStepsChart";
import {
  loadPaywallFunnelReport,
  paywallFirstPaymentWindowDays,
  paywallFunnelStartDate,
  type PaywallFunnelCounts,
  type PaywallFunnelGroup,
  type PaywallFunnelReport,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: PaywallFunnelReport }>;

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

export function PaywallFunnelSection(props: FunnelSectionProps): JSX.Element {
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    const abortController = new AbortController();
    void loadPaywallFunnelReport(props.config, props.filters, null, abortController.signal)
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

    return () => { cancelled = true; abortController.abort(); };
  }, [loadRevision, props.config, props.filters, props.isRangeLoading, props.onTerminalAdminError]);

  const report = props.isRangeLoading === false && loadState.status === "ready" ? loadState.report : null;
  const totals = useMemo(
    () => (report === null ? null : sumFunnelGroups(report.groups)),
    [report],
  );
  const stages = useMemo(() => (totals === null ? [] : buildStages(totals)), [totals]);
  const startDateNote = report === null ? null : buildStartDateNote(props.filters.dateRange);
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={paywallFunnelAnchor.funnelId} title={paywallFunnelTitle} />

      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}

      {totals !== null ? <FunnelMaturingWarning maturingCount={totals.maturingCount} entryCount={totals.paywallShownCount} /> : null}
      {totals !== null ? <FirstPaymentPendingWarning pendingCount={totals.firstPaymentPendingCount} entryCount={totals.paywallShownCount} /> : null}

      {props.isRangeLoading || loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={false}
          label="Loading paywall funnel…"
        />
      ) : null}
      {totals !== null && totals.paywallShownCount === 0 ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={false}
          note={<><strong>No paywall views match these filters.</strong><span>A person enters this funnel when a web, iOS or Android client reports the paywall reaching the screen on a selected day.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</>}
        />
      ) : null}

      {totals !== null && totals.paywallShownCount > 0 ? (
        <FunnelStepsChart
          anchor={paywallFunnelAnchor}
          stages={stages}
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
        />
      ) : null}

      {totals !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Paywall entries still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Paywall entries still inside {paywallFirstPaymentWindowDays}-day first-payment window</span><strong>{totals.firstPaymentPendingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one canonical actor, anchored at their first trusted paywall presentation in the selected UTC dates, counted only from {paywallFunnelStartDate}; guest activity and the account it becomes are one person. Later steps can come from that presentation or a later one of the same person: Premium needs an explicit <code>paywall_choice</code> with <code>outcome=premium</code> and checkout a <code>purchase_started</code> after it on the same presentation, both within seven days of the first presentation. A client from before presentation UUIDs sent no choice, so its <code>purchase_started</code> also counts as the Premium tap.</p>
          <p>Checkout requested means the client reported <code>purchase_started</code>, not that a provider sheet appeared. The final step is a server <code>trial_started</code> or <code>purchase_completed</code> within fourteen days after that checkout, long enough for the seven-day free trial to reach its first payment. Each billing fact credits the same actor&rsquo;s latest preceding checkout and nobody when that checkout is unlinked, and a server purchase never fills in a missing Premium click or checkout. An open seven-day window, or an open {paywallFirstPaymentWindowDays}-day first-payment window, is not a confirmed drop-off.</p>
          <p>The platform is the first paywall&rsquo;s, unattributed when it carried none; the country and language keep a person the way they do on General. Test accounts, admins and excluded actors are left out. <strong>Signed-in only</strong> keeps people who resolve to a real, non-guest account; <strong>All</strong> counts the same people as <strong>With anonymous ID</strong>, because there are no cookieless visitors on a paywall.</p>
        </details>
      ) : null}
    </section>
  );
}

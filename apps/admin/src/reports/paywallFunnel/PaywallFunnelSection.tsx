import { useMemo, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { buildFunnelAudienceEmptyStateNote, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import { FunnelEmptyRangeNotes } from "../funnels/FunnelEmptyRangeNotes";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
import {
  buildFunnelRangeGroups,
  formatFunnelRangeNote,
  useFunnelRangeReports,
} from "../funnels/funnelRangeReports";
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

function loadReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  signal: AbortSignal,
): Promise<PaywallFunnelReport> {
  return loadPaywallFunnelReport(config, filters, null, signal);
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
  props: Readonly<{ seriesLabel: string | null; pendingCount: number; entryCount: number }>,
): JSX.Element | null {
  if (props.pendingCount === 0) {
    return null;
  }

  return (
    <p className="report-state report-state-warning" aria-live="polite">
      {formatFunnelRangeNote(
        props.seriesLabel,
        `${props.pendingCount.toLocaleString("en-US")} of ${props.entryCount.toLocaleString("en-US")} people entered less than ${paywallFirstPaymentWindowDays} days ago; their first payments can still arrive.`,
      )}
    </p>
  );
}

export function PaywallFunnelSection(props: FunnelSectionProps): JSX.Element {
  const { state: loadState, retry } = useFunnelRangeReports(props, loadReport, getErrorMessage);
  const rangeViews = useMemo(
    () => (loadState.status === "ready" ? loadState.ranges : []).map((range) => {
      const totals = sumFunnelGroups(range.report.groups);
      return { ...range, totals, stages: buildStages(totals), hasEntries: totals.paywallShownCount > 0 };
    }),
    [loadState],
  );
  const groups = useMemo(() => buildFunnelRangeGroups(rangeViews), [rangeViews]);
  // A, whose figures the explainer shows.
  const primaryRange = rangeViews[0];
  const hasEntries = rangeViews.some((range) => range.hasEntries);
  const isComparing = props.filters.comparisonDateRange !== null;
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={paywallFunnelAnchor.funnelId} title={paywallFunnelTitle} />

      {loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={retry}>Retry</button></div> : null}
      {rangeViews.map((range) => {
        const startDateNote = buildStartDateNote(range.dateRange);
        return startDateNote === null ? null : <p key={range.key} className="report-state" aria-live="polite">{formatFunnelRangeNote(range.seriesLabel, startDateNote)}</p>;
      })}

      {rangeViews.map((range) => <FunnelMaturingWarning key={range.key} seriesLabel={range.seriesLabel} maturingCount={range.totals.maturingCount} entryCount={range.totals.paywallShownCount} />)}
      {rangeViews.map((range) => <FirstPaymentPendingWarning key={range.key} seriesLabel={range.seriesLabel} pendingCount={range.totals.firstPaymentPendingCount} entryCount={range.totals.paywallShownCount} />)}
      <FunnelEmptyRangeNotes ranges={rangeViews} />

      {loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={isComparing}
          label="Loading paywall funnel…"
        />
      ) : null}
      {loadState.status === "ready" && hasEntries === false ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={isComparing}
          note={<><strong>No paywall views match these filters.</strong><span>A person enters this funnel when a web, iOS or Android client reports the paywall reaching the screen on a selected day.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</>}
        />
      ) : null}

      {primaryRange !== undefined && hasEntries ? (
        <FunnelStepsChart
          anchor={paywallFunnelAnchor}
          stages={primaryRange.stages}
          groups={groups}
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
        />
      ) : null}

      {primaryRange !== undefined ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Paywall entries still inside 7-day window</span><strong>{primaryRange.totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Paywall entries still inside {paywallFirstPaymentWindowDays}-day first-payment window</span><strong>{primaryRange.totals.firstPaymentPendingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one canonical actor, anchored at their first trusted paywall presentation in the selected UTC dates, counted only from {paywallFunnelStartDate}; guest activity and the account it becomes are one person. Later steps can come from that presentation or a later one of the same person: Premium needs an explicit <code>paywall_choice</code> with <code>outcome=premium</code> and checkout a <code>purchase_started</code> after it on the same presentation, both within seven days of the first presentation. A client from before presentation UUIDs sent no choice, so its <code>purchase_started</code> also counts as the Premium tap.</p>
          <p>Checkout requested means the client reported <code>purchase_started</code>, not that a provider sheet appeared. The final step is a server <code>trial_started</code> or <code>purchase_completed</code> within fourteen days after that checkout, long enough for the seven-day free trial to reach its first payment. Each billing fact credits the same actor&rsquo;s latest preceding checkout and nobody when that checkout is unlinked, and a server purchase never fills in a missing Premium click or checkout. An open seven-day window, or an open {paywallFirstPaymentWindowDays}-day first-payment window, is not a confirmed drop-off.</p>
          <p>The platform is the first paywall&rsquo;s, unattributed when it carried none; the country and language keep a person the way they do on General. Test accounts, admins and excluded actors are left out. <strong>Signed-in only</strong> keeps people who resolve to a real, non-guest account; <strong>All</strong> counts the same people as <strong>With anonymous ID</strong>, because there are no cookieless visitors on a paywall.</p>
        </details>
      ) : null}
    </section>
  );
}

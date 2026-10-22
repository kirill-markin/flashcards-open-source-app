import { useMemo, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import {
  buildFunnelRangeGroups,
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
  buildFunnelEmptyRangeNote,
  buildFunnelMaturingNote,
  buildFunnelRangeWarnings,
} from "../funnels/funnelWarnings";
import {
  loadSignInFunnelReport,
  signInFunnelStartDate,
  type SignInFunnelCounts,
  type SignInFunnelGroup,
  type SignInFunnelReport,
} from "./query";

const funnelStepIds = ["method-selected", "session-accepted", "account-ready"] as const;
type FunnelStepId = (typeof funnelStepIds)[number];

export const signInFunnelAnchor: FunnelAnchor<FunnelStepId> = {
  funnelId: "signin",
  stepIds: funnelStepIds,
};

export const signInFunnelTitle = "Sign-in";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected sign-in funnel error.";
}

function loadReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  signal: AbortSignal,
): Promise<SignInFunnelReport> {
  return loadSignInFunnelReport(config, filters, null, signal);
}

function buildStages(counts: SignInFunnelCounts): ReadonlyArray<FunnelStage<FunnelStepId>> {
  const stages = {
    "method-selected": { label: "Method selected", count: counts.selectedCount },
    "session-accepted": { label: "Session accepted", count: counts.sessionAcceptedCount },
    "account-ready": { label: "Account / workspace ready", count: counts.accountReadyCount },
  } satisfies Record<FunnelStepId, Readonly<{ label: string; count: number }>>;

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

function sumFunnelGroups(groups: ReadonlyArray<SignInFunnelGroup>): SignInFunnelCounts {
  return groups.reduce<SignInFunnelCounts>((totals, group) => ({
    selectedCount: totals.selectedCount + group.selectedCount,
    sessionAcceptedCount: totals.sessionAcceptedCount + group.sessionAcceptedCount,
    accountReadyCount: totals.accountReadyCount + group.accountReadyCount,
    maturingCount: totals.maturingCount + group.maturingCount,
  }), { selectedCount: 0, sessionAcceptedCount: 0, accountReadyCount: 0, maturingCount: 0 });
}

export function SignInFunnelSection(props: FunnelSectionProps): JSX.Element {
  const { state: loadState, retry } = useFunnelRangeReports(props, loadReport, getErrorMessage);
  const rangeViews = useMemo(
    () => (loadState.status === "ready" ? loadState.ranges : []).map((range) => {
      const totals = sumFunnelGroups(range.report.groups);
      return { ...range, totals, stages: buildStages(totals), hasEntries: totals.selectedCount > 0 };
    }),
    [loadState],
  );
  const groups = useMemo(() => buildFunnelRangeGroups(rangeViews), [rangeViews]);
  const warnings = useMemo(() => rangeViews.flatMap((range) => buildFunnelRangeWarnings(range, {
    coverage: range.dateRange.from < signInFunnelStartDate
      ? `Selections before ${signInFunnelStartDate} are outside this report’s coverage.`
      : null,
    maturing: buildFunnelMaturingNote(range.totals.maturingCount, range.totals.selectedCount),
    empty: buildFunnelEmptyRangeNote(rangeViews, range),
  })), [rangeViews]);
  // A, whose figures the explainer shows.
  const primaryRange = rangeViews[0];
  const hasEntries = rangeViews.some((range) => range.hasEntries);
  const isComparing = props.filters.comparisonDateRange !== null;

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={signInFunnelAnchor.funnelId} title={signInFunnelTitle} warnings={warnings} onDetailsNavigate={props.onDetailsNavigate} />

      {loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={retry}>Retry</button></div> : null}

      {loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          isGrouped={isComparing}
          label="Loading sign-in funnel…"
        />
      ) : null}
      {loadState.status === "ready" && hasEntries === false ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          isGrouped={isComparing}
          note={<><strong>No observed sign-in method selections match these filters.</strong><span>Entry requires a recorded method choice on the ordinary sign-in screen and an anonymous, guest or account identifier.</span></>}
        />
      ) : null}

      {primaryRange !== undefined && hasEntries ? (
        <FunnelStepsChart
          anchor={signInFunnelAnchor}
          stages={primaryRange.stages}
          groups={groups}
          countLabel="People"
          dateRange={props.filters.dateRange}
        />
      ) : null}

      {primaryRange !== undefined ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Entries still inside 7-day window</span><strong>{primaryRange.totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>One person is one resolved analytics actor, including a visitor or guest who never registered. A person enters once at their first recorded <code>auth_method_selected</code> in the selected UTC dates, from {signInFunnelStartDate}, on the ordinary sign-in screen of web, iOS (including iPad and Mac) or Android; account-security linking and credential recovery are excluded.</p>
          <p>Each step counts that person at most once. Within seven days of entry, each method and platform has its own ordered <code>auth_method_selected</code> → <code>auth_session_accepted</code> → <code>auth_account_ready</code> path, and the funnel counts a person if any such path reaches the step; an email session and an Apple ready event cannot form one path. The platform filter reads the first selection in range.</p>
          <p>Unreported steps stay unobserved: older client versions, analytics consent and delivery gaps can hide a successful sign-in, and missing facts are never backfilled with inferred success. A person still inside the window is not a confirmed drop-off.</p>
          <p>The country and language use the shared person-level filters, and test accounts, admins, analytics exclusions and detected automation are left out.</p>
        </details>
      ) : null}
    </section>
  );
}

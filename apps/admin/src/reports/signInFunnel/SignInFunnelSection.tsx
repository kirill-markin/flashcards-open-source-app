import { useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote } from "../../filters/analyticsFilters";
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
  loadSignInFunnelReport,
  signInFunnelStartDate,
  type SignInFunnelCounts,
  type SignInFunnelGroup,
  type SignInFunnelReport,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: SignInFunnelReport }>;

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

function buildStages(counts: SignInFunnelCounts): ReadonlyArray<FunnelStage<FunnelStepId>> {
  const stages = {
    "method-selected": { label: "Method selected", count: counts.selectedCount, hashedCount: 0 },
    "session-accepted": { label: "Session accepted", count: counts.sessionAcceptedCount, hashedCount: 0 },
    "account-ready": { label: "Account / workspace ready", count: counts.accountReadyCount, hashedCount: 0 },
  } satisfies Record<FunnelStepId, Readonly<{ label: string; count: number; hashedCount: number }>>;

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
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    const abortController = new AbortController();
    void loadSignInFunnelReport(props.config, props.filters, null, abortController.signal)
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
  const totals = useMemo(() => (report === null ? null : sumFunnelGroups(report.groups)), [report]);
  const stages = useMemo(() => (totals === null ? [] : buildStages(totals)), [totals]);
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);

  return (
    <section className="dashboard-section funnel-report">
      <FunnelSectionHeader funnelId={signInFunnelAnchor.funnelId} title={signInFunnelTitle} />

      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {props.filters.dateRange.from < signInFunnelStartDate ? <p className="report-state">Selections before {signInFunnelStartDate} are outside this report&rsquo;s coverage.</p> : null}

      {totals !== null ? <FunnelMaturingWarning maturingCount={totals.maturingCount} entryCount={totals.selectedCount} /> : null}

      {props.isRangeLoading || loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={false}
          label="Loading sign-in funnel…"
        />
      ) : null}
      {totals !== null && totals.selectedCount === 0 ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={false}
          note={<><strong>No observed sign-in method selections match these filters.</strong><span>Entry requires a recorded method choice on the ordinary sign-in screen and an anonymous, guest or account identifier.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</>}
        />
      ) : null}

      {totals !== null && totals.selectedCount > 0 ? (
        <FunnelStepsChart
          anchor={signInFunnelAnchor}
          stages={stages}
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
        />
      ) : null}

      {totals !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Entries still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>One person is one resolved analytics actor, including a visitor or guest who never registered. A person enters once at their first recorded <code>auth_method_selected</code> in the selected UTC dates, from {signInFunnelStartDate}, on the ordinary sign-in screen of web, iOS (including iPad and Mac) or Android; account-security linking and credential recovery are excluded.</p>
          <p>Each step counts that person at most once. Within seven days of entry, each method and platform has its own ordered <code>auth_method_selected</code> → <code>auth_session_accepted</code> → <code>auth_account_ready</code> path, and the funnel counts a person if any such path reaches the step; an email session and an Apple ready event cannot form one path. The platform filter reads the first selection in range.</p>
          <p>Unreported steps stay unobserved: older client versions, analytics consent and delivery gaps can hide a successful sign-in, and missing facts are never backfilled with inferred success. A person still inside the window is not a confirmed drop-off.</p>
          <p>The country and language use the shared person-level filters, and test accounts, admins, analytics exclusions and detected automation are left out. There is no cookieless cohort, so <strong>All</strong> and <strong>With anonymous ID</strong> count the same people; <strong>Signed-in only</strong> narrows this to actors that currently resolve to registered accounts.</p>
        </details>
      ) : null}
    </section>
  );
}

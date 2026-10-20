import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote } from "../../filters/analyticsFilters";
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
import {
  formatPercentage,
  FunnelStepsChart,
  FunnelStepsEmptyChart,
  FunnelStepsLoadingChart,
  type FunnelStage,
} from "../funnels/FunnelStepsChart";
import {
  loadSignInFunnelReport,
  signInFunnelGroupByDimensions,
  signInFunnelStartDate,
  type SignInFunnelCounts,
  type SignInFunnelGroup,
  type SignInFunnelReport,
  type SignInMethodDetail,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
    status: "ready";
    report: SignInFunnelReport;
    dimension: FunnelGroupByDimension | null;
  }>;

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

function MethodDetails(props: Readonly<{ methods: ReadonlyArray<SignInMethodDetail> }>): JSX.Element {
  return (
    <div className="funnel-group-table-shell">
      <table className="funnel-group-table">
        <caption>Actual method paths · distinct people per method; rows can overlap</caption>
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col">Selected</th>
            <th scope="col">Session accepted</th>
            <th scope="col">Account ready</th>
            <th scope="col">Ready / selected</th>
            <th scope="col">Optional observation</th>
            <th scope="col">People</th>
            <th scope="col">Optional observation</th>
            <th scope="col">People</th>
          </tr>
        </thead>
        <tbody>
          {(["email", "google", "apple"] as const).map((method) => {
            const detail = props.methods.find((row) => row.key === method);
            const selected = detail?.selectedCount ?? 0;
            const ready = detail?.accountReadyCount ?? 0;
            return (
              <tr key={method}>
                <th scope="row">{{ email: "Email", google: "Google", apple: "Apple" }[method]}</th>
                <td>{selected.toLocaleString("en-US")}</td>
                <td>{(detail?.sessionAcceptedCount ?? 0).toLocaleString("en-US")}</td>
                <td>{ready.toLocaleString("en-US")}</td>
                <td>{formatPercentage(ready, selected)}</td>
                <td>{method === "email" ? "Code form shown" : "Provider requested"}</td>
                <td>{(detail?.entryDetailCount ?? 0).toLocaleString("en-US")}</td>
                <td>{method === "email" ? "Code submitted" : "Provider credential received"}</td>
                <td>{(detail?.responseDetailCount ?? 0).toLocaleString("en-US")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SignInFunnelSection(props: FunnelSectionProps): JSX.Element {
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });
  const [groupByDimension, setGroupByDimension] = useState<FunnelGroupByDimension | null>(
    () => parseFunnelGroupByDimension(
      new URLSearchParams(window.location.search),
      signInFunnelAnchor.funnelId,
      signInFunnelGroupByDimensions,
    ),
  );

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    const abortController = new AbortController();
    void loadSignInFunnelReport(props.config, props.filters, groupByDimension, abortController.signal)
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

    return () => { cancelled = true; abortController.abort(); };
  }, [groupByDimension, loadRevision, props.config, props.filters, props.isRangeLoading, props.onTerminalAdminError]);

  const selectGroupByDimension = useCallback((dimension: FunnelGroupByDimension | null): void => {
    setGroupByDimension(dimension);
    writeFunnelGroupByToUrl(signInFunnelAnchor.funnelId, dimension?.id ?? null);
  }, []);

  const readyState = props.isRangeLoading === false && loadState.status === "ready" ? loadState : null;
  const report = readyState === null ? null : readyState.report;
  const totals = useMemo(() => (report === null ? null : sumFunnelGroups(report.groups)), [report]);
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
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);

  return (
    <section className="dashboard-section funnel-report">
      <header className="dashboard-section-header">
        <p className="eyebrow">Funnel report</p>
        <h2>{signInFunnelTitle}</h2>
      </header>

      {props.filterRow}

      <p>Web, Apple and Android · observed method selection → accepted session → usable account and workspace.</p>
      <p>Coverage begins {signInFunnelStartDate}. Unreported steps stay unobserved: older client versions, analytics consent and delivery gaps can hide a successful sign-in. On web, both completion facts are currently emitted together only after the account and workspace are ready and the sign-in method hint is consumed.</p>

      <div className="funnel-group-by-row">
        <FunnelGroupByPicker
          funnelId={signInFunnelAnchor.funnelId}
          dimensions={signInFunnelGroupByDimensions}
          selectedDimensionId={groupByDimension === null ? null : groupByDimension.id}
          isReportLoading={props.isRangeLoading || loadState.status === "loading"}
          onSelect={selectGroupByDimension}
        />
      </div>

      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {props.filters.dateRange.from < signInFunnelStartDate ? <p className="report-state">Selections before {signInFunnelStartDate} are outside this report&rsquo;s coverage.</p> : null}

      {totals !== null ? <FunnelMaturingWarning maturingCount={totals.maturingCount} entryCount={totals.selectedCount} /> : null}

      {props.isRangeLoading || loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={groupByDimension !== null}
          label="Loading sign-in funnel…"
        />
      ) : null}
      {totals !== null && totals.selectedCount === 0 ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped={groupByDimension !== null}
          note={<><strong>No observed sign-in method selections match these filters.</strong><span>Entry requires a recorded method choice on the ordinary sign-in screen and an anonymous, guest or account identifier.</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</>}
        />
      ) : null}

      {totals !== null && totals.selectedCount > 0 ? (
        <FunnelStepsChart
          anchor={signInFunnelAnchor}
          stages={stages}
          groups={groups ?? undefined}
          countLabel="People"
          tableCaption="Sign-in funnel steps"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
        />
      ) : null}

      {report !== null && totals !== null ? (
        <>
          <MethodDetails methods={report.methods} />
          <p>Method rows count people who selected that actual method during their seven-day window, including later switches. Session accepted and account ready require ordered facts with that same method and platform. A person may appear in several method rows; do not sum them. Optional code/provider columns are independent observations after that method selection, never required steps or proof that the account became usable.</p>
          <details className="funnel-explainer">
            <summary>How it&rsquo;s counted</summary>
            <div className="funnel-detail-row funnel-explainer-figure"><span>Entries still inside 7-day window</span><strong>{totals.maturingCount.toLocaleString("en-US")}</strong></div>
            <p>One person is one resolved analytics actor, including a visitor or guest who never registered. Existing identity links fold visitor and guest history into the account when available. A person enters once at their first recorded <code>auth_method_selected</code> in the selected UTC dates, from {signInFunnelStartDate}. No common screen-view or sign-in intent step is inferred.</p>
            <p>Each step counts that person at most once. Within seven days of entry, each method and platform has its own ordered <code>auth_method_selected</code> → <code>auth_session_accepted</code> → <code>auth_account_ready</code> path. The overall funnel counts a person if any such path reaches the step. Retries on the same method and platform can supply later facts; this measures people&rsquo;s observed progress, not attempts. A switch can succeed through its own selection and completion, but an email session and an Apple ready event cannot form one completed path.</p>
            <p>Only <code>screen = signin</code> on web, iOS (including iPad and Mac) or Android counts. Account-security linking under <code>settings</code> and credential recovery under <code>credential_recovery</code> are excluded. Browser auth-origin facts are intentionally read at their credential-free trust level, with shared visitor consent; a browser with no shared analytics identifier is unobservable here. There is no cookieless hashed cohort, so <strong>All</strong> and <strong>With anonymous ID</strong> count the same people. <strong>Signed-in only</strong> deliberately narrows this to actors that currently resolve to registered accounts.</p>
            <p>Platform filtering and <strong>Group by</strong> use the first selection in range. Those groups partition the overall cohort; their conversions may use a later method or another platform with its own full path. In particular, grouping by first method shows eventual progress of people who started there, not that method&rsquo;s success rate. The actual-method table above answers the latter observed path question. Country and interface language use the shared person-level filters. Test accounts, admins, analytics exclusions and detected automation use the shared exclusion rule.</p>
            <p>The reporting boundary is the first whole UTC day after these client producer implementations were added; it does not establish native release coverage. Missing historical facts are never backfilled with inferred success. An absent completion is unobserved, and a person still inside the window is not a confirmed drop-off. Sign-in source and intent attribution are not available in this report.</p>
          </details>
        </>
      ) : null}
    </section>
  );
}

import { useEffect, useMemo, useState, type JSX } from "react";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import { FunnelStepsChart, type FunnelStage } from "../funnels/FunnelStepsChart";
import {
  loadMobileFirstLaunchFunnelReport,
  mobileFirstLaunchEngagedReviewThreshold,
  mobileFirstLaunchFunnelStartDate,
  type MobileFirstLaunchFunnelReport,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: MobileFirstLaunchFunnelReport }>;

/** The six funnel steps in chart order; `buildStages` takes its order from this list. */
const funnelStepIds = [
  "first-open",
  "review-screen",
  "revealed",
  "one-review",
  "engaged",
  "engaged-returning",
] as const;

type FunnelStepId = (typeof funnelStepIds)[number];

export const mobileFirstLaunchFunnelAnchor: FunnelAnchor<FunnelStepId> = {
  funnelId: "mobile",
  stepIds: funnelStepIds,
};

export const mobileFirstLaunchFunnelTitle = "Mobile first launch";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected mobile first launch funnel error.";
}

/** The short note shown when the selected range starts before `mobileFirstLaunchFunnelStartDate`, or `null`. */
function buildStartDateNote(dateRange: AnalyticsFilterState["dateRange"]): string | null {
  if (dateRange.to < mobileFirstLaunchFunnelStartDate) {
    return `First launches count from ${mobileFirstLaunchFunnelStartDate}, the first day the apps reported every step, so the selected range has no data.`;
  }

  return dateRange.from < mobileFirstLaunchFunnelStartDate
    ? `First launches count from ${mobileFirstLaunchFunnelStartDate}, the first day the apps reported every step, so there is no data before that day.`
    : null;
}

function buildStages(report: MobileFirstLaunchFunnelReport): ReadonlyArray<FunnelStage<FunnelStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelStepIds`.
  const stages: Readonly<Record<FunnelStepId, Readonly<{ label: string; count: number }>>> = {
    "first-open": { label: "First app open", count: report.firstOpenCount },
    "review-screen": { label: "Review screen", count: report.reviewScreenCount },
    revealed: { label: "Answer revealed", count: report.revealedCount },
    "one-review": { label: "1+ review", count: report.oneReviewCount },
    engaged: { label: `${mobileFirstLaunchEngagedReviewThreshold}+ reviews`, count: report.engagedCount },
    "engaged-returning": {
      label: `${mobileFirstLaunchEngagedReviewThreshold}+ reviews with a return day`,
      count: report.engagedReturningCount,
    },
  };

  return funnelStepIds.map((id) => ({ id, ...stages[id] }));
}

export function MobileFirstLaunchFunnelSection(props: FunnelSectionProps): JSX.Element {
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    void loadMobileFirstLaunchFunnelReport(props.config, props.filters)
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

  const report = props.isRangeLoading === false && loadState.status === "ready" ? loadState.report : null;
  const stages = useMemo(() => (report === null ? [] : buildStages(report)), [report]);
  const startDateNote = report === null ? null : buildStartDateNote(props.filters.dateRange);

  return (
    <section className="dashboard-section funnel-report">
      <header className="dashboard-section-header">
        <p className="eyebrow">Funnel report</p>
        <h2>{mobileFirstLaunchFunnelTitle}</h2>
      </header>

      {props.filterRow}

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading mobile first launch funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {report !== null && report.firstOpenCount === 0 ? <div className="report-state"><strong>No first mobile app opens match these filters.</strong><span>Only a person whose first event anywhere is opening the iOS or Android app on a selected day enters this funnel.</span></div> : null}

      {report !== null ? <FunnelMaturingWarning maturingCount={report.maturingCount} entryCount={report.firstOpenCount} /> : null}

      {report !== null && report.firstOpenCount > 0 ? (
        <FunnelStepsChart
          anchor={mobileFirstLaunchFunnelAnchor}
          stages={stages}
          countLabel="People"
          tableCaption="Mobile first launch funnel steps"
          dateRange={props.filters.dateRange}
        />
      ) : null}

      {report !== null ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>First opens still inside 7-day window</span><strong>{report.maturingCount.toLocaleString("en-US")}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it.</p>
          <p>One row is one person, anchored at their first <code>app_opened</code> on iOS or Android in the selected UTC dates, and only when that app open is their first trusted event anywhere, over every event name and all of history. A person who first used the web app, the agent API or an earlier app version before the range is not here. A signed-out marketing-site visit is not a trusted event, so it does not keep anyone out. One event is let through: a <code>card_created</code> up to 60 seconds before that app open, which is the demo onboarding card the app seeds during its first launch. A <code>card_created</code> any earlier, or any other earlier event, still keeps the person out, so someone who first created cards through the agent API or MCP is not counted as new. First opens count only from {mobileFirstLaunchFunnelStartDate}, the first UTC day on which the iOS and Android apps had reported both a review-screen <code>screen_viewed</code> and a <code>review_card_revealed</code>, so a range starting earlier does not show drop-off at steps the apps were not yet reporting.</p>
          <p>Every later step is that same person within seven days of the first app open, each at or after the step above it: a <code>screen_viewed</code> of the review screen, a <code>review_card_revealed</code>, then a first <code>review_answered</code>. The review count runs from that first answer, the return day is one of those answers on a later UTC day than the first app open, and neither is limited to the device the person started on. A person still inside their seven-day window is not a confirmed drop-off.</p>
          <p>The date range, the client platform, the connection country and the app interface language are applied in SQL. The platform is the first app open&rsquo;s, so any selection without iOS or Android empties this funnel; the country and language keep a person the way they do on General, from their events in the selected dates. An <code>@example.com</code> account, an active admin and an actor on the analytics exclusion list are excluded.</p>
        </details>
      ) : null}
    </section>
  );
}

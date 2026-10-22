import { useMemo, type JSX } from "react";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildFunnelGroupLabel,
  foldComparedFunnelGroups,
  foldFunnelGroups,
  type FunnelGroupByDimension,
  type FunnelGroupCounts,
} from "../funnels/funnelGroupBy";
import {
  buildFunnelRangeGroups,
  formatFunnelRangeSeriesLabel,
  useFunnelRangeReports,
  type FunnelReportLoader,
} from "../funnels/funnelRangeReports";
import { FunnelSectionHeader } from "../funnels/FunnelSectionHeader";
import type { FunnelReportProps } from "../funnels/funnelSections";
import {
  FunnelStepsChart,
  FunnelStepsEmptyChart,
  FunnelStepsLoadingChart,
  type FunnelChartGroups,
  type FunnelStage,
} from "../funnels/FunnelStepsChart";
import { buildFunnelEmptyRangeNote, buildFunnelRangeWarnings, type FunnelWarning } from "../funnels/funnelWarnings";
import {
  loadReviewPromptFunnelReport,
  reviewPromptFollowUpDays,
  reviewPromptFunnels,
  type ReviewPromptFunnel,
  type ReviewPromptFunnelCounts,
  type ReviewPromptFunnelGroup,
  type ReviewPromptFunnelReport,
} from "./detailsQuery";
import { buildReviewPromptWarnings, formatReviewPromptLateStarts, type ReviewPrompt } from "./reviewPromptDefinitions";

const countLabel = "Showings";

/** The main card above names the ranges' caveats once for the whole page. */
const noWarnings: ReadonlyArray<FunnelWarning> = [];

/** The groups replace the plain funnel's steps, so the chart is given none; one array, so a render is not a change. */
const noStages: ReadonlyArray<FunnelStage<string>> = [];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected review prompt funnel error.";
}

function buildStages(funnel: ReviewPromptFunnel, counts: ReviewPromptFunnelCounts): ReadonlyArray<FunnelStage<string>> {
  return funnel.steps.map((step, index) => {
    const count = counts.stepCounts[index];
    if (count === undefined) {
      throw new Error(`Review prompt funnel step "${step.id}" has no count.`);
    }

    return { id: step.id, label: step.label, count };
  });
}

/** The funnel as a whole: the groups partition the showings, so it is their sum. */
function sumGroups(funnel: ReviewPromptFunnel, groups: ReadonlyArray<ReviewPromptFunnelGroup>): ReviewPromptFunnelCounts {
  return groups.reduce<ReviewPromptFunnelCounts>((totals, group) => ({
    stepCounts: totals.stepCounts.map((count, index) => count + (group.stepCounts[index] ?? 0)),
    actedPendingCount: totals.actedPendingCount + group.actedPendingCount,
    followUpPendingCount: totals.followUpPendingCount + group.followUpPendingCount,
  }), { stepCounts: funnel.steps.map(() => 0), actedPendingCount: 0, followUpPendingCount: 0 });
}

/** Names the showings whose last step reads events past the Acted window and can still grow, or `null`. */
function buildFollowUpPendingNote(funnel: ReviewPromptFunnel, counts: ReviewPromptFunnelCounts): string | null {
  const lastStep = funnel.steps[funnel.steps.length - 1];
  return funnel.followUpEventsSql === null || lastStep === undefined || counts.followUpPendingCount === 0
    ? null
    : `${lastStep.label} can still grow for ${counts.followUpPendingCount.toLocaleString("en-US")} of ${(counts.stepCounts[0] ?? 0).toLocaleString("en-US")} showings less than ${reviewPromptFollowUpDays} days old.`;
}

/** One note per step whose own event starts after the range does on a selected platform, keyed apart from the prompt's coverage start. */
function buildStepCoverageNotes(funnel: ReviewPromptFunnel, filters: AnalyticsFilterState): Readonly<Record<string, string | null>> {
  return Object.fromEntries(funnel.steps.flatMap((step) => {
    if (step.coverage === null) {
      return [];
    }

    const lateStarts = formatReviewPromptLateStarts(step.coverage, filters);
    const note: readonly [string, string | null] = [
      `${step.id}-coverage`,
      lateStarts === null ? null : `${step.label} is reported on ${lateStarts}, so showings before that or on older apps never reach it.`,
    ];
    return [note];
  }));
}

function FunnelQueryError(props: Readonly<{ message: string; onRetry: () => void }>): JSX.Element {
  return (
    <div className="report-state report-state-error">
      <strong>Funnel query failed.</strong><span>{props.message}</span>
      <button className="filter-button" type="button" onClick={props.onRetry}>Retry</button>
    </div>
  );
}

/** One prompt's funnel of showings, with every caveat its ranges trigger. */
export function ReviewPromptFunnelSection(props: FunnelReportProps & Readonly<{ prompt: ReviewPrompt }>): JSX.Element {
  const { prompt, filters } = props;
  const funnel = reviewPromptFunnels[prompt.id];
  const loadReport = useMemo<FunnelReportLoader<ReviewPromptFunnelReport>>(
    () => (config, rangeFilters, signal) => loadReviewPromptFunnelReport(config, rangeFilters, prompt.id, null, signal),
    [prompt.id],
  );
  const { state: loadState, retry } = useFunnelRangeReports(props, loadReport, getErrorMessage);
  const rangeViews = useMemo(
    () => (loadState.status === "ready" ? loadState.ranges : []).map((range) => {
      const totals = sumGroups(funnel, range.report.groups);
      return { ...range, totals, stages: buildStages(funnel, totals), hasEntries: (totals.stepCounts[0] ?? 0) > 0 };
    }),
    [funnel, loadState],
  );
  const groups = useMemo(() => buildFunnelRangeGroups(rangeViews), [rangeViews]);
  const warnings = useMemo(() => [
    ...rangeViews.flatMap((range) => {
      const rangeFilters = { ...filters, dateRange: range.dateRange };
      const promptWarnings = buildReviewPromptWarnings(
        prompt,
        // No funnel step is Gone, so its maturing caveat stays with the outcome chart's Maturing stack.
        { shownCount: range.totals.stepCounts[0] ?? 0, maturingCount: 0, actedPendingCount: range.totals.actedPendingCount },
        rangeFilters,
      );
      return buildFunnelRangeWarnings(range, {
        ...Object.fromEntries(promptWarnings.map((warning) => [warning.id, warning.text])),
        ...buildStepCoverageNotes(funnel, rangeFilters),
        "follow-up-pending": buildFollowUpPendingNote(funnel, range.totals),
        empty: buildFunnelEmptyRangeNote(rangeViews, range),
      });
    }),
    ...(funnel.warning === null ? [] : [funnel.warning]),
  ], [filters, funnel, prompt, rangeViews]);
  const primaryRange = rangeViews[0];
  const hasEntries = rangeViews.some((range) => range.hasEntries);
  const isComparing = filters.comparisonDateRange !== null;

  return (
    <section className="dashboard-section funnel-report" data-testid="review-prompt-funnel">
      <FunnelSectionHeader funnelId={funnel.anchor.funnelId} title={prompt.title} warnings={warnings} onDetailsNavigate={null} />

      {loadState.status === "error" ? <FunnelQueryError message={loadState.message} onRetry={retry} /> : null}
      {loadState.status === "loading" ? (
        <FunnelStepsLoadingChart countLabel={countLabel} dateRange={filters.dateRange} isGrouped={isComparing} label={`Loading ${prompt.title} funnel…`} />
      ) : null}
      {loadState.status === "ready" && hasEntries === false ? (
        <FunnelStepsEmptyChart countLabel={countLabel} dateRange={filters.dateRange} isGrouped={isComparing} note={<strong>No showings of this prompt match these filters.</strong>} />
      ) : null}
      {primaryRange !== undefined && hasEntries ? (
        <FunnelStepsChart anchor={funnel.anchor} stages={primaryRange.stages} groups={groups} countLabel={countLabel} dateRange={filters.dateRange} />
      ) : null}

      {primaryRange !== undefined ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <p>Every step counts showings, so one person shown the prompt twice counts twice, and a showing counts at a step only after reaching every step above it. Each step is the same person after that showing:</p>
          <ul>
            {funnel.steps.map((step) => <li key={step.id}><strong>{step.label}:</strong> {step.rule}</li>)}
          </ul>
          <p>The platform is the showing&rsquo;s own; the country and language filters keep a person as the table does. Test accounts, admins and excluded actors are left out.</p>
        </details>
      ) : null}
    </section>
  );
}

function buildGroupCounts(
  funnel: ReviewPromptFunnel,
  dimension: FunnelGroupByDimension,
  report: ReviewPromptFunnelReport,
): ReadonlyArray<FunnelGroupCounts<string>> {
  return report.groups.map((group) => ({
    key: group.key,
    label: buildFunnelGroupLabel(dimension, group.key),
    stages: buildStages(funnel, group),
  }));
}

/**
 * One prompt's funnel split by one dimension, each group measured inside itself. Under a comparison
 * every group draws its A and B bars as a pair.
 */
export function ReviewPromptFunnelBreakdownSection(
  props: FunnelReportProps & Readonly<{ prompt: ReviewPrompt; dimension: FunnelGroupByDimension }>,
): JSX.Element {
  const { prompt, dimension, filters } = props;
  const funnel = reviewPromptFunnels[prompt.id];
  const title = `${prompt.title} by ${dimension.label.toLowerCase()}`;
  const loadReport = useMemo<FunnelReportLoader<ReviewPromptFunnelReport>>(
    () => (config, rangeFilters, signal) => loadReviewPromptFunnelReport(config, rangeFilters, prompt.id, dimension, signal),
    [dimension, prompt.id],
  );
  const { state: loadState, retry } = useFunnelRangeReports(props, loadReport, getErrorMessage);
  const chart = useMemo(() => {
    if (loadState.status !== "ready") {
      return null;
    }

    const [rangeA, rangeB] = loadState.ranges;
    if (rangeA === undefined) {
      throw new Error(`${title} has no range A report.`);
    }

    const hasEntries = loadState.ranges.some((range) => range.report.groups.some((group) => (group.stepCounts[0] ?? 0) > 0));
    const groupsA = buildGroupCounts(funnel, dimension, rangeA.report);
    const groups: FunnelChartGroups<string> = rangeB === undefined
      ? { kind: "groups", groups: foldFunnelGroups(dimension, groupsA) }
      : {
        kind: "range-pairs",
        rangeLabels: {
          a: formatFunnelRangeSeriesLabel(rangeA.key, rangeA.dateRange),
          b: formatFunnelRangeSeriesLabel(rangeB.key, rangeB.dateRange),
        },
        groups: foldComparedFunnelGroups(dimension, groupsA, buildGroupCounts(funnel, dimension, rangeB.report)),
      };
    return { hasEntries, groups };
  }, [dimension, funnel, loadState, title]);

  return (
    <section className="dashboard-section funnel-report" data-testid={`review-prompt-funnel-by-${dimension.id}`}>
      <FunnelSectionHeader funnelId={funnel.anchor.funnelId} title={title} warnings={noWarnings} onDetailsNavigate={null} />

      {loadState.status === "error" ? <FunnelQueryError message={loadState.message} onRetry={retry} /> : null}
      {loadState.status === "loading" ? (
        <FunnelStepsLoadingChart countLabel={countLabel} dateRange={filters.dateRange} isGrouped label={`Loading ${title.toLowerCase()}…`} />
      ) : null}
      {chart !== null && chart.hasEntries === false ? (
        <FunnelStepsEmptyChart countLabel={countLabel} dateRange={filters.dateRange} isGrouped note={<strong>No showings of this prompt match these filters.</strong>} />
      ) : null}
      {chart !== null && chart.hasEntries ? (
        <FunnelStepsChart anchor={funnel.anchor} stages={noStages} groups={chart.groups} countLabel={countLabel} dateRange={filters.dateRange} />
      ) : null}
    </section>
  );
}

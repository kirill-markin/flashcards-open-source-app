import { useMemo, type JSX } from "react";
import {
  buildFunnelGroupLabel,
  foldComparedFunnelGroups,
  foldFunnelGroups,
  type FunnelGroupByDimension,
  type FunnelGroupCounts,
} from "../funnels/funnelGroupBy";
import {
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
import {
  buildFirstLaunchFunnelStages,
  firstLaunchFunnelAnchor,
  firstLaunchFunnelTitle,
  type FirstLaunchFunnelStepId,
} from "./FirstLaunchFunnelSection";
import {
  firstLaunchFunnelGroupByDimensions,
  loadFirstLaunchFunnelReport,
  type FirstLaunchFunnelReport,
} from "./query";

type FirstLaunchFunnelBreakdown = Readonly<{
  dimension: FunnelGroupByDimension;
  loadReport: FunnelReportLoader<FirstLaunchFunnelReport>;
}>;

/** One card per dimension, in picker order; built once here, because a card reloads whenever its loader changes. */
export const firstLaunchFunnelBreakdowns: ReadonlyArray<FirstLaunchFunnelBreakdown> = firstLaunchFunnelGroupByDimensions
  .map((dimension): FirstLaunchFunnelBreakdown => ({
    dimension,
    loadReport: (config, filters, signal) => loadFirstLaunchFunnelReport(config, filters, dimension, signal),
  }));

/** The groups replace the plain funnel's steps, so the chart is given none; one array, so a render is not a change. */
const noStages: ReadonlyArray<FunnelStage<FirstLaunchFunnelStepId>> = [];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected first launch funnel breakdown error.";
}

function buildGroupCounts(
  dimension: FunnelGroupByDimension,
  report: FirstLaunchFunnelReport,
): ReadonlyArray<FunnelGroupCounts<FirstLaunchFunnelStepId>> {
  return report.groups.map((group) => ({
    key: group.key,
    label: buildFunnelGroupLabel(dimension, group.key),
    stages: buildFirstLaunchFunnelStages(group),
  }));
}

/**
 * The First launch funnel split by one dimension: the main chart's seven steps, one bar per group,
 * each group measured inside itself. Under a comparison every group draws its A and B bars as a pair.
 */
export function FirstLaunchFunnelBreakdownSection(
  props: FunnelReportProps & Readonly<{ breakdown: FirstLaunchFunnelBreakdown }>,
): JSX.Element {
  const dimension = props.breakdown.dimension;
  const title = `${firstLaunchFunnelTitle} by ${dimension.label.toLowerCase()}`;
  const { state: loadState, retry } = useFunnelRangeReports(props, props.breakdown.loadReport, getErrorMessage);
  const chart = useMemo(() => {
    if (loadState.status !== "ready") {
      return null;
    }

    const [rangeA, rangeB] = loadState.ranges;
    if (rangeA === undefined) {
      throw new Error(`${title} has no range A report.`);
    }

    const hasEntries = loadState.ranges.some((range) => range.report.groups.some((group) => group.firstLaunchCount > 0));
    const groupsA = buildGroupCounts(dimension, rangeA.report);
    const groups: FunnelChartGroups<FirstLaunchFunnelStepId> = rangeB === undefined
      ? { kind: "groups", groups: foldFunnelGroups(dimension, groupsA) }
      : {
        kind: "range-pairs",
        rangeLabels: {
          a: formatFunnelRangeSeriesLabel(rangeA.key, rangeA.dateRange),
          b: formatFunnelRangeSeriesLabel(rangeB.key, rangeB.dateRange),
        },
        groups: foldComparedFunnelGroups(dimension, groupsA, buildGroupCounts(dimension, rangeB.report)),
      };
    return { hasEntries, groups };
  }, [dimension, loadState, title]);

  return (
    <section className="dashboard-section funnel-report" data-testid={`funnel-first-launch-by-${dimension.id}`}>
      <FunnelSectionHeader funnelId={firstLaunchFunnelAnchor.funnelId} title={title} onDetailsNavigate={null} />

      {loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={retry}>Retry</button></div> : null}

      {loadState.status === "loading" ? (
        <FunnelStepsLoadingChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped
          label={`Loading ${title.toLowerCase()}…`}
        />
      ) : null}
      {chart !== null && chart.hasEntries === false ? (
        <FunnelStepsEmptyChart
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
          isGrouped
          note={<strong>No first app launches match these filters.</strong>}
        />
      ) : null}

      {chart !== null && chart.hasEntries ? (
        <FunnelStepsChart
          anchor={firstLaunchFunnelAnchor}
          stages={noStages}
          groups={chart.groups}
          countLabel="People"
          dateRange={props.filters.dateRange}
          showsHashedSplit={false}
        />
      ) : null}
    </section>
  );
}

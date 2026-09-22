import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import {
  renderFunnelStepsChart,
  type FunnelStepBar,
  type FunnelStepGroupBars,
} from "../../charts/chartRenderers";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  parseFunnelAnchorStepId,
  writeFunnelAnchorToUrl,
  type FunnelAnchor,
} from "./funnelAnchorUrl";
import type { FunnelGroup } from "./funnelGroupBy";

/**
 * A main-path step; its `id` is what the URL stores as the anchor, so a label can change freely.
 *
 * `count` is the whole step and `hashedCount` is the part of it made of cookieless visitors counted
 * by their daily hash, so the identified part is the difference. Every share on this chart is
 * measured on `count`, which is what makes the `all` mode a wider funnel rather than a second one
 * drawn beside it.
 */
export type FunnelStage<StepId extends string> = Readonly<{
  id: StepId;
  label: string;
  count: number;
  hashedCount: number;
}>;

/** The single series an ungrouped funnel draws; its key is never shown and never collides with a group key. */
const ungroupedFunnelGroupKey = "ungrouped";

export function formatPercentage(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "—";
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

/**
 * Every step is a subset of the one before it, so a later step's count over the anchor's is a
 * conversion rate.
 *
 * It is called once per group, so a grouped chart measures every group against that group's own
 * first step and its own anchor step rather than against the funnel as a whole.
 *
 * `showsHashedSplit` is the same gate the table and the chart's sub-heading read, and it zeroes
 * `hashedCount` here rather than only hiding the text: the lighter bar segment is drawn from that
 * number, and one render with stale stages under a new mode must not leave a segment on screen that
 * nothing left announces.
 */
function buildFunnelStepBars<StepId extends string>(
  stages: ReadonlyArray<FunnelStage<StepId>>,
  anchorIndex: number,
  showsHashedSplit: boolean,
): ReadonlyArray<FunnelStepBar> {
  const firstCount = stages[0]?.count ?? 0;
  const anchorCount = stages[anchorIndex]?.count ?? 0;
  return stages.map((stage, index) => {
    const previousCount = index === 0 ? null : (stages[index - 1]?.count ?? 0);
    const hashedCount = showsHashedSplit ? stage.hashedCount : 0;
    return {
      label: stage.label,
      count: stage.count,
      hashedCount,
      previousCount,
      shareOfFirstLabel: formatPercentage(stage.count, firstCount),
      shareOfAnchorLabel: index < anchorIndex ? "—" : formatPercentage(stage.count, anchorCount),
      shareOfPreviousLabel: previousCount === null ? "—" : formatPercentage(stage.count, previousCount),
      // Only a step that has a hashed part is split, so a step below the site ones reads as the
      // plain total it is instead of claiming a zero segment it could never have had. The two parts
      // go on a line each so that the widest line is one formatted number plus a fixed short word,
      // whatever the counts grow to, rather than both numbers on one line under a step column it
      // would eventually outgrow. The table below names both parts in a column each.
      splitLabels: hashedCount === 0
        ? []
        : [`${formatCount(stage.count - hashedCount)} with ID`, `+ ${formatCount(hashedCount)} hashed`],
    };
  });
}

/**
 * The ungrouped chart's text alternative: the same numbers the bars carry, for screen readers only.
 *
 * The two split columns appear whenever the hashed cohort was actually read rather than only when a
 * step happens to have hashed people in it, so a reader who chose `all` and sees zeros learns that
 * there were none rather than that the split is missing. They stay away when the query left the
 * cohort out - `all` with a connection country selected - because there a zero would claim the
 * cookieless visitors were looked for and not found, and the section's own note says the opposite.
 */
function FunnelStepTable(
  props: Readonly<{
    caption: string;
    countLabel: string;
    steps: ReadonlyArray<FunnelStepBar>;
    anchorIndex: number;
    showsHashedSplit: boolean;
  }>,
): JSX.Element {
  const anchorLabel = props.anchorIndex > 0 ? (props.steps[props.anchorIndex]?.label ?? null) : null;
  return (
    <div className="visually-hidden">
      <table>
        <caption>{props.caption}</caption>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">{props.countLabel}</th>
            {props.showsHashedSplit ? <th scope="col">With an identifier</th> : null}
            {props.showsHashedSplit ? <th scope="col">Cookieless, counted by daily hash</th> : null}
            <th scope="col">Of first step</th>
            {anchorLabel === null ? null : <th scope="col">Of selected step ({anchorLabel})</th>}
            <th scope="col">Of previous step</th>
          </tr>
        </thead>
        <tbody>
          {props.steps.map((step) => (
            <tr key={step.label}>
              <th scope="row">{step.label}</th>
              <td>{formatCount(step.count)}</td>
              {props.showsHashedSplit ? <td>{formatCount(step.count - step.hashedCount)}</td> : null}
              {props.showsHashedSplit ? <td>{formatCount(step.hashedCount)}</td> : null}
              <td>{step.shareOfFirstLabel}</td>
              {anchorLabel === null ? null : <td>{step.shareOfAnchorLabel}</td>}
              <td>{step.shareOfPreviousLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The grouped chart's numbers, one row per step and group, VISIBLE RATHER THAN HIDDEN and replacing
 * the hidden table while grouping is on.
 *
 * It is the only place the exact numbers of a grouped chart can be read without a pointer: the bars
 * no longer have room to carry them, and a tooltip answers one bar at a time and reaches neither a
 * keyboard nor a screen reader. Every share in it is that group's own, measured the way the group's
 * bars are drawn.
 */
function FunnelStepGroupTable(
  props: Readonly<{
    caption: string;
    countLabel: string;
    groups: ReadonlyArray<FunnelStepGroupBars>;
    anchorIndex: number;
    showsHashedSplit: boolean;
  }>,
): JSX.Element {
  const firstGroupSteps = props.groups[0]?.steps ?? [];
  const anchorLabel = props.anchorIndex > 0 ? (firstGroupSteps[props.anchorIndex]?.label ?? null) : null;
  return (
    <div className="funnel-group-table-shell">
      <table className="funnel-group-table">
        <caption>{props.caption}</caption>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Group</th>
            <th scope="col">{props.countLabel}</th>
            {props.showsHashedSplit ? <th scope="col">With an identifier</th> : null}
            {props.showsHashedSplit ? <th scope="col">Cookieless, counted by daily hash</th> : null}
            <th scope="col">Of first step</th>
            {anchorLabel === null ? null : <th scope="col">Of selected step ({anchorLabel})</th>}
            <th scope="col">Of previous step</th>
          </tr>
        </thead>
        <tbody>
          {firstGroupSteps.flatMap((firstGroupStep, stepIndex) => props.groups.map((group, groupIndex) => {
            const step = group.steps[stepIndex];
            if (step === undefined) {
              throw new Error(`Funnel group "${group.key}" is missing step ${stepIndex}.`);
            }

            return (
              <tr key={`${firstGroupStep.label}:${group.key}`}>
                {/* `scope="row"` heads the rows the cell spans, which is this step's group rows and
                    only those. `rowgroup` would head every later step as well, because the whole
                    table is one `<tbody>`. */}
                {groupIndex === 0
                  ? <th scope="row" rowSpan={props.groups.length}>{firstGroupStep.label}</th>
                  : null}
                {/* A second row header beside the step's, which one row may carry: as a plain cell
                    it left a screen reader announcing every count with its step and none with its
                    group, which is the one thing this table exists to say. */}
                <th scope="row" className="funnel-group-table-name">
                  <span className="funnel-group-swatch" style={{ backgroundColor: group.color }} />
                  {group.label}
                </th>
                <td>{formatCount(step.count)}</td>
                {props.showsHashedSplit ? <td>{formatCount(step.count - step.hashedCount)}</td> : null}
                {props.showsHashedSplit ? <td>{formatCount(step.hashedCount)}</td> : null}
                <td>{step.shareOfFirstLabel}</td>
                {anchorLabel === null ? null : <td>{step.shareOfAnchorLabel}</td>}
                <td>{step.shareOfPreviousLabel}</td>
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One funnel's step chart with its click-to-anchor state and its table. Mount it only once the funnel
 * has something to draw - which is why the funnel's own `Group by` field is not in here but in the
 * section around it, mounted in every state, including the empty one a grouping has to be cleared
 * from. The anchor is read from the URL on mount and written back on every click, so a remount after
 * a reload reopens the same anchor; only a click moves it, and `null` is the default view, measured
 * from the first step. The anchor is one choice for the whole chart: clicking a step re-bases every
 * group on its own count at that step.
 */
export function FunnelStepsChart<StepId extends string>(
  props: Readonly<{
    anchor: FunnelAnchor<StepId>;
    /** The main path in chart order, each step a subset of the one before it. */
    stages: ReadonlyArray<FunnelStage<StepId>>;
    /**
     * One coloured series per group, which replaces `stages` while a `Group by` dimension is
     * selected; each group carries the funnel's full step list in the same order. Left out is the
     * ungrouped chart, and a funnel with no group-by field of its own never passes it: `stages`
     * becomes the single group everything below draws, so there is one rendering path either way.
     */
    groups?: ReadonlyArray<FunnelGroup<StepId>>;
    /** What one counted row is, plural: the chart heading and the table's count column. */
    countLabel: string;
    tableCaption: string;
    dateRange: AnalyticsDateRange;
    /**
     * The hashed cohort was read, so the bars carry a segment that has to be named. It is the read
     * gate rather than the mode: with `all` and a connection country selected the mode is on and the
     * cohort was deliberately not queried, and nothing here may announce a segment that is not there.
     */
    showsHashedSplit: boolean;
  }>,
): JSX.Element {
  const [anchorStepId, setAnchorStepId] = useState<StepId | null>(
    () => parseFunnelAnchorStepId(new URLSearchParams(window.location.search), props.anchor),
  );
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const propsGroups = props.groups;
  const groups = useMemo<ReadonlyArray<FunnelGroup<StepId>>>(() => (
    propsGroups ?? [{
      key: ungroupedFunnelGroupKey,
      label: props.countLabel,
      // The single bar takes its accent fill from the stylesheet, so no colour is read off this group.
      color: "var(--accent)",
      stages: props.stages,
    }]
  ), [propsGroups, props.countLabel, props.stages]);
  // A SELECTED DIMENSION IS WHAT MAKES THE CHART GROUPED, not how many groups came back. A range in
  // which the dimension placed nobody returns the one `Unresolved` group, and a range with one
  // country or one platform returns one value group; drawing either as the ungrouped accent chart
  // would read as the plain funnel and hide the very fact the reader asked the field for.
  const isGrouped = propsGroups !== undefined;
  // Every group carries the same steps in the same order, so the first one names the funnel's steps.
  const chartStages = groups[0]?.stages ?? [];
  const anchorIndex = Math.max(0, chartStages.findIndex((stage) => stage.id === anchorStepId));
  const groupBars = useMemo<ReadonlyArray<FunnelStepGroupBars>>(() => groups.map((group) => ({
    key: group.key,
    label: group.label,
    color: group.color,
    steps: buildFunnelStepBars(group.stages, anchorIndex, props.showsHashedSplit),
  })), [groups, anchorIndex, props.showsHashedSplit]);
  /** Selecting the current anchor or the first step returns to the default view and clears the URL. */
  const selectAnchorStep = useCallback((stepIndex: number): void => {
    const selectedStepId = chartStages[stepIndex]?.id ?? null;
    const nextStepId = stepIndex === 0 || selectedStepId === anchorStepId ? null : selectedStepId;
    setAnchorStepId(nextStepId);
    writeFunnelAnchorToUrl(props.anchor, nextStepId);
  }, [anchorStepId, chartStages, props.anchor]);

  const chartRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svgElement = chartRef.current;
    if (svgElement === null) {
      return;
    }

    renderFunnelStepsChart({
      svgElement,
      groups: groupBars,
      isGrouped,
      countLabel: props.countLabel,
      anchorIndex,
      onSelectStep: selectAnchorStep,
      tooltipHandlers,
    });
  }, [anchorIndex, groupBars, isGrouped, props.countLabel, selectAnchorStep, tooltipHandlers]);

  return (
    <section className="chart-column funnel-chart-column">
      <div className="chart-shell">
        <div className="chart-meta">
          <div className="funnel-chart-heading">
            <span>{props.countLabel} reaching each step</span>
            <span>
              {props.showsHashedSplit
                ? "Lighter segment: cookieless visitors, by daily hash · Click a step to measure from it"
                : "Click a step to measure from it"}
            </span>
          </div>
          <div className="chart-meta-right">
            <span>{props.dateRange.from} to {props.dateRange.to}, inclusive</span>
          </div>
        </div>
        {/* The same key markup the platform charts use, so a colour key reads the same everywhere. */}
        {isGrouped ? (
          <div className="platform-key funnel-group-key" aria-label="Funnel group color key">
            {groupBars.map((group) => (
              <span key={group.key} className="platform-key-item">
                <span className="platform-key-swatch" style={{ backgroundColor: group.color }} />
                <span>{group.label}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="chart-scroll">
          <svg ref={chartRef} className="funnel-steps-chart" role="group" aria-label="Funnel steps; select a step to measure later steps from it" />
        </div>
      </div>
      {isGrouped ? (
        <FunnelStepGroupTable
          caption={props.tableCaption}
          countLabel={props.countLabel}
          groups={groupBars}
          anchorIndex={anchorIndex}
          showsHashedSplit={props.showsHashedSplit}
        />
      ) : (
        <FunnelStepTable
          caption={props.tableCaption}
          countLabel={props.countLabel}
          steps={groupBars[0]?.steps ?? []}
          anchorIndex={anchorIndex}
          showsHashedSplit={props.showsHashedSplit}
        />
      )}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

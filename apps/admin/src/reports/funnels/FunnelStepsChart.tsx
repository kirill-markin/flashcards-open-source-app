import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKeyPlaceholder } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { chartWidth } from "../../charts/chartPrimitives";
import {
  getFunnelChartHeight,
  getFunnelSplitLineCount,
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

/** The lines `buildFunnelStepBars` writes for a step that has a hashed part. */
const funnelSplitLabelLineCount = 2;

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
 * `showsHashedSplit` is the same gate the chart's sub-heading reads, and it zeroes
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
      // would eventually outgrow.
      splitLabels: hashedCount === 0
        ? []
        : [`${formatCount(stage.count - hashedCount)} with ID`, `+ ${formatCount(hashedCount)} hashed`],
    };
  });
}

/**
 * The height a funnel's chart draws at, known before its report: an ungrouped hashed read draws the
 * split lines, unless no step turns out to have a hashed part, which draws it shorter than this.
 */
function getExpectedFunnelChartHeight(showsHashedSplit: boolean, isGrouped: boolean): number {
  return getFunnelChartHeight(showsHashedSplit && isGrouped === false ? funnelSplitLabelLineCount : 0);
}

function FunnelChartMeta(
  props: Readonly<{
    countLabel: string;
    dateRange: AnalyticsDateRange;
    showsHashedSplit: boolean;
  }>,
): JSX.Element {
  return (
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
  );
}

/**
 * A funnel's chart panel with an empty area in place of its chart, at the size a ready one draws at,
 * and `note` over it. `isGrouped` is whether the ready chart will draw groups, which reserves one row
 * of the group key.
 */
function FunnelChartPanel(
  props: Readonly<{
    countLabel: string;
    dateRange: AnalyticsDateRange;
    showsHashedSplit: boolean;
    isGrouped: boolean;
    note: JSX.Element;
  }>,
): JSX.Element {
  return (
    <section className="chart-column funnel-chart-column">
      <div className="chart-shell">
        <FunnelChartMeta countLabel={props.countLabel} dateRange={props.dateRange} showsHashedSplit={props.showsHashedSplit} />
        {props.isGrouped ? <div className="funnel-group-key"><ChartColorKeyPlaceholder /></div> : null}
        <div className="funnel-chart-area">
          <div className="chart-scroll">
            {/* The ready chart's class, so the area keeps its minimum width in the same scroll container. */}
            <div className="funnel-steps-chart">
              <ChartAreaWithNote
                viewBoxWidth={chartWidth}
                viewBoxHeight={getExpectedFunnelChartHeight(props.showsHashedSplit, props.isGrouped)}
                note={null}
              >
                {null}
              </ChartAreaWithNote>
            </div>
          </div>
          {/* Outside the scroller, so it centers in the visible part rather than in the wider area. */}
          {props.note}
        </div>
      </div>
    </section>
  );
}

/** A funnel's chart panel while its report loads or reloads. */
export function FunnelStepsLoadingChart(
  props: Readonly<{
    countLabel: string;
    dateRange: AnalyticsDateRange;
    showsHashedSplit: boolean;
    isGrouped: boolean;
    label: string;
  }>,
): JSX.Element {
  return (
    <FunnelChartPanel
      countLabel={props.countLabel}
      dateRange={props.dateRange}
      showsHashedSplit={props.showsHashedSplit}
      isGrouped={props.isGrouped}
      note={<p className="chart-area-note" aria-live="polite"><span>{props.label}</span></p>}
    />
  );
}

/** A funnel's chart panel when nobody entered it, with `note` saying why over the empty chart area. */
export function FunnelStepsEmptyChart(
  props: Readonly<{
    countLabel: string;
    dateRange: AnalyticsDateRange;
    showsHashedSplit: boolean;
    isGrouped: boolean;
    note: JSX.Element;
  }>,
): JSX.Element {
  return (
    <FunnelChartPanel
      countLabel={props.countLabel}
      dateRange={props.dateRange}
      showsHashedSplit={props.showsHashedSplit}
      isGrouped={props.isGrouped}
      note={<p className="chart-area-note"><span className="funnel-empty-note">{props.note}</span></p>}
    />
  );
}

/**
 * One funnel's step chart with its click-to-anchor state. Mount it only once the funnel has something
 * to draw. The anchor is read from the URL on mount and written back on every click, so a remount after
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
     * One coloured series per group, which replaces `stages`; each group carries the funnel's full
     * step list in the same order. Left out is the ungrouped chart: `stages` becomes the single group
     * everything below draws, so there is one rendering path either way.
     */
    groups?: ReadonlyArray<FunnelGroup<StepId>>;
    /** What one counted row is, plural: the chart heading. */
    countLabel: string;
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
  // PASSED GROUPS ARE WHAT MAKE THE CHART GROUPED, not how many came back. A range in which a
  // dimension placed nobody returns the one `Unresolved` group, and a range with one country or one
  // platform returns one value group; drawing either as the ungrouped accent chart would read as the
  // plain funnel and hide the very split the reader asked for.
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
        <FunnelChartMeta countLabel={props.countLabel} dateRange={props.dateRange} showsHashedSplit={props.showsHashedSplit} />
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
          <div className="funnel-steps-chart">
            <ChartAreaWithNote
              viewBoxWidth={chartWidth}
              viewBoxHeight={getFunnelChartHeight(getFunnelSplitLineCount(groupBars[0]?.steps ?? [], isGrouped))}
              note={null}
            >
              <svg ref={chartRef} role="group" aria-label="Funnel steps; select a step to measure later steps from it" />
            </ChartAreaWithNote>
          </div>
        </div>
      </div>
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

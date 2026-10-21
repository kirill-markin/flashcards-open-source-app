import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type JSX } from "react";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKeyPlaceholder } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildFunnelComparisonTint, chartWidth, neutralChartColor } from "../../charts/chartPrimitives";
import {
  funnelChartHeight,
  renderFunnelStepsChart,
  type FunnelStepBar,
  type FunnelStepGroupBars,
} from "../../charts/chartRenderers";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  parseFunnelAnchorStepId,
  subscribeToFunnelAnchorChanges,
  writeFunnelAnchorToUrl,
  type FunnelAnchor,
} from "./funnelAnchorUrl";
import type { FunnelComparedGroup, FunnelGroup } from "./funnelGroupBy";

/** A main-path step; its `id` is what the URL stores as the anchor, so a label can change freely. */
export type FunnelStage<StepId extends string> = Readonly<{
  id: StepId;
  label: string;
  count: number;
}>;

/**
 * What a grouped chart draws: one coloured series per group, such as the A/B date range comparison,
 * or a date range comparison of groups, each drawn as a pair of bars in its own colour, range A solid
 * and range B a lighter tint of it, named by `rangeLabels` in the key.
 */
export type FunnelChartGroups<StepId extends string> =
  | Readonly<{ kind: "groups"; groups: ReadonlyArray<FunnelGroup<StepId>> }>
  | Readonly<{
    kind: "range-pairs";
    rangeLabels: Readonly<{ a: string; b: string }>;
    groups: ReadonlyArray<FunnelComparedGroup<StepId>>;
  }>;

/** The single series an ungrouped funnel draws; its key is never shown and never collides with a group key. */
const ungroupedFunnelGroupKey = "ungrouped";

export function formatPercentage(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "—";
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/**
 * Every share is a plain ratio of two step counts. A funnel whose steps are counted on their own
 * rather than nested can therefore show a share above 100%, which is written as computed rather than capped.
 *
 * It is called once per group, so a grouped chart measures every group against that group's own
 * first step and its own anchor step rather than against the funnel as a whole.
 */
function buildFunnelStepBars<StepId extends string>(
  stages: ReadonlyArray<FunnelStage<StepId>>,
  anchorIndex: number,
): ReadonlyArray<FunnelStepBar> {
  const firstCount = stages[0]?.count ?? 0;
  const anchorCount = stages[anchorIndex]?.count ?? 0;
  return stages.map((stage, index) => {
    const previousStage = index === 0 ? undefined : stages[index - 1];
    return {
      label: stage.label,
      count: stage.count,
      shareOfFirstLabel: formatPercentage(stage.count, firstCount),
      shareOfAnchorLabel: index < anchorIndex ? "—" : formatPercentage(stage.count, anchorCount),
      shareOfPreviousLabel: previousStage === undefined ? "—" : formatPercentage(stage.count, previousStage.count),
    };
  });
}

function FunnelChartMeta(
  props: Readonly<{
    countLabel: string;
    dateRange: AnalyticsDateRange;
  }>,
): JSX.Element {
  return (
    <div className="chart-meta">
      <div className="funnel-chart-heading">
        <span>{props.countLabel} reaching each step</span>
        <span>Click a step to measure from it</span>
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
    isGrouped: boolean;
    note: JSX.Element;
  }>,
): JSX.Element {
  return (
    <section className="chart-column funnel-chart-column">
      <div className="chart-shell">
        <FunnelChartMeta countLabel={props.countLabel} dateRange={props.dateRange} />
        {props.isGrouped ? <div className="funnel-group-key"><ChartColorKeyPlaceholder /></div> : null}
        <div className="funnel-chart-area">
          <div className="chart-scroll">
            {/* The ready chart's class, so the area keeps its minimum width in the same scroll container. */}
            <div className="funnel-steps-chart">
              <ChartAreaWithNote
                viewBoxWidth={chartWidth}
                viewBoxHeight={funnelChartHeight}
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
    isGrouped: boolean;
    label: string;
  }>,
): JSX.Element {
  return (
    <FunnelChartPanel
      countLabel={props.countLabel}
      dateRange={props.dateRange}
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
    isGrouped: boolean;
    note: JSX.Element;
  }>,
): JSX.Element {
  return (
    <FunnelChartPanel
      countLabel={props.countLabel}
      dateRange={props.dateRange}
      isGrouped={props.isGrouped}
      note={<p className="chart-area-note"><span className="funnel-empty-note">{props.note}</span></p>}
    />
  );
}

/**
 * One funnel's step chart with its click-to-anchor state. Mount it only once the funnel has something
 * to draw. The anchor is read from the URL and written back on every click, so a reload reopens the
 * same anchor and every chart of the funnel on the page follows the click; only a click moves it, and
 * `null` is the default view, measured from the first step. The anchor is one choice for the whole
 * chart: clicking a step re-bases every group on its own count at that step.
 */
export function FunnelStepsChart<StepId extends string>(
  props: Readonly<{
    anchor: FunnelAnchor<StepId>;
    /** The main path in chart order. */
    stages: ReadonlyArray<FunnelStage<StepId>>;
    /**
     * The groups, which replace `stages`; each carries the funnel's full step list in the same order.
     * `undefined` is the ungrouped chart: `stages` becomes the single group everything below draws, so
     * there is one rendering path either way.
     */
    groups: FunnelChartGroups<StepId> | undefined;
    /** What one counted row is, plural: the chart heading. */
    countLabel: string;
    dateRange: AnalyticsDateRange;
  }>,
): JSX.Element {
  const anchorStepId = useSyncExternalStore(
    subscribeToFunnelAnchorChanges,
    () => parseFunnelAnchorStepId(new URLSearchParams(window.location.search), props.anchor),
  );
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const propsGroups = props.groups;
  // PASSED GROUPS ARE WHAT MAKE THE CHART GROUPED, not how many there are: a passed series is always
  // drawn in its own colour and named in the key, so it can never read as the plain funnel.
  const isGrouped = propsGroups !== undefined;
  // Every group carries the same steps in the same order, so the first one names the funnel's steps.
  const chartStages = useMemo<ReadonlyArray<FunnelStage<StepId>>>(() => {
    if (propsGroups === undefined) {
      return props.stages;
    }

    return (propsGroups.kind === "groups" ? propsGroups.groups[0]?.stages : propsGroups.groups[0]?.aStages) ?? [];
  }, [propsGroups, props.stages]);
  const anchorIndex = Math.max(0, chartStages.findIndex((stage) => stage.id === anchorStepId));
  const groupBars = useMemo<ReadonlyArray<FunnelStepGroupBars>>(() => {
    if (propsGroups === undefined) {
      return [{
        key: ungroupedFunnelGroupKey,
        label: props.countLabel,
        // The single bar takes its accent fill from the stylesheet, so no colour is read off this group.
        color: "var(--accent)",
        pairKey: ungroupedFunnelGroupKey,
        pairedRange: null,
        steps: buildFunnelStepBars(props.stages, anchorIndex),
      }];
    }

    if (propsGroups.kind === "groups") {
      return propsGroups.groups.map((group) => ({
        key: group.key,
        label: group.label,
        color: group.color,
        pairKey: group.key,
        pairedRange: null,
        steps: buildFunnelStepBars(group.stages, anchorIndex),
      }));
    }

    // The range is a prefix of the bar's key, so a group key can never collide with another bar's.
    return propsGroups.groups.flatMap((group): ReadonlyArray<FunnelStepGroupBars> => [
      {
        key: `a:${group.key}`,
        label: group.label,
        color: group.color,
        pairKey: group.key,
        pairedRange: "a",
        steps: buildFunnelStepBars(group.aStages, anchorIndex),
      },
      {
        key: `b:${group.key}`,
        label: group.label,
        color: buildFunnelComparisonTint(group.color),
        pairKey: group.key,
        pairedRange: "b",
        steps: buildFunnelStepBars(group.bStages, anchorIndex),
      },
    ]);
  }, [propsGroups, props.countLabel, props.stages, anchorIndex]);
  /** Selecting the current anchor or the first step returns to the default view and clears the URL. */
  const selectAnchorStep = useCallback((stepIndex: number): void => {
    const selectedStepId = chartStages[stepIndex]?.id ?? null;
    const nextStepId = stepIndex === 0 || selectedStepId === anchorStepId ? null : selectedStepId;
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
        <FunnelChartMeta countLabel={props.countLabel} dateRange={props.dateRange} />
        {/* The same key markup the platform charts use, so a colour key reads the same everywhere. */}
        {propsGroups?.kind === "groups" ? (
          <div className="platform-key funnel-group-key" aria-label="Funnel group color key">
            {groupBars.map((group) => (
              <span key={group.key} className="platform-key-item">
                <span className="platform-key-swatch" style={{ backgroundColor: group.color }} />
                <span>{group.label}</span>
              </span>
            ))}
          </div>
        ) : null}
        {/* Each group's swatch shows both of its tints; the last two entries say which tint is which range. */}
        {propsGroups?.kind === "range-pairs" ? (
          <div className="platform-key funnel-group-key" aria-label="Funnel group color key">
            {propsGroups.groups.map((group) => (
              <span key={group.key} className="platform-key-item">
                <span
                  className="platform-key-swatch"
                  style={{ background: `linear-gradient(90deg, ${group.color} 50%, ${buildFunnelComparisonTint(group.color)} 50%)` }}
                />
                <span>{group.label}</span>
              </span>
            ))}
            <span className="platform-key-item">
              <span className="platform-key-swatch" style={{ backgroundColor: neutralChartColor }} />
              <span>Solid: {propsGroups.rangeLabels.a}</span>
            </span>
            <span className="platform-key-item">
              <span className="platform-key-swatch" style={{ backgroundColor: buildFunnelComparisonTint(neutralChartColor) }} />
              <span>Light: {propsGroups.rangeLabels.b}</span>
            </span>
          </div>
        ) : null}
        <div className="chart-scroll">
          <div className="funnel-steps-chart">
            <ChartAreaWithNote
              viewBoxWidth={chartWidth}
              viewBoxHeight={funnelChartHeight}
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

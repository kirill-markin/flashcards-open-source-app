import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { renderFunnelStepsChart, type FunnelStepBar } from "../../charts/chartRenderers";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  parseFunnelAnchorStepId,
  writeFunnelAnchorToUrl,
  type FunnelAnchor,
} from "./funnelAnchorUrl";

/** A main-path step; its `id` is what the URL stores as the anchor, so a label can change freely. */
export type FunnelStage<StepId extends string> = Readonly<{
  id: StepId;
  label: string;
  count: number;
}>;

export function formatPercentage(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "—";
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** Every step is a subset of the one before it, so a later step's count over the anchor's is a conversion rate. */
function buildFunnelStepBars<StepId extends string>(
  stages: ReadonlyArray<FunnelStage<StepId>>,
  anchorIndex: number,
): ReadonlyArray<FunnelStepBar> {
  const firstCount = stages[0]?.count ?? 0;
  const anchorCount = stages[anchorIndex]?.count ?? 0;
  return stages.map((stage, index) => {
    const previousCount = index === 0 ? null : (stages[index - 1]?.count ?? 0);
    return {
      label: stage.label,
      count: stage.count,
      previousCount,
      shareOfFirstLabel: formatPercentage(stage.count, firstCount),
      shareOfAnchorLabel: index < anchorIndex ? "—" : formatPercentage(stage.count, anchorCount),
      shareOfPreviousLabel: previousCount === null ? "—" : formatPercentage(stage.count, previousCount),
    };
  });
}

/** The chart's text alternative: the same numbers the bars carry, for screen readers only. */
function FunnelStepTable(
  props: Readonly<{
    caption: string;
    countLabel: string;
    steps: ReadonlyArray<FunnelStepBar>;
    anchorIndex: number;
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
            <th scope="col">Of first step</th>
            {anchorLabel === null ? null : <th scope="col">Of selected step ({anchorLabel})</th>}
            <th scope="col">Of previous step</th>
          </tr>
        </thead>
        <tbody>
          {props.steps.map((step) => (
            <tr key={step.label}>
              <th scope="row">{step.label}</th>
              <td>{step.count.toLocaleString("en-US")}</td>
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
 * One funnel's step chart with its click-to-anchor state and its hidden table. Mount it only once
 * the funnel has something to draw. The anchor is read from the URL on mount and written back on
 * every click, so a remount after a reload reopens the same anchor; only a click moves it, and
 * `null` is the default view, measured from the first step.
 */
export function FunnelStepsChart<StepId extends string>(
  props: Readonly<{
    anchor: FunnelAnchor<StepId>;
    /** The main path in chart order, each step a subset of the one before it. */
    stages: ReadonlyArray<FunnelStage<StepId>>;
    /** What one counted row is, plural: the chart heading and the table's count column. */
    countLabel: string;
    tableCaption: string;
    dateRange: AnalyticsDateRange;
  }>,
): JSX.Element {
  const [anchorStepId, setAnchorStepId] = useState<StepId | null>(
    () => parseFunnelAnchorStepId(new URLSearchParams(window.location.search), props.anchor),
  );
  const anchorIndex = Math.max(0, props.stages.findIndex((stage) => stage.id === anchorStepId));
  const stepBars = useMemo(() => buildFunnelStepBars(props.stages, anchorIndex), [props.stages, anchorIndex]);
  /** Selecting the current anchor or the first step returns to the default view and clears the URL. */
  const selectAnchorStep = useCallback((stepIndex: number): void => {
    const selectedStepId = props.stages[stepIndex]?.id ?? null;
    const nextStepId = stepIndex === 0 || selectedStepId === anchorStepId ? null : selectedStepId;
    setAnchorStepId(nextStepId);
    writeFunnelAnchorToUrl(props.anchor, nextStepId);
  }, [anchorStepId, props.anchor, props.stages]);

  const chartRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svgElement = chartRef.current;
    if (svgElement === null) {
      return;
    }

    renderFunnelStepsChart({
      svgElement,
      steps: stepBars,
      anchorIndex,
      onSelectStep: selectAnchorStep,
    });
  }, [anchorIndex, stepBars, selectAnchorStep]);

  return (
    <section className="chart-column funnel-chart-column">
      <div className="chart-shell">
        <div className="chart-meta">
          <div className="funnel-chart-heading">
            <span>{props.countLabel} reaching each step</span>
            <span>Click a step to measure from it</span>
          </div>
          <div className="chart-meta-right">
            <span>{props.dateRange.from} to {props.dateRange.to}, inclusive</span>
          </div>
        </div>
        <div className="chart-scroll">
          <svg ref={chartRef} className="funnel-steps-chart" role="group" aria-label="Funnel steps; select a step to measure later steps from it" />
        </div>
      </div>
      <FunnelStepTable
        caption={props.tableCaption}
        countLabel={props.countLabel}
        steps={stepBars}
        anchorIndex={anchorIndex}
      />
    </section>
  );
}

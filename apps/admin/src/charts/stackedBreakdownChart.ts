import * as d3 from "d3";
import { chartMargin, neutralChartColor, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

/** The series a breakdown sums every value outside its top values into. */
export const breakdownOtherValue = "Other";

/** The value a breakdown shows for a NULL or empty one. */
export const breakdownUnknownValue = "Unknown";

const breakdownUnknownColor = "#bab0ac";

// Tableau 10 without its grey, which Unknown takes.
const breakdownValuePalette: ReadonlyArray<string> = d3.schemeTableau10.slice(0, 9);

/** One bar: its count per value, or null when the bar is unavailable; a not final bar is drawn faded. */
export type StackedBreakdownBar = Readonly<{
  key: string;
  countsByValue: ReadonlyMap<string, number> | null;
  notFinal: boolean;
}>;

type MeasuredBreakdownBar = Readonly<{
  key: string;
  countsByValue: ReadonlyMap<string, number>;
  notFinal: boolean;
}>;

/** Colours by value: Other and Unknown in neutral greys, every other value the next palette colour in stack order. */
export function buildBreakdownValueColors(values: ReadonlyArray<string>): ReadonlyMap<string, string> {
  const coloredValues = values.filter((value) => value !== breakdownOtherValue && value !== breakdownUnknownValue);
  if (coloredValues.length > breakdownValuePalette.length) {
    throw new Error(`A breakdown has ${coloredValues.length} values, but its palette holds ${breakdownValuePalette.length}.`);
  }

  return new Map(values.map((value) => {
    if (value === breakdownOtherValue) return [value, neutralChartColor];
    if (value === breakdownUnknownValue) return [value, breakdownUnknownColor];
    return [value, breakdownValuePalette[coloredValues.indexOf(value)]];
  }));
}

export function sumBreakdownBar(countsByValue: ReadonlyMap<string, number>): number {
  return d3.sum(countsByValue.values());
}

/** Bars stacked in `values` order from the bottom; an unavailable bar draws nothing. */
export function renderStackedBreakdownChart(params: Readonly<{
  svgElement: SVGSVGElement;
  bars: ReadonlyArray<StackedBreakdownBar>;
  values: ReadonlyArray<string>;
  getValueColor: (value: string) => string;
  /** The bar holding today, marked in progress; null when the selection ends before today. */
  inProgressKey: string | null;
  yLabel: string;
  xLabel: string;
  formatTick: (key: string) => string;
  getLabel: (key: string) => string;
  getTooltipHtml: (key: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const keys = params.bars.map((bar) => bar.key);
  const measuredBars = params.bars.filter((bar): bar is MeasuredBreakdownBar => bar.countsByValue !== null);
  const peak = d3.max(measuredBars, (bar) => sumBreakdownBar(bar.countsByValue)) ?? 0;
  const y = d3.scaleLinear().domain([0, Math.max(1, peak)]).nice()
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const frame = renderMeaningfulActivityFrame(params.svgElement, keys, y, y.ticks(6).filter(Number.isInteger),
    params.yLabel, params.xLabel, d3.format(",d"), params.formatTick);
  const layers = d3.stack<MeasuredBreakdownBar, string>()
    .keys(params.values)
    .value((bar, value) => bar.countsByValue.get(value) ?? 0)(measuredBars);
  const segments = layers.flatMap((layer) => layer
    .map((point) => ({ key: point.data.key, value: layer.key, notFinal: point.data.notFinal, low: point[0], high: point[1] }))
    .filter((segment) => segment.high > segment.low));
  frame.group.selectAll(".bar-segment").data(segments).join("rect")
    .attr("class", "bar-segment").classed("bar-segment-not-final", (segment) => segment.notFinal)
    .attr("fill", (segment) => params.getValueColor(segment.value))
    .attr("x", (segment) => frame.x(segment.key) ?? 0).attr("width", frame.x.bandwidth())
    .attr("y", (segment) => y(segment.high)).attr("height", (segment) => y(segment.low) - y(segment.high)).attr("rx", 2);
  const inProgressX = params.inProgressKey === null ? undefined : frame.x(params.inProgressKey);
  if (inProgressX !== undefined) {
    frame.group.append("line").attr("x1", inProgressX).attr("x2", inProgressX)
      .attr("y1", 0).attr("y2", frame.innerHeight).attr("stroke", "currentColor").attr("stroke-dasharray", "6 4");
    frame.group.append("text").attr("x", inProgressX + frame.x.bandwidth()).attr("y", -10)
      .attr("text-anchor", "end").attr("fill", "currentColor").text("In progress");
  }
  renderMeaningfulActivityHitTargets(frame, keys, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
}

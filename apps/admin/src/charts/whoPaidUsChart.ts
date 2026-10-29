import * as d3 from "d3";
import { getPaymentSeriesTotal, paymentSeries, type WhoPaidUsBucket } from "../reports/whoPaidUs/query";
import { chartMargin, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderChartNotes, type PlacedChartNote } from "./chartNotes";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

export const paymentColors = { trial: "#4e79a7", first: "#59a14f", recurring: "#f28e2b", cancellations: "#e15759" } as const;

export function renderWhoPaidUsChart(params: Readonly<{
  svgElement: SVGSVGElement;
  buckets: ReadonlyArray<WhoPaidUsBucket>;
  notes: ReadonlyArray<PlacedChartNote>;
  /** The still-filling bucket, drawn faded; null when the range has none. */
  inProgressKey: string | null;
  xLabel: string;
  formatTick: (key: string) => string;
  getLabel: (key: string) => string;
  getTooltipHtml: (key: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const keys = params.buckets.map((entry) => entry.bucket.key);
  const segments = params.buckets.flatMap((entry) => {
    let low = 0;
    return paymentSeries.map((series) => {
      const count = getPaymentSeriesTotal(entry, series);
      const segment = { key: entry.bucket.key, series, count, low, high: low + (count ?? 0) };
      low = segment.high;
      return segment;
    }).filter((segment) => segment.count !== null);
  });
  // Cancellations are drawn below zero, and the axis labels them as positive counts.
  const cancellations = params.buckets.flatMap((entry) => entry.cancellations === null ? []
    : [{ key: entry.bucket.key, series: "cancellations" as const, low: -entry.cancellations.total, high: 0 }]);
  const peak = d3.max(segments, (segment) => segment.high) ?? 0;
  const trough = d3.min(cancellations, (segment) => segment.low) ?? 0;
  // One tick count for nice() and ticks(), so both domain ends, including the one below zero, are labeled ticks.
  const tickCount = 6;
  const y = d3.scaleLinear().domain([trough, Math.max(1, peak)]).nice(tickCount)
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const formatCount = d3.format(",d");
  const frame = renderMeaningfulActivityFrame(params.svgElement, keys, y, y.ticks(tickCount).filter(Number.isInteger),
    "Recorded subscription events", params.xLabel, (value) => formatCount(Math.abs(value)), params.formatTick);
  frame.group.selectAll(".bar-segment").data([...segments, ...cancellations]).join("rect")
    .attr("class", "bar-segment").classed("bar-segment-not-final", (segment) => segment.key === params.inProgressKey)
    .attr("fill", (segment) => paymentColors[segment.series])
    .attr("x", (segment) => frame.x(segment.key) ?? 0).attr("width", frame.x.bandwidth())
    .attr("y", (segment) => y(segment.high)).attr("height", (segment) => y(segment.low) - y(segment.high)).attr("rx", 2);
  frame.group.append("line").attr("class", "chart-zero-line")
    .attr("x1", 0).attr("x2", frame.x.range()[1]).attr("y1", y(0)).attr("y2", y(0));
  renderMeaningfulActivityHitTargets(frame, keys, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
  renderChartNotes(frame.group, frame.x, frame.innerHeight, params.notes, params.tooltipHandlers);
}

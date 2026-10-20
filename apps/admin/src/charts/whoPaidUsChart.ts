import * as d3 from "d3";
import { getPaymentSeriesTotal, paymentSeries, type WhoPaidUsBucket } from "../reports/whoPaidUs/query";
import { chartMargin, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderChartNotes, type PlacedChartNote } from "./chartNotes";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

export const paymentColors = { trial: "#4e79a7", first: "#59a14f", recurring: "#f28e2b" } as const;

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
  const peak = d3.max(segments, (segment) => segment.high) ?? 0;
  const y = d3.scaleLinear().domain([0, Math.max(1, peak)]).nice()
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const frame = renderMeaningfulActivityFrame(params.svgElement, keys, y, y.ticks(6).filter(Number.isInteger),
    "Recorded subscription events", params.xLabel, d3.format(",d"), params.formatTick);
  frame.group.selectAll(".bar-segment").data(segments).join("rect")
    .attr("class", "bar-segment").classed("bar-segment-not-final", (segment) => segment.key === params.inProgressKey)
    .attr("fill", (segment) => paymentColors[segment.series])
    .attr("x", (segment) => frame.x(segment.key) ?? 0).attr("width", frame.x.bandwidth())
    .attr("y", (segment) => y(segment.high)).attr("height", (segment) => y(segment.low) - y(segment.high)).attr("rx", 2);
  renderMeaningfulActivityHitTargets(frame, keys, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
  renderChartNotes(frame.group, frame.x, frame.innerHeight, params.notes, params.tooltipHandlers);
}

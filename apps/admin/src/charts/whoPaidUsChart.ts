import * as d3 from "d3";
import { getPaymentSeriesTotal, paymentSeries, type WhoPaidUsBucket } from "../reports/whoPaidUs/query";
import { chartMargin, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

export const paymentColors = { trial: "#4e79a7", first: "#59a14f", recurring: "#f28e2b" } as const;

export function renderWhoPaidUsChart(params: Readonly<{
  svgElement: SVGSVGElement;
  buckets: ReadonlyArray<WhoPaidUsBucket>;
  /** The bucket holding today, marked in progress; null when the selection ends before today. */
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
    .attr("class", "bar-segment").attr("fill", (segment) => paymentColors[segment.series])
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

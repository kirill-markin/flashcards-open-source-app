import * as d3 from "d3";
import { chartMargin, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

type RatePoint = Readonly<{ key: string; rate: number | null }>;

/** One line of rates across the keys; a null rate draws no point and breaks the line there. */
export function renderRateLineChart(params: Readonly<{
  svgElement: SVGSVGElement;
  keys: ReadonlyArray<string>;
  getRate: (key: string) => number | null;
  color: string;
  yLabel: string;
  xLabel: string;
  /** The bar a dashed vertical line marks at its left edge, with `markerLabel`; null draws no marker. */
  markerKey: string | null;
  markerLabel: string;
  formatTick: (key: string) => string;
  getLabel: (key: string) => string;
  getTooltipHtml: (key: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const points = params.keys.map((key): RatePoint => ({ key, rate: params.getRate(key) }));
  const peak = d3.max(points, (point) => point.rate) ?? 0;
  // Headroom above the peak, at least 10% so an all-zero range still has an axis, and never past 100%.
  const y = d3.scaleLinear().domain([0, Math.min(1, Math.max(0.1, peak * 1.2))]).nice()
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const frame = renderMeaningfulActivityFrame(params.svgElement, params.keys, y, y.ticks(6), params.yLabel, params.xLabel,
    d3.format(".0%"), params.formatTick);
  const getX = (point: RatePoint): number => (frame.x(point.key) ?? 0) + frame.x.bandwidth() / 2;
  const getY = (point: RatePoint): number => y(point.rate ?? 0);
  const line = d3.line<RatePoint>().defined((point) => point.rate !== null).x(getX).y(getY);
  frame.group.append("path").datum(points).attr("fill", "none")
    .attr("stroke", params.color).attr("stroke-width", 3).attr("d", line);
  frame.group.append("g").selectAll("circle").data(points.filter((point) => point.rate !== null)).join("circle")
    .attr("fill", params.color).attr("r", 5).attr("cx", getX).attr("cy", getY);
  const markerX = params.markerKey === null ? undefined : frame.x(params.markerKey);
  if (markerX !== undefined) {
    // The label sits on the side with more room, so it stays inside the plot near either edge.
    const isRightHalf = markerX > frame.x.range()[1] / 2;
    frame.group.append("line").attr("x1", markerX).attr("x2", markerX)
      .attr("y1", 0).attr("y2", frame.innerHeight).attr("stroke", "currentColor").attr("stroke-dasharray", "6 4");
    frame.group.append("text").attr("x", isRightHalf ? markerX - 6 : markerX + 6).attr("y", -10)
      .attr("text-anchor", isRightHalf ? "end" : "start").attr("fill", "currentColor").text(params.markerLabel);
  }
  renderMeaningfulActivityHitTargets(frame, params.keys, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
}

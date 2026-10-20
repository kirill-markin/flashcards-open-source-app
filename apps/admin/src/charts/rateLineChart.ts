import * as d3 from "d3";
import { chartMargin, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderChartNotes, type PlacedChartNote } from "./chartNotes";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

type RatePoint = Readonly<{ key: string; rate: number | null }>;

/**
 * One line of rates across the keys; a null rate draws no point and breaks the line there.
 * The still-filling in-progress key is drawn hollow and faded, reached by a dashed segment from the nearest earlier point.
 */
export function renderRateLineChart(params: Readonly<{
  svgElement: SVGSVGElement;
  keys: ReadonlyArray<string>;
  getRate: (key: string) => number | null;
  color: string;
  inProgressKey: string | null;
  yLabel: string;
  xLabel: string;
  notes: ReadonlyArray<PlacedChartNote>;
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
  const settledPoints = points.map((point): RatePoint => point.key === params.inProgressKey ? { key: point.key, rate: null } : point);
  frame.group.append("path").datum(settledPoints).attr("fill", "none")
    .attr("stroke", params.color).attr("stroke-width", 3).attr("d", line);
  frame.group.append("g").selectAll("circle").data(settledPoints.filter((point) => point.rate !== null)).join("circle")
    .attr("fill", params.color).attr("r", 5).attr("cx", getX).attr("cy", getY);
  const inProgressIndex = points.findIndex((point) => point.key === params.inProgressKey);
  const inProgressPoint = points[inProgressIndex];
  if (inProgressPoint !== undefined && inProgressPoint.rate !== null) {
    const previousPoint = points.slice(0, inProgressIndex).reverse().find((point) => point.rate !== null);
    if (previousPoint !== undefined) {
      frame.group.append("path").datum([previousPoint, inProgressPoint]).attr("class", "rate-line-not-final").attr("fill", "none")
        .attr("stroke", params.color).attr("stroke-width", 3).attr("stroke-dasharray", "6 4").attr("d", line);
    }
    frame.group.append("circle").attr("class", "rate-line-not-final").attr("fill", "none")
      .attr("stroke", params.color).attr("stroke-width", 2).attr("r", 5)
      .attr("cx", getX(inProgressPoint)).attr("cy", getY(inProgressPoint));
  }
  renderMeaningfulActivityHitTargets(frame, params.keys, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
  renderChartNotes(frame.group, frame.x, frame.innerHeight, params.notes, params.tooltipHandlers);
}

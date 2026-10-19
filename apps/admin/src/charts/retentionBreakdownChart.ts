import * as d3 from "d3";
import { chartMargin, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

type RatePoint = Readonly<{ key: string; rate: number | null }>;

/** One line of retention rates per value across the keys; a null rate draws no point and breaks the line there. */
export function renderRetentionBreakdownChart(params: Readonly<{
  svgElement: SVGSVGElement;
  keys: ReadonlyArray<string>;
  values: ReadonlyArray<string>;
  getValueColor: (value: string) => string;
  getRate: (key: string, value: string) => number | null;
  xLabel: string;
  formatTick: (key: string) => string;
  getLabel: (key: string) => string;
  getTooltipHtml: (key: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const y = d3.scaleLinear().domain([0, 1])
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const frame = renderMeaningfulActivityFrame(params.svgElement, params.keys, y, y.ticks(6), "Users who returned", params.xLabel,
    d3.format(".0%"), params.formatTick);
  const getX = (point: RatePoint): number => (frame.x(point.key) ?? 0) + frame.x.bandwidth() / 2;
  const getY = (point: RatePoint): number => y(point.rate ?? 0);
  for (const value of params.values) {
    const points = params.keys.map((key): RatePoint => ({ key, rate: params.getRate(key, value) }));
    const color = params.getValueColor(value);
    const line = d3.line<RatePoint>().defined((point) => point.rate !== null).x(getX).y(getY);
    frame.group.append("path").datum(points).attr("fill", "none")
      .attr("stroke", color).attr("stroke-width", 3).attr("d", line);
    frame.group.append("g").selectAll("circle").data(points.filter((point) => point.rate !== null)).join("circle")
      .attr("fill", color).attr("r", 5).attr("cx", getX).attr("cy", getY);
  }
  renderMeaningfulActivityHitTargets(frame, params.keys, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
}

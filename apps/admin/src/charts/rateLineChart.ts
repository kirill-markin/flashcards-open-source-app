import * as d3 from "d3";
import { chartMargin, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderChartNotes, type PlacedChartNote } from "./chartNotes";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

type RatePoint = Readonly<{ key: string; rate: number | null }>;

type RateLine = Readonly<{
  getRate: (key: string) => number | null;
  color: string;
}>;

type LineChartParams = Readonly<{
  svgElement: SVGSVGElement;
  keys: ReadonlyArray<string>;
  lines: ReadonlyArray<RateLine>;
  inProgressKey: string | null;
  yLabel: string;
  xLabel: string;
  notes: ReadonlyArray<PlacedChartNote>;
  formatTick: (key: string) => string;
  getLabel: (key: string) => string;
  getTooltipHtml: (key: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>;

function getPeakValue(params: LineChartParams): number {
  return d3.max(params.lines.flatMap((rateLine) => params.keys.map((key) => rateLine.getRate(key))), (value) => value) ?? 0;
}

/**
 * Lines of rates across the keys on one y scale; a null rate draws no point and breaks its line there.
 * The still-filling in-progress key is drawn hollow and faded, reached by a dashed segment from the line's nearest earlier point.
 */
export function renderRateLineChart(params: LineChartParams): void {
  const peak = getPeakValue(params);
  // Headroom above the peak, at least 10% so an all-zero range still has an axis, and past 100% only for a rate above it.
  const y = d3.scaleLinear().domain([0, peak > 1 ? peak * 1.2 : Math.min(1, Math.max(0.1, peak * 1.2))]).nice()
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  renderLines(params, y, y.ticks(6), d3.format(".0%"));
}

/** `renderRateLineChart` for counts, whose y axis starts at 0 and reaches at least 1. */
export function renderCountLineChart(params: LineChartParams): void {
  const peak = getPeakValue(params);
  const y = d3.scaleLinear().domain([0, Math.max(1, peak * 1.1)]).nice()
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  // Whole numbers only, so a small count's axis never labels a fraction.
  renderLines(params, y, y.ticks(6).filter((tick) => Number.isInteger(tick)), d3.format(","));
}

function renderLines(
  params: LineChartParams,
  y: d3.ScaleLinear<number, number>,
  yTickValues: ReadonlyArray<number>,
  formatValue: (value: number) => string,
): void {
  const plottedLines = params.lines.map((rateLine) => ({
    color: rateLine.color,
    points: params.keys.map((key): RatePoint => ({ key, rate: rateLine.getRate(key) })),
  }));
  const frame = renderMeaningfulActivityFrame(params.svgElement, params.keys, y, yTickValues, params.yLabel, params.xLabel,
    formatValue, params.formatTick);
  const getX = (point: RatePoint): number => (frame.x(point.key) ?? 0) + frame.x.bandwidth() / 2;
  const getY = (point: RatePoint): number => y(point.rate ?? 0);
  const line = d3.line<RatePoint>().defined((point) => point.rate !== null).x(getX).y(getY);
  plottedLines.forEach(({ color, points }) => {
    const settledPoints = points.map((point): RatePoint => point.key === params.inProgressKey ? { key: point.key, rate: null } : point);
    frame.group.append("path").datum(settledPoints).attr("fill", "none")
      .attr("stroke", color).attr("stroke-width", 3).attr("d", line);
    frame.group.append("g").selectAll("circle").data(settledPoints.filter((point) => point.rate !== null)).join("circle")
      .attr("fill", color).attr("r", 5).attr("cx", getX).attr("cy", getY);
    const inProgressIndex = points.findIndex((point) => point.key === params.inProgressKey);
    const inProgressPoint = points[inProgressIndex];
    if (inProgressPoint !== undefined && inProgressPoint.rate !== null) {
      const previousPoint = points.slice(0, inProgressIndex).reverse().find((point) => point.rate !== null);
      if (previousPoint !== undefined) {
        frame.group.append("path").datum([previousPoint, inProgressPoint]).attr("class", "rate-line-not-final").attr("fill", "none")
          .attr("stroke", color).attr("stroke-width", 3).attr("stroke-dasharray", "6 4").attr("d", line);
      }
      frame.group.append("circle").attr("class", "rate-line-not-final").attr("fill", "none")
        .attr("stroke", color).attr("stroke-width", 2).attr("r", 5)
        .attr("cx", getX(inProgressPoint)).attr("cy", getY(inProgressPoint));
    }
  });
  renderMeaningfulActivityHitTargets(frame, params.keys, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
  renderChartNotes(frame.group, frame.x, frame.innerHeight, params.notes, params.tooltipHandlers);
}

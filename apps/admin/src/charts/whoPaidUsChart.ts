import * as d3 from "d3";
import { getPaymentSeriesTotal, paymentSeries, type WhoPaidUsDay } from "../reports/whoPaidUs/query";
import { chartMargin, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

export const paymentColors = { trial: "#4e79a7", first: "#59a14f", recurring: "#f28e2b" } as const;

export function renderWhoPaidUsChart(params: Readonly<{
  svgElement: SVGSVGElement;
  days: ReadonlyArray<WhoPaidUsDay>;
  today: string;
  getLabel: (date: string) => string;
  getTooltipHtml: (date: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const dates = params.days.map((day) => day.date);
  const segments = params.days.flatMap((day) => {
    let low = 0;
    return paymentSeries.map((series) => {
      const count = getPaymentSeriesTotal(day, series);
      const segment = { date: day.date, series, count, low, high: low + (count ?? 0) };
      low = segment.high;
      return segment;
    }).filter((segment) => segment.count !== null);
  });
  const peak = d3.max(segments, (segment) => segment.high) ?? 0;
  const y = d3.scaleLinear().domain([0, Math.max(1, peak)]).nice()
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const frame = renderMeaningfulActivityFrame(params.svgElement, dates, y, "Recorded subscription events", "Event date (UTC)", d3.format(",d"));
  frame.group.select<SVGGElement>(".axis")
    .call(d3.axisLeft(y).tickValues(y.ticks(6).filter(Number.isInteger)).tickFormat((value) => d3.format(",d")(Number(value))));
  frame.group.selectAll(".bar-segment").data(segments).join("rect")
    .attr("class", "bar-segment").attr("fill", (segment) => paymentColors[segment.series])
    .attr("x", (segment) => frame.x(segment.date) ?? 0).attr("width", frame.x.bandwidth())
    .attr("y", (segment) => y(segment.high)).attr("height", (segment) => y(segment.low) - y(segment.high)).attr("rx", 2);
  const todayX = frame.x(params.today);
  if (todayX !== undefined) {
    frame.group.append("line").attr("x1", todayX).attr("x2", todayX)
      .attr("y1", 0).attr("y2", frame.innerHeight).attr("stroke", "currentColor").attr("stroke-dasharray", "6 4");
    frame.group.append("text").attr("x", todayX + frame.x.bandwidth()).attr("y", -10)
      .attr("text-anchor", "end").attr("fill", "currentColor").text("Today: in progress");
  }
  renderMeaningfulActivityHitTargets(frame, dates, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
}

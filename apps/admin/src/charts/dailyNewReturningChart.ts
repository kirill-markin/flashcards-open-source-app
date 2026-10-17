import * as d3 from "d3";
import type { DailyNewReturningDay } from "../reports/dailyNewReturning/query";
import { chartMargin, stackedChartHeight, uniqueUserCohortColors, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

export function renderDailyNewReturningChart(params: Readonly<{
  svgElement: SVGSVGElement;
  days: ReadonlyArray<DailyNewReturningDay>;
  today: string;
  getLabel: (date: string) => string;
  getTooltipHtml: (date: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const dates = params.days.map((day) => day.date);
  const peak = d3.max(params.days, (day) => (day.newUsers ?? 0) + (day.returningUsers ?? 0)) ?? 0;
  const y = d3.scaleLinear().domain([0, Math.max(1, peak)]).nice()
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const frame = renderMeaningfulActivityFrame(params.svgElement, dates, y, "Unique people", "Date (UTC)", d3.format(",d"));
  frame.group.select<SVGGElement>(".axis")
    .call(d3.axisLeft(y).tickValues(y.ticks(6).filter(Number.isInteger)).tickFormat((value) => d3.format(",d")(Number(value))));
  const coveredDays = params.days.filter((day) => day.newUsers !== null);
  const segments = coveredDays.flatMap((day) => [
    { date: day.date, key: "returning" as const, low: 0, high: day.returningUsers ?? 0 },
    { date: day.date, key: "new" as const, low: day.returningUsers ?? 0, high: (day.returningUsers ?? 0) + (day.newUsers ?? 0) },
  ]);
  frame.group.selectAll(".bar-segment").data(segments).join("rect")
    .attr("class", "bar-segment").attr("fill", (entry) => uniqueUserCohortColors[entry.key])
    .attr("x", (entry) => frame.x(entry.date) ?? 0).attr("width", frame.x.bandwidth())
    .attr("y", (entry) => y(entry.high)).attr("height", (entry) => y(entry.low) - y(entry.high)).attr("rx", 2);
  const todayX = frame.x(params.today);
  if (todayX !== undefined) {
    frame.group.append("line").attr("x1", todayX).attr("x2", todayX)
      .attr("y1", 0).attr("y2", frame.innerHeight).attr("stroke", "currentColor").attr("stroke-dasharray", "6 4");
    frame.group.append("text").attr("x", todayX + frame.x.bandwidth()).attr("y", -10)
      .attr("text-anchor", "end").attr("fill", "currentColor").text("Today: in progress");
  }
  renderMeaningfulActivityHitTargets(frame, dates, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
}

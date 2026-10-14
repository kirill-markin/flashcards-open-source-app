import * as d3 from "d3";
import type { WhoUsedUsDay } from "../reports/whoUsedUs/query";
import { chartMargin, stackedChartHeight, uniqueUserCohortColors, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

export function renderWhoUsedUsChart(params: Readonly<{
  svgElement: SVGSVGElement;
  days: ReadonlyArray<WhoUsedUsDay>;
  getLabel: (date: string) => string;
  getTooltipHtml: (date: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const dates = params.days.map((day) => day.date);
  const peak = d3.max(params.days, (day) => (day.newUsers ?? 0) + (day.returningUsers ?? 0)) ?? 0;
  const y = d3.scaleLinear().domain([0, Math.max(1, peak)]).nice()
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const frame = renderMeaningfulActivityFrame(params.svgElement, dates, y, "Unique meaningful users", "Rolling 7-day window ending (UTC)", d3.format(",d"));
  const coveredDays = params.days.filter((day) => day.newUsers !== null);
  const segments = coveredDays.flatMap((day) => [
    { date: day.date, key: "returning" as const, low: 0, high: day.returningUsers ?? 0 },
    { date: day.date, key: "new" as const, low: day.returningUsers ?? 0, high: (day.returningUsers ?? 0) + (day.newUsers ?? 0) },
  ]);
  frame.group.selectAll(".bar-segment").data(segments).join("rect")
    .attr("class", "bar-segment").attr("fill", (entry) => uniqueUserCohortColors[entry.key])
    .attr("x", (entry) => frame.x(entry.date) ?? 0).attr("width", frame.x.bandwidth())
    .attr("y", (entry) => y(entry.high)).attr("height", (entry) => y(entry.low) - y(entry.high)).attr("rx", 2);
  renderMeaningfulActivityHitTargets(frame, dates, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
}

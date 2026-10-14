import * as d3 from "d3";
import type { WhoCameBackWeek } from "../reports/whoCameBack/query";
import { chartMargin, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

export const retentionSeries = ["w1", "w4"] as const;
export const retentionColors = { w1: "#4e79a7", w4: "#59a14f" } as const;
export const retentionLabels = { w1: "W1", w4: "W4" } as const;

export function renderWhoCameBackChart(params: Readonly<{
  svgElement: SVGSVGElement;
  weeks: ReadonlyArray<WhoCameBackWeek>;
  getLabel: (date: string) => string;
  getTooltipHtml: (date: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const dates = params.weeks.map((week) => week.week);
  const y = d3.scaleLinear().domain([0, 1])
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const frame = renderMeaningfulActivityFrame(params.svgElement, dates, y, "Users who returned", "First meaningful-use week (Monday, UTC)", d3.format(".0%"));
  for (const key of retentionSeries) {
    const line = d3.line<WhoCameBackWeek>()
      .defined((week) => week[key] !== null)
      .x((week) => (frame.x(week.week) ?? 0) + frame.x.bandwidth() / 2)
      .y((week) => {
        const counts = week[key];
        return y(counts === null ? 0 : counts.returned / counts.base);
      });
    frame.group.append("path").datum(params.weeks).attr("fill", "none")
      .attr("stroke", retentionColors[key]).attr("stroke-width", 3).attr("d", line);
    frame.group.selectAll(`.retention-${key}`).data(params.weeks.filter((week) => week[key] !== null)).join("circle")
      .attr("class", `retention-${key}`).attr("fill", retentionColors[key]).attr("r", 5)
      .attr("cx", (week) => (frame.x(week.week) ?? 0) + frame.x.bandwidth() / 2)
      .attr("cy", (week) => {
        const counts = week[key];
        return y(counts === null ? 0 : counts.returned / counts.base);
      });
  }
  renderMeaningfulActivityHitTargets(frame, dates, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
}

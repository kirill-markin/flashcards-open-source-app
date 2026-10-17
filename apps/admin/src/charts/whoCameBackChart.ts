import * as d3 from "d3";
import type { WhoCameBackCohort } from "../reports/whoCameBack/query";
import { chartMargin, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

export const retentionSeries = ["w1", "w4"] as const;
export const retentionColors = { w1: "#4e79a7", w4: "#59a14f" } as const;
export const retentionLabels = { w1: "W1", w4: "W4" } as const;

export function renderWhoCameBackChart(params: Readonly<{
  svgElement: SVGSVGElement;
  cohorts: ReadonlyArray<WhoCameBackCohort>;
  xLabel: string;
  formatTick: (key: string) => string;
  getLabel: (date: string) => string;
  getTooltipHtml: (date: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const keys = params.cohorts.map((cohort) => cohort.bucket.key);
  const y = d3.scaleLinear().domain([0, 1])
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const frame = renderMeaningfulActivityFrame(params.svgElement, keys, y, y.ticks(6), "Users who returned", params.xLabel,
    d3.format(".0%"), params.formatTick);
  for (const key of retentionSeries) {
    const line = d3.line<WhoCameBackCohort>()
      .defined((cohort) => cohort[key] !== null)
      .x((cohort) => (frame.x(cohort.bucket.key) ?? 0) + frame.x.bandwidth() / 2)
      .y((cohort) => {
        const counts = cohort[key];
        return y(counts === null ? 0 : counts.returned / counts.base);
      });
    frame.group.append("path").datum(params.cohorts).attr("fill", "none")
      .attr("stroke", retentionColors[key]).attr("stroke-width", 3).attr("d", line);
    frame.group.selectAll(`.retention-${key}`).data(params.cohorts.filter((cohort) => cohort[key] !== null)).join("circle")
      .attr("class", `retention-${key}`).attr("fill", retentionColors[key]).attr("r", 5)
      .attr("cx", (cohort) => (frame.x(cohort.bucket.key) ?? 0) + frame.x.bandwidth() / 2)
      .attr("cy", (cohort) => {
        const counts = cohort[key];
        return y(counts === null ? 0 : counts.returned / counts.base);
      });
  }
  renderMeaningfulActivityHitTargets(frame, keys, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
}

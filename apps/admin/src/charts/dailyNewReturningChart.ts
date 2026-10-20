import * as d3 from "d3";
import type { NewReturningBucket } from "../reports/dailyNewReturning/query";
import { chartMargin, stackedChartHeight, uniqueUserCohortColors, type ChartTooltipHandlers } from "./chartPrimitives";
import { renderChartNotes, type PlacedChartNote } from "./chartNotes";
import { renderMeaningfulActivityFrame, renderMeaningfulActivityHitTargets } from "./meaningfulActivityFrame";

export function renderDailyNewReturningChart(params: Readonly<{
  svgElement: SVGSVGElement;
  buckets: ReadonlyArray<NewReturningBucket>;
  notes: ReadonlyArray<PlacedChartNote>;
  /** The still-filling bucket, drawn faded; null when the range has none. */
  inProgressKey: string | null;
  xLabel: string;
  formatTick: (key: string) => string;
  getLabel: (key: string) => string;
  getTooltipHtml: (key: string) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const keys = params.buckets.map((entry) => entry.bucket.key);
  const peak = d3.max(params.buckets, (entry) => (entry.newUsers ?? 0) + (entry.returningUsers ?? 0)) ?? 0;
  const y = d3.scaleLinear().domain([0, Math.max(1, peak)]).nice()
    .range([stackedChartHeight - chartMargin.top - chartMargin.bottom, 0]);
  const frame = renderMeaningfulActivityFrame(params.svgElement, keys, y, y.ticks(6).filter(Number.isInteger),
    "Unique people", params.xLabel, d3.format(",d"), params.formatTick);
  const coveredBuckets = params.buckets.filter((entry) => entry.newUsers !== null);
  const segments = coveredBuckets.flatMap((entry) => [
    { key: entry.bucket.key, cohort: "returning" as const, low: 0, high: entry.returningUsers ?? 0 },
    { key: entry.bucket.key, cohort: "new" as const, low: entry.returningUsers ?? 0, high: (entry.returningUsers ?? 0) + (entry.newUsers ?? 0) },
  ]);
  frame.group.selectAll(".bar-segment").data(segments).join("rect")
    .attr("class", "bar-segment").classed("bar-segment-not-final", (segment) => segment.key === params.inProgressKey)
    .attr("fill", (segment) => uniqueUserCohortColors[segment.cohort])
    .attr("x", (segment) => frame.x(segment.key) ?? 0).attr("width", frame.x.bandwidth())
    .attr("y", (segment) => y(segment.high)).attr("height", (segment) => y(segment.low) - y(segment.high)).attr("rx", 2);
  renderMeaningfulActivityHitTargets(frame, keys, params.getLabel, params.getTooltipHtml, params.tooltipHandlers);
  renderChartNotes(frame.group, frame.x, frame.innerHeight, params.notes, params.tooltipHandlers);
}

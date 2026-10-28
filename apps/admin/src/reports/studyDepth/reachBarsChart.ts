import * as d3 from "d3";
import { chartWidth, type ChartTooltipHandlers } from "../../charts/chartPrimitives";
import { escapeHtml } from "../../charts/formatting";
import {
  formatDropShare,
  formatShare,
  minReliablePeopleCount,
  type ReachBar,
} from "./reachBars";

export const reachBarsChartHeight = 380;
const reachBarsChartMargin = { top: 52, right: 24, bottom: 64, left: 68 } as const;
const thresholdRowY = 20;
const dropRowY = 44;
const emptyBarHeight = 2;
const numberFormatter = d3.format(",");

function buildReachBarTooltipHtml(bar: ReachBar, unitLabel: string): string {
  const rows = [
    `<p class="tooltip-title">≥ ${bar.threshold} ${escapeHtml(unitLabel)}</p>`,
    `<div class="tooltip-metric"><span>People</span><strong>${numberFormatter(bar.peopleCount)}</strong></div>`,
    `<div class="tooltip-metric"><span>Of cohort</span><strong>${formatShare(bar.shareOfCohort)}</strong></div>`,
  ];
  if (bar.drop !== null) {
    rows.push(`<div class="tooltip-metric"><span>Lost from ≥ ${bar.drop.previousThreshold}</span><strong>${numberFormatter(bar.drop.lostCount)} (${formatDropShare(bar.drop.share)})</strong></div>`);
  }
  if (bar.isReliable === false) {
    rows.push(`<p class="tooltip-hint">Fewer than ${minReliablePeopleCount} people, too few to read as a rate.</p>`);
  }

  return rows.join("");
}

function getReachBarAriaLabel(bar: ReachBar, unitLabel: string): string {
  const reached = `At least ${bar.threshold} ${unitLabel}: ${bar.peopleCount} people, ${formatShare(bar.shareOfCohort)} of the cohort`;
  return bar.drop === null
    ? reached
    : `${reached}; lost ${bar.drop.lostCount} from at least ${bar.drop.previousThreshold} (${formatDropShare(bar.drop.share)})`;
}

/**
 * Cumulative "reached at least N" bars, each labelled with its count and share of the cohort, with the
 * threshold and the drop from the previous bar in two rows under the axis.
 */
export function renderReachBarsChart(params: Readonly<{
  svgElement: SVGSVGElement;
  bars: ReadonlyArray<ReachBar>;
  /** Plural, as in "reviews", for the tooltip and the accessible labels. */
  unitLabel: string;
  tooltipHandlers: ChartTooltipHandlers;
}>): void {
  const innerWidth = chartWidth - reachBarsChartMargin.left - reachBarsChartMargin.right;
  const innerHeight = reachBarsChartHeight - reachBarsChartMargin.top - reachBarsChartMargin.bottom;
  const x = d3.scaleBand<number>()
    .domain(params.bars.map((bar) => bar.threshold))
    .range([0, innerWidth])
    .paddingInner(0.2)
    .paddingOuter(0.1);
  const y = d3.scaleLinear()
    .domain([0, Math.max(1, ...params.bars.map((bar) => bar.peopleCount))])
    .range([innerHeight, 0]);
  const axisTicks = y.ticks(5).filter((tick) => Number.isInteger(tick));
  const getBarTopY = (bar: ReachBar): number => (bar.peopleCount === 0 ? innerHeight - emptyBarHeight : y(bar.peopleCount));

  const svg = d3.select(params.svgElement);
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${chartWidth} ${reachBarsChartHeight}`);
  const group = svg.append("g")
    .attr("transform", `translate(${reachBarsChartMargin.left},${reachBarsChartMargin.top})`);

  group.append("g")
    .attr("class", "grid")
    .attr("aria-hidden", "true")
    .call(d3.axisLeft(y).tickValues(axisTicks).tickSize(-innerWidth).tickFormat(() => ""))
    .call((grid) => grid.select(".domain").remove());
  group.append("g")
    .attr("class", "axis")
    .attr("aria-hidden", "true")
    .call(d3.axisLeft(y).tickValues(axisTicks).tickFormat((value) => numberFormatter(Number(value))));
  group.append("g")
    .attr("class", "axis")
    .attr("aria-hidden", "true")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickSize(0).tickFormat(() => ""));
  group.append("text")
    .attr("class", "axis-label")
    .attr("aria-hidden", "true")
    .attr("x", -innerHeight / 2)
    .attr("y", -48)
    .attr("transform", "rotate(-90)")
    .attr("text-anchor", "middle")
    .text("People");

  // Row headers in the left margin, beside the two label rows under the axis.
  const rowHeaders = group.append("g").attr("aria-hidden", "true");
  rowHeaders.append("text")
    .attr("class", "reach-row-header")
    .attr("x", -10)
    .attr("y", innerHeight + thresholdRowY)
    .attr("text-anchor", "end")
    .text("at least");
  rowHeaders.append("text")
    .attr("class", "reach-row-header")
    .attr("x", -10)
    .attr("y", innerHeight + dropRowY)
    .attr("text-anchor", "end")
    .text("drop");

  const columns = group.selectAll<SVGGElement, ReachBar>("g.reach-bar")
    .data(params.bars)
    .join("g")
    .attr("class", (bar) => (bar.isReliable ? "reach-bar" : "reach-bar reach-bar-unreliable"))
    .attr("transform", (bar) => `translate(${x(bar.threshold) ?? 0},0)`)
    .attr("role", "img")
    .attr("aria-label", (bar) => getReachBarAriaLabel(bar, params.unitLabel))
    .on("mousemove", (event: MouseEvent, bar: ReachBar) => {
      params.tooltipHandlers.showTooltip(buildReachBarTooltipHtml(bar, params.unitLabel), event.clientX, event.clientY);
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);

  const bandWidth = x.bandwidth();
  const columnInset = (x.step() - bandWidth) / 2;
  // The whole column, value labels and both label rows included, is the hover target.
  columns.append("rect")
    .attr("class", "reach-bar-hit")
    .attr("x", -columnInset)
    .attr("y", -reachBarsChartMargin.top + 2)
    .attr("width", x.step())
    .attr("height", reachBarsChartHeight - 4)
    .attr("rx", 6);
  columns.append("rect")
    .attr("class", (bar) => (bar.peopleCount === 0 ? "reach-bar-rect reach-bar-rect-empty" : "reach-bar-rect"))
    .attr("x", 0)
    .attr("y", getBarTopY)
    .attr("width", bandWidth)
    .attr("height", (bar) => innerHeight - getBarTopY(bar))
    .attr("rx", 4);

  const values = columns.append("text")
    .attr("class", "reach-bar-value")
    .attr("aria-hidden", "true")
    .attr("text-anchor", "middle")
    .attr("y", (bar) => getBarTopY(bar) - 22);
  values.append("tspan")
    .attr("class", "reach-bar-count")
    .attr("x", bandWidth / 2)
    .text((bar) => numberFormatter(bar.peopleCount));
  values.append("tspan")
    .attr("class", "reach-bar-share")
    .attr("x", bandWidth / 2)
    .attr("dy", 15)
    .text((bar) => formatShare(bar.shareOfCohort));

  columns.append("text")
    .attr("class", "reach-bar-threshold")
    .attr("aria-hidden", "true")
    .attr("x", bandWidth / 2)
    .attr("y", innerHeight + thresholdRowY)
    .attr("text-anchor", "middle")
    .text((bar) => `≥ ${bar.threshold}`);
  columns.filter((bar) => bar.drop !== null)
    .append("text")
    .attr("class", (bar) => [
      "reach-bar-drop",
      bar.drop?.isLargest === true ? "reach-bar-drop-largest" : "",
      bar.drop?.isReliable === false ? "reach-bar-drop-unreliable" : "",
    ].filter((className) => className !== "").join(" "))
    .attr("aria-hidden", "true")
    .attr("x", bandWidth / 2)
    .attr("y", innerHeight + dropRowY)
    .attr("text-anchor", "middle")
    .text((bar) => formatDropShare(bar.drop?.share ?? null));
}

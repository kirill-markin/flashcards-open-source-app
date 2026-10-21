import * as d3 from "d3";
import { chartMargin, chartWidth, createTickDates, stackedChartHeight, type ChartTooltipHandlers } from "./chartPrimitives";

/** `yTickValues` place both the grid lines and the left-axis labels, so no grid line goes unlabeled. */
export function renderMeaningfulActivityFrame(
  svgElement: SVGSVGElement,
  dates: ReadonlyArray<string>,
  y: d3.ScaleLinear<number, number>,
  yTickValues: ReadonlyArray<number>,
  yLabel: string,
  xLabel: string,
  formatValue: (value: number) => string,
  formatTick: (date: string) => string,
): Readonly<{
  group: d3.Selection<SVGGElement, unknown, null, undefined>;
  x: d3.ScaleBand<string>;
  innerHeight: number;
}> {
  const innerWidth = chartWidth - chartMargin.left - chartMargin.right;
  const innerHeight = stackedChartHeight - chartMargin.top - chartMargin.bottom;
  const x = d3.scaleBand<string>().domain(dates).range([0, innerWidth]).padding(0.12);
  const svg = d3.select(svgElement);
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${chartWidth} ${stackedChartHeight}`);
  const group = svg.append("g").attr("transform", `translate(${chartMargin.left},${chartMargin.top})`);
  group.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).tickValues(yTickValues).tickSize(-innerWidth).tickFormat(() => ""))
    .call((grid) => grid.select(".domain").remove());
  group.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).tickValues(yTickValues).tickFormat((value) => formatValue(Number(value))));
  group.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickValues(createTickDates(dates)).tickFormat(formatTick))
    .call((axis) => axis.selectAll("text").attr("transform", "rotate(-32)").style("text-anchor", "end").attr("dy", "0.3em"));
  group.append("text").attr("class", "axis-label").attr("transform", "rotate(-90)")
    .attr("x", -innerHeight / 2).attr("y", -48).attr("text-anchor", "middle").text(yLabel);
  group.append("text").attr("class", "axis-label").attr("x", innerWidth / 2)
    .attr("y", innerHeight + 74).attr("text-anchor", "middle").text(xLabel);
  return { group, x, innerHeight };
}

export function renderMeaningfulActivityHitTargets(
  frame: ReturnType<typeof renderMeaningfulActivityFrame>,
  dates: ReadonlyArray<string>,
  getLabel: (date: string) => string,
  getTooltipHtml: (date: string) => string,
  tooltipHandlers: ChartTooltipHandlers,
): void {
  const showFocusedTooltip = function(this: SVGRectElement, _event: FocusEvent, date: string): void {
    const bounds = this.getBoundingClientRect();
    tooltipHandlers.showTooltip(getTooltipHtml(date), bounds.left, bounds.top);
  };
  frame.group.selectAll<SVGRectElement, string>(".activity-chart-hit").data(dates).join("rect")
    .attr("class", "activity-chart-hit")
    .attr("x", (date) => frame.x(date) ?? 0).attr("y", 0)
    .attr("width", frame.x.bandwidth()).attr("height", frame.innerHeight)
    .attr("fill", "transparent").attr("tabindex", 0).attr("role", "img")
    .attr("aria-label", getLabel)
    .on("mousemove", (event: MouseEvent, date: string) => {
      tooltipHandlers.showTooltip(getTooltipHtml(date), event.clientX, event.clientY);
    })
    .on("focus", showFocusedTooltip)
    .on("blur", tooltipHandlers.hideTooltip)
    .on("mouseleave", tooltipHandlers.hideTooltip);
}

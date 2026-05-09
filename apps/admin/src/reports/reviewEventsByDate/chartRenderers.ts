import * as d3 from "d3";
import {
  reviewEventPlatforms,
  type ReviewEventPlatform,
  type ReviewEventsByDateUser,
} from "../../adminApi";
import {
  chartMargin,
  chartWidth,
  getPlatformColor,
  platformLabels,
  simpleChartHeight,
  stackedChartHeight,
  uniqueUserCohortColors,
  uniqueUserCohortKeys,
  uniqueUserCohortLabels,
  type GroupedChartRectEntry,
  type MatrixChartEntry,
  type StackedChartRectEntry,
  type UniqueUserCohortKey,
} from "./chartModel";
import { escapeHtml, formatCompactDateLabel, formatDateRangeLabel } from "./formatting";

type ChartFrameParams = Readonly<{
  chartHeight: number;
  x: d3.ScaleBand<string>;
  y: d3.ScaleLinear<number, number>;
  tickDates: ReadonlyArray<string>;
  yAxisLabel: string;
}>;

type ChartTooltipHandlers = Readonly<{
  showTooltip: (html: string, clientX: number, clientY: number) => void;
  hideTooltip: () => void;
}>;

export type RenderDailyUniqueUsersChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  dailyUniqueUserCohortMatrix: ReadonlyArray<MatrixChartEntry>;
  dailyUniqueUsersByDate: ReadonlyMap<string, number>;
  totalReviewEventsByDate: ReadonlyMap<string, number>;
  peakDailyUniqueUsers: number;
  tooltipHandlers: ChartTooltipHandlers;
}>;

export type RenderUserReviewEventsChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  userMatrix: ReadonlyArray<MatrixChartEntry>;
  userIds: ReadonlyArray<string>;
  userColorScale: d3.ScaleOrdinal<string, string>;
  userById: ReadonlyMap<string, ReviewEventsByDateUser>;
  totalReviewEventsByDate: ReadonlyMap<string, number>;
  peakDailyVolume: number;
  isReportLoading: boolean;
  onUserFilterApply: (userId: string) => void;
  tooltipHandlers: ChartTooltipHandlers;
}>;

export type RenderPlatformActiveUsersChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  platformActiveUsersMatrix: ReadonlyArray<MatrixChartEntry>;
  dailyUniqueUsersByDate: ReadonlyMap<string, number>;
  peakDailyPlatformUsers: number;
  tooltipHandlers: ChartTooltipHandlers;
}>;

export type RenderPlatformReviewEventsChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  platformReviewEventsMatrix: ReadonlyArray<MatrixChartEntry>;
  totalPlatformReviewEventsByDate: ReadonlyMap<string, number>;
  peakDailyPlatformReviewEvents: number;
  tooltipHandlers: ChartTooltipHandlers;
}>;

const numberFormatter = d3.format(",");

function getInnerWidth(): number {
  return chartWidth - chartMargin.left - chartMargin.right;
}

function getInnerHeight(chartHeight: number): number {
  return chartHeight - chartMargin.top - chartMargin.bottom;
}

function createDateScale(dates: ReadonlyArray<string>): d3.ScaleBand<string> {
  return d3.scaleBand<string>()
    .domain(dates)
    .range([0, getInnerWidth()])
    .paddingInner(0.08)
    .paddingOuter(0.04);
}

function renderChartFrame(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  params: ChartFrameParams,
): d3.Selection<SVGGElement, unknown, null, undefined> {
  const innerWidth = getInnerWidth();
  const innerHeight = getInnerHeight(params.chartHeight);

  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${chartWidth} ${params.chartHeight}`);

  const group = svg.append("g").attr("transform", `translate(${chartMargin.left},${chartMargin.top})`);

  group.append("g")
    .attr("class", "grid")
    .call(
      d3.axisLeft(params.y)
        .ticks(Math.min(8, Math.max(2, Math.round(params.y.domain()[1]) + 1)))
        .tickSize(-innerWidth)
        .tickFormat(() => ""),
    )
    .call((grid) => grid.select(".domain").remove());

  group.append("g")
    .attr("class", "axis")
    .call(
      d3.axisLeft(params.y)
        .ticks(Math.min(8, Math.max(2, Math.round(params.y.domain()[1]) + 1)))
        .tickFormat((value) => numberFormatter(Number(value))),
    );

  group.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${innerWidth},0)`)
    .call(
      d3.axisRight(params.y)
        .ticks(Math.min(8, Math.max(2, Math.round(params.y.domain()[1]) + 1)))
        .tickFormat((value) => numberFormatter(Number(value))),
    );

  group.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3.axisBottom(params.x)
        .tickValues(params.tickDates)
        .tickFormat((value) => formatCompactDateLabel(value)),
    )
    .call((axis) => axis.selectAll("text")
      .attr("transform", "rotate(-32)")
      .style("text-anchor", "end")
      .attr("dx", "-0.5em")
      .attr("dy", "0.3em"));

  group.append("text")
    .attr("class", "axis-label")
    .attr("x", -innerHeight / 2)
    .attr("y", -48)
    .attr("transform", "rotate(-90)")
    .attr("text-anchor", "middle")
    .text(params.yAxisLabel);

  group.append("text")
    .attr("class", "axis-label")
    .attr("x", innerWidth / 2)
    .attr("y", innerHeight + 74)
    .attr("text-anchor", "middle")
    .text("Review date");

  return group;
}

export function renderDailyUniqueUsersChart(params: RenderDailyUniqueUsersChartParams): void {
  const svg = d3.select(params.svgElement);
  const x = createDateScale(params.dates);
  const innerHeight = getInnerHeight(simpleChartHeight);
  const y = d3.scaleLinear()
    .domain([0, Math.max(1, params.peakDailyUniqueUsers)])
    .nice()
    .range([innerHeight, 0]);
  const group = renderChartFrame(svg, {
    chartHeight: simpleChartHeight,
    x,
    y,
    tickDates: params.tickDates,
    yAxisLabel: "Unique users",
  });
  const series = d3.stack<MatrixChartEntry>()
    .keys(uniqueUserCohortKeys)
    .value((entry, key) => entry.valuesByKey[key] ?? 0)(params.dailyUniqueUserCohortMatrix);

  group.selectAll(".series")
    .data(series)
    .join("g")
    .attr("class", "series")
    .attr("fill", (segment) => uniqueUserCohortColors[segment.key as UniqueUserCohortKey])
    .selectAll("rect")
    .data((segment) => segment.map((entry) => ({
      key: segment.key,
      date: entry.data.date,
      y0: entry[0],
      y1: entry[1],
      value: entry.data.valuesByKey[segment.key] ?? 0,
    })).filter((entry) => entry.value > 0))
    .join("rect")
    .attr("class", "bar-segment daily-unique-users")
    .attr("x", (entry) => x(entry.date) ?? 0)
    .attr("y", (entry) => y(entry.y1))
    .attr("width", x.bandwidth())
    .attr("height", (entry) => Math.max(0, y(entry.y0) - y(entry.y1)))
    .attr("rx", 3)
    .attr("stroke", "rgba(255, 255, 255, 0.18)")
    .attr("stroke-width", 1)
    .on("mousemove", (event, entry: StackedChartRectEntry) => {
      const cohortKey = entry.key as UniqueUserCohortKey;
      const totalUniqueUsers = params.dailyUniqueUsersByDate.get(entry.date) ?? entry.value;
      params.tooltipHandlers.showTooltip(
        [
          `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
          `<p class="tooltip-subtitle">${escapeHtml(uniqueUserCohortLabels[cohortKey])}</p>`,
          `<div class="tooltip-metric"><span>Unique users in this cohort</span><strong>${numberFormatter(entry.value)}</strong></div>`,
          `<div class="tooltip-metric"><span>Total unique users</span><strong>${numberFormatter(totalUniqueUsers)}</strong></div>`,
          `<div class="tooltip-metric"><span>Total review events</span><strong>${numberFormatter(params.totalReviewEventsByDate.get(entry.date) ?? 0)}</strong></div>`,
        ].join(""),
        event.clientX,
        event.clientY,
      );
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);
}

export function renderUserReviewEventsChart(params: RenderUserReviewEventsChartParams): void {
  const svg = d3.select(params.svgElement);
  const x = createDateScale(params.dates);
  const innerHeight = getInnerHeight(stackedChartHeight);
  const y = d3.scaleLinear()
    .domain([0, Math.max(1, params.peakDailyVolume)])
    .nice()
    .range([innerHeight, 0]);
  const group = renderChartFrame(svg, {
    chartHeight: stackedChartHeight,
    x,
    y,
    tickDates: params.tickDates,
    yAxisLabel: "Review events",
  });
  const series = d3.stack<MatrixChartEntry>()
    .keys(params.userIds)
    .value((entry, key) => entry.valuesByKey[key] ?? 0)(params.userMatrix);
  const bars = group.selectAll(".series")
    .data(series)
    .join("g")
    .attr("class", "series")
    .attr("fill", (segment) => params.userColorScale(segment.key))
    .selectAll("rect")
    .data((segment) => segment.map((entry) => ({
      key: segment.key,
      date: entry.data.date,
      y0: entry[0],
      y1: entry[1],
      value: entry.data.valuesByKey[segment.key] ?? 0,
    })).filter((entry) => entry.value > 0))
    .join("rect")
    .attr("class", `bar-segment user-review-events${params.isReportLoading ? "" : " clickable"}`)
    .attr("x", (entry) => x(entry.date) ?? 0)
    .attr("y", (entry) => y(entry.y1))
    .attr("width", x.bandwidth())
    .attr("height", (entry) => Math.max(0, y(entry.y0) - y(entry.y1)))
    .attr("rx", 2)
    .on("mousemove", (event, entry: StackedChartRectEntry) => {
      const user = params.userById.get(entry.key);
      if (user === undefined) {
        return;
      }

      params.tooltipHandlers.showTooltip(
        [
          `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
          `<p class="tooltip-user-primary">${escapeHtml(user.email)}</p>`,
          `<p class="tooltip-user-secondary">${escapeHtml(user.userId)}</p>`,
          `<div class="tooltip-metric"><span>User review events</span><strong>${numberFormatter(entry.value)}</strong></div>`,
          `<div class="tooltip-metric"><span>Total on this date</span><strong>${numberFormatter(params.totalReviewEventsByDate.get(entry.date) ?? entry.value)}</strong></div>`,
          `<div class="tooltip-metric"><span>User total</span><strong>${numberFormatter(user.totalReviewEvents)}</strong></div>`,
        ].join(""),
        event.clientX,
        event.clientY,
      );
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);

  if (params.isReportLoading === false) {
    bars.on("click", (_event: MouseEvent, entry: StackedChartRectEntry) => {
      params.onUserFilterApply(entry.key);
    });
  } else {
    bars.on("click", null);
  }
}

export function renderPlatformActiveUsersChart(params: RenderPlatformActiveUsersChartParams): void {
  const svg = d3.select(params.svgElement);
  const x = createDateScale(params.dates);
  const innerHeight = getInnerHeight(stackedChartHeight);
  const platformUsersX = d3.scaleBand<ReviewEventPlatform>()
    .domain(reviewEventPlatforms)
    .range([0, x.bandwidth()])
    .paddingInner(0.16)
    .paddingOuter(0.08);
  const y = d3.scaleLinear()
    .domain([0, Math.max(1, params.peakDailyPlatformUsers)])
    .nice()
    .range([innerHeight, 0]);
  const group = renderChartFrame(svg, {
    chartHeight: stackedChartHeight,
    x,
    y,
    tickDates: params.tickDates,
    yAxisLabel: "Active users",
  });
  const bars = params.platformActiveUsersMatrix.flatMap((entry) => reviewEventPlatforms.map((platform) => ({
    key: platform,
    date: entry.date,
    value: entry.valuesByKey[platform] ?? 0,
  })).filter((item) => item.value > 0));

  group.selectAll<SVGGElement, GroupedChartRectEntry>(".series")
    .data(bars)
    .join("rect")
    .attr("class", "bar-segment")
    .attr("fill", (entry) => getPlatformColor(entry.key))
    .attr("x", (entry) => (x(entry.date) ?? 0) + (platformUsersX(entry.key) ?? 0))
    .attr("y", (entry) => y(entry.value))
    .attr("width", platformUsersX.bandwidth())
    .attr("height", (entry) => Math.max(0, innerHeight - y(entry.value)))
    .attr("rx", 2)
    .on("mousemove", (event, entry: GroupedChartRectEntry) => {
      params.tooltipHandlers.showTooltip(
        [
          `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
          `<p class="tooltip-subtitle">${escapeHtml(platformLabels[entry.key])}</p>`,
          `<div class="tooltip-metric"><span>Active users on this platform</span><strong>${numberFormatter(entry.value)}</strong></div>`,
          `<div class="tooltip-metric"><span>Total unique users on this date</span><strong>${numberFormatter(params.dailyUniqueUsersByDate.get(entry.date) ?? 0)}</strong></div>`,
        ].join(""),
        event.clientX,
        event.clientY,
      );
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);
}

export function renderPlatformReviewEventsChart(params: RenderPlatformReviewEventsChartParams): void {
  const svg = d3.select(params.svgElement);
  const x = createDateScale(params.dates);
  const innerHeight = getInnerHeight(stackedChartHeight);
  const y = d3.scaleLinear()
    .domain([0, Math.max(1, params.peakDailyPlatformReviewEvents)])
    .nice()
    .range([innerHeight, 0]);
  const group = renderChartFrame(svg, {
    chartHeight: stackedChartHeight,
    x,
    y,
    tickDates: params.tickDates,
    yAxisLabel: "Review events",
  });
  const series = d3.stack<MatrixChartEntry>()
    .keys(reviewEventPlatforms)
    .value((entry, key) => entry.valuesByKey[key] ?? 0)(params.platformReviewEventsMatrix);

  group.selectAll(".series")
    .data(series)
    .join("g")
    .attr("class", "series")
    .attr("fill", (segment) => getPlatformColor(segment.key))
    .selectAll("rect")
    .data((segment) => segment.map((entry) => ({
      key: segment.key,
      date: entry.data.date,
      y0: entry[0],
      y1: entry[1],
      value: entry.data.valuesByKey[segment.key] ?? 0,
    })).filter((entry) => entry.value > 0))
    .join("rect")
    .attr("class", "bar-segment")
    .attr("x", (entry) => x(entry.date) ?? 0)
    .attr("y", (entry) => y(entry.y1))
    .attr("width", x.bandwidth())
    .attr("height", (entry) => Math.max(0, y(entry.y0) - y(entry.y1)))
    .attr("rx", 2)
    .on("mousemove", (event, entry: StackedChartRectEntry) => {
      params.tooltipHandlers.showTooltip(
        [
          `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
          `<p class="tooltip-subtitle">${escapeHtml(platformLabels[entry.key as ReviewEventPlatform])}</p>`,
          `<div class="tooltip-metric"><span>Review events</span><strong>${numberFormatter(entry.value)}</strong></div>`,
          `<div class="tooltip-metric"><span>All platforms on this date</span><strong>${numberFormatter(params.totalPlatformReviewEventsByDate.get(entry.date) ?? 0)}</strong></div>`,
        ].join(""),
        event.clientX,
        event.clientY,
      );
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);
}

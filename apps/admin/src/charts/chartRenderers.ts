import * as d3 from "d3";
import {
  productEventDeviceTypes,
  productEventOsNames,
  reviewEventPlatforms,
  type ProductEventDeviceType,
  type ProductEventOsName,
  type ReviewEventPlatform,
  type ReviewEventsByDateUser,
} from "../adminApi";
import type { UserColorScale } from "../dashboard/userColors";
import { getUserPath } from "../routing";
import { renderChartNotes, type PlacedChartNote } from "./chartNotes";
import {
  chartMargin,
  chartWidth,
  dailyActiveUsersUniqueTotalMarkerColor,
  dailyTotalBarColor,
  deviceTypeColors,
  deviceTypeLabels,
  funnelHashedSegmentMixColor,
  getPlatformColor,
  isNewTabClick,
  openPathInNewTab,
  openPathOnMiddleClick,
  osNameColors,
  osNameLabels,
  platformLabels,
  preventMiddleClickAutoscroll,
  simpleChartHeight,
  stackedChartHeight,
  uniqueUserCohortColors,
  uniqueUserCohortKeys,
  uniqueUserCohortLabels,
  type ChartTooltipHandlers,
  type ChartUser,
  type GroupedChartRectEntry,
  type MatrixChartEntry,
  type PackageColorScale,
  type StackedChartRectEntry,
  type UniqueUserCohortKey,
} from "./chartPrimitives";
import { escapeHtml, formatCompactDateLabel, formatDateRangeLabel } from "./formatting";

type ChartFrameParams = Readonly<{
  chartHeight: number;
  x: d3.ScaleBand<string>;
  y: d3.ScaleLinear<number, number>;
  tickDates: ReadonlyArray<string>;
  formatTickLabel: (date: string) => string;
  yAxisLabel: string;
  xAxisLabel: string;
}>;

type UserStackedBarChartParams<User extends ChartUser> = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  userMatrix: ReadonlyArray<MatrixChartEntry>;
  userIds: ReadonlyArray<string>;
  userColorScale: UserColorScale;
  userById: ReadonlyMap<string, User>;
  peakStackedValue: number;
  yAxisLabel: string;
  xAxisLabel: string;
  segmentClass: string;
  buildTooltipMetricsHtml: (entry: StackedChartRectEntry, user: User) => string;
  onUserFilterApply: (userId: string) => void;
  tooltipHandlers: ChartTooltipHandlers;
}>;

type UniqueUserCohortChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  cohortMatrix: ReadonlyArray<MatrixChartEntry>;
  peakDailyUniqueUsers: number;
  yAxisLabel: string;
  xAxisLabel: string;
  buildTooltipMetricsHtml: (entry: StackedChartRectEntry) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>;

type KeyedStackedBarChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  matrix: ReadonlyArray<MatrixChartEntry>;
  keys: ReadonlyArray<string>;
  getKeyColor: (key: string) => string;
  getKeyLabel: (key: string) => string;
  peakStackedValue: number;
  yAxisLabel: string;
  xAxisLabel: string;
  formatTickLabel: (date: string) => string;
  formatTitleLabel: (date: string) => string;
  buildTooltipMetricsHtml: (entry: StackedChartRectEntry) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>;

type KeyedGroupedUsersChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  matrix: ReadonlyArray<MatrixChartEntry>;
  keys: ReadonlyArray<string>;
  getKeyColor: (key: string) => string;
  getKeyLabel: (key: string) => string;
  peakGroupedValue: number;
  yAxisLabel: string;
  xAxisLabel: string;
  buildTooltipMetricsHtml: (entry: GroupedChartRectEntry) => string;
  tooltipHandlers: ChartTooltipHandlers;
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
  userColorScale: UserColorScale;
  userById: ReadonlyMap<string, ReviewEventsByDateUser>;
  totalReviewEventsByDate: ReadonlyMap<string, number>;
  peakDailyVolume: number;
  onUserFilterApply: (userId: string) => void;
  tooltipHandlers: ChartTooltipHandlers;
}>;

export type RenderDailyActiveUsersChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  dailyActiveUserCohortMatrix: ReadonlyArray<MatrixChartEntry>;
  dailyActiveUsersByDate: ReadonlyMap<string, number>;
  peakDailyActiveUsers: number;
  tooltipHandlers: ChartTooltipHandlers;
}>;

export type RenderDailyActiveUsersTotalChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  dailyActiveUsersByDate: ReadonlyMap<string, number>;
  peakDailyActiveUsers: number;
  tooltipHandlers: ChartTooltipHandlers;
}>;

/** One breakdown of daily active users whose keys can overlap: platform, OS name or device type. */
export type RenderDailyActiveUsersKeyedBreakdownChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  activeUsersMatrix: ReadonlyArray<MatrixChartEntry>;
  dailyActiveUsersByDate: ReadonlyMap<string, number>;
  /** The taller of each day's stack and its unique-user total, over the range. */
  peakDailyValue: number;
  tooltipHandlers: ChartTooltipHandlers;
}>;

type DailyActiveUsersOverlappingStackChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  matrix: ReadonlyArray<MatrixChartEntry>;
  keys: ReadonlyArray<string>;
  getKeyColor: (key: string) => string;
  getKeyLabel: (key: string) => string;
  segmentMetricLabel: string;
  dailyActiveUsersByDate: ReadonlyMap<string, number>;
  peakDailyValue: number;
  tooltipHandlers: ChartTooltipHandlers;
}>;

type DailyTotalEntry = Readonly<{
  date: string;
  value: number;
}>;

type DailyTotalBarChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  totalsByDate: ReadonlyMap<string, number>;
  peakDailyTotal: number;
  yAxisLabel: string;
  xAxisLabel: string;
  tooltipMetricLabel: string;
  tooltipHandlers: ChartTooltipHandlers;
}>;

type KeyedStackedBarChartFrame = Readonly<{
  group: d3.Selection<SVGGElement, unknown, null, undefined>;
  x: d3.ScaleBand<string>;
  y: d3.ScaleLinear<number, number>;
}>;

export type RenderDailyFriendInvitationsChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  friendInvitationsByDate: ReadonlyMap<string, number>;
  peakDailyFriendInvitations: number;
  tooltipHandlers: ChartTooltipHandlers;
}>;

export type RenderDailyFriendConnectionsChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  friendConnectionsByDate: ReadonlyMap<string, number>;
  peakDailyFriendConnections: number;
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

export type RenderCatalogInstallsByPackageChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  packageInstallsMatrix: ReadonlyArray<MatrixChartEntry>;
  packageSlugs: ReadonlyArray<string>;
  packageColorScale: PackageColorScale;
  totalInstallsByDate: ReadonlyMap<string, number>;
  /** Cards added per `${date}:${packageSlug}`, which is the granularity of one stack segment. */
  cardCountByDateAndPackageSlug: ReadonlyMap<string, number>;
  peakDailyInstalls: number;
  tooltipHandlers: ChartTooltipHandlers;
}>;

const numberFormatter = d3.format(",");

/** The tooltip cannot hold a link, so a per-user segment names its two click gestures instead. */
const userSegmentClickHintHtml = `<p class="tooltip-hint">Click to filter · ⌘/Ctrl-click opens the user</p>`;

function getUserSegmentPath(entry: StackedChartRectEntry): string {
  return getUserPath(entry.key, "profile");
}

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
        .tickFormat((value) => params.formatTickLabel(value)),
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
    .text(params.xAxisLabel);

  return group;
}

function renderUserStackedBarChart<User extends ChartUser>(params: UserStackedBarChartParams<User>): void {
  const svg = d3.select(params.svgElement);
  const x = createDateScale(params.dates);
  const innerHeight = getInnerHeight(stackedChartHeight);
  const y = d3.scaleLinear()
    .domain([0, Math.max(1, params.peakStackedValue)])
    .nice()
    .range([innerHeight, 0]);
  const group = renderChartFrame(svg, {
    chartHeight: stackedChartHeight,
    x,
    y,
    tickDates: params.tickDates,
    formatTickLabel: formatCompactDateLabel,
    yAxisLabel: params.yAxisLabel,
    xAxisLabel: params.xAxisLabel,
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
    .attr("class", `bar-segment ${params.segmentClass} clickable`)
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
          params.buildTooltipMetricsHtml(entry, user),
          userSegmentClickHintHtml,
        ].join(""),
        event.clientX,
        event.clientY,
      );
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);

  bars.on("click", (event: MouseEvent, entry: StackedChartRectEntry) => {
    if (isNewTabClick(event)) {
      openPathInNewTab(getUserSegmentPath(entry));
      return;
    }

    params.onUserFilterApply(entry.key);
  })
    .on("mousedown", preventMiddleClickAutoscroll)
    .on("auxclick", openPathOnMiddleClick(getUserSegmentPath));
}

function renderUniqueUserCohortChart(params: UniqueUserCohortChartParams): void {
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
    formatTickLabel: formatCompactDateLabel,
    yAxisLabel: params.yAxisLabel,
    xAxisLabel: params.xAxisLabel,
  });
  const series = d3.stack<MatrixChartEntry>()
    .keys(uniqueUserCohortKeys)
    .value((entry, key) => entry.valuesByKey[key] ?? 0)(params.cohortMatrix);

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
      params.tooltipHandlers.showTooltip(
        [
          `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
          `<p class="tooltip-subtitle">${escapeHtml(uniqueUserCohortLabels[cohortKey])}</p>`,
          params.buildTooltipMetricsHtml(entry),
        ].join(""),
        event.clientX,
        event.clientY,
      );
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);
}

export function renderDailyUniqueUsersChart(params: RenderDailyUniqueUsersChartParams): void {
  renderUniqueUserCohortChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    cohortMatrix: params.dailyUniqueUserCohortMatrix,
    peakDailyUniqueUsers: params.peakDailyUniqueUsers,
    yAxisLabel: "Unique users",
    xAxisLabel: "Review date",
    buildTooltipMetricsHtml: (entry) => [
      `<div class="tooltip-metric"><span>Unique users in this cohort</span><strong>${numberFormatter(entry.value)}</strong></div>`,
      `<div class="tooltip-metric"><span>Total unique users</span><strong>${numberFormatter(params.dailyUniqueUsersByDate.get(entry.date) ?? entry.value)}</strong></div>`,
      `<div class="tooltip-metric"><span>Total review events</span><strong>${numberFormatter(params.totalReviewEventsByDate.get(entry.date) ?? 0)}</strong></div>`,
    ].join(""),
    tooltipHandlers: params.tooltipHandlers,
  });
}

// New versus returning is the report's own cohort definition and not the review report's first review
// day. `apps/admin/src/reports/dailyActiveUsers/query.ts` states which `app_opened` rows that first
// day is derived from; this renderer only draws the cohorts it is handed.
export function renderDailyActiveUsersChart(params: RenderDailyActiveUsersChartParams): void {
  renderUniqueUserCohortChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    cohortMatrix: params.dailyActiveUserCohortMatrix,
    peakDailyUniqueUsers: params.peakDailyActiveUsers,
    yAxisLabel: "Active users",
    xAxisLabel: "Date",
    buildTooltipMetricsHtml: (entry) => [
      `<div class="tooltip-metric"><span>Active users in this cohort</span><strong>${numberFormatter(entry.value)}</strong></div>`,
      `<div class="tooltip-metric"><span>Total active users</span><strong>${numberFormatter(params.dailyActiveUsersByDate.get(entry.date) ?? entry.value)}</strong></div>`,
    ].join(""),
    tooltipHandlers: params.tooltipHandlers,
  });
}

function renderDailyTotalBarChart(params: DailyTotalBarChartParams): void {
  const svg = d3.select(params.svgElement);
  const x = createDateScale(params.dates);
  const innerHeight = getInnerHeight(simpleChartHeight);
  const y = d3.scaleLinear()
    .domain([0, Math.max(1, params.peakDailyTotal)])
    .nice()
    .range([innerHeight, 0]);
  const group = renderChartFrame(svg, {
    chartHeight: simpleChartHeight,
    x,
    y,
    tickDates: params.tickDates,
    formatTickLabel: formatCompactDateLabel,
    yAxisLabel: params.yAxisLabel,
    xAxisLabel: params.xAxisLabel,
  });
  const bars: ReadonlyArray<DailyTotalEntry> = params.dates
    .map((date) => ({ date, value: params.totalsByDate.get(date) ?? 0 }))
    .filter((entry) => entry.value > 0);

  group.selectAll<SVGRectElement, DailyTotalEntry>(".bar-segment")
    .data(bars)
    .join("rect")
    .attr("class", "bar-segment")
    .attr("fill", dailyTotalBarColor)
    .attr("x", (entry) => x(entry.date) ?? 0)
    .attr("y", (entry) => y(entry.value))
    .attr("width", x.bandwidth())
    .attr("height", (entry) => Math.max(0, innerHeight - y(entry.value)))
    .attr("rx", 3)
    .on("mousemove", (event, entry: DailyTotalEntry) => {
      params.tooltipHandlers.showTooltip(
        [
          `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
          `<div class="tooltip-metric"><span>${escapeHtml(params.tooltipMetricLabel)}</span><strong>${numberFormatter(entry.value)}</strong></div>`,
        ].join(""),
        event.clientX,
        event.clientY,
      );
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);
}

export function renderDailyActiveUsersTotalChart(params: RenderDailyActiveUsersTotalChartParams): void {
  renderDailyTotalBarChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    totalsByDate: params.dailyActiveUsersByDate,
    peakDailyTotal: params.peakDailyActiveUsers,
    yAxisLabel: "Active users",
    xAxisLabel: "Date",
    tooltipMetricLabel: "Unique active users",
    tooltipHandlers: params.tooltipHandlers,
  });
}

export function renderUserReviewEventsChart(params: RenderUserReviewEventsChartParams): void {
  renderUserStackedBarChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    userMatrix: params.userMatrix,
    userIds: params.userIds,
    userColorScale: params.userColorScale,
    userById: params.userById,
    peakStackedValue: params.peakDailyVolume,
    yAxisLabel: "Review events",
    xAxisLabel: "Review date",
    segmentClass: "user-review-events",
    buildTooltipMetricsHtml: (entry, user) => [
      `<div class="tooltip-metric"><span>User review events</span><strong>${numberFormatter(entry.value)}</strong></div>`,
      `<div class="tooltip-metric"><span>Total on this date</span><strong>${numberFormatter(params.totalReviewEventsByDate.get(entry.date) ?? entry.value)}</strong></div>`,
      `<div class="tooltip-metric"><span>User total</span><strong>${numberFormatter(user.totalReviewEvents)}</strong></div>`,
    ].join(""),
    onUserFilterApply: params.onUserFilterApply,
    tooltipHandlers: params.tooltipHandlers,
  });
}

export function renderDailyFriendInvitationsChart(params: RenderDailyFriendInvitationsChartParams): void {
  renderDailyTotalBarChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    totalsByDate: params.friendInvitationsByDate,
    peakDailyTotal: params.peakDailyFriendInvitations,
    yAxisLabel: "Invite links",
    xAxisLabel: "Date",
    tooltipMetricLabel: "Invite links created",
    tooltipHandlers: params.tooltipHandlers,
  });
}

export function renderDailyFriendConnectionsChart(params: RenderDailyFriendConnectionsChartParams): void {
  renderDailyTotalBarChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    totalsByDate: params.friendConnectionsByDate,
    peakDailyTotal: params.peakDailyFriendConnections,
    yAxisLabel: "Connections",
    xAxisLabel: "Date",
    tooltipMetricLabel: "Connections at end of day",
    tooltipHandlers: params.tooltipHandlers,
  });
}

function renderKeyedGroupedUsersChart(params: KeyedGroupedUsersChartParams): void {
  const svg = d3.select(params.svgElement);
  const x = createDateScale(params.dates);
  const innerHeight = getInnerHeight(stackedChartHeight);
  const keyX = d3.scaleBand<string>()
    .domain(params.keys)
    .range([0, x.bandwidth()])
    .paddingInner(0.16)
    .paddingOuter(0.08);
  const y = d3.scaleLinear()
    .domain([0, Math.max(1, params.peakGroupedValue)])
    .nice()
    .range([innerHeight, 0]);
  const group = renderChartFrame(svg, {
    chartHeight: stackedChartHeight,
    x,
    y,
    tickDates: params.tickDates,
    formatTickLabel: formatCompactDateLabel,
    yAxisLabel: params.yAxisLabel,
    xAxisLabel: params.xAxisLabel,
  });
  const bars = params.matrix.flatMap((entry) => params.keys.map((key) => ({
    key,
    date: entry.date,
    value: entry.valuesByKey[key] ?? 0,
  })).filter((item) => item.value > 0));

  group.selectAll<SVGGElement, GroupedChartRectEntry>(".series")
    .data(bars)
    .join("rect")
    .attr("class", "bar-segment")
    .attr("fill", (entry) => params.getKeyColor(entry.key))
    .attr("x", (entry) => (x(entry.date) ?? 0) + (keyX(entry.key) ?? 0))
    .attr("y", (entry) => y(entry.value))
    .attr("width", keyX.bandwidth())
    .attr("height", (entry) => Math.max(0, innerHeight - y(entry.value)))
    .attr("rx", 2)
    .on("mousemove", (event, entry: GroupedChartRectEntry) => {
      params.tooltipHandlers.showTooltip(
        [
          `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
          `<p class="tooltip-subtitle">${escapeHtml(params.getKeyLabel(entry.key))}</p>`,
          params.buildTooltipMetricsHtml(entry),
        ].join(""),
        event.clientX,
        event.clientY,
      );
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);
}

export function renderPlatformActiveUsersChart(params: RenderPlatformActiveUsersChartParams): void {
  renderKeyedGroupedUsersChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    matrix: params.platformActiveUsersMatrix,
    keys: reviewEventPlatforms,
    getKeyColor: getPlatformColor,
    getKeyLabel: (key) => platformLabels[key as ReviewEventPlatform],
    peakGroupedValue: params.peakDailyPlatformUsers,
    yAxisLabel: "Reviewing users",
    xAxisLabel: "Review date",
    buildTooltipMetricsHtml: (entry) => [
      `<div class="tooltip-metric"><span>Reviewing users on this platform</span><strong>${numberFormatter(entry.value)}</strong></div>`,
      `<div class="tooltip-metric"><span>Total unique users on this date</span><strong>${numberFormatter(params.dailyUniqueUsersByDate.get(entry.date) ?? 0)}</strong></div>`,
    ].join(""),
    tooltipHandlers: params.tooltipHandlers,
  });
}

function renderKeyedStackedBarChart(params: KeyedStackedBarChartParams): KeyedStackedBarChartFrame {
  const svg = d3.select(params.svgElement);
  const x = createDateScale(params.dates);
  const innerHeight = getInnerHeight(stackedChartHeight);
  const y = d3.scaleLinear()
    .domain([0, Math.max(1, params.peakStackedValue)])
    .nice()
    .range([innerHeight, 0]);
  const group = renderChartFrame(svg, {
    chartHeight: stackedChartHeight,
    x,
    y,
    tickDates: params.tickDates,
    formatTickLabel: params.formatTickLabel,
    yAxisLabel: params.yAxisLabel,
    xAxisLabel: params.xAxisLabel,
  });
  const series = d3.stack<MatrixChartEntry>()
    .keys(params.keys)
    .value((entry, key) => entry.valuesByKey[key] ?? 0)(params.matrix);

  group.selectAll(".series")
    .data(series)
    .join("g")
    .attr("class", "series")
    .attr("fill", (segment) => params.getKeyColor(segment.key))
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
          `<p class="tooltip-title">${escapeHtml(params.formatTitleLabel(entry.date))}</p>`,
          `<p class="tooltip-subtitle">${escapeHtml(params.getKeyLabel(entry.key))}</p>`,
          params.buildTooltipMetricsHtml(entry),
        ].join(""),
        event.clientX,
        event.clientY,
      );
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);

  return { group, x, y };
}

// A person active on the phone and the browser on one day sits in both segments, so a stack can rise
// above the day's unique total; the marker drawn over it is that total, and the only number to read
// as "how many people".
function renderDailyActiveUsersOverlappingStackChart(params: DailyActiveUsersOverlappingStackChartParams): void {
  const frame = renderKeyedStackedBarChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    matrix: params.matrix,
    keys: params.keys,
    getKeyColor: params.getKeyColor,
    getKeyLabel: params.getKeyLabel,
    peakStackedValue: params.peakDailyValue,
    yAxisLabel: "Active users",
    xAxisLabel: "Date",
    formatTickLabel: formatCompactDateLabel,
    formatTitleLabel: formatDateRangeLabel,
    buildTooltipMetricsHtml: (entry) => [
      `<div class="tooltip-metric"><span>${escapeHtml(params.segmentMetricLabel)}</span><strong>${numberFormatter(entry.value)}</strong></div>`,
      `<div class="tooltip-metric"><span>Unique active users on this date</span><strong>${numberFormatter(params.dailyActiveUsersByDate.get(entry.date) ?? 0)}</strong></div>`,
    ].join(""),
    tooltipHandlers: params.tooltipHandlers,
  });
  const stackTotalByDate = new Map(params.matrix.map((entry) => [
    entry.date,
    d3.sum(params.keys, (key) => entry.valuesByKey[key] ?? 0),
  ]));
  const markers: ReadonlyArray<DailyTotalEntry> = params.dates
    .map((date) => ({ date, value: params.dailyActiveUsersByDate.get(date) ?? 0 }))
    .filter((entry) => entry.value > 0);

  // The marker never crosses half the gap between bands, so on a dense range each one still sits
  // over its own day's bar alone; the transparent hit line keeps it hoverable when that bar is thin.
  const overhang = Math.min(2, (frame.x.step() - frame.x.bandwidth()) / 2);
  const markerGroups = frame.group.selectAll<SVGGElement, DailyTotalEntry>(".unique-total-marker")
    .data(markers)
    .join("g")
    .attr("class", "unique-total-marker");

  for (const [stroke, strokeWidth] of [[dailyActiveUsersUniqueTotalMarkerColor, 3], ["transparent", 9]] as const) {
    markerGroups.append("line")
      .attr("x1", (entry) => (frame.x(entry.date) ?? 0) - overhang)
      .attr("x2", (entry) => (frame.x(entry.date) ?? 0) + frame.x.bandwidth() + overhang)
      .attr("y1", (entry) => frame.y(entry.value))
      .attr("y2", (entry) => frame.y(entry.value))
      .attr("stroke", stroke)
      .attr("stroke-width", strokeWidth)
      .attr("stroke-linecap", "butt");
  }

  markerGroups
    .on("mousemove", (event, entry: DailyTotalEntry) => {
      params.tooltipHandlers.showTooltip(
        [
          `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
          `<div class="tooltip-metric"><span>Unique active users</span><strong>${numberFormatter(entry.value)}</strong></div>`,
          `<div class="tooltip-metric"><span>Sum of the segments</span><strong>${numberFormatter(stackTotalByDate.get(entry.date) ?? 0)}</strong></div>`,
        ].join(""),
        event.clientX,
        event.clientY,
      );
    })
    .on("mouseleave", params.tooltipHandlers.hideTooltip);
}

export function renderDailyActiveUsersByPlatformChart(params: RenderDailyActiveUsersKeyedBreakdownChartParams): void {
  renderDailyActiveUsersOverlappingStackChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    matrix: params.activeUsersMatrix,
    keys: reviewEventPlatforms,
    getKeyColor: getPlatformColor,
    getKeyLabel: (key) => platformLabels[key as ReviewEventPlatform],
    segmentMetricLabel: "Active users on this platform",
    dailyActiveUsersByDate: params.dailyActiveUsersByDate,
    peakDailyValue: params.peakDailyValue,
    tooltipHandlers: params.tooltipHandlers,
  });
}

export function renderDailyActiveUsersByOsNameChart(params: RenderDailyActiveUsersKeyedBreakdownChartParams): void {
  renderDailyActiveUsersOverlappingStackChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    matrix: params.activeUsersMatrix,
    keys: productEventOsNames,
    getKeyColor: (key) => osNameColors[key as ProductEventOsName],
    getKeyLabel: (key) => osNameLabels[key as ProductEventOsName],
    segmentMetricLabel: "Active users on this OS",
    dailyActiveUsersByDate: params.dailyActiveUsersByDate,
    peakDailyValue: params.peakDailyValue,
    tooltipHandlers: params.tooltipHandlers,
  });
}

export function renderDailyActiveUsersByDeviceTypeChart(params: RenderDailyActiveUsersKeyedBreakdownChartParams): void {
  renderDailyActiveUsersOverlappingStackChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    matrix: params.activeUsersMatrix,
    keys: productEventDeviceTypes,
    getKeyColor: (key) => deviceTypeColors[key as ProductEventDeviceType],
    getKeyLabel: (key) => deviceTypeLabels[key as ProductEventDeviceType],
    segmentMetricLabel: "Active users on this device type",
    dailyActiveUsersByDate: params.dailyActiveUsersByDate,
    peakDailyValue: params.peakDailyValue,
    tooltipHandlers: params.tooltipHandlers,
  });
}

export function renderPlatformReviewEventsChart(params: RenderPlatformReviewEventsChartParams): void {
  renderKeyedStackedBarChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    matrix: params.platformReviewEventsMatrix,
    keys: reviewEventPlatforms,
    getKeyColor: getPlatformColor,
    getKeyLabel: (key) => platformLabels[key as ReviewEventPlatform],
    peakStackedValue: params.peakDailyPlatformReviewEvents,
    yAxisLabel: "Review events",
    xAxisLabel: "Review date",
    formatTickLabel: formatCompactDateLabel,
    formatTitleLabel: formatDateRangeLabel,
    buildTooltipMetricsHtml: (entry) => [
      `<div class="tooltip-metric"><span>Review events</span><strong>${numberFormatter(entry.value)}</strong></div>`,
      `<div class="tooltip-metric"><span>All platforms on this date</span><strong>${numberFormatter(params.totalPlatformReviewEventsByDate.get(entry.date) ?? 0)}</strong></div>`,
    ].join(""),
    tooltipHandlers: params.tooltipHandlers,
  });
}

// Stacked by deck rather than by person: the section answers which decks were installed, and who
// installed them is already the shared user filter's and the tooltip's job on the per-user charts.
export function renderCatalogInstallsByPackageChart(params: RenderCatalogInstallsByPackageChartParams): void {
  renderKeyedStackedBarChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    matrix: params.packageInstallsMatrix,
    keys: params.packageSlugs,
    getKeyColor: params.packageColorScale,
    // The deck dimension is the package slug: no catalog table is read, so no deck title exists here.
    getKeyLabel: (key) => key,
    peakStackedValue: params.peakDailyInstalls,
    yAxisLabel: "Installs",
    xAxisLabel: "Install date",
    formatTickLabel: formatCompactDateLabel,
    formatTitleLabel: formatDateRangeLabel,
    buildTooltipMetricsHtml: (entry) => [
      `<div class="tooltip-metric"><span>Installs of this deck</span><strong>${numberFormatter(entry.value)}</strong></div>`,
      `<div class="tooltip-metric"><span>All decks on this date</span><strong>${numberFormatter(params.totalInstallsByDate.get(entry.date) ?? 0)}</strong></div>`,
      `<div class="tooltip-metric"><span>Cards added</span><strong>${numberFormatter(params.cardCountByDateAndPackageSlug.get(`${entry.date}:${entry.key}`) ?? 0)}</strong></div>`,
    ].join(""),
    tooltipHandlers: params.tooltipHandlers,
  });
}

export type RenderWhoSawUsChartParams = Readonly<{
  svgElement: SVGSVGElement;
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  matrix: ReadonlyArray<MatrixChartEntry>;
  keys: ReadonlyArray<string>;
  getKeyColor: (key: string) => string;
  getKeyLabel: (key: string) => string;
  peakDailyTotal: number;
  xAxisLabel: string;
  /** Whether a series' segment in a bar can still change, drawn faded. */
  isNotFinalSegment: (key: string, date: string) => boolean;
  /** Placed against the buckets keyed by `dates`. */
  notes: ReadonlyArray<PlacedChartNote>;
  formatTickLabel: (date: string) => string;
  formatTitleLabel: (date: string) => string;
  buildTooltipMetricsHtml: (entry: StackedChartRectEntry) => string;
  tooltipHandlers: ChartTooltipHandlers;
}>;

export function renderWhoSawUsChart(params: RenderWhoSawUsChartParams): void {
  const frame = renderKeyedStackedBarChart({
    svgElement: params.svgElement,
    dates: params.dates,
    tickDates: params.tickDates,
    matrix: params.matrix,
    keys: params.keys,
    getKeyColor: params.getKeyColor,
    getKeyLabel: params.getKeyLabel,
    peakStackedValue: params.peakDailyTotal,
    yAxisLabel: "Visitors",
    xAxisLabel: params.xAxisLabel,
    formatTickLabel: params.formatTickLabel,
    formatTitleLabel: params.formatTitleLabel,
    buildTooltipMetricsHtml: params.buildTooltipMetricsHtml,
    tooltipHandlers: params.tooltipHandlers,
  });
  frame.group.selectAll<SVGRectElement, StackedChartRectEntry>(".bar-segment")
    .classed("bar-segment-not-final", (entry) => params.isNotFinalSegment(entry.key, entry.date));
  renderChartNotes(frame.group, frame.x, getInnerHeight(stackedChartHeight), params.notes, params.tooltipHandlers);
}

/** One funnel step as the step chart draws it; the shares arrive preformatted so the chart and its text alternative cannot disagree. */
export type FunnelStepBar = Readonly<{
  label: string;
  /** The whole step: people with an identifier plus `hashedCount`. Every share is measured on it. */
  count: number;
  /**
   * The part of `count` that is cookieless visitors counted by their daily hash, drawn as a lighter
   * segment at the top of the bar. Zero outside the `all` audience mode, and zero on every step the
   * hashed people cannot reach, which is every step below the site ones.
   */
  hashedCount: number;
  /** Null on the first step, which has nothing before it to drop off from. */
  previousCount: number | null;
  shareOfFirstLabel: string;
  /** "—" on a step before the anchor, which is not a subset of it. */
  shareOfAnchorLabel: string;
  shareOfPreviousLabel: string;
  /**
   * The two parts written under the total, one line each, or empty when there is no hashed part to
   * split out. One line per part keeps the widest one to a single number plus a short word, which a
   * step column holds at any count the funnels reach.
   */
  splitLabels: ReadonlyArray<string>;
}>;

/**
 * One coloured series inside every step band: one group's own steps, in the funnel's step order.
 *
 * An ungrouped funnel is one group, which is exactly the single accent bar per step the chart has
 * always drawn, so the grouped and ungrouped charts are one code path rather than two renderers.
 */
export type FunnelStepGroupBars = Readonly<{
  key: string;
  label: string;
  color: string;
  steps: ReadonlyArray<FunnelStepBar>;
}>;

export type RenderFunnelStepsChartParams = Readonly<{
  svgElement: SVGSVGElement;
  /** At least one group, each carrying the funnel's full step list in the same order. */
  groups: ReadonlyArray<FunnelStepGroupBars>;
  /**
   * A `Group by` dimension is selected, so the bars are its groups and are drawn and named as such.
   * It is not `groups.length > 1`: a dimension that placed everybody in one group, or nobody
   * anywhere, still has to draw its colour and its key rather than pass for the plain funnel.
   */
  isGrouped: boolean;
  /** What one counted row is, plural; the tooltip names the number with it. */
  countLabel: string;
  /** The step every later share is measured from; 0 is the default view. */
  anchorIndex: number;
  onSelectStep: (stepIndex: number) => void;
  /** Grouped bars carry their numbers here, because a step band holding several has no room to write them. */
  tooltipHandlers: ChartTooltipHandlers;
}>;

/** One group's bar at one step: everything the bar, its ghost and its tooltip are drawn from. */
type FunnelStepGroupBar = Readonly<{
  groupIndex: number;
  group: FunnelStepGroupBars;
  stepIndex: number;
  step: FunnelStepBar;
}>;

const funnelChartHeight = 440;
const funnelChartMargin = { top: 76, right: 24, bottom: 64, left: chartMargin.left } as const;
const funnelStepLabelMaxLineLength = 18;
/** In ems, so a step label's lines stay apart at whatever size its stylesheet gives it; the Level 1 grid enlarges it. */
const funnelStepLabelLineHeight = "1.25em";
/** One line of the identified/hashed split drawn under the total when a step has a hashed part. */
const funnelStepSplitLineHeight = 17;
/** Keeps the column's 1.5-unit selected stroke inside the viewBox, whose edges clip it. */
const funnelStepHitEdgeInset = 2;
/** Clears the column's selected stroke with the 2-unit focus ring drawn inside it. */
const funnelStepFocusRingInset = 4;
/** Depth of the zig-zag drawn inside a capped bar's top edge; it stays below the labels, whose last baseline sits 10 units above the plot. */
const funnelStepClipMarkDepth = 6;
const funnelStepClipMarkToothWidth = 10;
/** The gap between two groups inside one step band; the band's own edges stay flush with the step column. */
const funnelGroupBandPaddingInner = 0.16;
const funnelHashedSegmentMixRatio = 0.55;
const funnelShareAxisFormatter = d3.format(".0%");

/**
 * A funnel chart's viewBox height. A split label adds lines above the bars, so the chart grows by as
 * many rather than the plot shrinking: the bars stay the height they are without the split.
 */
export function getFunnelChartHeight(splitLineCount: number): number {
  return funnelChartHeight + splitLineCount * funnelStepSplitLineHeight;
}

/** A grouped chart writes nothing above its bars, so it never asks for split lines. */
export function getFunnelSplitLineCount(steps: ReadonlyArray<FunnelStepBar>, isGrouped: boolean): number {
  return isGrouped ? 0 : Math.max(0, ...steps.map((step) => step.splitLabels.length));
}

/**
 * A grouped bar's hashed segment: that group's own colour, mixed toward the page's text.
 *
 * The stylesheet's wash cannot serve a grouped chart. It is one translucent `--text` over whatever
 * is beneath, so every group's segment comes out the same colour, and on a step whose identified
 * count is zero the segment is the whole bar and its group's colour is gone from the plot. Mixing
 * the group's own colour instead keeps the segment that group one shade up, which is exactly what
 * the wash does over the single accent bar of an ungrouped funnel.
 */
function buildFunnelHashedSegmentColor(groupColor: string): string {
  return d3.interpolateLab(groupColor, funnelHashedSegmentMixColor)(funnelHashedSegmentMixRatio);
}

/** An even tooth count starts and ends the zig-zag at its depth, inside the bar's rounded top corners. */
function buildFunnelStepClipMarkPath(width: number): string {
  const toothCount = 2 * Math.max(1, Math.round(width / (2 * funnelStepClipMarkToothWidth)));
  const points = d3.range(toothCount + 1).map((index) => {
    const pointY = index % 2 === 0 ? funnelStepClipMarkDepth : 0;
    return `${(width * index) / toothCount},${pointY}`;
  });

  return `M${points.join("L")}`;
}

/**
 * A rectangle with rounded top corners and independently rounded bottom ones, as a path.
 *
 * The hashed segment is drawn over the upper slice of the bar the total already drew, so its bottom
 * edge is normally an internal boundary rather than the shape's end: rounding it would curve the
 * lighter fill away from the accent underneath and leave a notch at each bottom corner, which a thin
 * segment shows plainly. `rect` rounds all four corners or none, so that shape is drawn here instead.
 *
 * `bottomRadius` exists for the one case where that bottom edge is not internal. When the hashed count
 * equals the total, the segment is the whole bar, and the bar's own `rx` has rounded the two bottom
 * corners away: square ones there would paint outside the bar's silhouette and the composite would
 * read as square-bottomed. The caller passes the bar's radius in that case and `0` otherwise. Each
 * radius is clamped to the segment, so a segment shorter or narrower than its corners keeps clean
 * edges, and both are clamped to half the height once the bottom is rounded, so opposite corners on a
 * thin full-height segment cannot overlap.
 *
 * That clamp does not reproduce the bar's own corners exactly on a very short bar. `rect` clamps only
 * `ry` to half the height and leaves `rx` at the radius, so its corners turn elliptical there, while
 * these stay circular at the smaller radius and keep a sliver of fill the bar has already curved
 * away. It is sub-pixel on the bars this renders and is left as is rather than switched to elliptical
 * arcs; a full-height segment is otherwise inside the bar's silhouette, not square-bottomed over it.
 */
function buildRoundedBarSegmentPath(
  width: number,
  height: number,
  topRadius: number,
  bottomRadius: number,
): string {
  const heightLimit = bottomRadius > 0 ? height / 2 : height;
  const top = Math.max(0, Math.min(topRadius, heightLimit, width / 2));
  const bottom = Math.max(0, Math.min(bottomRadius, height / 2, width / 2));
  return [
    `M0,${height - bottom}`,
    `L0,${top}`,
    `A${top},${top} 0 0 1 ${top},0`,
    `L${width - top},0`,
    `A${top},${top} 0 0 1 ${width},${top}`,
    `L${width},${height - bottom}`,
    `A${bottom},${bottom} 0 0 1 ${width - bottom},${height}`,
    `L${bottom},${height}`,
    `A${bottom},${bottom} 0 0 1 0,${height - bottom}`,
    "Z",
  ].join("");
}

function wrapFunnelStepLabel(label: string): ReadonlyArray<string> {
  const lines: Array<string> = [];
  for (const word of label.split(" ")) {
    const lastLine = lines[lines.length - 1];
    if (lastLine !== undefined && `${lastLine} ${word}`.length <= funnelStepLabelMaxLineLength) {
      lines[lines.length - 1] = `${lastLine} ${word}`;
    } else {
      lines.push(word);
    }
  }

  return lines;
}

/** The anchored line reads "of selected" rather than the step's name, which can run past its ~153-unit column. */
function getFunnelStepAnchorShareText(step: FunnelStepBar, stepIndex: number, anchorIndex: number): string {
  if (stepIndex < anchorIndex || anchorIndex === 0) {
    return `${step.shareOfFirstLabel} of first`;
  }

  return `${step.shareOfAnchorLabel} of selected`;
}

/** Names the control only. */
function getFunnelStepAriaLabel(step: FunnelStepBar, stepIndex: number, anchorIndex: number): string {
  if (stepIndex === 0) {
    return `Measure from ${step.label} (default start)`;
  }

  if (stepIndex === anchorIndex) {
    return `Measure from ${step.label} (current start; press again to reset)`;
  }

  return `Measure from ${step.label}`;
}

/** Every share a grouped bar carries is that group's own, which is what the wording has to say. */
function buildFunnelStepGroupTooltipHtml(
  bar: FunnelStepGroupBar,
  countLabel: string,
  anchorIndex: number,
): string {
  return [
    `<p class="tooltip-title">${escapeHtml(bar.group.label)}</p>`,
    `<p class="tooltip-subtitle">${escapeHtml(bar.step.label)}</p>`,
    `<div class="tooltip-metric"><span>${escapeHtml(countLabel)}</span><strong>${numberFormatter(bar.step.count)}</strong></div>`,
    `<div class="tooltip-metric"><span>Of this group's first step</span><strong>${escapeHtml(bar.step.shareOfFirstLabel)}</strong></div>`,
    ...(anchorIndex > 0
      ? [`<div class="tooltip-metric"><span>Of this group's selected step</span><strong>${escapeHtml(bar.step.shareOfAnchorLabel)}</strong></div>`]
      : []),
    `<div class="tooltip-metric"><span>Of this group's previous step</span><strong>${escapeHtml(bar.step.shareOfPreviousLabel)}</strong></div>`,
  ].join("");
}

/**
 * Vertical funnel bars, one coloured bar per group inside every step band. A faint ghost at that
 * group's own previous step sits behind each later bar, so the drop-off reads as the gap between
 * them, and a zero step keeps a thin muted stub so it still reads as a measured step.
 * Each step's whole column is a toggle button that re-anchors the shares on it, for every group at
 * once. A selected step re-bases the chart: the axis reads as a share of it, EVERY GROUP IS THEN
 * DRAWN AS A SHARE OF ITS OWN COUNT AT THAT STEP, which is what keeps two groups of very different
 * size comparable, and the steps before it lose their ghosts, turn grey and are capped at the plot
 * top with a zig-zag clip mark when taller.
 * A redraw keeps keyboard focus on the column that held it.
 *
 * THE UNGROUPED CHART IS THE ONE-GROUP CASE OF ALL OF THAT, and it alone writes the exact count, the
 * identified/hashed split and both shares above each bar: a step band that may hold several bars has
 * no room for any of it, so a grouped chart moves those numbers to the hover tooltip, whether its
 * dimension resolved to seven groups or to one.
 */
export function renderFunnelStepsChart(params: RenderFunnelStepsChartParams): void {
  const firstGroup = params.groups[0];
  if (firstGroup === undefined) {
    throw new Error("A funnel step chart needs at least one group to draw.");
  }

  const isGrouped = params.isGrouped;
  const steps = firstGroup.steps;
  // The top margin grows with the chart, so the plot keeps its height.
  const splitLineCount = getFunnelSplitLineCount(steps, isGrouped);
  const chartHeight = getFunnelChartHeight(splitLineCount);
  const marginTop = funnelChartMargin.top + splitLineCount * funnelStepSplitLineHeight;
  const innerWidth = chartWidth - funnelChartMargin.left - funnelChartMargin.right;
  const innerHeight = chartHeight - marginTop - funnelChartMargin.bottom;
  const peakCount = Math.max(1, ...params.groups.flatMap((group) => group.steps.map((step) => step.count)));
  const hasAnchor = params.anchorIndex > 0;
  const groupAnchorCounts = params.groups.map((group) => group.steps[params.anchorIndex]?.count ?? 0);
  // An anchor no group has anybody at has nothing to scale to, so the chart keeps the visitor scale.
  const isRebased = hasAnchor && Math.max(...groupAnchorCounts) > 0;
  const x = d3.scaleBand<string>()
    .domain(steps.map((step) => step.label))
    .range([0, innerWidth])
    .paddingInner(0.28)
    .paddingOuter(0.14);
  const bandWidth = x.bandwidth();
  const groupX = d3.scaleBand<string>()
    .domain(params.groups.map((group) => group.key))
    .range([0, bandWidth])
    .paddingInner(isGrouped ? funnelGroupBandPaddingInner : 0)
    .paddingOuter(0);
  // One scale for the plot and the axis: counts, or shares once a step is selected. Clamping caps the
  // steps before a re-based anchor at the plot top.
  const y = d3.scaleLinear().domain([0, isRebased ? 1 : peakCount]).range([innerHeight, 0]).clamp(true);
  const axisTicks = isRebased
    ? y.ticks(5)
    : y.ticks(Math.min(6, peakCount + 1)).filter((tick) => Number.isInteger(tick));
  const axisTickFormatter = isRebased ? funnelShareAxisFormatter : numberFormatter;
  /** A value's height inside its own group: a count, or that group's own share of its own anchor. */
  const getGroupValueY = (groupIndex: number, value: number): number => {
    if (isRebased === false) {
      return y(value);
    }

    // A group with nobody at the anchor has no rate to draw, so anything it still has at an earlier
    // step is capped at the plot top by the scale rather than divided by zero into nothing.
    const anchorCount = groupAnchorCounts[groupIndex] ?? 0;
    return y(value === 0 ? 0 : value / anchorCount);
  };

  const svg = d3.select(params.svgElement);
  const focusedStepIndex = svg.selectAll<SVGGElement, FunnelStepBar>("g.funnel-step").nodes()
    .findIndex((node) => node === params.svgElement.ownerDocument.activeElement);
  const stepIndexByLabel = new Map(steps.map((step, index) => [step.label, index]));
  const getStepIndex = (label: string): number => {
    const index = stepIndexByLabel.get(label);
    if (index === undefined) {
      throw new Error(`Funnel step "${label}" is missing from the rendered steps.`);
    }

    return index;
  };
  /** Every group's bar at one step, in group order; each group carries the same steps in the same order. */
  const getStepGroupBars = (stepLabel: string): ReadonlyArray<FunnelStepGroupBar> => {
    const stepIndex = getStepIndex(stepLabel);
    return params.groups.map((group, groupIndex) => {
      const step = group.steps[stepIndex];
      if (step === undefined) {
        throw new Error(`Funnel group "${group.key}" is missing step ${stepIndex}.`);
      }

      return { groupIndex, group, stepIndex, step };
    });
  };
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${chartWidth} ${chartHeight}`);

  const group = svg.append("g")
    .attr("transform", `translate(${funnelChartMargin.left},${marginTop})`);

  group.append("g")
    .attr("class", "grid")
    .attr("aria-hidden", "true")
    .call(d3.axisLeft(y).tickValues(axisTicks).tickSize(-innerWidth).tickFormat(() => ""))
    .call((grid) => grid.select(".domain").remove());

  group.append("g")
    .attr("class", "axis")
    .attr("aria-hidden", "true")
    .call(d3.axisLeft(y).tickValues(axisTicks).tickFormat((value) => axisTickFormatter(Number(value))));

  const xAxis = group.append("g")
    .attr("class", "axis")
    .attr("aria-hidden", "true")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickSize(0))
    .call((axis) => axis.selectAll(".tick text").remove());
  xAxis.selectAll<SVGGElement, string>(".tick")
    .append("text")
    .attr("class", (label) => {
      const index = getStepIndex(label);
      if (index < params.anchorIndex) {
        return "funnel-step-axis-label funnel-step-faded";
      }

      return hasAnchor && index === params.anchorIndex
        ? "funnel-step-axis-label funnel-step-axis-label-selected"
        : "funnel-step-axis-label";
    })
    .attr("text-anchor", "middle")
    .attr("y", 18)
    .selectAll("tspan")
    .data((label) => wrapFunnelStepLabel(label))
    .join("tspan")
    .attr("x", 0)
    .attr("dy", (_line, index) => (index === 0 ? 0 : funnelStepLabelLineHeight))
    .text((line) => line);

  group.append("text")
    .attr("class", "axis-label")
    .attr("aria-hidden", "true")
    .attr("x", -innerHeight / 2)
    .attr("y", -48)
    .attr("transform", "rotate(-90)")
    .attr("text-anchor", "middle")
    .text(isRebased ? "% of selected" : "Visitors");

  const stepGroups = group.selectAll<SVGGElement, FunnelStepBar>("g.funnel-step")
    .data(steps)
    .join("g")
    .attr("class", (step) => {
      const index = getStepIndex(step.label);
      if (index < params.anchorIndex) {
        return "funnel-step funnel-step-before-anchor";
      }

      return hasAnchor && index === params.anchorIndex ? "funnel-step funnel-step-selected" : "funnel-step";
    })
    .attr("transform", (step) => `translate(${x(step.label) ?? 0},0)`)
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-pressed", (step) => String(hasAnchor && getStepIndex(step.label) === params.anchorIndex))
    .attr("aria-label", (step) => getFunnelStepAriaLabel(step, getStepIndex(step.label), params.anchorIndex))
    .on("click", (_event: MouseEvent, step: FunnelStepBar) => {
      params.onSelectStep(getStepIndex(step.label));
    })
    .on("keydown", (event: KeyboardEvent, step: FunnelStepBar) => {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }

      event.preventDefault();
      params.onSelectStep(getStepIndex(step.label));
    });

  // The full column from the top edge to below the axis labels, drawn first so the bars and labels sit over it.
  // It stops short of the viewBox's top and bottom edges, which clip overflow, so its stroke is drawn whole.
  const columnInset = (x.step() - bandWidth) / 2;
  stepGroups.append("rect")
    .attr("class", "funnel-step-hit")
    .attr("x", -columnInset)
    .attr("y", -marginTop + funnelStepHitEdgeInset)
    .attr("width", x.step())
    .attr("height", chartHeight - funnelStepHitEdgeInset * 2)
    .attr("rx", 6);
  // The keyboard focus ring sits inside the column's own edge, so it shows alongside the anchor's accent stroke.
  stepGroups.append("rect")
    .attr("class", "funnel-step-focus-ring")
    .attr("x", -columnInset + funnelStepFocusRingInset)
    .attr("y", -marginTop + funnelStepHitEdgeInset + funnelStepFocusRingInset)
    .attr("width", x.step() - funnelStepFocusRingInset * 2)
    .attr("height", chartHeight - (funnelStepHitEdgeInset + funnelStepFocusRingInset) * 2)
    .attr("rx", 4);

  const groupBandWidth = groupX.bandwidth();
  const barGroups = stepGroups.selectAll<SVGGElement, FunnelStepGroupBar>("g.funnel-step-group")
    .data((step) => getStepGroupBars(step.label))
    .join("g")
    .attr("class", "funnel-step-group")
    .attr("transform", (bar) => `translate(${groupX(bar.group.key) ?? 0},0)`);

  // The anchor's previous step lies outside the measured funnel, so the anchor draws no ghost. A re-based
  // chart also drops the grey steps' ghosts, whose dashed outline would show through the faded bar.
  const getGhostCount = (bar: FunnelStepGroupBar): number | null => {
    if (hasAnchor && bar.stepIndex === params.anchorIndex) {
      return null;
    }

    return isRebased && bar.stepIndex < params.anchorIndex ? null : bar.step.previousCount;
  };
  barGroups.filter((bar) => {
    const ghostCount = getGhostCount(bar);
    return ghostCount !== null && ghostCount > bar.step.count;
  })
    .append("rect")
    .attr("class", "funnel-step-ghost")
    .attr("x", 0)
    .attr("y", (bar) => getGroupValueY(bar.groupIndex, getGhostCount(bar) ?? 0))
    .attr("width", groupBandWidth)
    .attr("height", (bar) => innerHeight - getGroupValueY(bar.groupIndex, getGhostCount(bar) ?? 0))
    .attr("rx", 4);

  const emptyStepHeight = 2;
  const bars = barGroups.append("rect")
    .attr("class", (bar) => (bar.step.count === 0 ? "funnel-step-bar funnel-step-bar-empty" : "funnel-step-bar"))
    .attr("x", 0)
    .attr("y", (bar) => (
      bar.step.count === 0 ? innerHeight - emptyStepHeight : getGroupValueY(bar.groupIndex, bar.step.count)
    ))
    .attr("width", groupBandWidth)
    .attr("height", (bar) => (
      bar.step.count === 0 ? emptyStepHeight : innerHeight - getGroupValueY(bar.groupIndex, bar.step.count)
    ))
    .attr("rx", 4);
  if (isGrouped) {
    // An inline style rather than a `fill` attribute, which the stylesheet's own `.funnel-step-bar`
    // rule would win over. Two bars keep that stylesheet fill on purpose: a zero step's stub, which
    // is the absence of a count rather than a reading of the group, and a step before the anchor,
    // which is outside the measured funnel and drops its colour the way the accent one does.
    bars.style("fill", (bar) => (
      bar.step.count === 0 || bar.stepIndex < params.anchorIndex ? null : bar.group.color
    ));
  }

  // The hashed part sits at the top of the bar the total already drew, so the bar's height stays the
  // total and only its upper slice is lighter. The scale is clamped, so on a step capped by a re-based
  // anchor both ends land on the plot top and the segment collapses to nothing rather than escaping it.
  const funnelStepBarRadius = 4;
  const hashedSegments = barGroups.filter((bar) => bar.step.count > 0 && bar.step.hashedCount > 0)
    .append("path")
    .attr("class", "funnel-step-bar-hashed")
    .attr("transform", (bar) => `translate(0,${getGroupValueY(bar.groupIndex, bar.step.count)})`)
    .attr("d", (bar) => {
      const barTop = getGroupValueY(bar.groupIndex, bar.step.count);
      const segmentHeight = Math.max(
        0,
        getGroupValueY(bar.groupIndex, bar.step.count - bar.step.hashedCount) - barTop,
      );
      // A step whose identified count is zero makes the segment the whole bar, whose own bottom
      // corners are rounded, so it takes the bar's radius there rather than painting square corners
      // outside that silhouette.
      const isWholeBar = segmentHeight >= innerHeight - barTop;
      return buildRoundedBarSegmentPath(
        groupBandWidth,
        segmentHeight,
        funnelStepBarRadius,
        isWholeBar ? funnelStepBarRadius : 0,
      );
    });
  if (isGrouped) {
    // Inline styles for the reason the bars above take one, and opaque, because the group's colour
    // is already beneath the segment and a translucent one of the same hue would vanish into it. A
    // step before the anchor keeps the stylesheet's wash, the way its bar keeps the stylesheet fill.
    hashedSegments
      .style("fill", (bar) => (
        bar.stepIndex < params.anchorIndex ? null : buildFunnelHashedSegmentColor(bar.group.color)
      ))
      .style("fill-opacity", (bar) => (bar.stepIndex < params.anchorIndex ? null : 1));
  }

  barGroups.filter((bar) => (
    isRebased
      && bar.stepIndex < params.anchorIndex
      && bar.step.count > (groupAnchorCounts[bar.groupIndex] ?? 0)
  ))
    .append("path")
    .attr("class", "funnel-step-clip-mark")
    .attr("d", buildFunnelStepClipMarkPath(groupBandWidth));

  if (isGrouped) {
    barGroups
      .on("mousemove", (event: MouseEvent, bar: FunnelStepGroupBar) => {
        params.tooltipHandlers.showTooltip(
          buildFunnelStepGroupTooltipHtml(bar, params.countLabel, params.anchorIndex),
          event.clientX,
          event.clientY,
        );
      })
      .on("mouseleave", params.tooltipHandlers.hideTooltip);
  }

  // Only the ungrouped chart writes its numbers above the bars; a step band holding several has no
  // room for them, so a grouped chart puts them in the hover tooltip.
  if (isGrouped === false) {
    // Each block's last baseline sits 10 units above its own bar, so the offset is the block's own
    // height: a split line is added above the total rather than below the shares, which would push
    // them into the bar. Every block floats with the bar it labels, so there is no cross-step
    // alignment to keep by giving them all the tallest block's offset.
    const getValueLabelTopOffset = (bar: FunnelStepGroupBar): number => (
      47 + bar.step.splitLabels.length * funnelStepSplitLineHeight
    );
    const valueLabels = barGroups.append("text")
      .attr("class", "funnel-step-value")
      .attr("text-anchor", "middle")
      .attr("x", groupBandWidth / 2)
      .attr("y", (bar) => (
        getGroupValueY(bar.groupIndex, Math.max(bar.step.count, getGhostCount(bar) ?? 0))
          - getValueLabelTopOffset(bar)
      ));
    valueLabels.append("tspan")
      .attr("class", "funnel-step-count")
      .attr("x", groupBandWidth / 2)
      .text((bar) => numberFormatter(bar.step.count));
    // Only the steps that have a hashed part carry the split, so a step the hashed people cannot reach
    // reads as the plain total it is rather than as "n + 0".
    valueLabels.each(function appendSplitLines(bar: FunnelStepGroupBar): void {
      const valueLabel = d3.select(this);
      for (const splitLine of bar.step.splitLabels) {
        valueLabel.append("tspan")
          .attr("class", "funnel-step-split")
          .attr("x", groupBandWidth / 2)
          .attr("dy", funnelStepSplitLineHeight)
          .text(splitLine);
      }
    });
    valueLabels.append("tspan")
      .attr("class", "funnel-step-share")
      .attr("x", groupBandWidth / 2)
      .attr("dy", 20)
      .text((bar) => getFunnelStepAnchorShareText(bar.step, bar.stepIndex, params.anchorIndex));
    valueLabels.append("tspan")
      .attr("class", "funnel-step-share")
      .attr("x", groupBandWidth / 2)
      .attr("dy", 17)
      .text((bar) => `${bar.step.shareOfPreviousLabel} of previous`);
  }

  if (focusedStepIndex >= 0) {
    stepGroups.nodes()[focusedStepIndex]?.focus({ preventScroll: true });
  }
}

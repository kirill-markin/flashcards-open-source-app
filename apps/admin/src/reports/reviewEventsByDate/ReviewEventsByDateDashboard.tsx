import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import {
  reviewEventPlatforms,
  type ReviewEventPlatform,
  type ReviewEventsByDatePlatformActiveUserTotal,
  type ReviewEventsByDatePlatformReviewEventTotal,
  type ReviewEventsByDateReport,
} from "../../adminApi";

type ChartTooltipState = Readonly<{
  visible: boolean;
  html: string;
  left: number;
  top: number;
}>;

type DailyValueEntry = Readonly<{
  date: string;
  value: number;
}>;

type MatrixChartEntry = Readonly<{
  date: string;
  valuesByKey: Readonly<Record<string, number>>;
}>;

type StackedChartRectEntry = Readonly<{
  key: string;
  date: string;
  value: number;
  y0: number;
  y1: number;
}>;

type GroupedChartRectEntry = Readonly<{
  key: ReviewEventPlatform;
  date: string;
  value: number;
}>;

type ChartFrameParams = Readonly<{
  chartWidth: number;
  chartHeight: number;
  margin: Readonly<{
    top: number;
    right: number;
    bottom: number;
    left: number;
  }>;
  x: d3.ScaleBand<string>;
  y: d3.ScaleLinear<number, number>;
  tickDates: ReadonlyArray<string>;
  yAxisLabel: string;
}>;

const chartMargin = { top: 28, right: 68, bottom: 88, left: 68 } as const;
const chartWidth = 1320;
const simpleChartHeight = 300;
const stackedChartHeight = 620;
const platformLabels: Readonly<Record<ReviewEventPlatform, string>> = {
  web: "Web",
  android: "Android",
  ios: "iOS",
};
const platformColors: Readonly<Record<ReviewEventPlatform, string>> = {
  web: "#4e79a7",
  android: "#59a14f",
  ios: "#f28e2b",
};

function parseCalendarDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    throw new Error(`Invalid report date: ${date}`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsedDate = new Date(Date.UTC(year, monthIndex, day));

  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== monthIndex
    || parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid report date: ${date}`);
  }

  return parsedDate;
}

function formatDateRangeLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(parseCalendarDate(date));
}

function formatCompactDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
  }).format(parseCalendarDate(date));
}

function formatGeneratedAt(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildDailyUniqueUsers(report: ReviewEventsByDateReport): ReadonlyArray<DailyValueEntry> {
  const usersByDate = new Map<string, Set<string>>();

  for (const row of report.rows) {
    const users = usersByDate.get(row.date) ?? new Set<string>();
    users.add(row.userId);
    usersByDate.set(row.date, users);
  }

  return report.dateTotals.map((item) => ({
    date: item.date,
    value: usersByDate.get(item.date)?.size ?? 0,
  }));
}

function buildUserMatrix(report: ReviewEventsByDateReport): ReadonlyArray<MatrixChartEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const row of report.rows) {
    const currentValues = valuesByDate.get(row.date) ?? {};
    currentValues[row.userId] = (currentValues[row.userId] ?? 0) + row.reviewEventCount;
    valuesByDate.set(row.date, currentValues);
  }

  return report.dateTotals.map((item) => ({
    date: item.date,
    valuesByKey: valuesByDate.get(item.date) ?? {},
  }));
}

function buildPlatformMatrix<Item extends Readonly<{ date: string; platform: ReviewEventPlatform }>>(
  items: ReadonlyArray<Item>,
  getValue: (item: Item) => number,
  dates: ReadonlyArray<string>,
): ReadonlyArray<MatrixChartEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const item of items) {
    const currentValues = valuesByDate.get(item.date) ?? {};
    currentValues[item.platform] = getValue(item);
    valuesByDate.set(item.date, currentValues);
  }

  return dates.map((date) => ({
    date,
    valuesByKey: valuesByDate.get(date) ?? {},
  }));
}

function buildTotalsByDate(items: ReadonlyArray<DailyValueEntry | MatrixChartEntry>): ReadonlyMap<string, number> {
  const totalsByDate = new Map<string, number>();

  for (const item of items) {
    if ("value" in item) {
      totalsByDate.set(item.date, item.value);
      continue;
    }

    const nextTotal = Object.values(item.valuesByKey).reduce((sum, value) => sum + value, 0);
    totalsByDate.set(item.date, nextTotal);
  }

  return totalsByDate;
}

function getPeakDailyValue(items: ReadonlyArray<DailyValueEntry>): number {
  return d3.max(items, (item) => item.value) ?? 0;
}

function getPeakStackedValue(items: ReadonlyArray<MatrixChartEntry>): number {
  return d3.max(items, (item) => Object.values(item.valuesByKey).reduce((sum, value) => sum + value, 0)) ?? 0;
}

function getPeakGroupedValue(items: ReadonlyArray<MatrixChartEntry>): number {
  return d3.max(items, (item) => d3.max(reviewEventPlatforms, (platform) => item.valuesByKey[platform] ?? 0) ?? 0) ?? 0;
}

function getUserColorScale(userIds: ReadonlyArray<string>): d3.ScaleOrdinal<string, string> {
  const palette = [
    ...d3.schemeTableau10,
    ...d3.schemeSet2,
    ...d3.schemeDark2,
    "#e15759",
    "#76b7b2",
    "#f28e2b",
    "#59a14f",
  ].slice(0, userIds.length);

  return d3.scaleOrdinal<string, string>(userIds, palette);
}

function getPlatformColor(platform: string): string {
  if (reviewEventPlatforms.includes(platform as ReviewEventPlatform) === false) {
    throw new Error(`Unsupported platform color key: ${platform}`);
  }

  return platformColors[platform as ReviewEventPlatform];
}

function createTickDates(dates: ReadonlyArray<string>): ReadonlyArray<string> {
  return dates.filter(
    (_date, index) => dates.length <= 22 || index % Math.ceil(dates.length / 16) === 0,
  );
}

function renderChartFrame(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  params: ChartFrameParams,
): d3.Selection<SVGGElement, unknown, null, undefined> {
  const innerWidth = params.chartWidth - params.margin.left - params.margin.right;
  const innerHeight = params.chartHeight - params.margin.top - params.margin.bottom;

  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${params.chartWidth} ${params.chartHeight}`);

  const group = svg.append("g").attr("transform", `translate(${params.margin.left},${params.margin.top})`);

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
        .tickFormat((value) => d3.format(",")(Number(value))),
    );

  group.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${innerWidth},0)`)
    .call(
      d3.axisRight(params.y)
        .ticks(Math.min(8, Math.max(2, Math.round(params.y.domain()[1]) + 1)))
        .tickFormat((value) => d3.format(",")(Number(value))),
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

function ChartTooltip(props: ChartTooltipState): JSX.Element {
  return (
    <div
      className={`tooltip${props.visible ? " visible" : ""}`}
      style={{ left: props.left, top: props.top }}
      dangerouslySetInnerHTML={{ __html: props.html }}
    />
  );
}

function PlatformKey(): JSX.Element {
  return (
    <div className="platform-key" aria-label="Platform color key">
      {reviewEventPlatforms.map((platform) => (
        <span key={platform} className="platform-key-item">
          <span className="platform-key-swatch" style={{ backgroundColor: platformColors[platform] }} />
          <span>{platformLabels[platform]}</span>
        </span>
      ))}
    </div>
  );
}

export function ReviewEventsByDateDashboard(
  props: Readonly<{
    report: ReviewEventsByDateReport;
    adminEmail: string;
  }>,
): JSX.Element {
  const uniqueUsersChartRef = useRef<SVGSVGElement | null>(null);
  const userReviewEventsChartRef = useRef<SVGSVGElement | null>(null);
  const platformUsersChartRef = useRef<SVGSVGElement | null>(null);
  const platformReviewEventsChartRef = useRef<SVGSVGElement | null>(null);
  const [tooltipState, setTooltipState] = useState<ChartTooltipState>({
    visible: false,
    html: "",
    left: 0,
    top: 0,
  });

  const dates = useMemo(
    () => props.report.dateTotals.map((item) => item.date),
    [props.report.dateTotals],
  );
  const tickDates = useMemo(
    () => createTickDates(dates),
    [dates],
  );
  const userIds = useMemo(
    () => props.report.users.map((user) => user.userId),
    [props.report.users],
  );
  const userColorScale = useMemo(
    () => getUserColorScale(userIds),
    [userIds],
  );
  const dailyUniqueUsers = useMemo(
    () => buildDailyUniqueUsers(props.report),
    [props.report],
  );
  const userMatrix = useMemo(
    () => buildUserMatrix(props.report),
    [props.report],
  );
  const platformActiveUsersMatrix = useMemo(
    () => buildPlatformMatrix(props.report.platformActiveUserTotals, (item) => item.activeUserCount, dates),
    [dates, props.report.platformActiveUserTotals],
  );
  const platformReviewEventsMatrix = useMemo(
    () => buildPlatformMatrix(props.report.platformReviewEventTotals, (item) => item.reviewEventCount, dates),
    [dates, props.report.platformReviewEventTotals],
  );
  const totalReviewEventsByDate = useMemo(
    () => new Map(props.report.dateTotals.map((item) => [item.date, item.totalReviewEvents])),
    [props.report.dateTotals],
  );
  const userById = useMemo(
    () => new Map(props.report.users.map((user) => [user.userId, user])),
    [props.report.users],
  );
  const dailyUniqueUsersByDate = useMemo(
    () => new Map(dailyUniqueUsers.map((item) => [item.date, item.value])),
    [dailyUniqueUsers],
  );
  const totalPlatformReviewEventsByDate = useMemo(
    () => buildTotalsByDate(platformReviewEventsMatrix),
    [platformReviewEventsMatrix],
  );
  const peakDailyUniqueUsers = useMemo(
    () => getPeakDailyValue(dailyUniqueUsers),
    [dailyUniqueUsers],
  );
  const peakDailyVolume = useMemo(
    () => d3.max(props.report.dateTotals, (item) => item.totalReviewEvents) ?? 0,
    [props.report.dateTotals],
  );
  const peakDailyPlatformUsers = useMemo(
    () => getPeakGroupedValue(platformActiveUsersMatrix),
    [platformActiveUsersMatrix],
  );
  const peakDailyPlatformReviewEvents = useMemo(
    () => getPeakStackedValue(platformReviewEventsMatrix),
    [platformReviewEventsMatrix],
  );

  useEffect(() => {
    const uniqueUsersSvgElement = uniqueUsersChartRef.current;
    const userReviewEventsSvgElement = userReviewEventsChartRef.current;
    const platformUsersSvgElement = platformUsersChartRef.current;
    const platformReviewEventsSvgElement = platformReviewEventsChartRef.current;
    if (
      uniqueUsersSvgElement === null
      || userReviewEventsSvgElement === null
      || platformUsersSvgElement === null
      || platformReviewEventsSvgElement === null
    ) {
      return;
    }

    const uniqueUsersSvg = d3.select(uniqueUsersSvgElement);
    const userReviewEventsSvg = d3.select(userReviewEventsSvgElement);
    const platformUsersSvg = d3.select(platformUsersSvgElement);
    const platformReviewEventsSvg = d3.select(platformReviewEventsSvgElement);
    const innerWidth = chartWidth - chartMargin.left - chartMargin.right;
    const simpleInnerHeight = simpleChartHeight - chartMargin.top - chartMargin.bottom;
    const stackedInnerHeight = stackedChartHeight - chartMargin.top - chartMargin.bottom;
    const x = d3.scaleBand<string>()
      .domain(dates)
      .range([0, innerWidth])
      .paddingInner(0.08)
      .paddingOuter(0.04);
    const platformUsersX = d3.scaleBand<ReviewEventPlatform>()
      .domain(reviewEventPlatforms)
      .range([0, x.bandwidth()])
      .paddingInner(0.16)
      .paddingOuter(0.08);
    const numberFormatter = d3.format(",");

    function showTooltip(html: string, clientX: number, clientY: number): void {
      const padding = 18;
      const nextLeft = Math.max(padding, Math.min(window.innerWidth - 340, clientX + 18));
      const nextTop = Math.max(padding, Math.min(window.innerHeight - 220, clientY + 18));
      setTooltipState({
        visible: true,
        html,
        left: nextLeft,
        top: nextTop,
      });
    }

    function hideTooltip(): void {
      setTooltipState((currentState) => ({
        ...currentState,
        visible: false,
      }));
    }

    const uniqueUsersY = d3.scaleLinear()
      .domain([0, Math.max(1, peakDailyUniqueUsers)])
      .nice()
      .range([simpleInnerHeight, 0]);

    const uniqueUsersGroup = renderChartFrame(uniqueUsersSvg, {
      chartWidth,
      chartHeight: simpleChartHeight,
      margin: chartMargin,
      x,
      y: uniqueUsersY,
      tickDates,
      yAxisLabel: "Unique users",
    });

    uniqueUsersGroup.selectAll("rect.daily-unique-users")
      .data(dailyUniqueUsers)
      .join("rect")
      .attr("class", "bar-segment daily-unique-users")
      .attr("x", (entry) => x(entry.date) ?? 0)
      .attr("y", (entry) => uniqueUsersY(entry.value))
      .attr("width", x.bandwidth())
      .attr("height", (entry) => Math.max(0, simpleInnerHeight - uniqueUsersY(entry.value)))
      .attr("rx", 3)
      .attr("fill", "var(--accent)")
      .attr("stroke", "rgba(255, 255, 255, 0.18)")
      .attr("stroke-width", 1)
      .on("mousemove", (event, entry) => {
        showTooltip(
          [
            `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
            `<div class="tooltip-metric"><span>Unique users</span><strong>${numberFormatter(entry.value)}</strong></div>`,
            `<div class="tooltip-metric"><span>Total review events</span><strong>${numberFormatter(totalReviewEventsByDate.get(entry.date) ?? 0)}</strong></div>`,
          ].join(""),
          event.clientX,
          event.clientY,
        );
      })
      .on("mouseleave", hideTooltip);

    const userReviewEventsY = d3.scaleLinear()
      .domain([0, Math.max(1, peakDailyVolume)])
      .nice()
      .range([stackedInnerHeight, 0]);

    const userReviewEventsGroup = renderChartFrame(userReviewEventsSvg, {
      chartWidth,
      chartHeight: stackedChartHeight,
      margin: chartMargin,
      x,
      y: userReviewEventsY,
      tickDates,
      yAxisLabel: "Review events",
    });

    const userSeries = d3.stack<MatrixChartEntry>()
      .keys(userIds)
      .value((entry, key) => entry.valuesByKey[key] ?? 0)(userMatrix);

    userReviewEventsGroup.selectAll(".series")
      .data(userSeries)
      .join("g")
      .attr("class", "series")
      .attr("fill", (segment) => userColorScale(segment.key))
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
      .attr("y", (entry) => userReviewEventsY(entry.y1))
      .attr("width", x.bandwidth())
      .attr("height", (entry) => Math.max(0, userReviewEventsY(entry.y0) - userReviewEventsY(entry.y1)))
      .attr("rx", 2)
      .on("mousemove", (event, entry: StackedChartRectEntry) => {
        const user = userById.get(entry.key);
        if (user === undefined) {
          return;
        }

        showTooltip(
          [
            `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
            `<p class="tooltip-user-primary">${escapeHtml(user.email)}</p>`,
            `<p class="tooltip-user-secondary">${escapeHtml(user.userId)}</p>`,
            `<div class="tooltip-metric"><span>User review events</span><strong>${numberFormatter(entry.value)}</strong></div>`,
            `<div class="tooltip-metric"><span>Total on this date</span><strong>${numberFormatter(totalReviewEventsByDate.get(entry.date) ?? entry.value)}</strong></div>`,
            `<div class="tooltip-metric"><span>User total</span><strong>${numberFormatter(user.totalReviewEvents)}</strong></div>`,
          ].join(""),
          event.clientX,
          event.clientY,
        );
      })
      .on("mouseleave", hideTooltip);

    const platformUsersY = d3.scaleLinear()
      .domain([0, Math.max(1, peakDailyPlatformUsers)])
      .nice()
      .range([stackedInnerHeight, 0]);

    const platformUsersGroup = renderChartFrame(platformUsersSvg, {
      chartWidth,
      chartHeight: stackedChartHeight,
      margin: chartMargin,
      x,
      y: platformUsersY,
      tickDates,
      yAxisLabel: "Active users",
    });

    const platformUserBars = platformActiveUsersMatrix.flatMap((entry) => reviewEventPlatforms.map((platform) => ({
      key: platform,
      date: entry.date,
      value: entry.valuesByKey[platform] ?? 0,
    })).filter((item) => item.value > 0));

    platformUsersGroup.selectAll<SVGGElement, GroupedChartRectEntry>(".series")
      .data(platformUserBars)
      .join("rect")
      .attr("class", "bar-segment")
      .attr("fill", (entry) => getPlatformColor(entry.key))
      .attr("x", (entry) => (x(entry.date) ?? 0) + (platformUsersX(entry.key) ?? 0))
      .attr("y", (entry) => platformUsersY(entry.value))
      .attr("width", platformUsersX.bandwidth())
      .attr("height", (entry) => Math.max(0, stackedInnerHeight - platformUsersY(entry.value)))
      .attr("rx", 2)
      .on("mousemove", (event, entry: GroupedChartRectEntry) => {
        showTooltip(
          [
            `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
            `<p class="tooltip-subtitle">${escapeHtml(platformLabels[entry.key])}</p>`,
            `<div class="tooltip-metric"><span>Active users on this platform</span><strong>${numberFormatter(entry.value)}</strong></div>`,
            `<div class="tooltip-metric"><span>Total unique users on this date</span><strong>${numberFormatter(dailyUniqueUsersByDate.get(entry.date) ?? 0)}</strong></div>`,
          ].join(""),
          event.clientX,
          event.clientY,
        );
      })
      .on("mouseleave", hideTooltip);

    const platformReviewEventsY = d3.scaleLinear()
      .domain([0, Math.max(1, peakDailyPlatformReviewEvents)])
      .nice()
      .range([stackedInnerHeight, 0]);

    const platformReviewEventsGroup = renderChartFrame(platformReviewEventsSvg, {
      chartWidth,
      chartHeight: stackedChartHeight,
      margin: chartMargin,
      x,
      y: platformReviewEventsY,
      tickDates,
      yAxisLabel: "Review events",
    });

    const platformReviewEventsSeries = d3.stack<MatrixChartEntry>()
      .keys(reviewEventPlatforms)
      .value((entry, key) => entry.valuesByKey[key] ?? 0)(platformReviewEventsMatrix);

    platformReviewEventsGroup.selectAll(".series")
      .data(platformReviewEventsSeries)
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
      .attr("y", (entry) => platformReviewEventsY(entry.y1))
      .attr("width", x.bandwidth())
      .attr("height", (entry) => Math.max(0, platformReviewEventsY(entry.y0) - platformReviewEventsY(entry.y1)))
      .attr("rx", 2)
      .on("mousemove", (event, entry: StackedChartRectEntry) => {
        showTooltip(
          [
            `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
            `<p class="tooltip-subtitle">${escapeHtml(platformLabels[entry.key as ReviewEventPlatform])}</p>`,
            `<div class="tooltip-metric"><span>Review events</span><strong>${numberFormatter(entry.value)}</strong></div>`,
            `<div class="tooltip-metric"><span>All platforms on this date</span><strong>${numberFormatter(totalPlatformReviewEventsByDate.get(entry.date) ?? 0)}</strong></div>`,
          ].join(""),
          event.clientX,
          event.clientY,
        );
      })
      .on("mouseleave", hideTooltip);
  }, [
    dailyUniqueUsers,
    dates,
    peakDailyPlatformReviewEvents,
    peakDailyPlatformUsers,
    peakDailyUniqueUsers,
    peakDailyVolume,
    dailyUniqueUsersByDate,
    platformActiveUsersMatrix,
    platformReviewEventsMatrix,
    tickDates,
    totalPlatformReviewEventsByDate,
    totalReviewEventsByDate,
    userById,
    userColorScale,
    userIds,
    userMatrix,
  ]);

  const summaryCards = [
    { label: "Total Review Events", value: props.report.totalReviewEvents.toLocaleString("en-US") },
    { label: "Users With Review Events", value: props.report.users.length.toLocaleString("en-US") },
    { label: "Dates With Review Events", value: props.report.dateTotals.length.toLocaleString("en-US") },
    { label: "Peak Daily Volume", value: peakDailyVolume.toLocaleString("en-US") },
    { label: "Peak Daily Unique Users", value: peakDailyUniqueUsers.toLocaleString("en-US") },
  ];

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Admin Analytics</p>
          <h1>Review Events By Date</h1>
        </div>
        <p className="subhead">
          Daily unique reviewers and stacked review-event volume by calendar date. The first two charts show overall user activity and per-user event volume. The two platform charts below compare active users and review events across <strong>web</strong>, <strong>android</strong>, and <strong>ios</strong>. Dates are grouped in the <strong>{props.report.timezone}</strong> timezone.
        </p>
        <div className="hero-meta">
          <span className="hero-badge">Signed in as {props.adminEmail}</span>
          <span className="hero-badge">Range {formatDateRangeLabel(props.report.from)} to {formatDateRangeLabel(props.report.to)}</span>
        </div>
      </section>

      <section className="summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="metric-card">
            <p className="metric-label">{card.label}</p>
            <p className="metric-value">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-meta">
            <span>Daily unique users with at least 1 review event</span>
          </div>
          <div className="chart-scroll">
            <svg ref={uniqueUsersChartRef} />
          </div>
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Stacked review events by user</span>
            <div className="chart-meta-right">
              <span>Generated {formatGeneratedAt(props.report.generatedAtUtc, props.report.timezone)}</span>
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={userReviewEventsChartRef} />
          </div>
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Daily active users by platform</span>
            <div className="chart-meta-right">
              <PlatformKey />
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={platformUsersChartRef} />
          </div>
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Daily review events by platform</span>
            <div className="chart-meta-right">
              <PlatformKey />
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={platformReviewEventsChartRef} />
          </div>
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </main>
  );
}

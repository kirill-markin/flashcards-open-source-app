import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type JSX } from "react";
import * as d3 from "d3";
import {
  reviewEventPlatforms,
  type ReviewEventPlatform,
  type ReviewEventsByDatePlatformActiveUserTotal,
  type ReviewEventsByDatePlatformReviewEventTotal,
  type ReviewEventsByDateReport,
  type ReviewEventsByDateUniqueUserCohort,
  type ReviewEventsByDateUser,
} from "../../adminApi";
import {
  filterReviewEventsByDateReportByUsers,
  type ReviewEventsByDateRange,
} from "./query";

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

type ActiveUserFilter = Readonly<{
  userId: string;
  label: string;
  secondaryLabel: string;
  hasUserInReport: boolean;
}>;

type SearchableUserFilterOption = Readonly<{
  user: ReviewEventsByDateUser;
  searchableValue: string;
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

const uniqueUserCohortKeys = ["returning", "new"] as const;
type UniqueUserCohortKey = (typeof uniqueUserCohortKeys)[number];
const uniqueUserCohortLabels: Readonly<Record<UniqueUserCohortKey, string>> = {
  returning: "Returning",
  new: "New",
};
const uniqueUserCohortColors: Readonly<Record<UniqueUserCohortKey, string>> = {
  returning: "var(--accent)",
  new: "#2e6f95",
};
const userColorPalette: ReadonlyArray<string> = [
  ...d3.schemeTableau10,
  ...d3.schemeSet2,
  ...d3.schemeDark2,
  "#e15759",
  "#76b7b2",
  "#f28e2b",
  "#59a14f",
];
const visibleUserFilterOptionLimit = 50;

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

function formatGeneratedAt(value: string): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
  return `${formatted} UTC`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildDailyUniqueUserCohortMatrix(
  cohorts: ReadonlyArray<ReviewEventsByDateUniqueUserCohort>,
): ReadonlyArray<MatrixChartEntry> {
  return cohorts.map((cohort) => ({
    date: cohort.date,
    valuesByKey: {
      returning: cohort.returningReviewingUsers,
      new: cohort.newReviewingUsers,
    },
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
  const colors = userIds.map((userId) => userColorPalette[getUserColorPaletteIndex(userId)]);

  return d3.scaleOrdinal<string, string>(userIds, colors);
}

function getUserColorPaletteIndex(userId: string): number {
  let hash = 0;

  for (const character of userId) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }

  return Math.abs(hash) % userColorPalette.length;
}

function getPlatformColor(platform: string): string {
  if (reviewEventPlatforms.includes(platform as ReviewEventPlatform) === false) {
    throw new Error(`Unsupported platform color key: ${platform}`);
  }

  return platformColors[platform as ReviewEventPlatform];
}

function getUserFilterLabel(user: ReviewEventsByDateUser): string {
  return user.email === "(no email)" ? user.userId : user.email;
}

function getUserFilterSecondaryLabel(user: ReviewEventsByDateUser): string {
  return user.email === "(no email)" ? user.email : user.userId;
}

function getNormalizedSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function getUserFilterSearchableValue(user: ReviewEventsByDateUser): string {
  return getNormalizedSearchValue([
    getUserFilterLabel(user),
    user.userId,
    user.email,
  ].join(" "));
}

function doesUserMatchSearch(option: SearchableUserFilterOption, normalizedSearchValue: string): boolean {
  return normalizedSearchValue === "" || option.searchableValue.includes(normalizedSearchValue);
}

function getStableUserColorDomain(users: ReadonlyArray<ReviewEventsByDateUser>): ReadonlyArray<string> {
  return users.map((user) => user.userId).sort((leftUserId, rightUserId) => leftUserId.localeCompare(rightUserId));
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

function UniqueUserCohortKey(): JSX.Element {
  return (
    <div className="platform-key" aria-label="Unique users cohort color key">
      {uniqueUserCohortKeys.map((cohort) => (
        <span key={cohort} className="platform-key-item">
          <span className="platform-key-swatch" style={{ backgroundColor: uniqueUserCohortColors[cohort] }} />
          <span>{uniqueUserCohortLabels[cohort]}</span>
        </span>
      ))}
    </div>
  );
}

export function ReviewEventsByDateDashboard(
  props: Readonly<{
    report: ReviewEventsByDateReport;
    adminEmail: string;
    defaultRange: ReviewEventsByDateRange;
    isReportLoading: boolean;
    dateRangeError: string;
    onDateRangeApply: (range: ReviewEventsByDateRange) => void;
    onDateRangeReset: () => void;
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
  const [draftRange, setDraftRange] = useState<ReviewEventsByDateRange>({
    from: props.report.from,
    to: props.report.to,
  });
  const [selectedUserIds, setSelectedUserIds] = useState<ReadonlyArray<string>>([]);
  const [userFilterSearchValue, setUserFilterSearchValue] = useState<string>("");

  useEffect(() => {
    setDraftRange({
      from: props.report.from,
      to: props.report.to,
    });
  }, [props.report.from, props.report.to]);

  function handleFromDateChange(event: ChangeEvent<HTMLInputElement>): void {
    const from = event.currentTarget.value;
    setDraftRange((currentRange) => ({
      ...currentRange,
      from,
    }));
  }

  function handleUserFilterSearchChange(event: ChangeEvent<HTMLInputElement>): void {
    setUserFilterSearchValue(event.currentTarget.value);
  }

  function handleUserFilterChange(event: ChangeEvent<HTMLInputElement>): void {
    const userId = event.currentTarget.value;
    const isChecked = event.currentTarget.checked;
    setSelectedUserIds((currentUserIds) => {
      if (isChecked) {
        if (currentUserIds.includes(userId)) {
          return currentUserIds;
        }

        return [...currentUserIds, userId];
      }

      return currentUserIds.filter((currentUserId) => currentUserId !== userId);
    });
  }

  function handleUserFilterRemove(userId: string): void {
    setSelectedUserIds((currentUserIds) => currentUserIds.filter((currentUserId) => currentUserId !== userId));
  }

  function handleUserFilterClear(): void {
    setSelectedUserIds([]);
  }

  const handleChartUserFilterApply = useCallback((userId: string): void => {
    setSelectedUserIds([userId]);
    setTooltipState((currentState) => ({
      ...currentState,
      visible: false,
    }));
  }, []);

  function handleToDateChange(event: ChangeEvent<HTMLInputElement>): void {
    const to = event.currentTarget.value;
    setDraftRange((currentRange) => ({
      ...currentRange,
      to,
    }));
  }

  function handleDateRangeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    props.onDateRangeApply(draftRange);
  }

  function handleDateRangeReset(): void {
    setDraftRange(props.defaultRange);
    props.onDateRangeReset();
  }

  const filteredReport = useMemo(
    () => filterReviewEventsByDateReportByUsers(props.report, selectedUserIds),
    [props.report, selectedUserIds],
  );
  const selectedUserIdSet = useMemo(
    () => new Set(selectedUserIds),
    [selectedUserIds],
  );
  const rawUserById = useMemo(
    () => new Map(props.report.users.map((user) => [user.userId, user])),
    [props.report.users],
  );
  const activeUserFilters = useMemo(
    (): ReadonlyArray<ActiveUserFilter> => selectedUserIds.map((userId) => {
      const user = rawUserById.get(userId);
      return {
        userId,
        label: user === undefined ? userId : getUserFilterLabel(user),
        secondaryLabel: user === undefined ? "No review events in range" : getUserFilterSecondaryLabel(user),
        hasUserInReport: user !== undefined,
      };
    }),
    [rawUserById, selectedUserIds],
  );
  const normalizedUserFilterSearchValue = useMemo(
    () => getNormalizedSearchValue(userFilterSearchValue),
    [userFilterSearchValue],
  );
  const searchableUserFilterOptions = useMemo(
    (): ReadonlyArray<SearchableUserFilterOption> => props.report.users.map((user) => ({
      user,
      searchableValue: getUserFilterSearchableValue(user),
    })),
    [props.report.users],
  );
  const matchingUserFilterOptions = useMemo(
    () => searchableUserFilterOptions
      .filter((option) => doesUserMatchSearch(option, normalizedUserFilterSearchValue))
      .map((option) => option.user),
    [normalizedUserFilterSearchValue, searchableUserFilterOptions],
  );
  const visibleUserFilterOptions = useMemo(
    () => matchingUserFilterOptions.slice(0, visibleUserFilterOptionLimit),
    [matchingUserFilterOptions],
  );
  const hiddenUserFilterOptionCount = matchingUserFilterOptions.length - visibleUserFilterOptions.length;
  const dates = useMemo(
    () => filteredReport.dateTotals.map((item) => item.date),
    [filteredReport.dateTotals],
  );
  const tickDates = useMemo(
    () => createTickDates(dates),
    [dates],
  );
  const allUserIds = useMemo(
    () => getStableUserColorDomain(props.report.users),
    [props.report.users],
  );
  const userIds = useMemo(
    () => filteredReport.users.map((user) => user.userId),
    [filteredReport.users],
  );
  const userColorScale = useMemo(
    () => getUserColorScale(allUserIds),
    [allUserIds],
  );
  const dailyUniqueUserCohortMatrix = useMemo(
    () => buildDailyUniqueUserCohortMatrix(filteredReport.dailyUniqueUserCohorts),
    [filteredReport.dailyUniqueUserCohorts],
  );
  const dailyUniqueUserTotals = useMemo<ReadonlyArray<DailyValueEntry>>(
    () => filteredReport.dailyUniqueUserCohorts.map((item) => ({
      date: item.date,
      value: item.newReviewingUsers + item.returningReviewingUsers,
    })),
    [filteredReport.dailyUniqueUserCohorts],
  );
  const userMatrix = useMemo(
    () => buildUserMatrix(filteredReport),
    [filteredReport],
  );
  const platformActiveUsersMatrix = useMemo(
    () => buildPlatformMatrix(filteredReport.platformActiveUserTotals, (item) => item.activeUserCount, dates),
    [dates, filteredReport.platformActiveUserTotals],
  );
  const platformReviewEventsMatrix = useMemo(
    () => buildPlatformMatrix(filteredReport.platformReviewEventTotals, (item) => item.reviewEventCount, dates),
    [dates, filteredReport.platformReviewEventTotals],
  );
  const totalReviewEventsByDate = useMemo(
    () => new Map(filteredReport.dateTotals.map((item) => [item.date, item.totalReviewEvents])),
    [filteredReport.dateTotals],
  );
  const dailyUniqueUsersByDate = useMemo(
    () => new Map(dailyUniqueUserTotals.map((item) => [item.date, item.value])),
    [dailyUniqueUserTotals],
  );
  const totalPlatformReviewEventsByDate = useMemo(
    () => buildTotalsByDate(platformReviewEventsMatrix),
    [platformReviewEventsMatrix],
  );
  const peakDailyUniqueUsers = useMemo(
    () => getPeakDailyValue(dailyUniqueUserTotals),
    [dailyUniqueUserTotals],
  );
  const peakDailyVolume = useMemo(
    () => d3.max(filteredReport.dateTotals, (item) => item.totalReviewEvents) ?? 0,
    [filteredReport.dateTotals],
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

    const uniqueUsersSeries = d3.stack<MatrixChartEntry>()
      .keys(uniqueUserCohortKeys)
      .value((entry, key) => entry.valuesByKey[key] ?? 0)(dailyUniqueUserCohortMatrix);

    uniqueUsersGroup.selectAll(".series")
      .data(uniqueUsersSeries)
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
      .attr("y", (entry) => uniqueUsersY(entry.y1))
      .attr("width", x.bandwidth())
      .attr("height", (entry) => Math.max(0, uniqueUsersY(entry.y0) - uniqueUsersY(entry.y1)))
      .attr("rx", 3)
      .attr("stroke", "rgba(255, 255, 255, 0.18)")
      .attr("stroke-width", 1)
      .on("mousemove", (event, entry: StackedChartRectEntry) => {
        const cohortKey = entry.key as UniqueUserCohortKey;
        const totalUniqueUsers = dailyUniqueUsersByDate.get(entry.date) ?? entry.value;
        showTooltip(
          [
            `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
            `<p class="tooltip-subtitle">${escapeHtml(uniqueUserCohortLabels[cohortKey])}</p>`,
            `<div class="tooltip-metric"><span>Unique users in this cohort</span><strong>${numberFormatter(entry.value)}</strong></div>`,
            `<div class="tooltip-metric"><span>Total unique users</span><strong>${numberFormatter(totalUniqueUsers)}</strong></div>`,
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

    const userReviewEventBars = userReviewEventsGroup.selectAll(".series")
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
      .attr("class", `bar-segment user-review-events${props.isReportLoading ? "" : " clickable"}`)
      .attr("x", (entry) => x(entry.date) ?? 0)
      .attr("y", (entry) => userReviewEventsY(entry.y1))
      .attr("width", x.bandwidth())
      .attr("height", (entry) => Math.max(0, userReviewEventsY(entry.y0) - userReviewEventsY(entry.y1)))
      .attr("rx", 2)
      .on("mousemove", (event, entry: StackedChartRectEntry) => {
        const user = rawUserById.get(entry.key);
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

    if (props.isReportLoading === false) {
      userReviewEventBars
        .on("click", (_event: MouseEvent, entry: StackedChartRectEntry) => {
          handleChartUserFilterApply(entry.key);
        });
    } else {
      userReviewEventBars.on("click", null);
    }

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
    dailyUniqueUserCohortMatrix,
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
    handleChartUserFilterApply,
    props.isReportLoading,
    rawUserById,
    userColorScale,
    userIds,
    userMatrix,
  ]);

  const summaryCards = [
    { label: "Total Review Events", value: filteredReport.totalReviewEvents.toLocaleString("en-US") },
    { label: "Users With Review Events", value: filteredReport.users.length.toLocaleString("en-US") },
    { label: "Days In Range", value: filteredReport.dateTotals.length.toLocaleString("en-US") },
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
          Daily unique reviewers and stacked review-event volume by calendar date. The first two charts show overall user activity and per-user event volume. The two platform charts below compare active users and review events across <strong>web</strong>, <strong>android</strong>, and <strong>ios</strong>. Dates are grouped in <strong>UTC</strong>.
        </p>
        <div className="hero-meta">
          <span className="hero-badge">Signed in as {props.adminEmail}</span>
          <span className="hero-badge">Range {formatDateRangeLabel(props.report.from)} to {formatDateRangeLabel(props.report.to)}</span>
          <span className="hero-badge">All dates and times in UTC</span>
        </div>
      </section>

      <section className="filter-panel" aria-labelledby="review-filters-title">
        <div className="filter-panel-header">
          <div>
            <p className="eyebrow">Filters</p>
            <h2 id="review-filters-title">Filters</h2>
          </div>
          <span className={`filter-status${props.isReportLoading ? " active" : ""}`} aria-live="polite">
            {props.isReportLoading ? "Updating" : `Default ${props.defaultRange.from} to ${props.defaultRange.to}`}
          </span>
        </div>
        <form className="date-filter-form" noValidate onSubmit={handleDateRangeSubmit}>
          <label className="date-filter-field">
            <span>From</span>
            <input
              type="date"
              value={draftRange.from}
              min={props.defaultRange.from}
              max={props.defaultRange.to}
              disabled={props.isReportLoading}
              onChange={handleFromDateChange}
            />
          </label>
          <label className="date-filter-field">
            <span>To</span>
            <input
              type="date"
              value={draftRange.to}
              min={props.defaultRange.from}
              max={props.defaultRange.to}
              disabled={props.isReportLoading}
              onChange={handleToDateChange}
            />
          </label>
          <div className="date-filter-actions">
            <button className="filter-button filter-button-primary" type="submit" disabled={props.isReportLoading}>
              Apply
            </button>
            <button className="filter-button" type="button" disabled={props.isReportLoading} onClick={handleDateRangeReset}>
              Reset
            </button>
          </div>
        </form>
        <div className="user-filter-section" aria-label="User filter">
          <div className="user-filter-header">
            <span>User</span>
            <span>
              {selectedUserIds.length === 0
                ? "All users"
                : `${selectedUserIds.length} selected`}
            </span>
          </div>
          {props.report.users.length > 0 ? (
            <>
              <label className="user-filter-search">
                <span>Search users</span>
                <input
                  type="search"
                  value={userFilterSearchValue}
                  placeholder="Email or user ID"
                  disabled={props.isReportLoading}
                  onChange={handleUserFilterSearchChange}
                />
              </label>
              {visibleUserFilterOptions.length > 0 ? (
                <div className="user-filter-options">
                  {visibleUserFilterOptions.map((user) => (
                    <label
                      key={user.userId}
                      className={`user-filter-option${selectedUserIdSet.has(user.userId) ? " selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        value={user.userId}
                        checked={selectedUserIdSet.has(user.userId)}
                        disabled={props.isReportLoading}
                        onChange={handleUserFilterChange}
                      />
                      <span className="user-filter-swatch" style={{ backgroundColor: userColorScale(user.userId) }} />
                      <span className="user-filter-option-text">
                        <span className="user-filter-option-primary">{getUserFilterLabel(user)}</span>
                        <span className="user-filter-option-secondary">
                          {user.userId} - {user.totalReviewEvents.toLocaleString("en-US")} events
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="user-filter-empty">No users match this search.</p>
              )}
              {hiddenUserFilterOptionCount > 0 ? (
                <p className="user-filter-limit">
                  Showing {visibleUserFilterOptions.length.toLocaleString("en-US")} of {matchingUserFilterOptions.length.toLocaleString("en-US")} matching users.
                </p>
              ) : null}
            </>
          ) : (
            <p className="user-filter-empty">No users with review events in this range.</p>
          )}
          {activeUserFilters.length > 0 ? (
            <div className="active-filter-chips" aria-label="Active user filters">
              {activeUserFilters.map((filter) => (
                <span key={filter.userId} className="active-filter-chip">
                  <span
                    className="active-filter-swatch"
                    style={{
                      backgroundColor: filter.hasUserInReport
                        ? userColorScale(filter.userId)
                        : "rgba(255, 255, 255, 0.36)",
                    }}
                  />
                  <span className="active-filter-text">
                    <span>{filter.label}</span>
                    <span>{filter.secondaryLabel}</span>
                  </span>
                  <button
                    className="active-filter-remove"
                    type="button"
                    disabled={props.isReportLoading}
                    aria-label={`Remove user filter ${filter.label}`}
                    onClick={() => handleUserFilterRemove(filter.userId)}
                  >
                    x
                  </button>
                </span>
              ))}
              <button
                className="filter-button filter-button-compact"
                type="button"
                disabled={props.isReportLoading}
                onClick={handleUserFilterClear}
              >
                Clear users
              </button>
            </div>
          ) : null}
        </div>
        {props.dateRangeError !== "" ? (
          <p className="filter-error" role="alert">{props.dateRangeError}</p>
        ) : null}
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
            <span>Daily unique users with at least 1 review event &mdash; new vs returning</span>
            <div className="chart-meta-right">
              <UniqueUserCohortKey />
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={uniqueUsersChartRef} />
          </div>
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Stacked review events by user</span>
            <div className="chart-meta-right">
              <span>Generated {formatGeneratedAt(props.report.generatedAtUtc)}</span>
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

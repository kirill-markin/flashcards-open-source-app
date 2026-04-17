import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import type { ReviewEventsByDateReport } from "../../adminApi";

type ChartTooltipState = Readonly<{
  visible: boolean;
  html: string;
  left: number;
  top: number;
}>;

type DailyUniqueUsersEntry = Readonly<{
  date: string;
  userCount: number;
}>;

type MatrixEntry = Readonly<{
  date: string;
  valuesByUserId: Readonly<Record<string, number>>;
}>;

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

function buildMatrix(report: ReviewEventsByDateReport): ReadonlyArray<MatrixEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const row of report.rows) {
    const currentValues = valuesByDate.get(row.date) ?? {};
    currentValues[row.userId] = row.reviewEventCount;
    valuesByDate.set(row.date, currentValues);
  }

  return report.dateTotals.map((item) => ({
    date: item.date,
    valuesByUserId: valuesByDate.get(item.date) ?? {},
  }));
}

function buildDailyUniqueUsers(report: ReviewEventsByDateReport): ReadonlyArray<DailyUniqueUsersEntry> {
  const countsByDate = new Map<string, number>();

  for (const row of report.rows) {
    countsByDate.set(row.date, (countsByDate.get(row.date) ?? 0) + 1);
  }

  return report.dateTotals.map((item) => ({
    date: item.date,
    userCount: countsByDate.get(item.date) ?? 0,
  }));
}

function getColorScale(userIds: ReadonlyArray<string>): d3.ScaleOrdinal<string, string> {
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
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

export function ReviewEventsByDateDashboard(
  props: Readonly<{
    report: ReviewEventsByDateReport;
    adminEmail: string;
  }>,
): JSX.Element {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const uniqueUsersChartRef = useRef<SVGSVGElement | null>(null);
  const [showEmails, setShowEmails] = useState(false);
  const [tooltipState, setTooltipState] = useState<ChartTooltipState>({
    visible: false,
    html: "",
    left: 0,
    top: 0,
  });

  const userIds = useMemo(
    () => props.report.users.map((user) => user.userId),
    [props.report.users],
  );
  const colorScale = useMemo(
    () => getColorScale(userIds),
    [userIds],
  );
  const matrix = useMemo(
    () => buildMatrix(props.report),
    [props.report],
  );
  const dailyUniqueUsers = useMemo(
    () => buildDailyUniqueUsers(props.report),
    [props.report],
  );
  const totalByDate = useMemo(
    () => new Map(props.report.dateTotals.map((item) => [item.date, item.totalReviewEvents])),
    [props.report.dateTotals],
  );
  const userById = useMemo(
    () => new Map(props.report.users.map((user) => [user.userId, user])),
    [props.report.users],
  );
  const peakDailyVolume = useMemo(
    () => d3.max(props.report.dateTotals, (item) => item.totalReviewEvents) ?? 0,
    [props.report.dateTotals],
  );
  const peakDailyUniqueUsers = useMemo(
    () => d3.max(dailyUniqueUsers, (item) => item.userCount) ?? 0,
    [dailyUniqueUsers],
  );

  useEffect(() => {
    const svgElement = chartRef.current;
    const uniqueUsersSvgElement = uniqueUsersChartRef.current;
    if (svgElement === null || uniqueUsersSvgElement === null) {
      return;
    }

    const chartSvg = d3.select(svgElement);
    const uniqueUsersSvg = d3.select(uniqueUsersSvgElement);
    const margin = { top: 28, right: 68, bottom: 88, left: 68 };
    const chartHeight = 620;
    const uniqueUsersChartHeight = 300;
    const chartWidth = 1320;
    const innerWidth = chartWidth - margin.left - margin.right;
    const chartInnerHeight = chartHeight - margin.top - margin.bottom;
    const uniqueUsersInnerHeight = uniqueUsersChartHeight - margin.top - margin.bottom;
    const dates = props.report.dateTotals.map((item) => item.date);
    const compactTickDates = dates.filter(
      (_date, index) => dates.length <= 22 || index % Math.ceil(dates.length / 16) === 0,
    );

    const x = d3.scaleBand<string>()
      .domain(dates)
      .range([0, innerWidth])
      .paddingInner(0.08)
      .paddingOuter(0.04);
    const y = d3.scaleLinear()
      .domain([0, peakDailyVolume])
      .nice()
      .range([chartInnerHeight, 0]);
    const uniqueUsersY = d3.scaleLinear()
      .domain([0, peakDailyUniqueUsers])
      .nice()
      .range([uniqueUsersInnerHeight, 0]);
    const stack = d3.stack<MatrixEntry>()
      .keys(userIds)
      .value((entry, key) => entry.valuesByUserId[key] ?? 0);

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

    chartSvg.selectAll("*").remove();
    chartSvg.attr("viewBox", `0 0 ${chartWidth} ${chartHeight}`);

    const chartGroup = chartSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    chartGroup.append("g")
      .attr("class", "grid")
      .call(
        d3.axisLeft(y)
          .ticks(Math.min(8, peakDailyVolume + 1))
          .tickSize(-innerWidth)
          .tickFormat(() => ""),
      )
      .call((group) => group.select(".domain").remove());

    chartGroup.append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(y).ticks(Math.min(8, peakDailyVolume + 1)).tickFormat((value) => numberFormatter(Number(value))));

    chartGroup.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${innerWidth},0)`)
      .call(d3.axisRight(y).ticks(Math.min(8, peakDailyVolume + 1)).tickFormat((value) => numberFormatter(Number(value))));

    chartGroup.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${chartInnerHeight})`)
      .call(
        d3.axisBottom(x)
          .tickValues(compactTickDates)
          .tickFormat((value) => formatCompactDateLabel(value)),
      )
      .call((group) => group.selectAll("text")
        .attr("transform", "rotate(-32)")
        .style("text-anchor", "end")
        .attr("dx", "-0.5em")
        .attr("dy", "0.3em"));

    chartGroup.append("text")
      .attr("class", "axis-label")
      .attr("x", -chartInnerHeight / 2)
      .attr("y", -48)
      .attr("transform", "rotate(-90)")
      .attr("text-anchor", "middle")
      .text("Review events");

    chartGroup.append("text")
      .attr("class", "axis-label")
      .attr("x", innerWidth / 2)
      .attr("y", chartInnerHeight + 74)
      .attr("text-anchor", "middle")
      .text("Review date");

    const series = stack(matrix);
    const layer = chartGroup.selectAll(".series")
      .data(series)
      .join("g")
      .attr("class", "series")
      .attr("fill", (segment) => colorScale(segment.key));

    layer.selectAll("rect")
      .data((segment) => segment.map((entry) => ({
        key: segment.key,
        date: entry.data.date,
        y0: entry[0],
        y1: entry[1],
        value: entry.data.valuesByUserId[segment.key] ?? 0,
      })).filter((entry) => entry.value > 0))
      .join("rect")
      .attr("class", "bar-segment")
      .attr("x", (entry) => x(entry.date) ?? 0)
      .attr("y", (entry) => y(entry.y1))
      .attr("width", x.bandwidth())
      .attr("height", (entry) => Math.max(0, y(entry.y0) - y(entry.y1)))
      .attr("rx", 2)
      .on("mousemove", (event, entry) => {
        const user = userById.get(entry.key);
        if (user === undefined) {
          return;
        }

        showTooltip(
          [
            `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
            `<p class="tooltip-subtitle"><span class="sensitive-email">${escapeHtml(user.email)}</span><br><span style="opacity:0.78">${escapeHtml(user.userId)}</span></p>`,
            `<div class="tooltip-metric"><span>User review events</span><strong>${numberFormatter(entry.value)}</strong></div>`,
            `<div class="tooltip-metric"><span>Total on this date</span><strong>${numberFormatter(totalByDate.get(entry.date) ?? entry.value)}</strong></div>`,
            `<div class="tooltip-metric"><span>User total</span><strong>${numberFormatter(user.totalReviewEvents)}</strong></div>`,
          ].join(""),
          event.clientX,
          event.clientY,
        );
      })
      .on("mouseleave", hideTooltip);

    uniqueUsersSvg.selectAll("*").remove();
    uniqueUsersSvg.attr("viewBox", `0 0 ${chartWidth} ${uniqueUsersChartHeight}`);

    const uniqueUsersGroup = uniqueUsersSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    uniqueUsersGroup.append("g")
      .attr("class", "grid")
      .call(
        d3.axisLeft(uniqueUsersY)
          .ticks(Math.min(6, peakDailyUniqueUsers + 1))
          .tickSize(-innerWidth)
          .tickFormat(() => ""),
      )
      .call((group) => group.select(".domain").remove());

    uniqueUsersGroup.append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(uniqueUsersY).ticks(Math.min(6, peakDailyUniqueUsers + 1)).tickFormat((value) => numberFormatter(Number(value))));

    uniqueUsersGroup.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${innerWidth},0)`)
      .call(d3.axisRight(uniqueUsersY).ticks(Math.min(6, peakDailyUniqueUsers + 1)).tickFormat((value) => numberFormatter(Number(value))));

    uniqueUsersGroup.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${uniqueUsersInnerHeight})`)
      .call(
        d3.axisBottom(x)
          .tickValues(compactTickDates)
          .tickFormat((value) => formatCompactDateLabel(value)),
      )
      .call((group) => group.selectAll("text")
        .attr("transform", "rotate(-32)")
        .style("text-anchor", "end")
        .attr("dx", "-0.5em")
        .attr("dy", "0.3em"));

    uniqueUsersGroup.append("text")
      .attr("class", "axis-label")
      .attr("x", -uniqueUsersInnerHeight / 2)
      .attr("y", -48)
      .attr("transform", "rotate(-90)")
      .attr("text-anchor", "middle")
      .text("Unique users");

    uniqueUsersGroup.append("text")
      .attr("class", "axis-label")
      .attr("x", innerWidth / 2)
      .attr("y", uniqueUsersInnerHeight + 74)
      .attr("text-anchor", "middle")
      .text("Review date");

    uniqueUsersGroup.selectAll("rect.daily-unique-users")
      .data(dailyUniqueUsers)
      .join("rect")
      .attr("class", "bar-segment daily-unique-users")
      .attr("x", (entry) => x(entry.date) ?? 0)
      .attr("y", (entry) => uniqueUsersY(entry.userCount))
      .attr("width", x.bandwidth())
      .attr("height", (entry) => Math.max(0, uniqueUsersInnerHeight - uniqueUsersY(entry.userCount)))
      .attr("rx", 3)
      .attr("fill", "var(--accent)")
      .attr("stroke", "rgba(255, 255, 255, 0.18)")
      .attr("stroke-width", 1)
      .on("mousemove", (event, entry) => {
        showTooltip(
          [
            `<p class="tooltip-title">${escapeHtml(formatDateRangeLabel(entry.date))}</p>`,
            `<div class="tooltip-metric"><span>Unique users</span><strong>${numberFormatter(entry.userCount)}</strong></div>`,
            `<div class="tooltip-metric"><span>Total review events</span><strong>${numberFormatter(totalByDate.get(entry.date) ?? 0)}</strong></div>`,
          ].join(""),
          event.clientX,
          event.clientY,
        );
      })
      .on("mouseleave", hideTooltip);
  }, [
    colorScale,
    dailyUniqueUsers,
    matrix,
    peakDailyUniqueUsers,
    peakDailyVolume,
    props.report,
    totalByDate,
    userById,
    userIds,
  ]);

  const summaryCards = [
    { label: "Total Review Events", value: props.report.totalReviewEvents.toLocaleString("en-US") },
    { label: "Users With Review Events", value: props.report.users.length.toLocaleString("en-US") },
    { label: "Dates With Review Events", value: props.report.dateTotals.length.toLocaleString("en-US") },
    { label: "Peak Daily Volume", value: peakDailyVolume.toLocaleString("en-US") },
    { label: "Peak Daily Unique Users", value: peakDailyUniqueUsers.toLocaleString("en-US") },
  ];

  return (
    <main className="shell" data-show-emails={showEmails ? "true" : "false"}>
      <section className="hero">
        <div>
          <p className="eyebrow">Admin Analytics</p>
          <h1>Review Events By Date</h1>
        </div>
        <p className="subhead">
          Daily unique reviewers and stacked review-event volume by calendar date. The upper chart shows how many users reviewed at least once per day, and the lower chart breaks total review events down by user. Dates are grouped in the <strong>{props.report.timezone}</strong> timezone.
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
            <span>Stacked review events by date</span>
            <div className="chart-meta-right">
              <label className="privacy-toggle" htmlFor="show-emails-toggle">
                <input
                  id="show-emails-toggle"
                  type="checkbox"
                  checked={showEmails}
                  onChange={(event) => setShowEmails(event.target.checked)}
                />
                <span>{showEmails ? "Emails visible" : "Emails hidden"}</span>
              </label>
              <span>Generated {formatGeneratedAt(props.report.generatedAtUtc, props.report.timezone)}</span>
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={chartRef} />
          </div>
        </div>
      </section>

      <section className="legend-shell">
        <div className="legend-header">
          <div>
            <p className="eyebrow">Legend</p>
            <h2>Users by total review events</h2>
          </div>
        </div>
        <div className="legend-grid">
          {props.report.users.map((user) => (
            <article key={user.userId} className="legend-card">
              <div className="legend-swatch" style={{ backgroundColor: colorScale(user.userId) }} />
              <div className="legend-copy">
                <p className="legend-label">
                  <span className="sensitive-email">{user.email}</span>
                </p>
                <p className="legend-subtitle">{user.userId}</p>
              </div>
              <strong className="legend-total">{user.totalReviewEvents.toLocaleString("en-US")}</strong>
            </article>
          ))}
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </main>
  );
}

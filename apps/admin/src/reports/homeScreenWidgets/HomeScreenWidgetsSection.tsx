import { useEffect, useMemo, useRef, type JSX } from "react";
import * as d3 from "d3";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartGeneratedAt } from "../../charts/ChartGeneratedAt";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes, type PlacedChartNote } from "../../charts/chartNotes";
import {
  chartWidth,
  dailyTotalBarColor,
  getPlatformColor,
  getPlatformLabel,
  neutralChartColor,
  stackedChartHeight,
} from "../../charts/chartPrimitives";
import { escapeHtml, formatCompactDateLabel, formatDateRangeLabel } from "../../charts/formatting";
import { renderRateLineChart } from "../../charts/rateLineChart";
import { buildBreakdownValueColors, renderStackedBreakdownChart } from "../../charts/stackedBreakdownChart";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import { getLatestGeneralReport, type GeneralReportView } from "../generalReportView";
import { buildRequestedDateRange, todayUtcCalendarDate } from "../reportValues";
import {
  homeScreenWidgetsReportLabel,
  widgetKinds,
  widgetPlatforms,
  widgetReturnWindowDays,
  widgetSizes,
  type HomeScreenWidgetsReport,
  type WidgetKind,
  type WidgetKindSummary,
  type WidgetPeopleDay,
  type WidgetReturnDay,
  type WidgetReturnGroup,
  type WidgetSize,
  type WidgetTapsDay,
} from "./query";
import "./homeScreenWidgets.css";

const returnGroupKeys = ["with-widget", "without-widget"] as const;
type ReturnGroupKey = (typeof returnGroupKeys)[number];

const returnGroupLabels: Readonly<Record<ReturnGroupKey, string>> = {
  "with-widget": "With a widget",
  "without-widget": "Without a widget",
};

const returnGroupColors: Readonly<Record<ReturnGroupKey, string>> = {
  "with-widget": dailyTotalBarColor,
  "without-widget": neutralChartColor,
};

const widgetSizeLabels: Readonly<Record<WidgetSize, string>> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  accessory_circular: "Lock Screen circular",
  accessory_rectangular: "Lock Screen rectangular",
  accessory_inline: "Lock Screen inline",
};

const widgetKindLabels: Readonly<Record<WidgetKind, string>> = {
  review: "Review",
  activity: "Activity",
  year: "Year",
  today: "Today",
  lock_screen: "Lock Screen",
  reviews_chart: "Reviews chart",
  streaks: "Streaks",
  month_calendar: "Calendar",
  coming_up: "Coming up",
  dashboard: "Dashboard",
};

const widgetSizeColors = buildBreakdownValueColors(widgetSizes);

function getWidgetSizeColor(size: string): string {
  const color = widgetSizeColors.get(size);
  if (color === undefined) {
    throw new Error(`Unsupported widget size color key: ${size}`);
  }
  return color;
}

/** One tooltip line, also read out as the bar's accessible label. */
type ChartMetric = readonly [label: string, value: string];

const numberFormatter = d3.format(",");
const rateFormatter = d3.format(".1%");

const emptyKindSummary = (widgetKind: WidgetKind): WidgetKindSummary => ({ widgetKind, placedPeople: 0, tapCount: 0, tapPeople: 0 });
const emptyPeopleDay = (date: string): WidgetPeopleDay => ({ date, peopleByPlatform: new Map(), totalPeople: 0 });
const emptyTapsDay = (date: string): WidgetTapsDay => ({ date, tapsBySize: new Map(), totalTaps: 0, totalPeople: 0 });
const emptyReturnDay = (date: string): WidgetReturnDay => ({
  date,
  withWidget: { people: 0, returnedPeople: null },
  withoutWidget: { people: 0, returnedPeople: null },
});

type HomeScreenWidgetsChartModel = Readonly<{
  dates: ReadonlyArray<string>;
  peopleByDate: ReadonlyMap<string, WidgetPeopleDay>;
  tapsByDate: ReadonlyMap<string, WidgetTapsDay>;
  returnByDate: ReadonlyMap<string, WidgetReturnDay>;
}>;

function buildChartModel(report: HomeScreenWidgetsReport): HomeScreenWidgetsChartModel {
  return {
    dates: buildRequestedDateRange(report.from, report.to, homeScreenWidgetsReportLabel),
    peopleByDate: new Map(report.peopleDays.map((day) => [day.date, day])),
    tapsByDate: new Map(report.tapsDays.map((day) => [day.date, day])),
    returnByDate: new Map(report.returnDays.map((day) => [day.date, day])),
  };
}

function getReturnGroup(day: WidgetReturnDay, groupKey: ReturnGroupKey): WidgetReturnGroup {
  return groupKey === "with-widget" ? day.withWidget : day.withoutWidget;
}

/** Null, so the line breaks, while the 7-day window is not over or the group has no member. */
function getReturnRate(group: WidgetReturnGroup): number | null {
  return group.returnedPeople === null || group.people === 0 ? null : group.returnedPeople / group.people;
}

function formatReturnGroup(group: WidgetReturnGroup): string {
  if (group.people === 0) {
    return "No one";
  }
  if (group.returnedPeople === null) {
    return `${numberFormatter(group.people)} people · window not over`;
  }
  return `${rateFormatter(group.returnedPeople / group.people)} · ${numberFormatter(group.returnedPeople)} of ${numberFormatter(group.people)}`;
}

/** Every kind in catalog order, a kind with no placement and no tap as zeros. */
function WidgetKindsTable(props: Readonly<{ report: HomeScreenWidgetsReport }>): JSX.Element {
  const summariesByKind = new Map(props.report.kindSummaries.map((summary) => [summary.widgetKind, summary]));
  return (
    <table className="widget-kinds-table">
      <caption>Placed at the end of {formatDateRangeLabel(props.report.to)}; taps over {formatDateRangeLabel(props.report.from)} – {formatDateRangeLabel(props.report.to)}, UTC.</caption>
      <thead>
        <tr>
          <th scope="col">Widget</th>
          <th scope="col">People with it placed</th>
          <th scope="col">Taps</th>
          <th scope="col">People who tapped</th>
        </tr>
      </thead>
      <tbody>
        {widgetKinds.map((widgetKind) => {
          const summary = summariesByKind.get(widgetKind) ?? emptyKindSummary(widgetKind);
          return (
            <tr key={widgetKind}>
              <th scope="row">{widgetKindLabels[widgetKind]}</th>
              <td>{numberFormatter(summary.placedPeople)}</td>
              <td>{numberFormatter(summary.tapCount)}</td>
              <td>{numberFormatter(summary.tapPeople)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function buildMetricsLabel(title: string, metrics: ReadonlyArray<ChartMetric>): string {
  return [title, ...metrics.map(([label, value]) => `${label}: ${value}`)].join(". ");
}

function buildMetricsTooltipHtml(title: string, metrics: ReadonlyArray<ChartMetric>): string {
  return [
    `<p class="tooltip-title">${escapeHtml(title)}</p>`,
    ...metrics.map(([label, value]) => `<div class="tooltip-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`),
  ].join("");
}

export function HomeScreenWidgetsSection(
  props: Readonly<{
    filteredReport: GeneralReportView<HomeScreenWidgetsReport>;
  }>,
): JSX.Element {
  const peopleChartRef = useRef<SVGSVGElement | null>(null);
  const tapsChartRef = useRef<SVGSVGElement | null>(null);
  const returnChartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const readyReport = props.filteredReport.status === "ready" ? props.filteredReport.report : null;
  const latestReport = getLatestGeneralReport(props.filteredReport);
  const chartModel = useMemo(
    () => readyReport === null ? null : buildChartModel(readyReport),
    [readyReport],
  );
  const today = todayUtcCalendarDate(new Date());
  const inProgressNotes = useMemo(() => chartModel === null ? null : placeChartNotes(
    [buildInProgressChartNote(today)],
    chartModel.dates.map((date) => ({ key: date, from: date, to: date })),
  ), [chartModel, today]);
  const noNotes: ReadonlyArray<PlacedChartNote> | null = chartModel === null ? null : [];

  useEffect(() => {
    if (chartModel === null || inProgressNotes === null) {
      tooltipHandlers.hideTooltip();
      return;
    }

    const peopleSvgElement = peopleChartRef.current;
    const tapsSvgElement = tapsChartRef.current;
    const returnSvgElement = returnChartRef.current;
    if (peopleSvgElement === null || tapsSvgElement === null || returnSvgElement === null) {
      return;
    }

    const formatTitle = (date: string): string => `${formatDateRangeLabel(date)}${date === today ? " · in progress" : ""}`;
    const getPeopleDay = (date: string): WidgetPeopleDay => chartModel.peopleByDate.get(date) ?? emptyPeopleDay(date);
    const getTapsDay = (date: string): WidgetTapsDay => chartModel.tapsByDate.get(date) ?? emptyTapsDay(date);
    const getReturnDay = (date: string): WidgetReturnDay => chartModel.returnByDate.get(date) ?? emptyReturnDay(date);
    const describePeopleDay = (date: string): ReadonlyArray<ChartMetric> => [
      ...widgetPlatforms.map((platform): ChartMetric => [getPlatformLabel(platform), numberFormatter(getPeopleDay(date).peopleByPlatform.get(platform) ?? 0)]),
      ["People on any platform", numberFormatter(getPeopleDay(date).totalPeople)],
    ];
    const describeTapsDay = (date: string): ReadonlyArray<ChartMetric> => [
      ...widgetSizes.map((size): ChartMetric => [widgetSizeLabels[size], numberFormatter(getTapsDay(date).tapsBySize.get(size) ?? 0)]),
      ["All taps", numberFormatter(getTapsDay(date).totalTaps)],
      ["People who tapped", numberFormatter(getTapsDay(date).totalPeople)],
    ];
    const describeReturnDay = (date: string): ReadonlyArray<ChartMetric> => returnGroupKeys.map((groupKey): ChartMetric => [
      returnGroupLabels[groupKey],
      formatReturnGroup(getReturnGroup(getReturnDay(date), groupKey)),
    ]);

    renderStackedBreakdownChart({
      svgElement: peopleSvgElement,
      bars: chartModel.dates.map((date) => ({
        key: date,
        countsByValue: getPeopleDay(date).peopleByPlatform,
        notFinal: date === today,
      })),
      values: widgetPlatforms,
      getValueColor: getPlatformColor,
      notes: inProgressNotes,
      yLabel: "People",
      xLabel: "Date",
      formatTick: formatCompactDateLabel,
      getLabel: (date) => buildMetricsLabel(formatTitle(date), describePeopleDay(date)),
      getTooltipHtml: (date) => buildMetricsTooltipHtml(formatTitle(date), describePeopleDay(date)),
      tooltipHandlers,
    });
    renderStackedBreakdownChart({
      svgElement: tapsSvgElement,
      bars: chartModel.dates.map((date) => ({
        key: date,
        countsByValue: getTapsDay(date).tapsBySize,
        notFinal: date === today,
      })),
      values: widgetSizes,
      getValueColor: getWidgetSizeColor,
      notes: inProgressNotes,
      yLabel: "Taps",
      xLabel: "Date",
      formatTick: formatCompactDateLabel,
      getLabel: (date) => buildMetricsLabel(formatTitle(date), describeTapsDay(date)),
      getTooltipHtml: (date) => buildMetricsTooltipHtml(formatTitle(date), describeTapsDay(date)),
      tooltipHandlers,
    });
    renderRateLineChart({
      svgElement: returnSvgElement,
      keys: chartModel.dates,
      lines: returnGroupKeys.map((groupKey) => ({
        getRate: (date: string) => getReturnRate(getReturnGroup(getReturnDay(date), groupKey)),
        color: returnGroupColors[groupKey],
      })),
      inProgressKey: null,
      yLabel: `${widgetReturnWindowDays}-day return`,
      xLabel: "App open date",
      notes: [],
      formatTick: formatCompactDateLabel,
      getLabel: (date) => buildMetricsLabel(formatTitle(date), describeReturnDay(date)),
      getTooltipHtml: (date) => buildMetricsTooltipHtml(formatTitle(date), describeReturnDay(date)),
      tooltipHandlers,
    });
  }, [chartModel, inProgressNotes, today, tooltipHandlers]);

  return (
    <section className="dashboard-section">
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>Home Screen widgets</h2>
          <ExplanationTip label="What Home Screen widgets shows" explanationId="home-screen-widgets-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> three daily charts, grouped by <strong>UTC</strong> day, and a table by widget kind, all following every active filter
                <ul>
                  <li>
                    <strong>People with a Home Screen widget:</strong> people for whom, on any installation, the latest <code>widget_placement_changed</code> of any widget kind by the end of the day counts at least one widget, Lock Screen ones included
                    <ul>
                      <li>The latest report of each kind may be from before the range; it holds until the next one</li>
                      <li>App versions before every kind was reported send no <code>widget_kind</code> and count only Review widgets</li>
                      <li>Stacked by the installation's platform, so someone with a widget on both iOS and Android sits in both segments; the tooltip's total counts them once</li>
                    </ul>
                  </li>
                  <li><strong>Widget taps:</strong> <code>widget_opened</code> per day, stacked by widget size; the tooltip adds the distinct people who tapped</li>
                  <li><strong>By widget kind:</strong> the people with that kind placed at the end of the range's last day, and its taps over the range; someone with several kinds counts in each, and a tap with no <code>widget_kind</code> counts as Review</li>
                  <li>
                    <strong>{widgetReturnWindowDays}-day return:</strong> of the people who opened the app on iOS or Android that day and whose widget state is known by its end, the share who opened the app again, on any platform, within the next {widgetReturnWindowDays} days
                    <ul>
                      <li>Split by whether any of their installations had a widget that day</li>
                      <li>A day stays empty until all {widgetReturnWindowDays} days after it are over in UTC, and a group with no one in it has no point</li>
                    </ul>
                  </li>
                </ul>
              </li>
              <li>
                <strong>Read the return lines as correlation, not cause:</strong> engaged people place widgets more, so a higher line does not mean the widget made them come back
              </li>
              <li>
                <strong>Placement data starts with the first app release that reports it</strong>, so earlier days and people on older versions have no known widget state; taps go back further
              </li>
              <li>
                <strong>Filters:</strong> the platform narrows the installations, the taps and the app opens that enter a cohort; new or returning is the person's first trusted app open, compared with each day
              </li>
            </ul>
          </ExplanationTip>
        </div>
      </header>

      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-meta">
            <span>People with a Home Screen widget &mdash; stacked by platform</span>
            <div className="chart-meta-right">
              <ChartColorKey
                ariaLabel="Home Screen widget platform color key"
                keys={widgetPlatforms}
                getColor={getPlatformColor}
                getLabel={getPlatformLabel}
              />
              <ChartGeneratedAt generatedAtUtc={latestReport?.generatedAtUtc ?? null} />
            </div>
          </div>
          <div className="chart-scroll">
            {chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading…" />
            ) : <svg ref={peopleChartRef} />}
          </div>
          <ChartNotesKey notes={inProgressNotes} />
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Widget taps &mdash; stacked by widget size</span>
            <div className="chart-meta-right">
              <ChartColorKey
                ariaLabel="Widget size color key"
                keys={widgetSizes}
                getColor={getWidgetSizeColor}
                getLabel={(size) => widgetSizeLabels[size]}
              />
            </div>
          </div>
          <div className="chart-scroll">
            {chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading…" />
            ) : <svg ref={tapsChartRef} />}
          </div>
          <ChartNotesKey notes={inProgressNotes} />
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>{widgetReturnWindowDays}-day return, with vs without a widget</span>
            <div className="chart-meta-right">
              <ChartColorKey
                ariaLabel="Widget return group color key"
                keys={returnGroupKeys}
                getColor={(groupKey) => returnGroupColors[groupKey]}
                getLabel={(groupKey) => returnGroupLabels[groupKey]}
              />
            </div>
          </div>
          <div className="chart-scroll">
            {chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading…" />
            ) : <svg ref={returnChartRef} />}
          </div>
          <ChartNotesKey notes={noNotes} />
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>By widget kind</span>
          </div>
          <div className="chart-scroll">
            {readyReport === null ? <p className="report-state" aria-live="polite">Loading…</p> : <WidgetKindsTable report={readyReport} />}
          </div>
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

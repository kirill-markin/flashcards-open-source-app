import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as d3 from "d3";
import {
  productEventDeviceTypes,
  productEventOsNames,
  reviewEventPlatforms,
  type DailyActiveUsersCohortTotal,
  type DailyActiveUsersReport,
} from "../../adminApi";
import {
  DeviceTypeKey,
  OsNameKey,
  PlatformKey,
  UniqueActiveUsersMarkerKey,
  UniqueUserCohortKey,
} from "../../charts/ChartLegends";
import { ChartGeneratedAt } from "../../charts/ChartGeneratedAt";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes } from "../../charts/chartNotes";
import {
  chartWidth,
  createTickDates,
  simpleChartHeight,
  stackedChartHeight,
  type MatrixChartEntry,
} from "../../charts/chartPrimitives";
import {
  renderDailyActiveUsersByDeviceTypeChart,
  renderDailyActiveUsersByOsNameChart,
  renderDailyActiveUsersByPlatformChart,
  renderDailyActiveUsersChart,
  renderDailyActiveUsersTotalChart,
} from "../../charts/chartRenderers";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import { getLatestGeneralReport, type GeneralReportView } from "../generalReportView";
import { todayUtcCalendarDate } from "../reportValues";

const dailyActiveUsersBreakdowns = ["none", "cohort", "platform", "osName", "deviceType"] as const;
type DailyActiveUsersBreakdown = (typeof dailyActiveUsersBreakdowns)[number];

const dailyActiveUsersBreakdownLabels: Readonly<Record<DailyActiveUsersBreakdown, string>> = {
  none: "None",
  cohort: "New vs returning",
  platform: "Platform",
  osName: "OS",
  deviceType: "Device type",
};

const dailyActiveUsersChartTitles: Readonly<Record<DailyActiveUsersBreakdown, string>> = {
  none: "Daily unique active users",
  cohort: "Daily unique active users — new vs returning",
  platform: "Daily active users by platform",
  osName: "Daily active users by OS",
  deviceType: "Daily active users by device type",
};

/** The viewBox height each breakdown's renderer draws at. */
const dailyActiveUsersChartHeights: Readonly<Record<DailyActiveUsersBreakdown, number>> = {
  none: simpleChartHeight,
  cohort: simpleChartHeight,
  platform: stackedChartHeight,
  osName: stackedChartHeight,
  deviceType: stackedChartHeight,
};

const dailyActiveUsersBreakdownFieldId = "daily-active-users-breakdown";

type DailyActiveUsersChartModel = Readonly<{
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  dailyActiveUserCohortMatrix: ReadonlyArray<MatrixChartEntry>;
  platformActiveUsersMatrix: ReadonlyArray<MatrixChartEntry>;
  osNameActiveUsersMatrix: ReadonlyArray<MatrixChartEntry>;
  deviceTypeActiveUsersMatrix: ReadonlyArray<MatrixChartEntry>;
  dailyActiveUsersByDate: ReadonlyMap<string, number>;
  peakDailyActiveUsers: number;
  peakDailyPlatformValue: number;
  peakDailyOsNameValue: number;
  peakDailyDeviceTypeValue: number;
}>;

function buildDailyActiveUserCohortMatrix(
  cohortTotals: ReadonlyArray<DailyActiveUsersCohortTotal>,
): ReadonlyArray<MatrixChartEntry> {
  return cohortTotals.map((cohortTotal) => ({
    date: cohortTotal.date,
    valuesByKey: {
      returning: cohortTotal.returningActiveUsers,
      new: cohortTotal.newActiveUsers,
    },
  }));
}

function buildKeyedActiveUsersMatrix<Total extends Readonly<{ date: string; activeUserCount: number }>>(
  keyedTotals: ReadonlyArray<Total>,
  getKey: (total: Total) => string,
  dates: ReadonlyArray<string>,
): ReadonlyArray<MatrixChartEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const keyedTotal of keyedTotals) {
    const currentValues = valuesByDate.get(keyedTotal.date) ?? {};
    currentValues[getKey(keyedTotal)] = keyedTotal.activeUserCount;
    valuesByDate.set(keyedTotal.date, currentValues);
  }

  return dates.map((date) => ({
    date,
    valuesByKey: valuesByDate.get(date) ?? {},
  }));
}

/** The y-axis peak of a stack drawn under a unique-total marker: whichever of the two is taller on any day. */
function getPeakStackOrUniqueTotal(
  matrix: ReadonlyArray<MatrixChartEntry>,
  keys: ReadonlyArray<string>,
  dailyActiveUsersByDate: ReadonlyMap<string, number>,
): number {
  return d3.max(matrix, (entry) => Math.max(
    d3.sum(keys, (key) => entry.valuesByKey[key] ?? 0),
    dailyActiveUsersByDate.get(entry.date) ?? 0,
  )) ?? 0;
}

function buildDailyActiveUsersChartModel(report: DailyActiveUsersReport): DailyActiveUsersChartModel {
  const dates = report.dailyCohortTotals.map((cohortTotal) => cohortTotal.date);
  // New and returning partition each day's distinct actors, so their sum is the unique total.
  const dailyActiveUsersByDate = new Map(report.dailyCohortTotals.map((cohortTotal) => [
    cohortTotal.date,
    cohortTotal.newActiveUsers + cohortTotal.returningActiveUsers,
  ]));
  const platformActiveUsersMatrix = buildKeyedActiveUsersMatrix(
    report.platformActiveUserTotals,
    (total) => total.platform,
    dates,
  );
  const osNameActiveUsersMatrix = buildKeyedActiveUsersMatrix(
    report.osNameActiveUserTotals,
    (total) => total.osName,
    dates,
  );
  const deviceTypeActiveUsersMatrix = buildKeyedActiveUsersMatrix(
    report.deviceTypeActiveUserTotals,
    (total) => total.deviceType,
    dates,
  );

  return {
    dates,
    tickDates: createTickDates(dates),
    dailyActiveUserCohortMatrix: buildDailyActiveUserCohortMatrix(report.dailyCohortTotals),
    platformActiveUsersMatrix,
    osNameActiveUsersMatrix,
    deviceTypeActiveUsersMatrix,
    dailyActiveUsersByDate,
    peakDailyActiveUsers: d3.max(dailyActiveUsersByDate.values()) ?? 0,
    peakDailyPlatformValue: getPeakStackOrUniqueTotal(
      platformActiveUsersMatrix,
      reviewEventPlatforms,
      dailyActiveUsersByDate,
    ),
    peakDailyOsNameValue: getPeakStackOrUniqueTotal(
      osNameActiveUsersMatrix,
      productEventOsNames,
      dailyActiveUsersByDate,
    ),
    peakDailyDeviceTypeValue: getPeakStackOrUniqueTotal(
      deviceTypeActiveUsersMatrix,
      productEventDeviceTypes,
      dailyActiveUsersByDate,
    ),
  };
}

function parseDailyActiveUsersBreakdown(value: string): DailyActiveUsersBreakdown {
  const breakdown = dailyActiveUsersBreakdowns.find((candidate) => candidate === value);
  if (breakdown === undefined) {
    throw new Error(`Unsupported daily active users breakdown: ${value}`);
  }

  return breakdown;
}

function DailyActiveUsersBreakdownKey(props: Readonly<{ breakdown: DailyActiveUsersBreakdown }>): JSX.Element | null {
  switch (props.breakdown) {
    case "none":
      return null;
    case "cohort":
      return <UniqueUserCohortKey />;
    case "platform":
      return <><PlatformKey /><UniqueActiveUsersMarkerKey /></>;
    case "osName":
      return <><OsNameKey /><UniqueActiveUsersMarkerKey /></>;
    case "deviceType":
      return <><DeviceTypeKey /><UniqueActiveUsersMarkerKey /></>;
  }
}

export function DailyActiveUsersSection(
  props: Readonly<{
    filteredReport: GeneralReportView<DailyActiveUsersReport>;
  }>,
): JSX.Element {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [breakdown, setBreakdown] = useState<DailyActiveUsersBreakdown>("none");
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const readyReport = props.filteredReport.status === "ready" ? props.filteredReport.report : null;
  const latestReport = getLatestGeneralReport(props.filteredReport);
  const chartModel = useMemo(
    () => readyReport === null ? null : buildDailyActiveUsersChartModel(readyReport),
    [readyReport],
  );
  const today = todayUtcCalendarDate(new Date());
  const chartNotes = useMemo(() => chartModel === null ? null : placeChartNotes(
    [buildInProgressChartNote(today)],
    chartModel.dates.map((date) => ({ key: date, from: date, to: date })),
  ), [chartModel, today]);

  useEffect(() => {
    if (chartModel === null || chartNotes === null) {
      tooltipHandlers.hideTooltip();
      return;
    }

    const svgElement = chartRef.current;
    if (svgElement === null) {
      return;
    }

    switch (breakdown) {
      case "none":
        renderDailyActiveUsersTotalChart({
          svgElement,
          dates: chartModel.dates,
          tickDates: chartModel.tickDates,
          today,
          notes: chartNotes,
          dailyActiveUsersByDate: chartModel.dailyActiveUsersByDate,
          peakDailyActiveUsers: chartModel.peakDailyActiveUsers,
          tooltipHandlers,
        });
        return;
      case "cohort":
        renderDailyActiveUsersChart({
          svgElement,
          dates: chartModel.dates,
          tickDates: chartModel.tickDates,
          today,
          notes: chartNotes,
          dailyActiveUserCohortMatrix: chartModel.dailyActiveUserCohortMatrix,
          dailyActiveUsersByDate: chartModel.dailyActiveUsersByDate,
          peakDailyActiveUsers: chartModel.peakDailyActiveUsers,
          tooltipHandlers,
        });
        return;
      case "platform":
        renderDailyActiveUsersByPlatformChart({
          svgElement,
          dates: chartModel.dates,
          tickDates: chartModel.tickDates,
          today,
          notes: chartNotes,
          activeUsersMatrix: chartModel.platformActiveUsersMatrix,
          dailyActiveUsersByDate: chartModel.dailyActiveUsersByDate,
          peakDailyValue: chartModel.peakDailyPlatformValue,
          tooltipHandlers,
        });
        return;
      case "osName":
        renderDailyActiveUsersByOsNameChart({
          svgElement,
          dates: chartModel.dates,
          tickDates: chartModel.tickDates,
          today,
          notes: chartNotes,
          activeUsersMatrix: chartModel.osNameActiveUsersMatrix,
          dailyActiveUsersByDate: chartModel.dailyActiveUsersByDate,
          peakDailyValue: chartModel.peakDailyOsNameValue,
          tooltipHandlers,
        });
        return;
      case "deviceType":
        renderDailyActiveUsersByDeviceTypeChart({
          svgElement,
          dates: chartModel.dates,
          tickDates: chartModel.tickDates,
          today,
          notes: chartNotes,
          activeUsersMatrix: chartModel.deviceTypeActiveUsersMatrix,
          dailyActiveUsersByDate: chartModel.dailyActiveUsersByDate,
          peakDailyValue: chartModel.peakDailyDeviceTypeValue,
          tooltipHandlers,
        });
        return;
    }
  }, [chartModel, chartNotes, today, breakdown, tooltipHandlers]);

  return (
    <section className="dashboard-section">
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>Daily active users</h2>
          <ExplanationTip label="What Daily active users shows" explanationId="daily-active-users-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> everyone who opened the app, from the <code>app_opened</code> event, not only the people who answered a card
                <ul>
                  <li>Each person counted once per <strong>UTC</strong> day</li>
                </ul>
              </li>
              <li>
                <strong>Break down by</strong> splits that daily count
                <ul>
                  <li><strong>New vs returning:</strong> divides it exactly, so its stack is the daily total</li>
                  <li>
                    <strong>Platform, OS, device type:</strong> one segment per value
                    <ul>
                      <li>A person active on more than one device in a day sits in more than one segment, so a stack can rise above the line marking the day&rsquo;s real unique total</li>
                      <li>A row reporting no OS or device type, every web row among them, shows as Unknown</li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
          </ExplanationTip>
        </div>
      </header>

      <div className="funnel-group-by-row">
        <div className="funnel-group-by">
          <label htmlFor={dailyActiveUsersBreakdownFieldId}>Break down by</label>
          <select
            id={dailyActiveUsersBreakdownFieldId}
            className="funnel-group-by-select"
            data-testid={dailyActiveUsersBreakdownFieldId}
            value={breakdown}
            onChange={(event) => setBreakdown(parseDailyActiveUsersBreakdown(event.target.value))}
          >
            {dailyActiveUsersBreakdowns.map((option) => (
              <option key={option} value={option}>{dailyActiveUsersBreakdownLabels[option]}</option>
            ))}
          </select>
        </div>
      </div>

      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-meta">
            <span>{dailyActiveUsersChartTitles[breakdown]}</span>
            <div className="chart-meta-right">
              <DailyActiveUsersBreakdownKey breakdown={breakdown} />
              <ChartGeneratedAt generatedAtUtc={latestReport?.generatedAtUtc ?? null} />
            </div>
          </div>
          <div className="chart-scroll">
            {chartModel === null ? (
              <ChartLoadingPlaceholder
                viewBoxWidth={chartWidth}
                viewBoxHeight={dailyActiveUsersChartHeights[breakdown]}
                label="Loading…"
              />
            ) : <svg ref={chartRef} />}
          </div>
          <ChartNotesKey notes={chartNotes} />
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

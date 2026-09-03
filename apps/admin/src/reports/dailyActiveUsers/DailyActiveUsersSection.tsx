import { useCallback, useEffect, useMemo, useRef, type JSX } from "react";
import * as d3 from "d3";
import {
  reviewEventPlatforms,
  type DailyActiveUsersCohortTotal,
  type DailyActiveUsersPlatformTotal,
  type DailyActiveUsersReport,
  type DailyActiveUsersRow,
  type DailyActiveUsersUser,
} from "../../adminApi";
import { PlatformKey, UniqueUserCohortKey } from "../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { createTickDates, type MatrixChartEntry } from "../../charts/chartPrimitives";
import {
  renderDailyActiveUsersByPlatformChart,
  renderDailyActiveUsersByUserChart,
  renderDailyActiveUsersChart,
} from "../../charts/chartRenderers";
import { formatGeneratedAt } from "../../charts/formatting";
import type { UserColorScale } from "../../dashboard/userColors";

type DailyActiveUsersChartModel = Readonly<{
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  activeUserIds: ReadonlyArray<string>;
  dailyActiveUserCohortMatrix: ReadonlyArray<MatrixChartEntry>;
  platformActiveUsersMatrix: ReadonlyArray<MatrixChartEntry>;
  activeUserMatrix: ReadonlyArray<MatrixChartEntry>;
  dailyActiveUsersByDate: ReadonlyMap<string, number>;
  peakDailyActiveUsers: number;
  peakDailyPlatformActiveUsers: number;
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

function buildPlatformActiveUsersMatrix(
  platformTotals: ReadonlyArray<DailyActiveUsersPlatformTotal>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<MatrixChartEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const platformTotal of platformTotals) {
    const currentValues = valuesByDate.get(platformTotal.date) ?? {};
    currentValues[platformTotal.platform] = platformTotal.activeUserCount;
    valuesByDate.set(platformTotal.date, currentValues);
  }

  return dates.map((date) => ({
    date,
    valuesByKey: valuesByDate.get(date) ?? {},
  }));
}

/** One unit per person per day, so a person on two platforms in one day is still one unit. */
function buildActiveUserMatrix(
  rows: ReadonlyArray<DailyActiveUsersRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<MatrixChartEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const currentValues = valuesByDate.get(row.date) ?? {};
    currentValues[row.userId] = 1;
    valuesByDate.set(row.date, currentValues);
  }

  return dates.map((date) => ({
    date,
    valuesByKey: valuesByDate.get(date) ?? {},
  }));
}

function buildDailyActiveUsersChartModel(report: DailyActiveUsersReport): DailyActiveUsersChartModel {
  const dates = report.dailyCohortTotals.map((cohortTotal) => cohortTotal.date);
  const dailyActiveUsersByDate = new Map(report.dailyCohortTotals.map((cohortTotal) => [
    cohortTotal.date,
    cohortTotal.newActiveUsers + cohortTotal.returningActiveUsers,
  ]));
  const platformActiveUsersMatrix = buildPlatformActiveUsersMatrix(report.platformActiveUserTotals, dates);

  return {
    dates,
    tickDates: createTickDates(dates),
    // Already ordered by active days, so the people with the most days sit at the bottom of the stack.
    activeUserIds: report.users.map((user) => user.userId),
    dailyActiveUserCohortMatrix: buildDailyActiveUserCohortMatrix(report.dailyCohortTotals),
    platformActiveUsersMatrix,
    activeUserMatrix: buildActiveUserMatrix(report.rows, dates),
    dailyActiveUsersByDate,
    // Also the peak of the stacked-by-user chart, whose column height is that same distinct count.
    peakDailyActiveUsers: d3.max(
      report.dailyCohortTotals,
      (cohortTotal) => cohortTotal.newActiveUsers + cohortTotal.returningActiveUsers,
    ) ?? 0,
    peakDailyPlatformActiveUsers: d3.max(
      platformActiveUsersMatrix,
      (entry) => d3.max(reviewEventPlatforms, (platform) => entry.valuesByKey[platform] ?? 0) ?? 0,
    ) ?? 0,
  };
}

function buildActiveUserById(
  users: ReadonlyArray<DailyActiveUsersUser>,
): ReadonlyMap<string, DailyActiveUsersUser> {
  return new Map(users.map((user) => [user.userId, user]));
}

export function DailyActiveUsersSection(
  props: Readonly<{
    filteredReport: DailyActiveUsersReport;
    generatedAtUtc: string;
    isReportLoading: boolean;
    userColorScale: UserColorScale;
    onUserFilterApply: (userId: string) => void;
  }>,
): JSX.Element {
  const activeUsersChartRef = useRef<SVGSVGElement | null>(null);
  const platformActiveUsersChartRef = useRef<SVGSVGElement | null>(null);
  const activeUsersByUserChartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const chartModel = useMemo(
    () => buildDailyActiveUsersChartModel(props.filteredReport),
    [props.filteredReport],
  );
  const userById = useMemo(
    () => buildActiveUserById(props.filteredReport.users),
    [props.filteredReport.users],
  );

  const handleUserFilterApply = useCallback((userId: string): void => {
    props.onUserFilterApply(userId);
    tooltipHandlers.hideTooltip();
  }, [props.onUserFilterApply, tooltipHandlers]);

  useEffect(() => {
    const activeUsersSvgElement = activeUsersChartRef.current;
    const platformActiveUsersSvgElement = platformActiveUsersChartRef.current;
    const activeUsersByUserSvgElement = activeUsersByUserChartRef.current;
    if (
      activeUsersSvgElement === null
      || platformActiveUsersSvgElement === null
      || activeUsersByUserSvgElement === null
    ) {
      return;
    }

    renderDailyActiveUsersChart({
      svgElement: activeUsersSvgElement,
      dates: chartModel.dates,
      tickDates: chartModel.tickDates,
      dailyActiveUserCohortMatrix: chartModel.dailyActiveUserCohortMatrix,
      dailyActiveUsersByDate: chartModel.dailyActiveUsersByDate,
      peakDailyActiveUsers: chartModel.peakDailyActiveUsers,
      tooltipHandlers,
    });
    renderDailyActiveUsersByPlatformChart({
      svgElement: platformActiveUsersSvgElement,
      dates: chartModel.dates,
      tickDates: chartModel.tickDates,
      platformActiveUsersMatrix: chartModel.platformActiveUsersMatrix,
      dailyActiveUsersByDate: chartModel.dailyActiveUsersByDate,
      peakDailyPlatformActiveUsers: chartModel.peakDailyPlatformActiveUsers,
      tooltipHandlers,
    });
    renderDailyActiveUsersByUserChart({
      svgElement: activeUsersByUserSvgElement,
      dates: chartModel.dates,
      tickDates: chartModel.tickDates,
      activeUserMatrix: chartModel.activeUserMatrix,
      activeUserIds: chartModel.activeUserIds,
      userColorScale: props.userColorScale,
      userById,
      dailyActiveUsersByDate: chartModel.dailyActiveUsersByDate,
      peakDailyActiveUsers: chartModel.peakDailyActiveUsers,
      isReportLoading: props.isReportLoading,
      onUserFilterApply: handleUserFilterApply,
      tooltipHandlers,
    });
  }, [
    chartModel,
    props.isReportLoading,
    props.userColorScale,
    userById,
    handleUserFilterApply,
    tooltipHandlers,
  ]);

  return (
    <section className="dashboard-section">
      <header className="dashboard-section-header">
        <h2>Daily active users</h2>
        <p className="dashboard-section-description">
          Everyone who opened the app on a calendar date, from the <code>app_opened</code> event, rather than only the people who answered a card. Platform is always split and never summed, because one person can be active on more than one platform in a day. Dates are grouped in <strong>UTC</strong>.
        </p>
      </header>

      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-meta">
            <span>Daily unique active users &mdash; new vs returning</span>
            <div className="chart-meta-right">
              <UniqueUserCohortKey />
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={activeUsersChartRef} />
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
            <svg ref={platformActiveUsersChartRef} />
          </div>
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Daily active users stacked by user &mdash; one unit per person per day</span>
            <div className="chart-meta-right">
              <span>Generated {formatGeneratedAt(props.generatedAtUtc)}</span>
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={activeUsersByUserChartRef} />
          </div>
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

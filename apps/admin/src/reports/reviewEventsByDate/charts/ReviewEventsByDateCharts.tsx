import { useCallback, useEffect, useMemo, useRef, type JSX } from "react";
import type { ReviewEventsByDateUser } from "../../../adminApi";
import { PlatformKey, UniqueUserCohortKey } from "../../../charts/ChartLegends";
import { ChartGeneratedAt } from "../../../charts/ChartGeneratedAt";
import { ChartLoadingPlaceholder } from "../../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes } from "../../../charts/chartNotes";
import { chartWidth, simpleChartHeight, stackedChartHeight } from "../../../charts/chartPrimitives";
import {
  renderDailyUniqueUsersChart,
  renderPlatformActiveUsersChart,
  renderPlatformReviewEventsChart,
  renderUserReviewEventsChart,
} from "../../../charts/chartRenderers";
import type { UserColorScale } from "../../../dashboard/userColors";
import { todayUtcCalendarDate } from "../../reportValues";
import type { ReviewEventsByDateChartModel } from "./chartModel";

type ReviewEventsByDateChartsProps = Readonly<{
  /** `null` while the General batch loads or reloads, which holds every chart's placeholder. */
  chartModel: ReviewEventsByDateChartModel | null;
  /** The last loaded report's, also during a reload; `null` before the first load. */
  generatedAtUtc: string | null;
  userById: ReadonlyMap<string, ReviewEventsByDateUser>;
  userColorScale: UserColorScale;
  onUserFilterApply: (userId: string) => void;
}>;

export function ReviewEventsByDateCharts(props: ReviewEventsByDateChartsProps): JSX.Element {
  const uniqueUsersChartRef = useRef<SVGSVGElement | null>(null);
  const userReviewEventsChartRef = useRef<SVGSVGElement | null>(null);
  const platformUsersChartRef = useRef<SVGSVGElement | null>(null);
  const platformReviewEventsChartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const today = todayUtcCalendarDate(new Date());
  const chartNotes = useMemo(() => props.chartModel === null ? null : placeChartNotes(
    [buildInProgressChartNote(today)],
    props.chartModel.dates.map((date) => ({ key: date, from: date, to: date })),
  ), [props.chartModel, today]);

  const handleUserFilterApply = useCallback((userId: string): void => {
    props.onUserFilterApply(userId);
    tooltipHandlers.hideTooltip();
  }, [props.onUserFilterApply, tooltipHandlers]);

  useEffect(() => {
    if (props.chartModel === null || chartNotes === null) {
      tooltipHandlers.hideTooltip();
      return;
    }

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

    renderDailyUniqueUsersChart({
      svgElement: uniqueUsersSvgElement,
      dates: props.chartModel.dates,
      tickDates: props.chartModel.tickDates,
      today,
      notes: chartNotes,
      dailyUniqueUserCohortMatrix: props.chartModel.dailyUniqueUserCohortMatrix,
      dailyUniqueUsersByDate: props.chartModel.dailyUniqueUsersByDate,
      totalReviewEventsByDate: props.chartModel.totalReviewEventsByDate,
      peakDailyUniqueUsers: props.chartModel.peakDailyUniqueUsers,
      tooltipHandlers,
    });
    renderUserReviewEventsChart({
      svgElement: userReviewEventsSvgElement,
      dates: props.chartModel.dates,
      tickDates: props.chartModel.tickDates,
      today,
      notes: chartNotes,
      userMatrix: props.chartModel.userMatrix,
      userIds: props.chartModel.userIds,
      userColorScale: props.userColorScale,
      userById: props.userById,
      totalReviewEventsByDate: props.chartModel.totalReviewEventsByDate,
      peakDailyVolume: props.chartModel.peakDailyVolume,
      onUserFilterApply: handleUserFilterApply,
      tooltipHandlers,
    });
    renderPlatformActiveUsersChart({
      svgElement: platformUsersSvgElement,
      dates: props.chartModel.dates,
      tickDates: props.chartModel.tickDates,
      today,
      notes: chartNotes,
      platformActiveUsersMatrix: props.chartModel.platformActiveUsersMatrix,
      dailyUniqueUsersByDate: props.chartModel.dailyUniqueUsersByDate,
      peakDailyPlatformUsers: props.chartModel.peakDailyPlatformUsers,
      tooltipHandlers,
    });
    renderPlatformReviewEventsChart({
      svgElement: platformReviewEventsSvgElement,
      dates: props.chartModel.dates,
      tickDates: props.chartModel.tickDates,
      today,
      notes: chartNotes,
      platformReviewEventsMatrix: props.chartModel.platformReviewEventsMatrix,
      totalPlatformReviewEventsByDate: props.chartModel.totalPlatformReviewEventsByDate,
      peakDailyPlatformReviewEvents: props.chartModel.peakDailyPlatformReviewEvents,
      tooltipHandlers,
    });
  }, [
    props.chartModel,
    chartNotes,
    today,
    props.userById,
    props.userColorScale,
    handleUserFilterApply,
    tooltipHandlers,
  ]);

  return (
    <>
      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-meta">
            <span>Daily unique users with at least 1 review event &mdash; new vs returning</span>
            <div className="chart-meta-right">
              <UniqueUserCohortKey />
            </div>
          </div>
          <div className="chart-scroll">
            {props.chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={simpleChartHeight} label="Loading…" />
            ) : <svg ref={uniqueUsersChartRef} />}
          </div>
          <ChartNotesKey notes={chartNotes} />
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Stacked review events by user</span>
            <div className="chart-meta-right">
              <ChartGeneratedAt generatedAtUtc={props.generatedAtUtc} />
            </div>
          </div>
          <div className="chart-scroll">
            {props.chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading…" />
            ) : <svg ref={userReviewEventsChartRef} />}
          </div>
          <ChartNotesKey notes={chartNotes} />
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Daily reviewing users by platform</span>
            <div className="chart-meta-right">
              <PlatformKey />
            </div>
          </div>
          <div className="chart-scroll">
            {props.chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading…" />
            ) : <svg ref={platformUsersChartRef} />}
          </div>
          <ChartNotesKey notes={chartNotes} />
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Daily review events by platform</span>
            <div className="chart-meta-right">
              <PlatformKey />
            </div>
          </div>
          <div className="chart-scroll">
            {props.chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading…" />
            ) : <svg ref={platformReviewEventsChartRef} />}
          </div>
          <ChartNotesKey notes={chartNotes} />
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </>
  );
}

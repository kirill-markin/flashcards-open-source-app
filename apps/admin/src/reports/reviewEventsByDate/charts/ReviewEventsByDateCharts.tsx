import { useCallback, useEffect, useRef, type JSX } from "react";
import type { ReviewEventsByDateUser } from "../../../adminApi";
import { PlatformKey, UniqueUserCohortKey } from "../../../charts/ChartLegends";
import { ChartTooltip, useChartTooltip } from "../../../charts/ChartTooltip";
import {
  renderDailyFriendInvitationsChart,
  renderDailyFriendshipsChart,
  renderDailyUniqueUsersChart,
  renderPlatformActiveUsersChart,
  renderPlatformReviewEventsChart,
  renderUserReviewEventsChart,
} from "../../../charts/chartRenderers";
import { formatGeneratedAt } from "../../../charts/formatting";
import type { UserColorScale } from "../../../dashboard/userColors";
import type { ReviewEventsByDateChartModel } from "./chartModel";

type ReviewEventsByDateChartsProps = Readonly<{
  chartModel: ReviewEventsByDateChartModel;
  generatedAtUtc: string;
  isReportLoading: boolean;
  userById: ReadonlyMap<string, ReviewEventsByDateUser>;
  userColorScale: UserColorScale;
  onUserFilterApply: (userId: string) => void;
}>;

export function ReviewEventsByDateCharts(props: ReviewEventsByDateChartsProps): JSX.Element {
  const uniqueUsersChartRef = useRef<SVGSVGElement | null>(null);
  const userReviewEventsChartRef = useRef<SVGSVGElement | null>(null);
  const platformUsersChartRef = useRef<SVGSVGElement | null>(null);
  const platformReviewEventsChartRef = useRef<SVGSVGElement | null>(null);
  const friendInvitationsChartRef = useRef<SVGSVGElement | null>(null);
  const friendshipsChartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();

  const handleUserFilterApply = useCallback((userId: string): void => {
    props.onUserFilterApply(userId);
    tooltipHandlers.hideTooltip();
  }, [props.onUserFilterApply, tooltipHandlers]);

  useEffect(() => {
    const uniqueUsersSvgElement = uniqueUsersChartRef.current;
    const userReviewEventsSvgElement = userReviewEventsChartRef.current;
    const platformUsersSvgElement = platformUsersChartRef.current;
    const platformReviewEventsSvgElement = platformReviewEventsChartRef.current;
    const friendInvitationsSvgElement = friendInvitationsChartRef.current;
    const friendshipsSvgElement = friendshipsChartRef.current;
    if (
      uniqueUsersSvgElement === null
      || userReviewEventsSvgElement === null
      || platformUsersSvgElement === null
      || platformReviewEventsSvgElement === null
      || friendInvitationsSvgElement === null
      || friendshipsSvgElement === null
    ) {
      return;
    }

    renderDailyUniqueUsersChart({
      svgElement: uniqueUsersSvgElement,
      dates: props.chartModel.dates,
      tickDates: props.chartModel.tickDates,
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
      userMatrix: props.chartModel.userMatrix,
      userIds: props.chartModel.userIds,
      userColorScale: props.userColorScale,
      userById: props.userById,
      totalReviewEventsByDate: props.chartModel.totalReviewEventsByDate,
      peakDailyVolume: props.chartModel.peakDailyVolume,
      isReportLoading: props.isReportLoading,
      onUserFilterApply: handleUserFilterApply,
      tooltipHandlers,
    });
    renderPlatformActiveUsersChart({
      svgElement: platformUsersSvgElement,
      dates: props.chartModel.dates,
      tickDates: props.chartModel.tickDates,
      platformActiveUsersMatrix: props.chartModel.platformActiveUsersMatrix,
      dailyUniqueUsersByDate: props.chartModel.dailyUniqueUsersByDate,
      peakDailyPlatformUsers: props.chartModel.peakDailyPlatformUsers,
      tooltipHandlers,
    });
    renderPlatformReviewEventsChart({
      svgElement: platformReviewEventsSvgElement,
      dates: props.chartModel.dates,
      tickDates: props.chartModel.tickDates,
      platformReviewEventsMatrix: props.chartModel.platformReviewEventsMatrix,
      totalPlatformReviewEventsByDate: props.chartModel.totalPlatformReviewEventsByDate,
      peakDailyPlatformReviewEvents: props.chartModel.peakDailyPlatformReviewEvents,
      tooltipHandlers,
    });
    renderDailyFriendInvitationsChart({
      svgElement: friendInvitationsSvgElement,
      dates: props.chartModel.dates,
      tickDates: props.chartModel.tickDates,
      friendInvitationUserMatrix: props.chartModel.friendInvitationUserMatrix,
      friendInvitationUserIds: props.chartModel.friendInvitationUserIds,
      userColorScale: props.userColorScale,
      userById: props.userById,
      totalFriendInvitationsByDate: props.chartModel.totalFriendInvitationsByDate,
      friendInvitationTotalsByUserId: props.chartModel.friendInvitationTotalsByUserId,
      peakDailyFriendInvitations: props.chartModel.peakDailyFriendInvitations,
      isReportLoading: props.isReportLoading,
      onUserFilterApply: handleUserFilterApply,
      tooltipHandlers,
    });
    renderDailyFriendshipsChart({
      svgElement: friendshipsSvgElement,
      dates: props.chartModel.dates,
      tickDates: props.chartModel.tickDates,
      friendshipUserMatrix: props.chartModel.friendshipUserMatrix,
      friendshipUserIds: props.chartModel.friendshipUserIds,
      userColorScale: props.userColorScale,
      userById: props.userById,
      totalFriendshipsByDate: props.chartModel.totalFriendshipsByDate,
      peakDailyFriendships: props.chartModel.peakDailyFriendships,
      isReportLoading: props.isReportLoading,
      onUserFilterApply: handleUserFilterApply,
      tooltipHandlers,
    });
  }, [
    props.chartModel,
    props.isReportLoading,
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
            <svg ref={uniqueUsersChartRef} />
          </div>
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Stacked review events by user</span>
            <div className="chart-meta-right">
              <span>Generated {formatGeneratedAt(props.generatedAtUtc)}</span>
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={userReviewEventsChartRef} />
          </div>
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Daily reviewing users by platform</span>
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

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Friend invite links created</span>
            <div className="chart-meta-right">
              <span>Stacked by user &mdash; follows all active filters</span>
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={friendInvitationsChartRef} />
          </div>
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Existing friend connections by day</span>
            <div className="chart-meta-right">
              <span>Stacked by user &mdash; follows all active filters</span>
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={friendshipsChartRef} />
          </div>
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </>
  );
}

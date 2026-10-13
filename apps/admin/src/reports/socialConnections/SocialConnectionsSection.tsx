import { useEffect, useMemo, useRef, type JSX } from "react";
import * as d3 from "d3";
import type { ReviewEventsByDateReport } from "../../adminApi";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { createTickDates } from "../../charts/chartPrimitives";
import {
  renderDailyFriendConnectionsChart,
  renderDailyFriendInvitationsChart,
} from "../../charts/chartRenderers";
import { formatGeneratedAt } from "../../charts/formatting";

type SocialConnectionsChartModel = Readonly<{
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  friendInvitationsByDate: ReadonlyMap<string, number>;
  friendConnectionsByDate: ReadonlyMap<string, number>;
  peakDailyFriendInvitations: number;
  peakDailyFriendConnections: number;
}>;

/** Each community row already holds one person's day, so a day's total is the sum over its people. */
function buildSocialConnectionsChartModel(report: ReviewEventsByDateReport): SocialConnectionsChartModel {
  const dates = report.dateTotals.map((item) => item.date);
  const friendInvitationsByDate = new Map<string, number>();
  const friendConnectionsByDate = new Map<string, number>();

  for (const row of report.communityRows) {
    friendInvitationsByDate.set(row.date, (friendInvitationsByDate.get(row.date) ?? 0) + row.friendInvitationCount);
    friendConnectionsByDate.set(row.date, (friendConnectionsByDate.get(row.date) ?? 0) + row.friendshipCount);
  }

  return {
    dates,
    tickDates: createTickDates(dates),
    friendInvitationsByDate,
    friendConnectionsByDate,
    peakDailyFriendInvitations: d3.max(dates, (date) => friendInvitationsByDate.get(date) ?? 0) ?? 0,
    peakDailyFriendConnections: d3.max(dates, (date) => friendConnectionsByDate.get(date) ?? 0) ?? 0,
  };
}

export function SocialConnectionsSection(
  props: Readonly<{
    filteredReport: ReviewEventsByDateReport;
    generatedAtUtc: string;
  }>,
): JSX.Element {
  const friendInvitationsChartRef = useRef<SVGSVGElement | null>(null);
  const friendConnectionsChartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const chartModel = useMemo(
    () => buildSocialConnectionsChartModel(props.filteredReport),
    [props.filteredReport],
  );

  useEffect(() => {
    const friendInvitationsSvgElement = friendInvitationsChartRef.current;
    const friendConnectionsSvgElement = friendConnectionsChartRef.current;
    if (friendInvitationsSvgElement === null || friendConnectionsSvgElement === null) {
      return;
    }

    renderDailyFriendInvitationsChart({
      svgElement: friendInvitationsSvgElement,
      dates: chartModel.dates,
      tickDates: chartModel.tickDates,
      friendInvitationsByDate: chartModel.friendInvitationsByDate,
      peakDailyFriendInvitations: chartModel.peakDailyFriendInvitations,
      tooltipHandlers,
    });
    renderDailyFriendConnectionsChart({
      svgElement: friendConnectionsSvgElement,
      dates: chartModel.dates,
      tickDates: chartModel.tickDates,
      friendConnectionsByDate: chartModel.friendConnectionsByDate,
      peakDailyFriendConnections: chartModel.peakDailyFriendConnections,
      tooltipHandlers,
    });
  }, [chartModel, tooltipHandlers]);

  return (
    <section className="dashboard-section">
      <header className="dashboard-section-header">
        <h2>Social: invites and friend connections</h2>
        <p className="dashboard-section-description">
          Friend invite links created per day, from the <code>friend_invitation_created</code> event, and existing friend connections at the end of each day, each person's running sum of <code>friendship_created</code> added up over everyone, so a friendship between two counted people adds two. Both follow every active filter. Dates are grouped in <strong>UTC</strong>.
        </p>
      </header>

      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-meta">
            <span>Friend invite links created</span>
            <div className="chart-meta-right">
              <span>Generated {formatGeneratedAt(props.generatedAtUtc)}</span>
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={friendInvitationsChartRef} />
          </div>
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Existing friend connections by day</span>
          </div>
          <div className="chart-scroll">
            <svg ref={friendConnectionsChartRef} />
          </div>
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

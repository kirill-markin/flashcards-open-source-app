import { useEffect, useMemo, useRef, type JSX } from "react";
import * as d3 from "d3";
import type { ReviewEventsByDateReport } from "../../adminApi";
import { ChartGeneratedAt } from "../../charts/ChartGeneratedAt";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes } from "../../charts/chartNotes";
import { chartWidth, createTickDates, simpleChartHeight } from "../../charts/chartPrimitives";
import {
  renderDailyFriendConnectionsChart,
  renderDailyFriendInvitationsChart,
} from "../../charts/chartRenderers";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import { getLatestGeneralReport, type GeneralReportView } from "../generalReportView";
import { todayUtcCalendarDate } from "../reportValues";

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
    filteredReport: GeneralReportView<ReviewEventsByDateReport>;
  }>,
): JSX.Element {
  const friendInvitationsChartRef = useRef<SVGSVGElement | null>(null);
  const friendConnectionsChartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const readyReport = props.filteredReport.status === "ready" ? props.filteredReport.report : null;
  const latestReport = getLatestGeneralReport(props.filteredReport);
  const chartModel = useMemo(
    () => readyReport === null ? null : buildSocialConnectionsChartModel(readyReport),
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

    const friendInvitationsSvgElement = friendInvitationsChartRef.current;
    const friendConnectionsSvgElement = friendConnectionsChartRef.current;
    if (friendInvitationsSvgElement === null || friendConnectionsSvgElement === null) {
      return;
    }

    renderDailyFriendInvitationsChart({
      svgElement: friendInvitationsSvgElement,
      dates: chartModel.dates,
      tickDates: chartModel.tickDates,
      today,
      notes: chartNotes,
      friendInvitationsByDate: chartModel.friendInvitationsByDate,
      peakDailyFriendInvitations: chartModel.peakDailyFriendInvitations,
      tooltipHandlers,
    });
    renderDailyFriendConnectionsChart({
      svgElement: friendConnectionsSvgElement,
      dates: chartModel.dates,
      tickDates: chartModel.tickDates,
      today,
      notes: chartNotes,
      friendConnectionsByDate: chartModel.friendConnectionsByDate,
      peakDailyFriendConnections: chartModel.peakDailyFriendConnections,
      tooltipHandlers,
    });
  }, [chartModel, chartNotes, today, tooltipHandlers]);

  return (
    <section className="dashboard-section">
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>Social: invites and friend connections</h2>
          <ExplanationTip label="What Social shows" explanationId="social-connections-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> two daily charts, grouped by <strong>UTC</strong> day, both following every active filter
                <ul>
                  <li><strong>Friend invite links created:</strong> per day, from the <code>friend_invitation_created</code> event</li>
                  <li>
                    <strong>Existing friend connections:</strong> at the end of each day, each person's running sum of <code>friendship_created</code>, added up over everyone
                    <ul>
                      <li>So a friendship between two counted people adds two</li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
          </ExplanationTip>
        </div>
      </header>

      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-meta">
            <span>Friend invite links created</span>
            <div className="chart-meta-right">
              <ChartGeneratedAt generatedAtUtc={latestReport?.generatedAtUtc ?? null} />
            </div>
          </div>
          <div className="chart-scroll">
            {chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={simpleChartHeight} label="Loading…" />
            ) : <svg ref={friendInvitationsChartRef} />}
          </div>
          <ChartNotesKey notes={chartNotes} />
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Existing friend connections by day</span>
          </div>
          <div className="chart-scroll">
            {chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={simpleChartHeight} label="Loading…" />
            ) : <svg ref={friendConnectionsChartRef} />}
          </div>
          <ChartNotesKey notes={chartNotes} />
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

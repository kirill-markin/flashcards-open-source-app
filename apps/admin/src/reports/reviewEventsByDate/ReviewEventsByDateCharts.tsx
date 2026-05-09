import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { reviewEventPlatforms, type ReviewEventsByDateUser } from "../../adminApi";
import {
  getPlatformColor,
  platformLabels,
  uniqueUserCohortColors,
  uniqueUserCohortKeys,
  uniqueUserCohortLabels,
  type ChartTooltipState,
  type ReviewEventsByDateChartModel,
} from "./chartModel";
import {
  renderDailyUniqueUsersChart,
  renderPlatformActiveUsersChart,
  renderPlatformReviewEventsChart,
  renderUserReviewEventsChart,
} from "./chartRenderers";
import { formatGeneratedAt } from "./formatting";

type ReviewEventsByDateChartsProps = Readonly<{
  chartModel: ReviewEventsByDateChartModel;
  generatedAtUtc: string;
  isReportLoading: boolean;
  userById: ReadonlyMap<string, ReviewEventsByDateUser>;
  onUserFilterApply: (userId: string) => void;
}>;

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
          <span className="platform-key-swatch" style={{ backgroundColor: getPlatformColor(platform) }} />
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

export function ReviewEventsByDateCharts(props: ReviewEventsByDateChartsProps): JSX.Element {
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

  const handleUserFilterApply = useCallback((userId: string): void => {
    props.onUserFilterApply(userId);
    setTooltipState((currentState) => ({
      ...currentState,
      visible: false,
    }));
  }, [props.onUserFilterApply]);

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

    const tooltipHandlers = {
      showTooltip,
      hideTooltip,
    };

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
      userColorScale: props.chartModel.userColorScale,
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
  }, [
    props.chartModel,
    props.isReportLoading,
    props.userById,
    handleUserFilterApply,
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
    </>
  );
}

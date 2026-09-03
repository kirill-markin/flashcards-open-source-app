import { useMemo, type JSX } from "react";
import type { ReviewEventsByDateReport, ReviewEventsByDateUser } from "../../adminApi";
import type { UserColorScale } from "../../dashboard/userColors";
import { ReviewEventsByDateCharts } from "./charts/ReviewEventsByDateCharts";
import { buildReviewEventsByDateChartModel } from "./charts/chartModel";
import {
  buildReviewEventsByDateSummaryCards,
  ReviewEventsByDateSummary,
} from "./ReviewEventsByDateSummary";

export function ReviewActivitySection(
  props: Readonly<{
    filteredReport: ReviewEventsByDateReport;
    generatedAtUtc: string;
    isReportLoading: boolean;
    filteredUserById: ReadonlyMap<string, ReviewEventsByDateUser>;
    userColorScale: UserColorScale;
    onUserFilterApply: (userId: string) => void;
  }>,
): JSX.Element {
  const chartModel = useMemo(
    () => buildReviewEventsByDateChartModel(props.filteredReport),
    [props.filteredReport],
  );
  const summaryCards = useMemo(
    () => buildReviewEventsByDateSummaryCards(
      props.filteredReport,
      chartModel.peakDailyVolume,
      chartModel.peakDailyUniqueUsers,
    ),
    [chartModel.peakDailyUniqueUsers, chartModel.peakDailyVolume, props.filteredReport],
  );

  return (
    <section className="dashboard-section">
      <header className="dashboard-section-header">
        <h2>Review activity</h2>
        <p className="dashboard-section-description">
          Daily unique reviewers, stacked review-event volume, platform activity, friend invite links, and existing friend connections by calendar date. Dates are grouped in <strong>UTC</strong>.
        </p>
      </header>

      <ReviewEventsByDateSummary cards={summaryCards} />

      <ReviewEventsByDateCharts
        chartModel={chartModel}
        generatedAtUtc={props.generatedAtUtc}
        isReportLoading={props.isReportLoading}
        userById={props.filteredUserById}
        userColorScale={props.userColorScale}
        onUserFilterApply={props.onUserFilterApply}
      />
    </section>
  );
}

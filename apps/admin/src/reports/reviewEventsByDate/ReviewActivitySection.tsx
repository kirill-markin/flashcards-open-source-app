import { useMemo, type JSX } from "react";
import type { ReviewEventsByDateReport, ReviewEventsByDateUser } from "../../adminApi";
import type { UserColorScale } from "../../dashboard/userColors";
import { ExplanationTip } from "../../explanations/ExplanationTip";
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
        <div className="explained-heading-row">
          <h2>Review activity</h2>
          <ExplanationTip label="What Review activity shows" explanationId="review-activity-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> per <strong>UTC</strong> day
                <ul>
                  <li>Daily unique reviewers</li>
                  <li>Stacked review-event volume</li>
                  <li>Platform activity</li>
                </ul>
              </li>
              <li>
                <strong>Caveats</strong>
                <ul>
                  <li>Today&rsquo;s UTC data is partial, through the report&rsquo;s last refresh</li>
                  <li>Public statistics include only completed UTC days and refresh daily, so recent arrivals can differ from them</li>
                </ul>
              </li>
            </ul>
          </ExplanationTip>
        </div>
      </header>

      <ReviewEventsByDateSummary cards={summaryCards} />

      <ReviewEventsByDateCharts
        chartModel={chartModel}
        generatedAtUtc={props.generatedAtUtc}
        userById={props.filteredUserById}
        userColorScale={props.userColorScale}
        onUserFilterApply={props.onUserFilterApply}
      />
    </section>
  );
}

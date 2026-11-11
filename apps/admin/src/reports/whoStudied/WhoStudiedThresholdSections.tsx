import { useMemo, type JSX } from "react";
import { getNewReturningChartPeak } from "../../charts/dailyNewReturningChart";
import { DailyNewReturningChartSection } from "../dailyNewReturning/DailyNewReturningSection";
import { useDailyNewReturningReport, type DailyNewReturningSelection } from "../dailyNewReturning/useDailyNewReturningReport";
import { whoStudiedReportExplanation } from "./WhoStudiedSection";
import { loadWhoStudiedThresholdReports, studyReviewThresholds } from "./thresholdQuery";

const reportTitle = "Who studied thresholds";

export function WhoStudiedThresholdSections(props: DailyNewReturningSelection): JSX.Element {
  const { state, retry } = useDailyNewReturningReport(props, reportTitle, loadWhoStudiedThresholdReports);
  const charts = useMemo(() => state.status === "ready"
    ? state.report.map(({ threshold, report }) => ({ threshold, state: { status: "ready", report } as const }))
    : studyReviewThresholds.map((threshold) => ({ threshold, state })), [state]);
  const sharedPeak = state.status === "ready"
    ? Math.max(...state.report.map(({ report }) => getNewReturningChartPeak(report.buckets)))
    : null;

  return (
    <div className="who-studied-threshold-charts" data-testid="who-studied-threshold-charts">
      {state.status === "error" ? (
        <DailyNewReturningChartSection
          period={props.period}
          title={reportTitle}
          testId="who-studied-section"
          explanationId="who-studied-explanation"
          explanation={whoStudiedReportExplanation}
          detailsLink={null}
          state={state}
          retry={retry}
          sharedPeak={null}
        />
      ) : charts.map(({ threshold, state: chartState }) => {
        const id = threshold === 1 ? "who-studied" : `who-studied-${threshold}-plus`;
        return (
          <DailyNewReturningChartSection
            key={threshold}
            period={props.period}
            title={`Who studied · ${threshold}+ reviews in a day`}
            testId={`${id}-section`}
            explanationId={`${id}-explanation`}
            explanation={<>
              <li>A person qualifies after answering at least {threshold} {threshold === 1 ? "review" : "reviews"} of any rating on one selected UTC day, counted across their selected platforms and devices.</li>
              <li>A week or month counts a person once if they reach the threshold on any selected day in that bar.</li>
              {whoStudiedReportExplanation}
            </>}
            detailsLink={null}
            state={chartState}
            retry={retry}
            sharedPeak={sharedPeak}
          />
        );
      })}
    </div>
  );
}

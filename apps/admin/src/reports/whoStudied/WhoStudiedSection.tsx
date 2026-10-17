import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { DailyNewReturningSection } from "../dailyNewReturning/DailyNewReturningSection";
import type { DailyActivitySource } from "../dailyNewReturning/query";
import { buildMeaningfulActivityCtesSql } from "../levelOneMetrics/meaningfulActivitySql";

const reviewActivitySource: DailyActivitySource = {
  ctesSql: buildMeaningfulActivityCtesSql(),
  activityCte: "meaningful_activity",
  firstUseCte: "actor_first_use",
  coverageCte: "activity_coverage",
};

export function WhoStudiedSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <DailyNewReturningSection
      config={props.config}
      dateRange={props.dateRange}
      onTerminalAdminError={props.onTerminalAdminError}
      title="Who studied"
      testId="who-studied-section"
      explanationId="who-studied-explanation"
      source={reviewActivitySource}
      explanation={<>
        <li>Daily unique people who answered at least one review, with any rating, on that UTC day, on iOS, Android, web or the agent API.</li>
        <li>One point per person per day, however many reviews or devices. A guest, and several guests merged into one account, count as that one person.</li>
        <li>New means that day is the person’s first recorded answered review; returning means an earlier first review. First review reads all retained history, regardless of this date selection.</li>
        <li>The shared actor exclusions apply, and only credentialed rows count. Today is shown and in progress; days before retained history are unavailable, never zero.</li>
        <li>Review analytics retain anonymized deletion history; reviews never recorded in analytics cannot be reconstructed. Later offline review syncs can revise past days.</li>
      </>}
    />
  );
}

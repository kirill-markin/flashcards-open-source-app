import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { DailyNewReturningSection } from "../dailyNewReturning/DailyNewReturningSection";
import type { DailyActivitySource } from "../dailyNewReturning/query";
import type { LevelOneMetricDetailsLink } from "../levelOneMetrics/LevelOneMetricDetailsLink";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { buildAppOpenActivityCtesSql } from "./appOpenActivitySql";

const appOpenActivitySource: DailyActivitySource = {
  ctesSql: buildAppOpenActivityCtesSql(),
  activityCte: "app_open_activity",
  firstUseCte: "app_open_first_use",
  coverageCte: "app_open_coverage",
};

export function WhoOpenedTheAppSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  detailsLink: LevelOneMetricDetailsLink | null;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <DailyNewReturningSection
      config={props.config}
      dateRange={props.dateRange}
      period={props.period}
      onTerminalAdminError={props.onTerminalAdminError}
      detailsLink={props.detailsLink}
      title="Who opened the app"
      testId="who-opened-the-app-section"
      explanationId="who-opened-the-app-explanation"
      source={appOpenActivitySource}
      explanation={<>
        <li>Unique people who opened the app (<code>app_opened</code>) in each UTC day, week or month, on iOS, Android, web or the agent API.</li>
        <li>One point per person per bar, however many opens, days or devices: a week or month counts each person once, never the sum of its days. A guest, and several guests merged into one account, count as that one person. A scheduled agent client opens a day for its owner on every day it runs.</li>
        <li>New means the person’s first recorded app open is on one of the bar’s days; returning means an earlier first open. First open reads all retained history, regardless of this date selection.</li>
        <li>The shared actor exclusions apply, and only credentialed rows count. Edge bars hold only the selected days. The bar holding today is shown and in progress; a bar with days before retained history is unavailable, never zero.</li>
        <li>App opens from before the clients reported them are partly reconstructed, so early first-open dates, and the new/returning split around them, are approximate.</li>
      </>}
    />
  );
}

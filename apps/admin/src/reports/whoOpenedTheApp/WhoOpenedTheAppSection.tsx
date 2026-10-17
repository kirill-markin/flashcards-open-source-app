import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { DailyNewReturningSection } from "../dailyNewReturning/DailyNewReturningSection";
import type { DailyActivitySource } from "../dailyNewReturning/query";
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
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <DailyNewReturningSection
      config={props.config}
      dateRange={props.dateRange}
      onTerminalAdminError={props.onTerminalAdminError}
      title="Who opened the app"
      testId="who-opened-the-app-section"
      explanationId="who-opened-the-app-explanation"
      source={appOpenActivitySource}
      explanation={<>
        <li>Daily unique people who opened the app (<code>app_opened</code>) on that UTC day, on iOS, Android, web or the agent API.</li>
        <li>One point per person per day, however many opens or devices. A guest, and several guests merged into one account, count as that one person. A scheduled agent client opens a day for its owner on every day it runs.</li>
        <li>New means that day is the person’s first recorded app open; returning means an earlier first open. First open reads all retained history, regardless of this date selection.</li>
        <li>The shared actor exclusions apply, and only credentialed rows count. Today is shown and in progress; days before retained history are unavailable, never zero.</li>
        <li>App opens from before the clients reported them are partly reconstructed, so early first-open dates, and the new/returning split around them, are approximate.</li>
      </>}
    />
  );
}

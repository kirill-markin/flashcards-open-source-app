import type { JSX } from "react";
import type { ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { DailyNewReturningSection } from "../dailyNewReturning/DailyNewReturningSection";
import type { LevelOneMetricDetailsLink } from "../levelOneMetrics/LevelOneMetricDetailsLink";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { reviewActivitySource } from "../levelOneMetrics/meaningfulActivitySql";

export function WhoStudiedSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>;
  appVersions: ReadonlyArray<string>;
  detailsLink: LevelOneMetricDetailsLink | null;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <DailyNewReturningSection
      config={props.config}
      dateRange={props.dateRange}
      period={props.period}
      eventPlatforms={props.eventPlatforms}
      appVersions={props.appVersions}
      onTerminalAdminError={props.onTerminalAdminError}
      detailsLink={props.detailsLink}
      title="Who studied"
      testId="who-studied-section"
      explanationId="who-studied-explanation"
      source={reviewActivitySource}
      explanation={<>
        <li>Unique people who answered at least one review, with any rating, in each UTC day, week or month, on iOS, Android, web or the agent API.</li>
        <li>One point per person per bar, however many reviews, days or devices: a week or month counts each person once, never the sum of its days. A guest, and several guests merged into one account, count as that one person.</li>
        <li>New means the person’s first recorded answered review is on one of the bar’s days; returning means an earlier first review. First review reads all retained history, regardless of this date selection.</li>
        <li>The Platform filter keeps a person on a day only when they answered a review on a selected platform that day, Unresolved being a review with no resolved device; their first review still counts on any platform.</li>
        <li>A review records no app version, so the App version filter keeps a person in a bar only when their last app open in it, on a selected platform, is on a selected version: someone with no app open in the bar, such as an agent-only learner, drops out. Their first review still counts on any version.</li>
        <li>The shared actor exclusions apply, and only credentialed rows count. Edge bars hold only the selected days. The bar holding today is shown and in progress; a bar with days before retained history is unavailable, never zero.</li>
        <li>Review analytics retain anonymized deletion history; reviews never recorded in analytics cannot be reconstructed. Later offline review syncs can revise past days.</li>
      </>}
    />
  );
}

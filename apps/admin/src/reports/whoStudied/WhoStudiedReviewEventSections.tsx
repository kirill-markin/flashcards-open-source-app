import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { getUserPath } from "../../routing";
import { BreakdownSection } from "../levelOneMetrics/BreakdownSection";
import { showPlatform } from "../levelOneMetrics/PeopleBreakdownSections";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import {
  isNamedPerson,
  loadReviewEventsByPersonReport,
  loadReviewEventsByPlatformReport,
} from "./reviewEventsBreakdownQuery";

const showValue = (value: string): string => value;

const getPersonPath = (value: string): string | null => (isNamedPerson(value) ? getUserPath(value, "activity") : null);

const reviewEventsCount = <li>Every answered review of the Who studied people, with any rating, so a person adds each of their reviews to a bar, not one point.</li>;

const reviewEventsRules = <>
  <li>The shared actor exclusions apply, and only credentialed rows count. A guest, and several guests merged into one account, count as that one person. Edge bars hold only the selected days. The bar holding today is in progress; a bar with days before retained history is unavailable, never zero.</li>
  <li>Later offline review syncs can revise past bars.</li>
</>;

/** The Who studied Details charts of answered reviews, after its people breakdowns. */
export function WhoStudiedReviewEventSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onNavigate: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <>
      <BreakdownSection
        config={props.config}
        dateRange={props.dateRange}
        period={props.period}
        onTerminalAdminError={props.onTerminalAdminError}
        title="Review events by person"
        testId="who-studied-review-events-by-person-section"
        explanationId="who-studied-review-events-by-person-explanation"
        explanation={<>
          {reviewEventsCount}
          <li>The five people with the most reviews over the available bars get their own colour, named by account email, or (no email) and the start of their id; everyone else is summed into Other. A named person in the key opens their Activity.</li>
          {reviewEventsRules}
        </>}
        countLabel="Review events"
        unavailableBarText="Unavailable: retained source history does not cover all of its days."
        noAvailableBarText="Retained source history does not cover this range."
        loadReport={loadReviewEventsByPersonReport}
        formatValue={showValue}
        buildExtraNotes={null}
        keyLink={{ getPath: getPersonPath, onNavigate: props.onNavigate }}
      />
      <BreakdownSection
        config={props.config}
        dateRange={props.dateRange}
        period={props.period}
        onTerminalAdminError={props.onTerminalAdminError}
        title="Review events by platform"
        testId="who-studied-review-events-by-platform-section"
        explanationId="who-studied-review-events-by-platform-explanation"
        explanation={<>
          {reviewEventsCount}
          <li>Each review counts under its own platform, as the server resolved it from the device or agent connection that stored it. The five platforms with the most reviews over the available bars get their own colour; the rest are summed into Other. A missing platform is Unknown and ranks like any other.</li>
          {reviewEventsRules}
        </>}
        countLabel="Review events"
        unavailableBarText="Unavailable: retained source history does not cover all of its days."
        noAvailableBarText="Retained source history does not cover this range."
        loadReport={loadReviewEventsByPlatformReport}
        formatValue={showPlatform}
        buildExtraNotes={null}
        keyLink={null}
      />
    </>
  );
}

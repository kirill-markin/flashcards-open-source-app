import type { JSX } from "react";
import type { ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildPeopleBreakdowns, PeopleBreakdownSections } from "../levelOneMetrics/PeopleBreakdownSections";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { loadAppOpenBreakdownReport } from "./breakdownQuery";

const metricTitle = "Who opened the app";

const appOpenBreakdowns = buildPeopleBreakdowns(metricTitle, {
  platform: <li>A person counts once per bar, under the platform of their last app open in it, as the server read it from the request.</li>,
  country: <li>App opens carry no country, so a person counts once per bar under the one connection country a funnel’s Group by places them in over the whole selection: the alphabetically first of their retained connection samples. Samples are kept 90 days and agent requests carry none, so older bars and agent-only people are mostly Unknown.</li>,
  "app-ui-language": <li>A person counts once per bar, under the app interface language of their last app open in it; an older client sends none.</li>,
  "sign-in-state": <li>A person counts once per bar, under the sign-in state of their last app open in it: Guest or Signed in. A reconstructed open shows its trust level as stored.</li>,
  "app-version": <li>A person counts once per bar, under the app version of their last app open in it, as the server read it from the request.</li>,
}, loadAppOpenBreakdownReport);

/** The Who opened the app Details breakdowns. */
export function WhoOpenedTheAppBreakdownSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <PeopleBreakdownSections
      config={props.config}
      dateRange={props.dateRange}
      period={props.period}
      eventPlatforms={props.eventPlatforms}
      onTerminalAdminError={props.onTerminalAdminError}
      metricTitle={metricTitle}
      testIdPrefix="who-opened-the-app"
      breakdowns={appOpenBreakdowns}
    />
  );
}

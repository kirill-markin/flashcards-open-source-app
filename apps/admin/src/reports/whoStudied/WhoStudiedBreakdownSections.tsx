import type { JSX } from "react";
import type { ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildPeopleBreakdowns, PeopleBreakdownSections } from "../levelOneMetrics/PeopleBreakdownSections";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { loadWhoStudiedBreakdownReport } from "./breakdownQuery";

const metricTitle = "Who studied";

const fromLastAppOpen = "The server records answered reviews without the app’s context, so this comes from the person’s last app open in the same bar; someone who studied there without opening the app is Unknown.";

const whoStudiedBreakdowns = buildPeopleBreakdowns(metricTitle, {
  platform: <li>A person counts once per bar, under the platform of their last answered review in it, as the server resolved it from the device or agent connection that stored the review.</li>,
  country: <li>Answered reviews carry no country, so a person counts once per bar under the one connection country a funnel’s Group by places them in over the whole selection: the alphabetically first of their retained connection samples. Samples are kept 90 days and agent requests carry none, so older bars and agent-only people are mostly Unknown.</li>,
  "app-ui-language": <li>A person counts once per bar, under one app interface language. {fromLastAppOpen} An older client sends none.</li>,
  "sign-in-state": <li>A person counts once per bar, under one sign-in state: Guest or Signed in. {fromLastAppOpen} A reconstructed open shows its trust level as stored.</li>,
  "app-version": <li>A person counts once per bar, under one app version. {fromLastAppOpen}</li>,
}, loadWhoStudiedBreakdownReport);

/** The Who studied Details breakdowns. */
export function WhoStudiedBreakdownSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>;
  appVersions: ReadonlyArray<string>;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <PeopleBreakdownSections
      config={props.config}
      dateRange={props.dateRange}
      period={props.period}
      eventPlatforms={props.eventPlatforms}
      appVersions={props.appVersions}
      onTerminalAdminError={props.onTerminalAdminError}
      metricTitle={metricTitle}
      testIdPrefix="who-studied"
      breakdowns={whoStudiedBreakdowns}
      appVersionFilterNote={<li>The App version filter narrows these people as it narrows {metricTitle}.</li>}
    />
  );
}

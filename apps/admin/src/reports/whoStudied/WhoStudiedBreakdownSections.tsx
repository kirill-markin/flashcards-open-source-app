import { useCallback, type JSX } from "react";
import type { ProductEventDeviceType, ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownSection } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import { buildPeopleBreakdowns, PeopleBreakdownSections } from "../levelOneMetrics/PeopleBreakdownSections";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { loadWhoStudiedBreakdownReport } from "./breakdownQuery";
import { loadWhoStudiedByDeviceReport } from "./deviceBreakdownQuery";

const metricTitle = "Who studied";
const showDevice = (value: string): string => value;

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
  eventDeviceTypes: ReadonlyArray<ProductEventDeviceType>;
  appVersions: ReadonlyArray<string>;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const loadDevices = useCallback<BreakdownReportLoader>((config, dateRange, period, signal) => (
    loadWhoStudiedByDeviceReport(config, dateRange, period, props.eventPlatforms, props.eventDeviceTypes, props.appVersions, signal)
  ), [props.eventPlatforms, props.eventDeviceTypes, props.appVersions]);

  return (
    <PeopleBreakdownSections
      config={props.config}
      dateRange={props.dateRange}
      period={props.period}
      eventPlatforms={props.eventPlatforms}
      eventDeviceTypes={props.eventDeviceTypes}
      appVersions={props.appVersions}
      onTerminalAdminError={props.onTerminalAdminError}
      metricTitle={metricTitle}
      testIdPrefix="who-studied"
      breakdowns={whoStudiedBreakdowns}
      deviceSection={(
        <BreakdownSection
          config={props.config}
          dateRange={props.dateRange}
          period={props.period}
          onTerminalAdminError={props.onTerminalAdminError}
          title="Who studied by device"
          testId="who-studied-by-device-section"
          explanationId="who-studied-by-device-explanation"
          explanation={<>
            <li>A person counts once per UTC day, week or month in each native or Web device category they used to answer a review. The same person can count in several categories.</li>
            <li>Unknown includes native reviews with missing or unsupported device details. Web · Unknown device covers browser reviews with missing or unsupported device class.</li>
            <li>The Platform and Device filters apply to each review. The App version filter keeps a person when their last app open in the same bucket, on a selected platform and device class, has a selected version.</li>
            <li>The shared actor exclusions apply, and only credentialed rows count. Edge bars hold only the selected days. Today’s bucket is in progress. A bucket that starts before the retained history is unavailable.</li>
            <li>Later offline review syncs can revise past bars.</li>
          </>}
          countLabel="Unique people"
          unavailableBarText="Unavailable: retained source history does not cover all of its days."
          noAvailableBarText="Retained source history does not cover this range."
          loadReport={loadDevices}
          formatValue={showDevice}
          buildExtraNotes={null}
          keyLink={null}
          chartStyle="grouped"
          showDataTable
        />
      )}
      appVersionFilterNote={<li>The App version filter narrows these people as it narrows {metricTitle}.</li>}
    />
  );
}

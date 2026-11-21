import { useCallback, type JSX } from "react";
import type { ProductEventDeviceType, ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownSection } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import { buildPeopleBreakdowns, PeopleBreakdownSections } from "../levelOneMetrics/PeopleBreakdownSections";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { loadAppOpenBreakdownReport, loadAppOpenDeviceBreakdownReport } from "./breakdownQuery";

const metricTitle = "Who opened the app";
const showDevice = (value: string): string => value;

const appOpenBreakdowns = buildPeopleBreakdowns(metricTitle, {
  platform: <li>A person counts once per bar, under the platform of their last app open in it, as the server read it from the request.</li>,
  country: <li>A person counts once per bar under the one connection country a funnel’s Group by places them in over the whole selection: the alphabetically first of their retained connection samples. Samples are kept 90 days and agent requests carry none, so older bars and agent-only people are mostly Unknown.</li>,
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
  eventDeviceTypes: ReadonlyArray<ProductEventDeviceType>;
  appVersions: ReadonlyArray<string>;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const loadDevices = useCallback<BreakdownReportLoader>((config, dateRange, period, signal) => (
    loadAppOpenDeviceBreakdownReport(config, dateRange, period, props.eventPlatforms, props.eventDeviceTypes, props.appVersions, signal)
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
      testIdPrefix="who-opened-the-app"
      breakdowns={appOpenBreakdowns}
      platformCompanion={(
        <BreakdownSection
          config={props.config}
          dateRange={props.dateRange}
          period={props.period}
          onTerminalAdminError={props.onTerminalAdminError}
          title="Who opened the app by device"
          testId="who-opened-the-app-by-device-section"
          explanationId="who-opened-the-app-by-device-explanation"
          explanation={<>
            <li>A person counts once per day, week or month on each native device category they opened the app on. The same person can count in several categories.</li>
            <li>Unknown includes native opens with missing or unsupported device details.</li>
            <li>The Platform, Device and App version filters apply to the app open itself.</li>
            <li>The shared actor exclusions apply, and only credentialed rows count. Edge bars hold only the selected days. Today’s bucket is in progress. A bucket that starts before the retained history is unavailable.</li>
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
      appVersionFilterNote={<li>The App version filter narrows these people as it narrows {metricTitle}, and only their opens on a selected version place them.</li>}
    />
  );
}

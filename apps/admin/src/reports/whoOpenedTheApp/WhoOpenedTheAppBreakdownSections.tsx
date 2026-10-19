import type { JSX, ReactNode } from "react";
import { isReviewEventPlatform, platformLabels } from "../../charts/chartPrimitives";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownSection } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { loadAppOpenBreakdownReport, type AppOpenBreakdownDimension } from "./breakdownQuery";

type AppOpenBreakdown = Readonly<{
  dimension: AppOpenBreakdownDimension;
  title: string;
  /** The `<li>` saying which value a person counts under. */
  placement: ReactNode;
  loadReport: BreakdownReportLoader;
  formatValue: (value: string) => string;
}>;

function buildAppOpenBreakdown(
  dimension: AppOpenBreakdownDimension,
  title: string,
  placement: ReactNode,
  formatValue: (value: string) => string,
): AppOpenBreakdown {
  return {
    dimension,
    title,
    placement,
    loadReport: (config, dateRange, period) => loadAppOpenBreakdownReport(config, dimension, dateRange, period, `${title} report`),
    formatValue,
  };
}

const showValue = (value: string): string => value;

const showPlatform = (value: string): string => (isReviewEventPlatform(value) ? platformLabels[value] : value);

const appOpenBreakdowns: ReadonlyArray<AppOpenBreakdown> = [
  buildAppOpenBreakdown("platform", "Who opened the app by platform", <li>A person counts once per bar, under the platform of their last app open in it, as the server read it from the request.</li>, showPlatform),
  buildAppOpenBreakdown("country", "Who opened the app by country", <li>App opens carry no country, so a person counts once per bar under the one connection country a funnel’s Group by places them in over the whole selection: the alphabetically first of their retained connection samples. Samples are kept 90 days and agent requests carry none, so older bars and agent-only people are mostly Unknown.</li>, showValue),
  buildAppOpenBreakdown("app-ui-language", "Who opened the app by app interface language", <li>A person counts once per bar, under the app interface language of their last app open in it; an older client sends none.</li>, showValue),
  buildAppOpenBreakdown("sign-in-state", "Who opened the app by sign-in state", <li>A person counts once per bar, under the sign-in state of their last app open in it: Guest or Signed in. A reconstructed open shows its trust level as stored.</li>, showValue),
  buildAppOpenBreakdown("app-version", "Who opened the app by app version", <li>A person counts once per bar, under the app version of their last app open in it, as the server read it from the request.</li>, showValue),
];

/** The Who opened the app Details breakdowns, one grid cell each. */
export function WhoOpenedTheAppBreakdownSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <>
      {appOpenBreakdowns.map((breakdown) => (
        <BreakdownSection
          key={breakdown.dimension}
          config={props.config}
          dateRange={props.dateRange}
          period={props.period}
          onTerminalAdminError={props.onTerminalAdminError}
          title={breakdown.title}
          testId={`who-opened-the-app-by-${breakdown.dimension}-section`}
          explanationId={`who-opened-the-app-by-${breakdown.dimension}-explanation`}
          explanation={<>
            <li>The people of Who opened the app, so each bar adds up to that chart’s bar for the same day, week or month.</li>
            {breakdown.placement}
            <li>The five values with the most people over the available bars get their own colour; the rest are summed into Other. A missing value is Unknown and ranks like any other.</li>
            <li>The shared actor exclusions apply, and only credentialed rows count. Edge bars hold only the selected days. The bar holding today is in progress; a bar with days before retained history is unavailable, never zero.</li>
          </>}
          countLabel="Unique people"
          unavailableBarText="Unavailable: retained source history does not cover all of its days."
          noAvailableBarText="Retained source history does not cover this range."
          loadReport={breakdown.loadReport}
          formatValue={breakdown.formatValue}
        />
      ))}
    </>
  );
}

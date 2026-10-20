import type { JSX, ReactNode } from "react";
import { isReviewEventPlatform, platformLabels } from "../../charts/chartPrimitives";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownSection } from "./BreakdownSection";
import type { BreakdownReport, BreakdownReportLoader } from "./breakdownReport";
import { peopleBreakdownDimensions, type PeopleBreakdownDimension } from "./peopleBreakdownQuery";
import type { ReportPeriod } from "./reportPeriod";

export type PeopleBreakdown = Readonly<{
  dimension: PeopleBreakdownDimension;
  title: string;
  /** The `<li>` saying which value a person counts under. */
  placement: ReactNode;
  loadReport: BreakdownReportLoader;
  formatValue: (value: string) => string;
}>;

const dimensionTitles: Readonly<Record<PeopleBreakdownDimension, string>> = {
  platform: "platform",
  country: "country",
  "app-ui-language": "app interface language",
  "sign-in-state": "sign-in state",
  "app-version": "app version",
};

const showValue = (value: string): string => value;

export const showPlatform = (value: string): string => (isReviewEventPlatform(value) ? platformLabels[value] : value);

/** Build at module level: `BreakdownSection` needs a stable loader. */
export function buildPeopleBreakdowns(
  metricTitle: string,
  placements: Readonly<Record<PeopleBreakdownDimension, ReactNode>>,
  loadReport: (
    config: AdminAppConfig,
    dimension: PeopleBreakdownDimension,
    dateRange: AnalyticsDateRange,
    period: ReportPeriod,
    reportLabel: string,
    signal: AbortSignal,
  ) => Promise<BreakdownReport>,
): ReadonlyArray<PeopleBreakdown> {
  return peopleBreakdownDimensions.map((dimension): PeopleBreakdown => {
    const title = `${metricTitle} by ${dimensionTitles[dimension]}`;
    return {
      dimension,
      title,
      placement: placements[dimension],
      loadReport: (config, dateRange, period, signal) => loadReport(config, dimension, dateRange, period, `${title} report`, signal),
      formatValue: dimension === "platform" ? showPlatform : showValue,
    };
  });
}

/** The Details breakdowns of a unique-people chart, one grid cell each. */
export function PeopleBreakdownSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  metricTitle: string;
  testIdPrefix: string;
  breakdowns: ReadonlyArray<PeopleBreakdown>;
}>): JSX.Element {
  return (
    <>
      {props.breakdowns.map((breakdown) => (
        <BreakdownSection
          key={breakdown.dimension}
          config={props.config}
          dateRange={props.dateRange}
          period={props.period}
          onTerminalAdminError={props.onTerminalAdminError}
          title={breakdown.title}
          testId={`${props.testIdPrefix}-by-${breakdown.dimension}-section`}
          explanationId={`${props.testIdPrefix}-by-${breakdown.dimension}-explanation`}
          explanation={<>
            <li>The people of {props.metricTitle}, so each bar adds up to that chart’s bar for the same day, week or month.</li>
            {breakdown.placement}
            <li>The five values with the most people over the available bars get their own colour; the rest are summed into Other. A missing value is Unknown and ranks like any other.</li>
            <li>The shared actor exclusions apply, and only credentialed rows count. Edge bars hold only the selected days. The bar holding today is in progress; a bar with days before retained history is unavailable, never zero.</li>
          </>}
          countLabel="Unique people"
          unavailableBarText="Unavailable: retained source history does not cover all of its days."
          noAvailableBarText="Retained source history does not cover this range."
          loadReport={breakdown.loadReport}
          formatValue={breakdown.formatValue}
          buildExtraNotes={null}
          keyLink={null}
        />
      ))}
    </>
  );
}

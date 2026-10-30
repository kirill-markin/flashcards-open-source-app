import { useMemo, type JSX, type ReactNode } from "react";
import type { ReviewEventPlatform } from "../../adminApi";
import { isReviewEventPlatform, platformLabels } from "../../charts/chartPrimitives";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownSection } from "./BreakdownSection";
import type { BreakdownReport, BreakdownReportLoader } from "./breakdownReport";
import { peopleBreakdownDimensions, type PeopleBreakdownDimension } from "./peopleBreakdownQuery";
import type { ReportPeriod } from "./reportPeriod";

type PeopleBreakdownReportLoader = (
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  appVersions: ReadonlyArray<string>,
  signal: AbortSignal,
) => Promise<BreakdownReport>;

export type PeopleBreakdown = Readonly<{
  dimension: PeopleBreakdownDimension;
  title: string;
  /** The `<li>` saying which value a person counts under. */
  placement: ReactNode;
  loadReport: PeopleBreakdownReportLoader;
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
    eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
    appVersions: ReadonlyArray<string>,
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
      loadReport: (config, dateRange, period, eventPlatforms, appVersions, signal) => loadReport(config, dimension, dateRange, period, eventPlatforms, appVersions, `${title} report`, signal),
      formatValue: dimension === "platform" ? showPlatform : showValue,
    };
  });
}

/** The Details breakdowns of a unique-people chart, one grid cell each. */
export function PeopleBreakdownSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>;
  appVersions: ReadonlyArray<string>;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  metricTitle: string;
  testIdPrefix: string;
  breakdowns: ReadonlyArray<PeopleBreakdown>;
  /** The `<li>` saying how the App version filter narrows and places these people. */
  appVersionFilterNote: ReactNode;
}>): JSX.Element {
  // `BreakdownSection` reloads when its loader changes, so each one closes over the platforms and
  // versions here.
  const loadedBreakdowns = useMemo(() => props.breakdowns.map((breakdown) => ({
    breakdown,
    loadReport: ((config, dateRange, period, signal) => breakdown.loadReport(
      config,
      dateRange,
      period,
      props.eventPlatforms,
      props.appVersions,
      signal,
    )) satisfies BreakdownReportLoader,
  })), [props.breakdowns, props.eventPlatforms, props.appVersions]);
  return (
    <>
      {loadedBreakdowns.map(({ breakdown, loadReport }) => (
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
            <li>The Platform filter narrows these people as it narrows {props.metricTitle}, and only their events on a selected platform place them.</li>
            {props.appVersionFilterNote}
            <li>The five values with the most people over the available bars get their own colour; the rest are summed into Other. A missing value is Unknown and ranks like any other.</li>
            <li>The shared actor exclusions apply, and only credentialed rows count. Edge bars hold only the selected days. The bar holding today is in progress; a bar with days before retained history is unavailable, never zero.</li>
          </>}
          countLabel="Unique people"
          unavailableBarText="Unavailable: retained source history does not cover all of its days."
          noAvailableBarText="Retained source history does not cover this range."
          loadReport={loadReport}
          formatValue={breakdown.formatValue}
          buildExtraNotes={null}
          keyLink={null}
        />
      ))}
    </>
  );
}

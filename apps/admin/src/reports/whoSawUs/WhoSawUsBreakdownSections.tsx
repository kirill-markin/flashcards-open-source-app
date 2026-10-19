import type { JSX, ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownSection } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { loadWhoSawUsBreakdownReport, type WhoSawUsBreakdownDimension } from "./breakdownQuery";

type WhoSawUsBreakdown = Readonly<{
  dimension: WhoSawUsBreakdownDimension;
  title: string;
  /** The `<li>` items saying what a bar counts and under which value. */
  explanation: ReactNode;
  loadReport: BreakdownReportLoader;
}>;

function buildWhoSawUsBreakdown(
  dimension: WhoSawUsBreakdownDimension,
  title: string,
  explanation: ReactNode,
): WhoSawUsBreakdown {
  return {
    dimension,
    title,
    explanation,
    loadReport: (config, dateRange, period) => loadWhoSawUsBreakdownReport(config, dimension, dateRange, period, `${title} report`),
  };
}

const showValue = (value: string): string => value;

const webCohorts = <li>The visitors of the Who saw us Web series, so each bar adds up to that series’ bar for the same day, week or month: an identified visitor counts once per bar after the shared exclusions, a cookieless one once per day with only automated traffic dropped.</li>;

const appleRows = <li>The rows the Who saw us App Store series sums, product page views by unique count plus apps.apple.com browser views, so each bar adds up to that series’ bar. Apple counts uniques within each of its own rows, so a visitor in two rows counts in both, and the segments are not additive unique visitors.</li>;

const storeNotFinal = <li>Store numbers for the last few days are not final.</li>;

const whoSawUsBreakdowns: ReadonlyArray<WhoSawUsBreakdown> = [
  buildWhoSawUsBreakdown("web-country", "Web visitors by country", <>
    {webCohorts}
    <li>A visitor counts under the country of their first page view in that bar or day, which the site’s collector derived from the request when it stored the view. Views stored before it began recording a country, in late September 2026, and requests it could not place are Unknown.</li>
  </>),
  buildWhoSawUsBreakdown("web-landing-page-type", "Web visitors by landing page type", <>
    {webCohorts}
    <li>A visitor counts under the page type of their first page view in that bar or day, as the site reports it, such as home or blog_article.</li>
  </>),
  buildWhoSawUsBreakdown("app-store-source-type", "App Store visitors by source type", <>
    {appleRows}
    <li>A row counts under its own source type, as Apple names it.</li>
    {storeNotFinal}
  </>),
  buildWhoSawUsBreakdown("app-store-territory", "App Store visitors by territory", <>
    {appleRows}
    <li>A row counts under its own territory, as Apple names it.</li>
    {storeNotFinal}
  </>),
];

/** The Who saw us Details breakdowns, one grid cell each. */
export function WhoSawUsBreakdownSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <>
      {whoSawUsBreakdowns.map((breakdown) => (
        <BreakdownSection
          key={breakdown.dimension}
          config={props.config}
          dateRange={props.dateRange}
          period={props.period}
          onTerminalAdminError={props.onTerminalAdminError}
          title={breakdown.title}
          testId={`who-saw-us-by-${breakdown.dimension}-section`}
          explanationId={`who-saw-us-by-${breakdown.dimension}-explanation`}
          explanation={<>
            {breakdown.explanation}
            <li>The five values with the most visitors over the selection get their own colour; the rest are summed into Other. A missing value is Unknown and ranks like any other.</li>
            <li>Edge bars hold only the selected days, and the bar holding today is in progress. A bar whose source has no row on any of its days is unavailable, never zero.</li>
          </>}
          countLabel="Visitors"
          unavailableBarText="No data: the source has no row on any of its days."
          noAvailableBarText="No data: the source has no row in this range."
          loadReport={breakdown.loadReport}
          formatValue={showValue}
        />
      ))}
    </>
  );
}

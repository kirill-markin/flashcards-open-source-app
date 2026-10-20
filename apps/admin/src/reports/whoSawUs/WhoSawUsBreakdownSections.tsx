import type { JSX, ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownSection } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { loadWhoSawUsBreakdownReport, type WhoSawUsBreakdownDimension } from "./breakdownQuery";
import type { WhoSawUsSeriesKey } from "./query";
import { storeNotFinalDayCounts } from "./storeDataFreshness";

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
    loadReport: (config, dateRange, period, signal) => loadWhoSawUsBreakdownReport(config, dimension, dateRange, period, `${title} report`, signal),
  };
}

const showValue = (value: string): string => value;

/** What a Who saw us breakdown bar counts, as its y axis names it. */
export const whoSawUsCountLabel = "Visitors";

/** How a Who saw us Web visitor is counted, to close a sentence. */
export const webVisitorCounting = "an identified visitor counts once per bar after the shared exclusions, a cookieless one once per day with only automated traffic dropped";

/** How a Who saw us Web Engaged visitor is counted, to close a sentence. */
export const webEngagedVisitorCounting = "an identified visitor engaged on any day of the bar counts once, a cookieless one once per engaged day";

const webCohorts = <li>The visitors of the Who saw us Web series, so each bar adds up to that series’ bar for the same day, week or month: {webVisitorCounting}.</li>;

const webEngagedCohorts = <li>Only the visitors of the Who saw us Web Engaged visitors chart, so each bar adds up to that chart’s bar for the same day, week or month: {webEngagedVisitorCounting}. A bar the Web series has a visitor in is available, so one without an engaged visitor is zero.</li>;

const webCountryValue = <li>A visitor counts under the country of their first page view in that bar or day, which the site’s collector derived from the request when it stored the view. Views stored before it began recording a country, in late September 2026, and requests it could not place are Unknown.</li>;

const webLandingPageTypeValue = <li>A visitor counts under the page type of their first page view in that bar or day, as the site reports it, such as home or blog_article.</li>;

const appleRows = <li>The rows the Who saw us App Store series sums, product page views by unique count plus apps.apple.com browser views, so each bar adds up to that series’ bar. Apple counts uniques within each of its own rows, so a visitor in two rows counts in both, and the segments are not additive unique visitors.</li>;

const appleFreshness = <li>A faded bar is not final: Apple’s numbers can still arrive or change for {storeNotFinalDayCounts["app-store"]} days, and in a week or month that runs past Apple’s newest delivered day. A bar none of whose days Apple has delivered yet is Not arrived yet, never zero.</li>;

/** The breakdowns of one Who saw us dataset page, or of the Web page's engaged visitors. */
export type WhoSawUsBreakdownGroup = WhoSawUsSeriesKey | "web-engaged";

const whoSawUsBreakdownsByGroup: Readonly<Record<WhoSawUsBreakdownGroup, ReadonlyArray<WhoSawUsBreakdown>>> = {
  web: [
    buildWhoSawUsBreakdown("web-country", "Web visitors by country", <>
      {webCohorts}
      {webCountryValue}
    </>),
    buildWhoSawUsBreakdown("web-landing-page-type", "Web visitors by landing page type", <>
      {webCohorts}
      {webLandingPageTypeValue}
    </>),
  ],
  "web-engaged": [
    buildWhoSawUsBreakdown("web-engaged-country", "Engaged visitors by country", <>
      {webEngagedCohorts}
      {webCountryValue}
    </>),
    buildWhoSawUsBreakdown("web-engaged-landing-page-type", "Engaged visitors by landing page type", <>
      {webEngagedCohorts}
      {webLandingPageTypeValue}
    </>),
  ],
  "app-store": [
    buildWhoSawUsBreakdown("app-store-source-type", "App Store visitors by source type", <>
      {appleRows}
      <li>A row counts under its own source type, as Apple names it.</li>
      {appleFreshness}
    </>),
    buildWhoSawUsBreakdown("app-store-territory", "App Store visitors by territory", <>
      {appleRows}
      <li>A row counts under its own territory, as Apple names it.</li>
      {appleFreshness}
    </>),
  ],
  "google-play": [],
};

/** One Who saw us breakdown chart, with the explanation items every breakdown shares. */
export function WhoSawUsBreakdownSection(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  title: string;
  testId: string;
  explanationId: string;
  /** The `<li>` items saying what a bar counts and under which value. */
  explanation: ReactNode;
  /** Must be stable, as `BreakdownSection` requires. */
  loadReport: BreakdownReportLoader;
}>): JSX.Element {
  return (
    <BreakdownSection
      config={props.config}
      dateRange={props.dateRange}
      period={props.period}
      onTerminalAdminError={props.onTerminalAdminError}
      title={props.title}
      testId={props.testId}
      explanationId={props.explanationId}
      explanation={<>
        {props.explanation}
        <li>The five values with the most visitors over the selection get their own colour; the rest are summed into Other. A missing value is Unknown and ranks like any other.</li>
        <li>Edge bars hold only the selected days, and the bar holding today is in progress. A bar whose source has no row on any of its days is unavailable, never zero.</li>
      </>}
      countLabel={whoSawUsCountLabel}
      unavailableBarText="No data: the source has no row on any of its days."
      noAvailableBarText="No data: the source has no row in this range."
      loadReport={props.loadReport}
      formatValue={showValue}
    />
  );
}

/** The breakdowns of one group, one grid cell each. */
export function WhoSawUsBreakdownSections(props: Readonly<{
  group: WhoSawUsBreakdownGroup;
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  return (
    <>
      {whoSawUsBreakdownsByGroup[props.group].map((breakdown) => (
        <WhoSawUsBreakdownSection
          key={breakdown.dimension}
          config={props.config}
          dateRange={props.dateRange}
          period={props.period}
          onTerminalAdminError={props.onTerminalAdminError}
          title={breakdown.title}
          testId={`who-saw-us-by-${breakdown.dimension}-section`}
          explanationId={`who-saw-us-by-${breakdown.dimension}-explanation`}
          explanation={breakdown.explanation}
          loadReport={breakdown.loadReport}
        />
      ))}
    </>
  );
}

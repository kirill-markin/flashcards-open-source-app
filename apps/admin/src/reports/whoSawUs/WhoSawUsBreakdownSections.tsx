import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import type { ChartNote } from "../../charts/chartNotes";
import { breakdownUnknownValue } from "../../charts/stackedBreakdownChart";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange, SiteVisitorFilterState } from "../../filters/analyticsFilters";
import { BreakdownSection } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import {
  loadWebUtmTagsTopValues,
  loadWhoSawUsBreakdownReport,
  loadWhoSawUsTopValues,
  siteUtmTagKeys,
  topValueCount,
  type UtmTagsVisitors,
  type ValueVisitors,
  type WhoSawUsBreakdownDimension,
} from "./breakdownQuery";
import { pageReadEngagementChartNote } from "./engagedVisitorsQuery";
import { webDataStartChartNote, type WhoSawUsSeriesKey } from "./query";
import { buildStoreNotFinalChartNote, storeNotFinalDayCounts } from "./storeDataFreshness";

type RowsLoader<Row> = (
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  signal: AbortSignal,
) => Promise<ReadonlyArray<Row>>;

export type TopValuesLoader = RowsLoader<ValueVisitors>;

type UtmTagsTopValuesLoader = RowsLoader<UtmTagsVisitors>;

/** A table of a breakdown's top values, beneath its chart. */
type WhoSawUsTopValues =
  | Readonly<{ kind: "values"; title: string; valueHeader: string; loadTopValues: TopValuesLoader }>
  | Readonly<{ kind: "utm-tags"; title: string; loadTopValues: UtmTagsTopValuesLoader }>;

type WhoSawUsBreakdown = Readonly<{
  dimension: WhoSawUsBreakdownDimension;
  title: string;
  /** The `<li>` items saying what a bar counts and under which value. */
  explanation: ReactNode;
  loadReport: BreakdownReportLoader;
  topValues: WhoSawUsTopValues | null;
}>;

function buildWhoSawUsBreakdown(
  siteFilters: SiteVisitorFilterState,
  dimension: WhoSawUsBreakdownDimension,
  title: string,
  explanation: ReactNode,
  topValues: WhoSawUsTopValues | null,
): WhoSawUsBreakdown {
  return {
    dimension,
    title,
    explanation,
    loadReport: (config, dateRange, period, signal) => loadWhoSawUsBreakdownReport(config, dimension, dateRange, period, siteFilters, `${title} report`, signal),
    topValues,
  };
}

function buildWhoSawUsTopValues(
  siteFilters: SiteVisitorFilterState,
  dimension: WhoSawUsBreakdownDimension,
  title: string,
  valueHeader: string,
): WhoSawUsTopValues {
  return {
    kind: "values",
    title,
    valueHeader,
    loadTopValues: (config, dateRange, period, signal) => loadWhoSawUsTopValues(config, dimension, dateRange, period, siteFilters, `${title} report`, signal),
  };
}

function buildWebUtmTagsTopValues(siteFilters: SiteVisitorFilterState, title: string): WhoSawUsTopValues {
  return {
    kind: "utm-tags",
    title,
    loadTopValues: (config, dateRange, period, signal) => loadWebUtmTagsTopValues(config, dateRange, period, siteFilters, `${title} report`, signal),
  };
}

const showValue = (value: string): string => value;

const formatCount = d3.format(",d");

/** What a Who saw us breakdown bar counts, as its y axis names it. */
export const whoSawUsCountLabel = "Visitors";

/** How a Who saw us Web engaged visitor is counted, to close a sentence. */
export const webEngagedVisitorCounting = "an identified visitor engaged on any day of the bar counts once, a cookieless one once per engaged day";

const webEngagedCohorts = <li>The visitors of the Who saw us Web engaged series, so each bar adds up to that series’ bar for the same day, week or month: {webEngagedVisitorCounting}. A bar with any site visitor is available, so one without an engaged visitor is zero.</li>;

const webCountryValue = <li>A visitor counts under the country of their first page view in that bar or day, which the site’s collector derived from the request when it stored the view. Views stored before it began recording a country, in late September 2026, and requests it could not place are Unknown.</li>;

const webLandingPageTypeValue = <li>A visitor counts under the page type of their first page view in that bar or day, as the site reports it, such as home or blog_article.</li>;

const webDeviceValue = <li>A visitor counts under the device category of their first page view in that bar or day, which the site derives from the browser’s user agent: desktop, mobile, tablet or unknown.</li>;

const webSourceValue = <li>A visitor counts under the traffic source of their first page view in that bar or day, which the site classifies from the page’s referrer: direct, search, social, ai_assistant (from a known AI assistant site, such as chatgpt.com or perplexity.ai, or a link whose utm_source names one), referral, internal (from another page of the site) or unknown.</li>;

const webBrowserLanguageValue = <li>A visitor counts under the browser language of their first page view in that bar or day: the language part of the locale the visitor’s browser reports, such as en from en-US, not the language of the page they opened. A view without a reported locale is Unknown.</li>;

const webBrowserLocaleValue = <li>A visitor counts under the browser locale of their first page view in that bar or day, as the visitor’s browser reports it, in canonical form, such as en-US or pt-BR, not the language of the page they opened. A browser that sends no region stays as the bare language, such as en. A view without a reported locale is Unknown.</li>;

const webReferrerValue = <li>A visitor counts under the referrer site of their first page view in that bar or day, which the site names only from a fixed list: google.com for a search on any Google domain, the listed host for another known search, social or AI assistant site, such as bing.com, reddit.com or chatgpt.com, and Unlisted site, which the site sends as other, for any other outside site or a referrer without a readable web address. Direct visits, links from the site’s own pages or the product’s apps, browsers that hide the referrer, and views stored before the site began sending a referrer, in late September 2026, are Unknown.</li>;

const webUtmCampaignValue = <li>A visitor counts under the UTM tags of the link that opened their first page view in that bar or day, as utm_source / utm_medium / utm_campaign, such as newsletter / email / launch, with (none) for a tag the link left out. The site keeps each tag as written, cut to 500 characters, since late October 2026, and lowercased it before that. A view whose link carried none of the three, and views stored before the site began sending UTM tags, in late September 2026, are Unknown.</li>;

const webUtmTagsTopValuesExplanation = <li>The table beneath lists the {topValueCount} combinations of all five tags, utm_source, utm_medium, utm_campaign, utm_content and utm_term, each in its own column, with the most visitors summed over the selection’s bars, so a visitor counts as many times as the bars count them: by day, one counted on 3 days counts 3 times. A tag the link left out reads (none), as do utm_content and utm_term on views stored before the site began sending them, in late October 2026. A view whose link carried none of the five, and views stored before the site began sending UTM tags, in late September 2026, are one Unknown row. One chart value splits into a row per utm_content and utm_term, so the order need not be the chart’s.</li>;

function buildTopValuesExplanation(valuesNoun: string): JSX.Element {
  return <li>The table beneath lists the {topValueCount} {valuesNoun} with the most visitors summed over the selection’s bars, so a visitor counts as many times as the bars count them: by day, one counted on 3 days counts 3 times. Its order is the chart’s, so its first five rows are the chart’s coloured {valuesNoun}.</li>;
}

const appleRows = <li>The rows the Who saw us App Store series sums, product page views by unique count plus apps.apple.com browser views, so each bar adds up to that series’ bar. Apple counts uniques within each of its own rows, so a visitor in two rows counts in both, and the segments are not additive unique visitors.</li>;

const appleFreshness = <li>A faded bar is not final: Apple’s numbers can still arrive or change for {storeNotFinalDayCounts["app-store"]} days, and in a week or month that runs past Apple’s newest delivered day. A bar none of whose days Apple has delivered yet is Not arrived yet, never zero.</li>;

/** The breakdowns of each Who saw us dataset page, their loaders bound to `siteFilters`. */
function buildWhoSawUsBreakdownsByGroup(
  siteFilters: SiteVisitorFilterState,
): Readonly<Record<WhoSawUsSeriesKey, ReadonlyArray<WhoSawUsBreakdown>>> {
  return {
    web: [
      buildWhoSawUsBreakdown(siteFilters, "web-engaged-country", "Web engaged visitors by country", <>
        {webEngagedCohorts}
        {webCountryValue}
      </>, null),
      buildWhoSawUsBreakdown(siteFilters, "web-engaged-landing-page-type", "Web engaged visitors by landing page type", <>
        {webEngagedCohorts}
        {webLandingPageTypeValue}
      </>, null),
      buildWhoSawUsBreakdown(siteFilters, "web-engaged-device", "Web engaged visitors by device", <>
        {webEngagedCohorts}
        {webDeviceValue}
      </>, null),
      buildWhoSawUsBreakdown(siteFilters, "web-engaged-source", "Web engaged visitors by traffic source", <>
        {webEngagedCohorts}
        {webSourceValue}
      </>, null),
      buildWhoSawUsBreakdown(siteFilters, "web-engaged-browser-language", "Web engaged visitors by browser language", <>
        {webEngagedCohorts}
        {webBrowserLanguageValue}
      </>, null),
      buildWhoSawUsBreakdown(siteFilters, "web-engaged-browser-locale", "Web engaged visitors by browser locale", <>
        {webEngagedCohorts}
        {webBrowserLocaleValue}
      </>, null),
      buildWhoSawUsBreakdown(siteFilters, "web-engaged-referrer", "Web engaged visitors by referrer site", <>
        {webEngagedCohorts}
        {webReferrerValue}
        {buildTopValuesExplanation("referrer sites")}
      </>, buildWhoSawUsTopValues(siteFilters, "web-engaged-referrer", `Top ${topValueCount} referrer sites of Web engaged visitors`, "Referrer site")),
      buildWhoSawUsBreakdown(siteFilters, "web-engaged-utm-campaign", "Web engaged visitors by UTM campaign", <>
        {webEngagedCohorts}
        {webUtmCampaignValue}
        {webUtmTagsTopValuesExplanation}
      </>, buildWebUtmTagsTopValues(siteFilters, `Top ${topValueCount} UTM tag combinations of Web engaged visitors`)),
    ],
    "app-store": [
      buildWhoSawUsBreakdown(siteFilters, "app-store-source-type", "App Store visitors by source type", <>
        {appleRows}
        <li>A row counts under its own source type, as Apple names it.</li>
        {appleFreshness}
      </>, null),
      buildWhoSawUsBreakdown(siteFilters, "app-store-territory", "App Store visitors by territory", <>
        {appleRows}
        <li>A row counts under its own territory, as Apple names it.</li>
        {appleFreshness}
      </>, null),
    ],
    "google-play": [],
  };
}

/** The notes of every Web engaged breakdown besides In progress. */
export function buildWebEngagedBreakdownChartNotes(): ReadonlyArray<ChartNote> {
  return [webDataStartChartNote, pageReadEngagementChartNote];
}

const buildBreakdownChartNotesByGroup: Readonly<Record<WhoSawUsSeriesKey, (today: string) => ReadonlyArray<ChartNote>>> = {
  web: buildWebEngagedBreakdownChartNotes,
  "app-store": (today) => [buildStoreNotFinalChartNote("app-store", today)],
  "google-play": (today) => [buildStoreNotFinalChartNote("google-play", today)],
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
  /** Must be stable, as `BreakdownSection` requires. */
  buildExtraNotes: (today: string) => ReadonlyArray<ChartNote>;
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
      buildExtraNotes={props.buildExtraNotes}
      keyLink={null}
    />
  );
}

type TopValuesLoadState<Row> =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; rows: ReadonlyArray<Row> }>;

/** Loads a top-values table's rows and shows its loading and failed states. */
function TopValuesLoad<Row>(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  title: string;
  testId: string;
  /** Must be stable. */
  loadRows: RowsLoader<Row>;
  renderTable: (rows: ReadonlyArray<Row>) => JSX.Element;
}>): JSX.Element {
  const [state, setState] = useState<TopValuesLoadState<Row>>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const abortController = new AbortController();
    void props.loadRows(props.config, props.dateRange, props.period, abortController.signal).then((rows) => {
      if (!cancelled) setState({ status: "ready", rows });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${props.title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.dateRange, props.period, props.onTerminalAdminError, props.loadRows, props.title, revision]);

  return (
    <div className="who-saw-us-top-values" data-testid={props.testId}>
      {state.status === "loading" ? <p className="report-state" aria-live="polite">Loading {props.title}…</p> : null}
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{props.title} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "ready" ? <div className="funnel-group-table-shell">{props.renderTable(state.rows)}</div> : null}
    </div>
  );
}

/** The values of one breakdown chart with the most visitors over the selection, in that chart's order. */
export function TopValuesTable(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  title: string;
  valueHeader: string;
  testId: string;
  /** Must be stable. */
  loadTopValues: TopValuesLoader;
}>): JSX.Element {
  return (
    <TopValuesLoad
      config={props.config}
      dateRange={props.dateRange}
      period={props.period}
      onTerminalAdminError={props.onTerminalAdminError}
      title={props.title}
      testId={props.testId}
      loadRows={props.loadTopValues}
      renderTable={(rows) => (
        <table className="funnel-group-table">
          <caption>{props.title}</caption>
          <thead><tr><th scope="col">Rank</th><th scope="col">{props.valueHeader}</th><th scope="col">Visitors</th></tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={row.value}>
              <th scope="row">{index + 1}</th>
              <td className="funnel-group-table-name">{row.value}</td>
              <td>{formatCount(row.visitors)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    />
  );
}

const missingUtmTagText = "(none)";

/** The combinations of all five UTM tags with the most visitors over the selection, a column per tag. */
function UtmTagsTopValuesTable(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  title: string;
  testId: string;
  /** Must be stable. */
  loadTopValues: UtmTagsTopValuesLoader;
}>): JSX.Element {
  return (
    <TopValuesLoad
      config={props.config}
      dateRange={props.dateRange}
      period={props.period}
      onTerminalAdminError={props.onTerminalAdminError}
      title={props.title}
      testId={props.testId}
      loadRows={props.loadTopValues}
      renderTable={(rows) => (
        <table className="funnel-group-table">
          <caption>{props.title}</caption>
          <thead><tr>
            <th scope="col">Rank</th>
            {siteUtmTagKeys.map((key) => <th key={key} scope="col">{key}</th>)}
            <th scope="col">Visitors</th>
          </tr></thead>
          <tbody>{rows.map((row, index) => {
            const tags = row.tags;
            return (
              <tr key={tags === null ? breakdownUnknownValue : JSON.stringify(tags)}>
                <th scope="row">{index + 1}</th>
                {tags === null ? (
                  <td className="funnel-group-table-name" colSpan={siteUtmTagKeys.length}>{breakdownUnknownValue}</td>
                ) : siteUtmTagKeys.map((key) => {
                  const tag = tags[key];
                  return (
                    <td key={key} className="funnel-group-table-name">
                      {tag === null ? missingUtmTagText : <span className="who-saw-us-utm-tag" title={tag}>{tag}</span>}
                    </td>
                  );
                })}
                <td>{formatCount(row.visitors)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    />
  );
}

/** The breakdowns of one dataset page, one grid cell each, a top-values table beneath its chart. */
export function WhoSawUsBreakdownSections(props: Readonly<{
  group: WhoSawUsSeriesKey;
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  /** Narrows the Web engaged breakdowns; the store rows carry nothing it could narrow. */
  siteFilters: SiteVisitorFilterState;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  // Rebuilt only when the filters change, so each loader stays as stable as `BreakdownSection` requires.
  const breakdowns = useMemo(
    () => buildWhoSawUsBreakdownsByGroup(props.siteFilters)[props.group],
    [props.siteFilters, props.group],
  );
  return (
    <>
      {breakdowns.map((breakdown) => (
        <div key={breakdown.dimension}>
          <WhoSawUsBreakdownSection
            config={props.config}
            dateRange={props.dateRange}
            period={props.period}
            onTerminalAdminError={props.onTerminalAdminError}
            title={breakdown.title}
            testId={`who-saw-us-by-${breakdown.dimension}-section`}
            explanationId={`who-saw-us-by-${breakdown.dimension}-explanation`}
            explanation={breakdown.explanation}
            loadReport={breakdown.loadReport}
            buildExtraNotes={buildBreakdownChartNotesByGroup[props.group]}
          />
          {breakdown.topValues?.kind === "values" ? (
            <TopValuesTable
              config={props.config}
              dateRange={props.dateRange}
              period={props.period}
              onTerminalAdminError={props.onTerminalAdminError}
              title={breakdown.topValues.title}
              valueHeader={breakdown.topValues.valueHeader}
              testId={`who-saw-us-by-${breakdown.dimension}-top-values`}
              loadTopValues={breakdown.topValues.loadTopValues}
            />
          ) : null}
          {breakdown.topValues?.kind === "utm-tags" ? (
            <UtmTagsTopValuesTable
              config={props.config}
              dateRange={props.dateRange}
              period={props.period}
              onTerminalAdminError={props.onTerminalAdminError}
              title={breakdown.topValues.title}
              testId={`who-saw-us-by-${breakdown.dimension}-top-values`}
              loadTopValues={breakdown.topValues.loadTopValues}
            />
          ) : null}
        </div>
      ))}
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import type { ChartTooltipHandlers } from "../../charts/chartPrimitives";
import { chartWidth, stackedChartHeight } from "../../charts/chartPrimitives";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { renderCountLineChart, renderRateLineChart } from "../../charts/rateLineChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange, AppStoreProductPageFilterState } from "../../filters/analyticsFilters";
import { DataTable } from "../../table/DataTable";
import { emptyDataTableState, type DataTableColumn, type DataTableState } from "../../table/dataTableModel";
import { formatReportBucketTick, reportPeriodAxisLabels } from "../levelOneMetrics/reportPeriod";
import { whoSawUsSeriesColors } from "../whoSawUs/WhoSawUsSection";
import {
  loadAppStoreProductPagesReport,
  type AppStoreProductPagePeriod,
  type AppStoreProductPagePeriodRow,
  type AppStoreProductPagesReport,
} from "./query";

const viewsTitle = "Unique product page views";
const downloadsTitle = "First-time downloads";
const conversionTitle = "First-time downloads per unique page view";
const coverageTitle = "Detailed rows coverage";

const viewsColor = whoSawUsSeriesColors["app-store"];
const downloadsColor = "#4e79a7";
const conversionColor = "#e15759";

const numberFormatter = d3.format(",");
const conversionFormatter = d3.format(".1%");
const coverageFormatter = d3.format(".0%");

const periodNames: Readonly<Record<AppStoreProductPagePeriod, string>> = { week: "Week", month: "Month" };
const periodPluralNames: Readonly<Record<AppStoreProductPagePeriod, string>> = { week: "weeks", month: "months" };

const lowerBoundNote = "Apple drops every detailed row below 5, so every per-listing number is a lower bound.";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: AppStoreProductPagesReport }>;

/** Downloads ÷ views, `null` when either is missing or no view was reported. */
function getConversion(row: AppStoreProductPagePeriodRow): number | null {
  if (row.listingViews === null || row.listingDownloads === null || row.listingViews === 0) return null;
  return row.listingDownloads / row.listingViews;
}

/** A missing detailed value of a delivered period is Apple's suppression below 5; of a later one, not delivered yet. */
function formatCount(value: number | null, delivered: boolean): string {
  if (value !== null) return numberFormatter(value);
  return delivered ? "No data" : "Not arrived yet";
}

function formatTableCount(value: number | null, delivered: boolean): string {
  return value === null && delivered ? "" : formatCount(value, delivered);
}

function formatConversion(row: AppStoreProductPagePeriodRow): string {
  const conversion = getConversion(row);
  return conversion === null || row.listingDownloads === null || row.listingViews === null
    ? "No estimate"
    : `${conversionFormatter(conversion)} (${numberFormatter(row.listingDownloads)} ÷ ${numberFormatter(row.listingViews)})`;
}

function formatPeriodTitle(period: AppStoreProductPagePeriod, row: AppStoreProductPagePeriodRow): string {
  return `${periodNames[period]} ${row.start} – ${row.end}`;
}

function buildPeriodTooltipHtml(period: AppStoreProductPagePeriod, row: AppStoreProductPagePeriodRow): string {
  return [
    `<p class="tooltip-title">${escapeHtml(`${formatPeriodTitle(period, row)} UTC`)}</p>`,
    `<div class="tooltip-metric"><span>${escapeHtml(viewsTitle)}</span><strong>${escapeHtml(formatCount(row.listingViews, row.viewsDelivered))}</strong></div>`,
    `<div class="tooltip-metric"><span>${escapeHtml(downloadsTitle)}</span><strong>${escapeHtml(formatCount(row.listingDownloads, row.downloadsDelivered))}</strong></div>`,
    `<div class="tooltip-metric"><span>${escapeHtml(conversionTitle)}</span><strong>${escapeHtml(formatConversion(row))}</strong></div>`,
  ].join("");
}

type CoverageTotals = Readonly<{
  covered: number;
  standard: number;
  countedPeriods: number;
  notDeliveredPeriods: number;
  noStandardPeriods: number;
}>;

/**
 * Detailed and standard totals over the same periods: delivered ones with a standard total. A missing
 * detailed value there counts as 0, being Apple's suppression; an undelivered period would read as low coverage.
 */
function sumCoverage(
  rows: ReadonlyArray<AppStoreProductPagePeriodRow>,
  readDetailed: (row: AppStoreProductPagePeriodRow) => number | null,
  readStandard: (row: AppStoreProductPagePeriodRow) => number | null,
  readDelivered: (row: AppStoreProductPagePeriodRow) => boolean,
): CoverageTotals {
  const deliveredRows = rows.filter(readDelivered);
  const pairs = deliveredRows.flatMap((row) => {
    const standard = readStandard(row);
    return standard === null ? [] : [{ covered: readDetailed(row) ?? 0, standard }];
  });
  return {
    covered: d3.sum(pairs, (pair) => pair.covered),
    standard: d3.sum(pairs, (pair) => pair.standard),
    countedPeriods: pairs.length,
    notDeliveredPeriods: rows.length - deliveredRows.length,
    noStandardPeriods: deliveredRows.length - pairs.length,
  };
}

function formatPeriodCount(count: number, period: AppStoreProductPagePeriod): string {
  return `${count} ${count === 1 ? period : periodPluralNames[period]}`;
}

/** `detailed of standard metric (share; periods left out)`. */
function formatCoverage(totals: CoverageTotals, metricLabel: string, period: AppStoreProductPagePeriod): string {
  const counts = totals.countedPeriods === 0
    ? `no ${metricLabel} to compare`
    : `${numberFormatter(totals.covered)} of ${numberFormatter(totals.standard)} ${metricLabel}`;
  const notes = [
    ...(totals.countedPeriods === 0 || totals.standard === 0 ? [] : [coverageFormatter(totals.covered / totals.standard)]),
    ...(totals.notDeliveredPeriods === 0 ? [] : [`newest ${formatPeriodCount(totals.notDeliveredPeriods, period)} left out as not delivered yet`]),
    ...(totals.noStandardPeriods === 0 ? [] : [`${formatPeriodCount(totals.noStandardPeriods, period)} without a standard total left out`]),
  ];
  return notes.length === 0 ? counts : `${counts} (${notes.join("; ")})`;
}

function buildTableColumns(period: AppStoreProductPagePeriod): ReadonlyArray<DataTableColumn<AppStoreProductPagePeriodRow>> {
  return [
    { id: "period", label: periodNames[period], kind: "text", value: (row) => formatPeriodTitle(period, row), renderCell: null },
    {
      id: "views",
      label: viewsTitle,
      kind: "number",
      value: (row) => row.listingViews,
      renderCell: (row) => formatTableCount(row.listingViews, row.viewsDelivered),
    },
    {
      id: "downloads",
      label: downloadsTitle,
      kind: "number",
      value: (row) => row.listingDownloads,
      renderCell: (row) => formatTableCount(row.listingDownloads, row.downloadsDelivered),
    },
    {
      id: "conversion",
      label: conversionTitle,
      kind: "number",
      value: getConversion,
      renderCell: (row) => (getConversion(row) === null ? "" : formatConversion(row)),
    },
    {
      id: "detailed-views",
      label: "Detailed views, every listing",
      kind: "number",
      value: (row) => row.detailedViews,
      renderCell: (row) => formatTableCount(row.detailedViews, row.viewsDelivered),
    },
    { id: "standard-views", label: "Standard views", kind: "number", value: (row) => row.standardViews, renderCell: null },
    {
      id: "detailed-downloads",
      label: "Detailed downloads, every listing",
      kind: "number",
      value: (row) => row.detailedDownloads,
      renderCell: (row) => formatTableCount(row.detailedDownloads, row.downloadsDelivered),
    },
    { id: "standard-downloads", label: "Standard downloads", kind: "number", value: (row) => row.standardDownloads, renderCell: null },
  ];
}

type LineChartRenderer = typeof renderCountLineChart;

/** One series over the report's whole periods: a gap where Apple published nothing, a point for a reported 0. */
function ProductPageLineChartSection(props: Readonly<{
  title: string;
  testId: string;
  explanation: ReactNode;
  note: string | null;
  loadState: LoadState;
  getValue: (row: AppStoreProductPagePeriodRow) => number | null;
  color: string;
  renderChart: LineChartRenderer;
}>): JSX.Element {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const report = props.loadState.status === "ready" ? props.loadState.report : null;
  const { getValue, renderChart, color, title } = props;

  useEffect(() => {
    const svgElement = chartRef.current;
    if (svgElement === null || report === null) return;
    renderProductPageChart(svgElement, report, title, color, getValue, renderChart, tooltipHandlers);
  }, [report, title, color, getValue, renderChart, tooltipHandlers]);

  return (
    <section className="dashboard-section" data-testid={props.testId}>
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{props.title}</h2>
          <ExplanationTip label={`What ${props.title} shows`} explanationId={`${props.testId}-explanation`}>
            <ul>
              {props.explanation}
              {report === null ? null : <li>Generated {formatGeneratedAt(report.generatedAtUtc)}.</li>}
            </ul>
          </ExplanationTip>
        </div>
      </header>
      {props.note === null ? null : <p className="activity-coverage-note" data-testid={`${props.testId}-note`}>{props.note}</p>}
      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-scroll">
            {report === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label={`Loading ${props.title}…`} />
            ) : (
              <ChartAreaWithNote viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} note={null}>
                <svg ref={chartRef} />
              </ChartAreaWithNote>
            )}
          </div>
        </div>
      </section>
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

function renderProductPageChart(
  svgElement: SVGSVGElement,
  report: AppStoreProductPagesReport,
  title: string,
  color: string,
  getValue: (row: AppStoreProductPagePeriodRow) => number | null,
  renderChart: LineChartRenderer,
  tooltipHandlers: ChartTooltipHandlers,
): void {
  const rowByStart = new Map(report.periods.map((row) => [row.start, row]));
  const getRow = (key: string): AppStoreProductPagePeriodRow => {
    const row = rowByStart.get(key);
    if (row === undefined) throw new Error(`${title} chart has no period starting ${key}.`);
    return row;
  };
  renderChart({
    svgElement,
    keys: report.periods.map((row) => row.start),
    lines: [{ getRate: (key) => getValue(getRow(key)), color }],
    inProgressKey: null,
    yLabel: title,
    xLabel: reportPeriodAxisLabels[report.period],
    notes: [],
    formatTick: (key) => formatReportBucketTick(report.period, key),
    getLabel: (key) => {
      const row = getRow(key);
      return [
        formatPeriodTitle(report.period, row),
        `${viewsTitle}: ${formatCount(row.listingViews, row.viewsDelivered)}`,
        `${downloadsTitle}: ${formatCount(row.listingDownloads, row.downloadsDelivered)}`,
        `${conversionTitle}: ${formatConversion(row)}`,
      ].join(". ");
    },
    getTooltipHtml: (key) => buildPeriodTooltipHtml(report.period, getRow(key)),
    tooltipHandlers,
  });
}

const readListingViews = (row: AppStoreProductPagePeriodRow): number | null => row.listingViews;
const readListingDownloads = (row: AppStoreProductPagePeriodRow): number | null => row.listingDownloads;

const missingCellItem = <li>A gap is a period Apple published no detailed row for: it omits every row below 5, so a gap is a small number, not 0, or a period past Apple's newest delivered detailed report, which the tooltip and table mark Not arrived yet</li>;

/**
 * The selected listing's views, first-time downloads and their ratio per whole week or month, the
 * coverage of the detailed rows against Apple's standard totals, and the table behind them.
 */
export function AppStoreProductPagesSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: AppStoreProductPagePeriod;
  listing: string;
  filters: AppStoreProductPageFilterState;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const [tableState, setTableState] = useState<DataTableState>(emptyDataTableState);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    const abortController = new AbortController();
    void loadAppStoreProductPagesReport(
      props.config,
      props.dateRange,
      props.period,
      props.listing,
      props.filters,
      abortController.signal,
    ).then((report) => {
      if (!cancelled) setLoadState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "Unexpected App Store product pages query error." });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.dateRange, props.period, props.listing, props.filters, props.onTerminalAdminError, revision]);

  const tableColumns = useMemo(() => buildTableColumns(props.period), [props.period]);

  if (loadState.status === "error") {
    return (
      <div className="report-state report-state-error" role="alert">
        <strong>App Store product pages query failed.</strong>
        <span>{loadState.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div>
    );
  }

  const report = loadState.status === "ready" ? loadState.report : null;
  const periodPlural = periodPluralNames[props.period];
  const firstPeriod = report?.periods[0];
  const lastPeriod = report?.periods[report.periods.length - 1];
  const hasListingRows = report !== null
    && report.periods.some((row) => row.listingViews !== null || row.listingDownloads !== null);

  return (
    <>
      {report === null ? null : (
        <p className="activity-coverage-note" data-testid="app-store-product-pages-effective-range">
          {firstPeriod === undefined || lastPeriod === undefined
            ? `The selected range ${props.dateRange.from} – ${props.dateRange.to} holds no whole ${props.period}; widen it to at least one whole ${props.period}.`
            : `Showing whole ${periodPlural} ${firstPeriod.start} – ${lastPeriod.end} UTC for ${props.listing}.`}
        </p>
      )}

      {report !== null && report.periods.length > 0 && !hasListingRows ? (
        <p className="report-state" data-testid="app-store-product-pages-empty">
          No detailed product page row for {props.listing} in these whole {periodPlural}. Apple may not have published enough data yet: it omits every detailed row below 5.
        </p>
      ) : null}

      {report !== null && !hasListingRows ? null : (
        <div className="level-1-metrics-grid" data-testid="app-store-product-pages-charts">
          <ProductPageLineChartSection
            title={viewsTitle}
            testId="app-store-product-pages-views-section"
            explanation={<>
              <li><strong>What it shows:</strong> the listing's unique product page views per whole {props.period}, summed over Apple's detailed {props.period === "week" ? "weekly" : "monthly"} rows under the filters</li>
              {missingCellItem}
            </>}
            note={null}
            loadState={loadState}
            getValue={readListingViews}
            color={viewsColor}
            renderChart={renderCountLineChart}
          />
          <ProductPageLineChartSection
            title={downloadsTitle}
            testId="app-store-product-pages-downloads-section"
            explanation={<>
              <li><strong>What it shows:</strong> first-time downloads Apple attributes to the listing per whole {props.period}, summed over its detailed {props.period === "week" ? "weekly" : "monthly"} rows under the filters</li>
              {missingCellItem}
            </>}
            note={null}
            loadState={loadState}
            getValue={readListingDownloads}
            color={downloadsColor}
            renderChart={renderCountLineChart}
          />
          <ProductPageLineChartSection
            title={conversionTitle}
            testId="app-store-product-pages-conversion-section"
            explanation={<>
              <li><strong>What it shows:</strong> {downloadsTitle} ÷ {viewsTitle} of the same {props.period}; the tooltip names both</li>
              <li>No point where either number is missing or no view was reported</li>
            </>}
            note="An estimate from Apple's published counts: Apple suppresses each cell on its own, and unique counts summed across segments can count one person more than once."
            loadState={loadState}
            getValue={getConversion}
            color={conversionColor}
            renderChart={renderRateLineChart}
          />
        </div>
      )}

      {report === null || report.periods.length === 0 ? null : (
        <section className="dashboard-section" data-testid="app-store-product-pages-coverage-section">
          <header className="dashboard-section-header">
            <h2>{coverageTitle}</h2>
          </header>
          <p className="activity-coverage-note" data-testid="app-store-product-pages-coverage">
            Over these whole {periodPlural}, detailed rows of every listing cover {formatCoverage(
              sumCoverage(report.periods, (row) => row.detailedViews, (row) => row.standardViews, (row) => row.viewsDelivered),
              "unique page views",
              props.period,
            )} and {formatCoverage(
              sumCoverage(report.periods, (row) => row.detailedDownloads, (row) => row.standardDownloads, (row) => row.downloadsDelivered),
              "first-time downloads",
              props.period,
            )} of Apple's standard product page totals, under the same filters. {lowerBoundNote}
          </p>
          <details className="activity-chart-table">
            <summary>Data table</summary>
            <DataTable
              testId="app-store-product-pages-table"
              columns={tableColumns}
              rows={report.periods}
              rowKey={(row) => row.start}
              rowClassName={() => ""}
              state={tableState}
              onStateChange={setTableState}
              server={null}
            />
          </details>
        </section>
      )}
    </>
  );
}

import { useEffect, useMemo, useRef, type JSX } from "react";
import * as d3 from "d3";
import type { CatalogInstallsReport } from "../../adminApi";
import { ChartGeneratedAt } from "../../charts/ChartGeneratedAt";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import {
  chartWidth,
  createTickDates,
  stackedChartHeight,
  type MatrixChartEntry,
  type PackageColorScale,
} from "../../charts/chartPrimitives";
import { renderCatalogInstallsByPackageChart } from "../../charts/chartRenderers";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import { getLatestGeneralReport, type GeneralReportView } from "../generalReportView";
import { buildRequestedDateRange } from "../reportValues";
import { catalogInstallsReportLabel } from "./query";

type CatalogInstallsChartModel = Readonly<{
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  packageSlugs: ReadonlyArray<string>;
  packageInstallsMatrix: ReadonlyArray<MatrixChartEntry>;
  totalInstallsByDate: ReadonlyMap<string, number>;
  cardCountByDateAndPackageSlug: ReadonlyMap<string, number>;
  peakDailyInstalls: number;
}>;

type CatalogInstallsSummaryCard = Readonly<{
  label: string;
  value: string;
}>;

/**
 * The keys are catalog-chosen slugs, and `constructor` is a legal one, so a plain object would
 * answer that lookup with a function inherited from `Object.prototype` instead of `undefined`.
 */
function createInstallCountsByPackageSlug(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

function buildCatalogInstallsChartModel(report: CatalogInstallsReport): CatalogInstallsChartModel {
  const dates = buildRequestedDateRange(report.from, report.to, catalogInstallsReportLabel);
  const installsByDate = new Map<string, Record<string, number>>();
  const totalInstallsByDate = new Map<string, number>();
  const cardCountByDateAndPackageSlug = new Map<string, number>();

  for (const row of report.rows) {
    const currentValues = installsByDate.get(row.date) ?? createInstallCountsByPackageSlug();
    currentValues[row.packageSlug] = (currentValues[row.packageSlug] ?? 0) + row.installCount;
    installsByDate.set(row.date, currentValues);
    totalInstallsByDate.set(row.date, (totalInstallsByDate.get(row.date) ?? 0) + row.installCount);

    const cardCountKey = `${row.date}:${row.packageSlug}`;
    cardCountByDateAndPackageSlug.set(
      cardCountKey,
      (cardCountByDateAndPackageSlug.get(cardCountKey) ?? 0) + row.cardCount,
    );
  }

  return {
    dates,
    tickDates: createTickDates(dates),
    // Already ordered by installs, so the most installed deck sits at the bottom of the stack.
    packageSlugs: report.packages.map((catalogPackage) => catalogPackage.packageSlug),
    packageInstallsMatrix: dates.map((date) => ({
      date,
      valuesByKey: installsByDate.get(date) ?? createInstallCountsByPackageSlug(),
    })),
    totalInstallsByDate,
    cardCountByDateAndPackageSlug,
    peakDailyInstalls: d3.max(dates, (date) => totalInstallsByDate.get(date) ?? 0) ?? 0,
  };
}

function buildCatalogInstallsSummaryCards(
  report: CatalogInstallsReport,
  peakDailyInstalls: number,
): ReadonlyArray<CatalogInstallsSummaryCard> {
  return [
    { label: "Total Installs", value: report.totalInstalls.toLocaleString("en-US") },
    { label: "Unique Installers", value: report.users.length.toLocaleString("en-US") },
    { label: "Decks Installed", value: report.packages.length.toLocaleString("en-US") },
    { label: "Peak Daily Installs", value: peakDailyInstalls.toLocaleString("en-US") },
  ];
}

export function CatalogInstallsSection(
  props: Readonly<{
    filteredReport: GeneralReportView<CatalogInstallsReport>;
    packageColorScale: PackageColorScale;
  }>,
): JSX.Element {
  const packageInstallsChartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const latestReport = getLatestGeneralReport(props.filteredReport);
  const chartModel = useMemo(
    () => latestReport === null ? null : buildCatalogInstallsChartModel(latestReport),
    [latestReport],
  );
  const summaryCards = useMemo(
    () => latestReport === null || chartModel === null
      ? null
      : buildCatalogInstallsSummaryCards(latestReport, chartModel.peakDailyInstalls),
    [chartModel, latestReport],
  );
  const readyReport = props.filteredReport.status === "ready" ? props.filteredReport.report : null;
  const readyChartModel = readyReport === null ? null : chartModel;

  useEffect(() => {
    if (readyChartModel === null) {
      tooltipHandlers.hideTooltip();
      return;
    }

    const packageInstallsSvgElement = packageInstallsChartRef.current;
    if (packageInstallsSvgElement === null) {
      return;
    }

    renderCatalogInstallsByPackageChart({
      svgElement: packageInstallsSvgElement,
      dates: readyChartModel.dates,
      tickDates: readyChartModel.tickDates,
      packageInstallsMatrix: readyChartModel.packageInstallsMatrix,
      packageSlugs: readyChartModel.packageSlugs,
      packageColorScale: props.packageColorScale,
      totalInstallsByDate: readyChartModel.totalInstallsByDate,
      cardCountByDateAndPackageSlug: readyChartModel.cardCountByDateAndPackageSlug,
      peakDailyInstalls: readyChartModel.peakDailyInstalls,
      tooltipHandlers,
    });
  }, [readyChartModel, props.packageColorScale, tooltipHandlers]);

  return (
    <section className="dashboard-section">
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>Catalog deck installs</h2>
          <ExplanationTip label="What Catalog deck installs shows" explanationId="catalog-installs-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> install actions per <strong>UTC</strong> day, from the <code>catalog_deck_installed</code> event
                <ul>
                  <li>One install = one install action by one person</li>
                </ul>
              </li>
              <li>
                <strong>Left out</strong>
                <ul>
                  <li>Installs of the delisted <code>test</code> fixture deck</li>
                  <li>Installs by people the shared exclusions drop</li>
                  <li>Together these leave almost nothing on production history so far</li>
                </ul>
              </li>
              <li>
                <strong>Platform:</strong> the event carries none, so every install sits in the <strong>Unresolved</strong> bucket
                <ul>
                  <li>Picking any device platform empties this section</li>
                </ul>
              </li>
            </ul>
          </ExplanationTip>
        </div>
      </header>

      {summaryCards === null ? null : (
        <section className="summary-grid">
          {summaryCards.map((card) => (
            <article key={card.label} className="metric-card">
              <p className="metric-label">{card.label}</p>
              <p className="metric-value">{card.value}</p>
            </article>
          ))}
        </section>
      )}

      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-meta">
            <span>Catalog deck installs per day &mdash; stacked by deck</span>
            <div className="chart-meta-right">
              <ChartGeneratedAt generatedAtUtc={latestReport?.generatedAtUtc ?? null} />
            </div>
          </div>
          <div className="chart-scroll">
            {readyChartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading…" />
            ) : <svg ref={packageInstallsChartRef} />}
          </div>
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

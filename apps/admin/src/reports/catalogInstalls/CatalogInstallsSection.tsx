import { useEffect, useMemo, useRef, type JSX } from "react";
import * as d3 from "d3";
import type { CatalogInstallsReport } from "../../adminApi";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import {
  createTickDates,
  type MatrixChartEntry,
  type PackageColorScale,
} from "../../charts/chartPrimitives";
import { renderCatalogInstallsByPackageChart } from "../../charts/chartRenderers";
import { formatGeneratedAt } from "../../charts/formatting";
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
    filteredReport: CatalogInstallsReport;
    generatedAtUtc: string;
    packageColorScale: PackageColorScale;
  }>,
): JSX.Element {
  const packageInstallsChartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const chartModel = useMemo(
    () => buildCatalogInstallsChartModel(props.filteredReport),
    [props.filteredReport],
  );
  const summaryCards = useMemo(
    () => buildCatalogInstallsSummaryCards(props.filteredReport, chartModel.peakDailyInstalls),
    [chartModel.peakDailyInstalls, props.filteredReport],
  );

  useEffect(() => {
    const packageInstallsSvgElement = packageInstallsChartRef.current;
    if (packageInstallsSvgElement === null) {
      return;
    }

    renderCatalogInstallsByPackageChart({
      svgElement: packageInstallsSvgElement,
      dates: chartModel.dates,
      tickDates: chartModel.tickDates,
      packageInstallsMatrix: chartModel.packageInstallsMatrix,
      packageSlugs: chartModel.packageSlugs,
      packageColorScale: props.packageColorScale,
      totalInstallsByDate: chartModel.totalInstallsByDate,
      cardCountByDateAndPackageSlug: chartModel.cardCountByDateAndPackageSlug,
      peakDailyInstalls: chartModel.peakDailyInstalls,
      tooltipHandlers,
    });
  }, [chartModel, props.packageColorScale, tooltipHandlers]);

  return (
    <section className="dashboard-section">
      <header className="dashboard-section-header">
        <h2>Catalog deck installs</h2>
        <p className="dashboard-section-description">
          One install action by one person, from the <code>catalog_deck_installed</code> event. Installs of the delisted <code>test</code> fixture deck and installs by active admins are excluded, which leaves almost nothing on production history so far. The event carries no platform, so every install sits in the <strong>Unresolved</strong> bucket and picking any device platform empties this section. Dates are grouped in <strong>UTC</strong>.
        </p>
      </header>

      <section className="summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="metric-card">
            <p className="metric-label">{card.label}</p>
            <p className="metric-value">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-meta">
            <span>Catalog deck installs per day &mdash; stacked by deck</span>
            <div className="chart-meta-right">
              <span>Generated {formatGeneratedAt(props.generatedAtUtc)}</span>
            </div>
          </div>
          <div className="chart-scroll">
            <svg ref={packageInstallsChartRef} />
          </div>
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

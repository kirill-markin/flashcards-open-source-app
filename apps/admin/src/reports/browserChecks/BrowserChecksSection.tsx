import { useEffect, useMemo, useRef, type JSX } from "react";
import * as d3 from "d3";
import { ChartColorKey, ChartColorKeyPlaceholder } from "../../charts/ChartLegends";
import { ChartGeneratedAt } from "../../charts/ChartGeneratedAt";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartNotesKey } from "../../charts/ChartNotesKey";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildInProgressChartNote, placeChartNotes } from "../../charts/chartNotes";
import { chartWidth, neutralChartColor, stackedChartHeight } from "../../charts/chartPrimitives";
import { escapeHtml, formatCompactDateLabel, formatDateRangeLabel } from "../../charts/formatting";
import {
  breakdownOtherValue,
  buildBreakdownValueColors,
  renderStackedBreakdownChart,
} from "../../charts/stackedBreakdownChart";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import { getLatestGeneralReport, type GeneralReportView } from "../generalReportView";
import { buildRequestedDateRange, todayUtcCalendarDate } from "../reportValues";
import {
  browserCheckOutcomes,
  browserChecksReportLabel,
  type BrowserCheckFlagTotal,
  type BrowserCheckOutcome,
  type BrowserChecksDay,
  type BrowserChecksReport,
} from "./query";

/** The outcomes of the second chart: the small series a required-check scale would flatten. */
const letThroughAndFailedOutcomes = ["allowed", "passed", "bypassed", "failed"] as const satisfies ReadonlyArray<BrowserCheckOutcome>;

const outcomeLabels: Readonly<Record<BrowserCheckOutcome, string>> = {
  required: "Check required",
  passed: "Passed",
  failed: "Failed",
  bypassed: "Bypassed (release smoke)",
  allowed: "Created without a check",
};

const outcomeColors: Readonly<Record<BrowserCheckOutcome, string>> = {
  required: "#f28e2b",
  passed: "#59a14f",
  failed: "#e15759",
  bypassed: neutralChartColor,
  allowed: "#4e79a7",
};

/** The outcomes the By flag table counts; a check created without one carries no flag. */
const flagOutcomes = ["required", "passed", "failed", "bypassed"] as const satisfies ReadonlyArray<BrowserCheckOutcome>;

function getOutcomeColor(value: string): string {
  if (browserCheckOutcomes.includes(value as BrowserCheckOutcome) === false) {
    throw new Error(`Unsupported browser check outcome color key: ${value}`);
  }
  return outcomeColors[value as BrowserCheckOutcome];
}

/** Flag sets drawn as their own segment; the rest sum into Other, so the breakdown palette always suffices. */
const shownFlagSetLimit = 8;

/** One tooltip line, also read out as the bar's accessible label. */
type ChartMetric = readonly [label: string, value: string];

const numberFormatter = d3.format(",");

const emptyDay = (date: string): BrowserChecksDay => ({ date, checksByOutcome: new Map(), requiredByFlagSet: new Map() });

type BrowserChecksChartModel = Readonly<{
  dates: ReadonlyArray<string>;
  daysByDate: ReadonlyMap<string, BrowserChecksDay>;
  /** Most required checks over the range first, Other last when present. */
  flagSetValues: ReadonlyArray<string>;
  flagSetColors: ReadonlyMap<string, string>;
  /** Each day's required checks per shown flag set or Other. */
  requiredByFlagSetValue: ReadonlyMap<string, ReadonlyMap<string, number>>;
}>;

function sumOutcome(report: BrowserChecksReport, outcome: BrowserCheckOutcome): number {
  return d3.sum(report.days, (day) => day.checksByOutcome.get(outcome) ?? 0);
}

function buildChartModel(report: BrowserChecksReport): BrowserChecksChartModel {
  const rangeRequiredByFlagSet = new Map<string, number>();
  for (const day of report.days) {
    for (const [flagSet, count] of day.requiredByFlagSet) {
      rangeRequiredByFlagSet.set(flagSet, (rangeRequiredByFlagSet.get(flagSet) ?? 0) + count);
    }
  }

  const rankedFlagSets = Array.from(rangeRequiredByFlagSet.entries())
    .sort(([leftSet, leftCount], [rightSet, rightCount]) => rightCount - leftCount || leftSet.localeCompare(rightSet))
    .map(([flagSet]) => flagSet);
  const shownFlagSets = new Set(rankedFlagSets.slice(0, shownFlagSetLimit));
  const flagSetValues = rankedFlagSets.length > shownFlagSetLimit
    ? [...shownFlagSets, breakdownOtherValue]
    : rankedFlagSets;

  return {
    dates: buildRequestedDateRange(report.from, report.to, browserChecksReportLabel),
    daysByDate: new Map(report.days.map((day) => [day.date, day])),
    flagSetValues,
    flagSetColors: buildBreakdownValueColors(flagSetValues),
    requiredByFlagSetValue: new Map(report.days.map((day) => {
      const countsByValue = new Map<string, number>();
      for (const [flagSet, count] of day.requiredByFlagSet) {
        const value = shownFlagSets.has(flagSet) ? flagSet : breakdownOtherValue;
        countsByValue.set(value, (countsByValue.get(value) ?? 0) + count);
      }
      return [day.date, countsByValue];
    })),
  };
}

function getMapColor(colors: ReadonlyMap<string, string>, value: string): string {
  const color = colors.get(value);
  if (color === undefined) {
    throw new Error(`Unsupported browser check flag set color key: ${value}`);
  }
  return color;
}

/** Every flag that occurred in the range, most required checks first. */
function BrowserCheckFlagsTable(props: Readonly<{ report: BrowserChecksReport }>): JSX.Element {
  const getCount = (flagTotal: BrowserCheckFlagTotal, outcome: BrowserCheckOutcome): number => flagTotal.checksByOutcome.get(outcome) ?? 0;
  const flagTotals = [...props.report.flagTotals].sort((left, right) => (
    getCount(right, "required") - getCount(left, "required") || left.flag.localeCompare(right.flag)
  ));
  return (
    <div className="funnel-group-table-shell">
      <table className="funnel-group-table">
        <caption>By flag, {formatDateRangeLabel(props.report.from)} – {formatDateRangeLabel(props.report.to)}, UTC; a check with several flags counts under each</caption>
        <thead>
          <tr>
            <th scope="col">Flag</th>
            {flagOutcomes.map((outcome) => <th key={outcome} scope="col">{outcomeLabels[outcome]}</th>)}
          </tr>
        </thead>
        <tbody>
          {flagTotals.length === 0 ? (
            <tr><td className="funnel-group-table-name" colSpan={flagOutcomes.length + 1}>No flagged request in the range</td></tr>
          ) : flagTotals.map((flagTotal) => (
            <tr key={flagTotal.flag}>
              <th scope="row"><code>{flagTotal.flag}</code></th>
              {flagOutcomes.map((outcome) => <td key={outcome}>{numberFormatter(getCount(flagTotal, outcome))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildMetricsLabel(title: string, metrics: ReadonlyArray<ChartMetric>): string {
  return [title, ...metrics.map(([label, value]) => `${label}: ${value}`)].join(". ");
}

function buildMetricsTooltipHtml(title: string, metrics: ReadonlyArray<ChartMetric>): string {
  return [
    `<p class="tooltip-title">${escapeHtml(title)}</p>`,
    ...metrics.map(([label, value]) => `<div class="tooltip-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`),
  ].join("");
}

export function BrowserChecksSection(
  props: Readonly<{
    filteredReport: GeneralReportView<BrowserChecksReport>;
  }>,
): JSX.Element {
  const requiredChartRef = useRef<SVGSVGElement | null>(null);
  const outcomesChartRef = useRef<SVGSVGElement | null>(null);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const readyReport = props.filteredReport.status === "ready" ? props.filteredReport.report : null;
  const latestReport = getLatestGeneralReport(props.filteredReport);
  const chartModel = useMemo(
    () => readyReport === null ? null : buildChartModel(readyReport),
    [readyReport],
  );
  const today = todayUtcCalendarDate(new Date());
  const inProgressNotes = useMemo(() => chartModel === null ? null : placeChartNotes(
    [buildInProgressChartNote(today)],
    chartModel.dates.map((date) => ({ key: date, from: date, to: date })),
  ), [chartModel, today]);

  useEffect(() => {
    if (chartModel === null || inProgressNotes === null) {
      tooltipHandlers.hideTooltip();
      return;
    }

    const requiredSvgElement = requiredChartRef.current;
    const outcomesSvgElement = outcomesChartRef.current;
    if (requiredSvgElement === null || outcomesSvgElement === null) {
      return;
    }

    const formatTitle = (date: string): string => `${formatDateRangeLabel(date)}${date === today ? " · in progress" : ""}`;
    const getDay = (date: string): BrowserChecksDay => chartModel.daysByDate.get(date) ?? emptyDay(date);
    const getRequiredByFlagSetValue = (date: string): ReadonlyMap<string, number> => chartModel.requiredByFlagSetValue.get(date) ?? new Map();
    const describeOutcomes = (date: string): ReadonlyArray<ChartMetric> => browserCheckOutcomes.map((outcome): ChartMetric => [
      outcomeLabels[outcome],
      numberFormatter(getDay(date).checksByOutcome.get(outcome) ?? 0),
    ]);
    const describeRequiredDay = (date: string): ReadonlyArray<ChartMetric> => [
      ...chartModel.flagSetValues
        .filter((value) => getRequiredByFlagSetValue(date).has(value))
        .map((value): ChartMetric => [value, numberFormatter(getRequiredByFlagSetValue(date).get(value) ?? 0)]),
      ...describeOutcomes(date),
    ];

    renderStackedBreakdownChart({
      svgElement: requiredSvgElement,
      bars: chartModel.dates.map((date) => ({
        key: date,
        countsByValue: getRequiredByFlagSetValue(date),
        notFinal: date === today,
      })),
      values: chartModel.flagSetValues,
      getValueColor: (value) => getMapColor(chartModel.flagSetColors, value),
      notes: inProgressNotes,
      yLabel: "Checks required",
      xLabel: "Date",
      formatTick: formatCompactDateLabel,
      getLabel: (date) => buildMetricsLabel(formatTitle(date), describeRequiredDay(date)),
      getTooltipHtml: (date) => buildMetricsTooltipHtml(formatTitle(date), describeRequiredDay(date)),
      tooltipHandlers,
    });
    renderStackedBreakdownChart({
      svgElement: outcomesSvgElement,
      bars: chartModel.dates.map((date) => ({
        key: date,
        // Only the stacked outcomes, because the shared chart scales its y-axis to the whole map and required dwarfs them.
        countsByValue: new Map(letThroughAndFailedOutcomes.map((outcome) => [outcome, getDay(date).checksByOutcome.get(outcome) ?? 0])),
        notFinal: date === today,
      })),
      values: letThroughAndFailedOutcomes,
      getValueColor: getOutcomeColor,
      notes: inProgressNotes,
      yLabel: "Requests",
      xLabel: "Date",
      formatTick: formatCompactDateLabel,
      getLabel: (date) => buildMetricsLabel(formatTitle(date), describeOutcomes(date)),
      getTooltipHtml: (date) => buildMetricsTooltipHtml(formatTitle(date), describeOutcomes(date)),
      tooltipHandlers,
    });
  }, [chartModel, inProgressNotes, today, tooltipHandlers]);

  return (
    <section className="dashboard-section">
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>Browser checks</h2>
          <ExplanationTip label="What Browser checks shows" explanationId="browser-checks-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> every decision of the browser check on new web guests, the Cloudflare Turnstile gate, per <strong>UTC</strong> day, from <code>analytics.guest_browser_checks</code>
                <ul>
                  <li>One count = one request decision, not a person: one browser can be asked for the check many times</li>
                  <li>Nothing is recorded while the check is not configured, so earlier days are empty</li>
                </ul>
              </li>
              <li>
                <strong>Outcomes</strong>
                <ul>
                  <li><strong>{outcomeLabels.required}:</strong> a server signal flagged the request and it carried no Turnstile token, so no guest was created and the browser was shown the check</li>
                  <li><strong>{outcomeLabels.passed}:</strong> flagged, and Cloudflare verified the token, so the guest was created; such a guest is not marked by the old-Chrome and burst scraper-fleet rules</li>
                  <li><strong>{outcomeLabels.failed}:</strong> Cloudflare rejected the token, or a bypass token was invalid</li>
                  <li><strong>Bypassed:</strong> a valid bypass token, which only our release smoke tests hold, flagged or not</li>
                  <li><strong>{outcomeLabels.allowed}:</strong> nothing flagged the request</li>
                </ul>
              </li>
              <li>
                <strong>Two charts, because required checks are mostly bots and outnumber the rest by far</strong>
                <ul>
                  <li><strong>Checks required:</strong> stacked by each check&rsquo;s set of flags, the {shownFlagSetLimit} most frequent in the range on their own and the rest in Other</li>
                  <li><strong>Guests created and failed checks:</strong> stacked by the other outcomes; both tooltips list all five</li>
                  <li><strong>By flag:</strong> range totals per single flag, so a check with several flags counts under each</li>
                </ul>
              </li>
              <li>
                <strong>Filters:</strong> only the date range applies; the shared exclusion rule and the other filters do not, because a decision is made before there is a person, mostly with no guest at all
              </li>
            </ul>
          </ExplanationTip>
        </div>
      </header>

      {latestReport === null ? null : (
        <section className="summary-grid">
          {browserCheckOutcomes.map((outcome) => (
            <article key={outcome} className="metric-card">
              <p className="metric-label">{outcomeLabels[outcome]}</p>
              <p className="metric-value">{numberFormatter(sumOutcome(latestReport, outcome))}</p>
            </article>
          ))}
        </section>
      )}

      <section className="chart-column">
        <div className="chart-shell">
          <div className="chart-meta">
            <span>Checks required per day &mdash; stacked by flags</span>
            <div className="chart-meta-right">
              {chartModel === null ? <ChartColorKeyPlaceholder /> : (
                <ChartColorKey
                  ariaLabel="Browser check flag set color key"
                  keys={chartModel.flagSetValues}
                  getColor={(value) => getMapColor(chartModel.flagSetColors, value)}
                  getLabel={(value) => value}
                />
              )}
              <ChartGeneratedAt generatedAtUtc={latestReport?.generatedAtUtc ?? null} />
            </div>
          </div>
          <div className="chart-scroll">
            {chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading…" />
            ) : <svg ref={requiredChartRef} />}
          </div>
          <ChartNotesKey notes={inProgressNotes} />
        </div>

        <div className="chart-shell">
          <div className="chart-meta">
            <span>Guests created and failed checks per day &mdash; stacked by outcome</span>
            <div className="chart-meta-right">
              <ChartColorKey
                ariaLabel="Browser check outcome color key"
                keys={letThroughAndFailedOutcomes}
                getColor={(outcome) => outcomeColors[outcome]}
                getLabel={(outcome) => outcomeLabels[outcome]}
              />
            </div>
          </div>
          <div className="chart-scroll">
            {chartModel === null ? (
              <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label="Loading…" />
            ) : <svg ref={outcomesChartRef} />}
          </div>
          <ChartNotesKey notes={inProgressNotes} />
        </div>

        <div className="chart-shell">
          {readyReport === null ? <p className="report-state" aria-live="polite">Loading…</p> : <BrowserCheckFlagsTable report={readyReport} />}
        </div>
      </section>

      <ChartTooltip {...tooltipState} />
    </section>
  );
}

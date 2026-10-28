import { Fragment, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import * as d3 from "d3";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartColorKey } from "../../charts/ChartLegends";
import { ChartLoadingPlaceholder } from "../../charts/ChartLoadingPlaceholder";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { buildFunnelComparisonTint, chartWidth, stackedChartHeight } from "../../charts/chartPrimitives";
import { escapeHtml, formatGeneratedAt } from "../../charts/formatting";
import { renderRateLineChart } from "../../charts/rateLineChart";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { formatFunnelRangeSeriesLabel, type FunnelRangeKey } from "../funnels/funnelRangeReports";
import {
  LevelOneMetricDetailsButton,
  type LevelOneMetricDetailsLink,
} from "../levelOneMetrics/LevelOneMetricDetailsLink";
import {
  buildAppOpenRetentionCurveSql,
  buildStudiedRetentionCurveSql,
  loadRetentionCurveReport,
  retentionCurveLastDay,
  type RetentionCurveCohortFilters,
  type RetentionCurveDay,
  type RetentionCurveReport,
} from "./query";

type RetentionCurveCopy = Readonly<{
  title: string;
  testId: string;
  buildSql: (dateRange: AnalyticsDateRange, cohortFilters: RetentionCurveCohortFilters, reportLabel: string) => string;
  /** The activity-specific `<li>` items of the (i) explanation. */
  explanation: ReactNode;
}>;

/** One range's curve: A is the selected range, B the comparison range. */
type RetentionCurveRange = Readonly<{
  key: FunnelRangeKey;
  /** `null` without a comparison, so a single curve reads as it always has. */
  seriesLabel: string | null;
  report: RetentionCurveReport;
}>;

/** Ready holds A first, then B when a comparison range is set. */
type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; ranges: ReadonlyArray<RetentionCurveRange> }>;

const studiedRetentionCurveCopy: RetentionCurveCopy = {
  title: "Who came back",
  testId: "retention-curve-studied",
  buildSql: buildStudiedRetentionCurveSql,
  explanation: <>
    <li>Day 0 is each person’s first-ever answered review, with any rating, on its UTC day.</li>
    <li>Active on day N means at least one answered review, with any rating, on exactly the UTC day N days after day 0. Opening the app or AI chat alone does not count.</li>
    <li>The same review history and actor exclusions as Who studied and Retention by first-use cohort: W1 and W4.</li>
  </>,
};

const appOpenRetentionCurveCopy: RetentionCurveCopy = {
  title: "Retention curve by days: opened the app",
  testId: "retention-curve-opened-the-app",
  buildSql: buildAppOpenRetentionCurveSql,
  explanation: <>
    <li>Day 0 is each person’s first recorded app open (<code>app_opened</code>) on iOS, Android, web or the agent API, on its UTC day.</li>
    <li>Active on day N means at least one app open on exactly the UTC day N days after day 0; reviews do not count.</li>
    <li>The same app-open history and actor exclusions as Who opened the app; early first opens are partly reconstructed, as there.</li>
  </>,
};

const tileDays: ReadonlyArray<number> = [1, 7, 30];
const dayKeys: ReadonlyArray<string> = d3.range(retentionCurveLastDay + 1).map((dayNumber) => `${dayNumber}`);
// B is a lighter tint of A, as in a funnel's range comparison, so the selected range stays the main line.
const curveColors: Readonly<Record<FunnelRangeKey, string>> = {
  a: "#4e79a7",
  b: buildFunnelComparisonTint("#4e79a7"),
};
const formatCount = d3.format(",d");
const formatRate = d3.format(".1%");

function getDay(report: RetentionCurveReport, dayNumber: number): RetentionCurveDay {
  const day = report.days[dayNumber];
  if (day === undefined) throw new Error(`Retention curve has no day ${dayNumber}.`);
  return day;
}

function getRate(day: RetentionCurveDay): number | null {
  return day.activeUsers === null ? null : day.activeUsers / day.eligibleUsers;
}

function describeUnavailableDay(day: RetentionCurveDay, report: RetentionCurveReport): string {
  return report.cohortUsers === 0
    ? "Unavailable: nobody has day 0 in the covered, complete days of this range."
    : `Unavailable: no cohort member’s day ${day.dayNumber} is complete through ${report.latestCompleteDate}.`;
}

function describeDay(day: RetentionCurveDay, report: RetentionCurveReport): string {
  return day.activeUsers === null
    ? describeUnavailableDay(day, report)
    : `${formatRate(day.activeUsers / day.eligibleUsers)} active (${formatCount(day.activeUsers)} / ${formatCount(day.eligibleUsers)} eligible).`;
}

/** `text` named by its range once two ranges share the card. */
function prefixRange(range: RetentionCurveRange, text: string): string {
  return range.seriesLabel === null ? text : `${range.key.toUpperCase()} ${text}`;
}

function buildDayTooltipMetricsHtml(day: RetentionCurveDay, report: RetentionCurveReport): string {
  return day.activeUsers === null
    ? `<p>${escapeHtml(describeUnavailableDay(day, report))}</p>`
    : [
      `<div class="tooltip-metric"><span>Active</span><strong>${escapeHtml(formatRate(day.activeUsers / day.eligibleUsers))}</strong></div>`,
      `<div class="tooltip-metric"><span>Active people</span><strong>${escapeHtml(formatCount(day.activeUsers))}</strong></div>`,
      `<div class="tooltip-metric"><span>Eligible people</span><strong>${escapeHtml(formatCount(day.eligibleUsers))}</strong></div>`,
    ].join("");
}

/** One value per range, A first. */
function RetentionCurveTile(props: Readonly<{
  label: string;
  entries: ReadonlyArray<Readonly<{ key: FunnelRangeKey; value: string; detail: string }>>;
}>): JSX.Element {
  return (
    <article className="metric-card">
      <p className="metric-label">{props.label}</p>
      {props.entries.map((entry) => (
        <Fragment key={entry.key}>
          <p className="metric-value">{entry.value}</p>
          <p className="metric-detail">{entry.detail}</p>
        </Fragment>
      ))}
    </article>
  );
}

type RetentionCurveSectionProps = Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  cohortFilters: RetentionCurveCohortFilters;
  /** Drawn as a second, lighter curve B; `null` is no comparison. */
  comparisonDateRange: AnalyticsDateRange | null;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>;

function RetentionCurveSection(props: RetentionCurveSectionProps & Readonly<{
  copy: RetentionCurveCopy;
  detailsLink: LevelOneMetricDetailsLink | null;
}>): JSX.Element {
  const { copy } = props;
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  useEffect(() => {
    let cancelled = false;
    const reportLabel = `${copy.title} report`;
    tooltipHandlers.hideTooltip();
    setState({ status: "loading" });
    const abortController = new AbortController();
    const requests: ReadonlyArray<Readonly<{ key: FunnelRangeKey; dateRange: AnalyticsDateRange }>> = props.comparisonDateRange === null
      ? [{ key: "a", dateRange: props.dateRange }]
      : [{ key: "a", dateRange: props.dateRange }, { key: "b", dateRange: props.comparisonDateRange }];
    void Promise.all(requests.map(async (request): Promise<RetentionCurveRange> => {
      const rangeLabel = `${reportLabel} on ${request.dateRange.from} – ${request.dateRange.to}`;
      const report = await loadRetentionCurveReport(
        props.config,
        copy.buildSql(request.dateRange, props.cohortFilters, rangeLabel),
        rangeLabel,
        abortController.signal,
      );
      return {
        key: request.key,
        seriesLabel: props.comparisonDateRange === null ? null : formatFunnelRangeSeriesLabel(request.key, request.dateRange),
        report,
      };
    })).then((ranges) => {
      if (!cancelled) setState({ status: "ready", ranges });
    }).catch((error: unknown) => {
      if (cancelled || props.onTerminalAdminError(error, props.config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${copy.title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [copy, props.config, props.dateRange, props.cohortFilters, props.comparisonDateRange, props.onTerminalAdminError, revision, tooltipHandlers]);
  useEffect(() => {
    if (chartRef.current === null || state.status !== "ready") return;
    const ranges = state.ranges;
    const getKeyDay = (range: RetentionCurveRange, key: string): RetentionCurveDay => getDay(range.report, Number(key));
    renderRateLineChart({
      svgElement: chartRef.current,
      keys: dayKeys,
      // B first, so A is drawn on top of it.
      lines: [...ranges].reverse().map((range) => ({ getRate: (key: string) => getRate(getKeyDay(range, key)), color: curveColors[range.key] })),
      inProgressKey: null,
      yLabel: "Cohort active that day",
      xLabel: "Days since day 0 (UTC)",
      notes: [],
      formatTick: (key) => `D${key}`,
      getLabel: (key) => `Day ${key}. ${ranges.map((range) => prefixRange(range, describeDay(getKeyDay(range, key), range.report))).join(" ")}`,
      getTooltipHtml: (key) => [
        `<p class="tooltip-title">Day ${escapeHtml(key)}</p>`,
        ...ranges.map((range) => [
          range.seriesLabel === null ? "" : `<p class="tooltip-subtitle">${escapeHtml(range.seriesLabel)}</p>`,
          buildDayTooltipMetricsHtml(getKeyDay(range, key), range.report),
        ].join("")),
      ].join(""),
      tooltipHandlers,
    });
  }, [state, tooltipHandlers]);
  const isComparing = state.status === "ready" && state.ranges.length > 1;
  const primaryRange = state.status === "ready" ? state.ranges[0] : undefined;
  return (
    <section className="dashboard-section" data-testid={`${copy.testId}-section`}>
      <header className="dashboard-section-header level-1-metric-section-header">
        <div className="explained-heading-row">
          <h2>{copy.title}</h2>
          <ExplanationTip label={`What ${copy.title} shows`} explanationId={`${copy.testId}-explanation`}>
            <ul>
              {copy.explanation}
              <li>Each point is the share of the people eligible on day N who were active that day. D0 is 100% by definition.</li>
              <li>A person is eligible on day N only once that day is a complete UTC day, so the eligible group shrinks towards D{retentionCurveLastDay} for recent day 0s. A day with nobody eligible is unavailable, never 0%.</li>
              <li>The date range selects day 0, using only covered, complete UTC days; activity after the range end still counts through the latest complete UTC day. One curve covers the whole range, so Group by does not change it.</li>
              <li>The platform, connection country and app interface language filters pick the cohort by first use: the platform is that of the event that is each person’s day 0, and a country or language keeps a person as it does on the funnels, over the same range. Activity on day N counts on any platform.</li>
              <li>A comparison range draws the same curve for the people whose day 0 falls in it, as a lighter line B; the tiles, tooltip and data table show A and B.</li>
              {primaryRange !== undefined ? <li>Generated {formatGeneratedAt(primaryRange.report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
        {props.detailsLink !== null ? <LevelOneMetricDetailsButton link={props.detailsLink} /> : null}
      </header>
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>{copy.title} query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <section className="summary-grid">
          <RetentionCurveTile
            label="Cohort"
            entries={state.ranges.map((range) => ({
              key: range.key,
              value: prefixRange(range, formatCount(range.report.cohortUsers)),
              detail: "People with day 0 in range",
            }))}
          />
          {tileDays.map((dayNumber) => (
            <RetentionCurveTile
              key={dayNumber}
              label={`D${dayNumber}`}
              entries={state.ranges.map((range) => {
                const day = getDay(range.report, dayNumber);
                return day.activeUsers === null
                  ? { key: range.key, value: prefixRange(range, "Unavailable"), detail: describeUnavailableDay(day, range.report) }
                  : { key: range.key, value: prefixRange(range, formatRate(day.activeUsers / day.eligibleUsers)), detail: `${formatCount(day.activeUsers)} / ${formatCount(day.eligibleUsers)} eligible` };
              })}
            />
          ))}
        </section>
      ) : null}
      {state.status === "error" ? null : (
        <section className="chart-column">
          <div className="chart-shell">
            <div className="chart-meta">
              <span>Share of the cohort active on day N · UTC</span>
              {state.status === "ready" && isComparing ? (
                <div className="chart-meta-right">
                  <ChartColorKey
                    ariaLabel={`${copy.title} color key`}
                    keys={state.ranges.map((range) => range.key)}
                    getColor={(key) => curveColors[key]}
                    getLabel={(key) => state.ranges.find((range) => range.key === key)?.seriesLabel ?? key}
                  />
                </div>
              ) : null}
            </div>
            <div className="chart-scroll">
              {state.status === "ready" ? (
                <ChartAreaWithNote
                  viewBoxWidth={chartWidth}
                  viewBoxHeight={stackedChartHeight}
                  note={state.ranges.every((range) => range.report.cohortUsers === 0)
                    ? `Nobody has day 0 in the covered, complete days of ${isComparing ? "either range" : "this range"}.`
                    : null}
                >
                  <svg ref={chartRef} role="group" aria-label={`${copy.title}: share of the cohort active on each day 0 to ${retentionCurveLastDay}`} />
                </ChartAreaWithNote>
              ) : <ChartLoadingPlaceholder viewBoxWidth={chartWidth} viewBoxHeight={stackedChartHeight} label={`Loading ${copy.title}…`} />}
            </div>
            {state.status === "ready" ? (
              <details className="activity-chart-table">
                <summary>Data table</summary>
                <div className="funnel-group-table-shell retention-curve-table-shell">
                  <table className="funnel-group-table retention-curve-table">
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        {state.ranges.map((range) => (
                          <Fragment key={range.key}>
                            <th scope="col">{prefixRange(range, "Eligible people")}</th>
                            <th scope="col">{prefixRange(range, "Active people")}</th>
                            <th scope="col">{prefixRange(range, "Active %")}</th>
                          </Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dayKeys.map((key) => (
                        <tr key={key}>
                          <th scope="row">D{key}</th>
                          {state.ranges.map((range) => {
                            const day = getDay(range.report, Number(key));
                            const rate = getRate(day);
                            return (
                              <Fragment key={range.key}>
                                <td>{formatCount(day.eligibleUsers)}</td>
                                <td>{day.activeUsers === null ? "—" : formatCount(day.activeUsers)}</td>
                                <td>{rate === null ? "Unavailable" : formatRate(rate)}</td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </div>
        </section>
      )}
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

/** Classic N-day retention of answered reviews over the whole selected range. */
export function StudiedRetentionCurveSection(props: RetentionCurveSectionProps & Readonly<{
  detailsLink: LevelOneMetricDetailsLink | null;
}>): JSX.Element {
  return <RetentionCurveSection {...props} copy={studiedRetentionCurveCopy} />;
}

/** Classic N-day retention of app opens over the whole selected range. */
export function AppOpenRetentionCurveSection(props: RetentionCurveSectionProps): JSX.Element {
  return <RetentionCurveSection {...props} copy={appOpenRetentionCurveCopy} detailsLink={null} />;
}

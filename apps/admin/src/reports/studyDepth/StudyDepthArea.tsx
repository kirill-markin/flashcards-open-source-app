import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { ChartAreaWithNote } from "../../charts/ChartAreaWithNote";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { chartWidth } from "../../charts/chartPrimitives";
import { formatGeneratedAt } from "../../charts/formatting";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { loadStudyDepthReport, studyDepthDayStartHour, type StudyDepthReport } from "./query";
import {
  buildReachBars,
  formatShare,
  minReliablePeopleCount,
  studyDepthReviewDayThresholds,
  studyDepthReviewThresholds,
  type ReachBar,
} from "./reachBars";
import { reachBarsChartHeight, renderReachBarsChart } from "./reachBarsChart";
import { buildStudyDepthMatrix } from "./reachMatrix";
import { StudyDepthMatrix } from "./StudyDepthMatrix";
import {
  parseStudyDepthControls,
  studyDepthMaturityDayOptions,
  writeStudyDepthControlsToUrl,
  type StudyDepthControls,
} from "./studyDepthUrl";
import "./studyDepth.css";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: StudyDepthReport }>;

const integerFormatter = new Intl.NumberFormat("en-US");

function ReachBarsExplanationItems(props: Readonly<{ unitLabel: string; thresholds: ReadonlyArray<number> }>): JSX.Element {
  return (
    <>
      <li>Each bar: the people in the cohort with at least that many {props.unitLabel} over their whole history up to now, as a count and a share of the cohort</li>
      <li>Fixed thresholds, so two selections compare bar by bar: {props.thresholds.join(", ")}</li>
      <li>Under the axis: the share of the previous bar that did not reach this one; the three largest drops are bold</li>
      <li>A bar with fewer than {minReliablePeopleCount} people, and the drop measured from it, is faded and never bold: too few people to read as a rate</li>
    </>
  );
}

function StudyDepthReachChart(
  props: Readonly<{
    title: string;
    subtitle: string;
    testId: string;
    explanation: ReactNode;
    unitLabel: string;
    bars: ReadonlyArray<ReachBar> | null;
    note: string | null;
  }>,
): JSX.Element {
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const chartRef = useRef<SVGSVGElement | null>(null);
  const { bars, unitLabel } = props;

  useEffect(() => {
    if (chartRef.current === null || bars === null) {
      return;
    }

    renderReachBarsChart({ svgElement: chartRef.current, bars, unitLabel, tooltipHandlers });
  }, [bars, tooltipHandlers, unitLabel]);

  return (
    <section className="chart-column study-depth-chart-column" data-testid={props.testId}>
      <div className="chart-shell">
        <div className="chart-meta">
          <div className="explained-heading-row">
            <h3>{props.title}</h3>
            <ExplanationTip label={`How the ${props.title} chart is counted`} explanationId={`${props.testId}-explanation`}>
              {props.explanation}
            </ExplanationTip>
          </div>
          <span className="chart-meta-right">{props.subtitle}</span>
        </div>
        <div className="chart-scroll">
          <div className="study-depth-chart">
            <ChartAreaWithNote viewBoxWidth={chartWidth} viewBoxHeight={reachBarsChartHeight} note={props.note}>
              {bars === null ? null : <svg ref={chartRef} role="group" aria-label={props.title} />}
            </ChartAreaWithNote>
          </div>
        </div>
      </div>
      <ChartTooltip {...tooltipState} />
    </section>
  );
}

/** The Study depth area: how far a cohort of people, placed by their first review, went on. */
export function StudyDepthArea(
  props: Readonly<{
    config: AdminAppConfig;
    filters: AnalyticsFilterState;
    /** The selection or its range is still settling; the area waits rather than querying a range it will drop. */
    isRangeLoading: boolean;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const [controls, setControls] = useState<StudyDepthControls>(
    () => parseStudyDepthControls(new URLSearchParams(window.location.search)),
  );

  const selectControls = useCallback((nextControls: StudyDepthControls): void => {
    setControls(nextControls);
    writeStudyDepthControlsToUrl(nextControls);
  }, []);

  const maturityDays = controls.maturityDays;
  const matrixMode = controls.matrixMode;

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) return () => { cancelled = true; };
    const abortController = new AbortController();
    void loadStudyDepthReport(props.config, props.filters, maturityDays, abortController.signal)
      .then((report) => {
        if (!cancelled) setLoadState({ status: "ready", report });
      })
      .catch((error: unknown) => {
        if (cancelled || props.onTerminalAdminError(error, props.config)) return;
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Unexpected Study depth query error.",
        });
      });
    return () => { cancelled = true; abortController.abort(); };
  }, [maturityDays, props.config, props.filters, props.isRangeLoading, props.onTerminalAdminError, revision]);

  const report = loadState.status === "ready" && !props.isRangeLoading ? loadState.report : null;
  const reviewBars = useMemo(() => (report === null || report.cohortPeopleCount === 0
    ? null
    : buildReachBars(report.cells, report.cohortPeopleCount, studyDepthReviewThresholds, (cell) => cell.reviewCount)), [report]);
  const reviewDayBars = useMemo(() => (report === null || report.cohortPeopleCount === 0
    ? null
    : buildReachBars(report.cells, report.cohortPeopleCount, studyDepthReviewDayThresholds, (cell) => cell.reviewDayCount)), [report]);
  const matrix = useMemo(() => (report === null || report.cohortPeopleCount === 0
    ? null
    : buildStudyDepthMatrix(report.cells, report.cohortPeopleCount, matrixMode)), [matrixMode, report]);
  const chartNote = report === null
    ? (loadState.status === "error" && !props.isRangeLoading ? null : "Loading study depth…")
    : report.cohortPeopleCount === 0
      ? `Nobody's first review falls inside this range at least ${maturityDays} days ago.`
      : null;
  const dayStart = `${String(studyDepthDayStartHour).padStart(2, "0")}:00`;

  return (
    <section className="dashboard-section" data-testid="study-depth-section">
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>Study depth</h2>
          <ExplanationTip label="Who Study depth counts" explanationId="study-depth-explanation">
            <ul>
              <li><strong>Cohort:</strong> the people whose first counted review falls inside the selected range and at least the chosen number of days ago, so everybody had that long to come back</li>
              <li>A person&rsquo;s reviews and review days count over their whole history up to now, not only inside the range</li>
              <li>A review is an answered card, including one answered through the AI chat or the machine API</li>
              <li>With a platform picked, only reviews on those platforms count, and a person&rsquo;s first review is their first one there. A review carries no country or language, so those two filters judge the person</li>
              <li>A review day is the local date in the time zone the review was saved with, starting at {dayStart}; a review saved without one is dated in UTC</li>
              <li>A guest and the account it became are one person. Test accounts, admins, automation and probable bots are left out</li>
              {report !== null ? <li>Generated {formatGeneratedAt(report.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>

      <div className="study-depth-controls">
        <h3 id="study-depth-maturity-title">Had at least N days to come back</h3>
        <div className="study-depth-control-modes" role="group" aria-labelledby="study-depth-maturity-title">
          {studyDepthMaturityDayOptions.map((option) => (
            <button
              key={option}
              className={option === maturityDays
                ? "filter-button filter-button-compact study-depth-mode-selected"
                : "filter-button filter-button-compact"}
              type="button"
              data-testid={`study-depth-maturity-${option}`}
              aria-pressed={option === maturityDays}
              disabled={props.isRangeLoading}
              onClick={() => selectControls({ ...controls, maturityDays: option })}
            >{option} days</button>
          ))}
        </div>
      </div>

      {report !== null ? (
        <p className="study-depth-summary" data-testid="study-depth-cohort">
          Cohort <strong>{integerFormatter.format(report.cohortPeopleCount)}</strong> people: first review
          from {props.filters.dateRange.from} to {props.filters.dateRange.to}, at least {maturityDays} days ago
        </p>
      ) : null}

      {!props.isRangeLoading && loadState.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>Study depth query failed.</strong><span>{loadState.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}

      <StudyDepthReachChart
        title="Reached at least N reviews"
        subtitle="People with at least N reviews in total; under the axis, the drop from the previous bar"
        testId="study-depth-reviews"
        unitLabel="reviews"
        bars={reviewBars}
        note={chartNote}
        explanation={<ul><ReachBarsExplanationItems unitLabel="reviews" thresholds={studyDepthReviewThresholds} /></ul>}
      />
      <StudyDepthReachChart
        title="Reached at least N review days"
        subtitle={`A review day is a local date in the time zone the review was saved with, starting at ${dayStart}`}
        testId="study-depth-review-days"
        unitLabel="review days"
        bars={reviewDayBars}
        note={chartNote}
        explanation={(
          <ul>
            <ReachBarsExplanationItems unitLabel="review days" thresholds={studyDepthReviewDayThresholds} />
            <li>A review day is the local date in the time zone the review was saved with, starting at {dayStart}, or the UTC date when none was saved</li>
          </ul>
        )}
      />
      <StudyDepthMatrix
        matrix={matrix}
        mode={matrixMode}
        onSelectMode={(nextMatrixMode) => selectControls({ ...controls, matrixMode: nextMatrixMode })}
        note={chartNote}
      />

      {report !== null && report.reviewCount > 0 ? (
        <p className="study-depth-note">
          {formatShare(report.noTimeZoneReviewCount / report.reviewCount)} of this cohort&rsquo;s reviews have no stored
          time zone, so their review day is the UTC date.
        </p>
      ) : null}
    </section>
  );
}

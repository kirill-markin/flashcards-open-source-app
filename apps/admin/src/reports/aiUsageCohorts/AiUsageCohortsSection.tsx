import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  AiUsagePanelPlaceholders,
  AiUsagePanels,
  formatCharRate,
  formatPeriodSpan,
  formatReviewRate,
  formatSharePercentage,
} from "./AiUsagePanels";
import {
  defaultAiUsageControls,
  parseAiUsageControls,
  writeAiUsageControlsToUrl,
  type AiUsageControls,
} from "./aiUsageCohortsUrl";
import { buildAiUsagePanels, type AiUsagePanel } from "./panels";
import { loadAiUsageCohortsReport, type AiUsageCohortsReport } from "./query";
import {
  aiUsageAudienceExplanations,
  aiUsageAudienceLabels,
  aiUsageAudiences,
  aiUsagePeriodWeekOptions,
  buildAiUsagePeriods,
  maxAiUsagePanelCount,
  minAiUsageExposureDays,
  type AiUsageAudience,
  type AiUsagePeriodWeeks,
} from "./reportModel";
import "./aiUsageCohorts.css";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: AiUsageCohortsReport }>;

const integerFormatter = new Intl.NumberFormat("en-US");

function ModeButtons<Value extends string | number>(
  props: Readonly<{
    title: string;
    /** Scopes this control's DOM id and test ids to the area, so neither can collide with another. */
    controlId: string;
    options: ReadonlyArray<Value>;
    selected: Value;
    isDisabled: boolean;
    buildLabel: (value: Value) => string;
    onSelect: (value: Value) => void;
  }>,
): JSX.Element {
  const titleId = `ai-usage-${props.controlId}-title`;
  return (
    <div className="ai-usage-control">
      <h3 id={titleId}>{props.title}</h3>
      <div className="ai-usage-control-modes" role="group" aria-labelledby={titleId}>
        {props.options.map((option) => (
          <button
            key={`${option}`}
            className={option === props.selected
              ? "filter-button filter-button-compact ai-usage-mode-selected"
              : "filter-button filter-button-compact"}
            type="button"
            data-testid={`ai-usage-${props.controlId}-${option}`}
            aria-pressed={option === props.selected}
            disabled={props.isDisabled}
            onClick={() => props.onSelect(option)}
          >{props.buildLabel(option)}</button>
        ))}
      </div>
    </div>
  );
}

function AiUsageSummaryTable(props: Readonly<{ panels: ReadonlyArray<AiUsagePanel> }>): JSX.Element {
  return (
    <table className="ai-usage-summary-table">
      <caption>One row per period, so the shift is readable without reading dots.</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          <th scope="col">People</th>
          <th scope="col">Never reviewed</th>
          <th scope="col">Median reviews/wk, reviewers only</th>
          <th scope="col">Median chat chars/wk, everyone</th>
        </tr>
      </thead>
      <tbody>
        {props.panels.map((panel) => (
          <tr key={panel.period.index}>
            <th scope="row">{panel.period.index + 1}. {formatPeriodSpan(panel.period)}</th>
            <td>{integerFormatter.format(panel.peopleCount)}</td>
            <td>
              {integerFormatter.format(panel.neverReviewedCount)}
              {" · "}
              {formatSharePercentage(panel.neverReviewedCount, panel.peopleCount)}
            </td>
            <td>{panel.medianReviewRateAmongReviewers === null
              ? "—"
              : formatReviewRate(panel.medianReviewRateAmongReviewers)}</td>
            <td>{panel.medianCharRate === null ? "—" : formatCharRate(panel.medianCharRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AiUsageResults(props: Readonly<{ report: AiUsageCohortsReport }>): JSX.Element {
  const report = props.report;
  const panels = useMemo(() => buildAiUsagePanels(report), [report]);

  if (panels.length === 0) {
    return (
      <p className="report-state">
        The selected range holds no whole period of this length. It covers {report.remainderDays} day
        {report.remainderDays === 1 ? "" : "s"}, and a period is not drawn until it is whole, because a
        short panel would read as a collapse rather than as a shorter window. Widen the range or pick a
        shorter period.
      </p>
    );
  }

  return (
    <>
      {report.droppedPeriodCount > 0 ? (
        <p className="report-state report-state-warning">
          This range holds {report.droppedPeriodCount + panels.length} whole periods and the
          {" "}{maxAiUsagePanelCount} most recent are drawn. The {report.droppedPeriodCount} oldest are
          not on screen: past roughly a dozen panels the squares are too small to compare, which is the
          only thing this report is for.
        </p>
      ) : null}
      {panels.length === 1 ? (
        <p className="report-state">
          This range holds one whole period, so there is one panel and nothing on screen to compare it
          with — and the comparison is the only thing this report is for. Small multiples start at two
          panels: widen the range, or pick a shorter period.
        </p>
      ) : null}
      <AiUsagePanels panels={panels} />
      <AiUsageSummaryTable panels={panels} />
      <p className="report-generated-at">Generated: {report.generatedAtUtc}</p>
    </>
  );
}

export function AiUsageCohortsSection(props: Readonly<{
  config: AdminAppConfig;
  /** The live selection, so this section answers a filter click even when a General report failed. */
  filters: AnalyticsFilterState;
  /** The shared selection is still settling after a filter change; this section waits it out rather than querying per click. */
  isRangeLoading: boolean;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  // The two controls open on whatever the URL asks for, the way a funnel's anchor does, and are
  // written straight back to it so a reload or a shared link reopens the same panels.
  const [controls, setControls] = useState<AiUsageControls>(
    () => (typeof window === "undefined"
      ? defaultAiUsageControls
      : parseAiUsageControls(new URLSearchParams(window.location.search))),
  );

  const selectControls = useCallback((nextControls: AiUsageControls): void => {
    setControls(nextControls);
    writeAiUsageControlsToUrl(nextControls);
  }, []);

  const periodWeeks = controls.periodWeeks;
  const audience = controls.audience;
  const loadingPeriods = useMemo(
    () => buildAiUsagePeriods(props.filters.dateRange, periodWeeks).periods,
    [periodWeeks, props.filters.dateRange],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) return () => { cancelled = true; };
    void loadAiUsageCohortsReport(props.config, props.filters, periodWeeks, audience)
      .then((report) => {
        if (!cancelled) setLoadState({ status: "ready", report });
      })
      .catch((error: unknown) => {
        if (cancelled || props.onTerminalAdminError(error, props.config)) return;
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Unexpected Study vs AI query error.",
        });
      });
    return () => { cancelled = true; };
  }, [
    audience,
    periodWeeks,
    props.config,
    props.filters,
    props.isRangeLoading,
    props.onTerminalAdminError,
    revision,
  ]);

  return (
    <section className="dashboard-section" data-testid="ai-usage-section">
      <header className="dashboard-section-header">
        <p className="eyebrow">Study vs AI</p>
        <div className="explained-heading-row">
          <h2>How much people study against how much AI text they use</h2>
          <ExplanationTip label="What Study vs AI shows" explanationId="ai-usage-explanation">
            <ul>
              <li>
                <strong>What it shows:</strong> one scatter panel per period, one dot per person in that period, after the shared exclusions
                <ul>
                  <li>
                    <strong>Horizontal:</strong> reviews per week
                    <ul>
                      <li>A review answered through the AI chat or the machine API counts too, so somebody who has the assistant review their cards moves right and up at once; part of the correlation on screen is that, not a habit</li>
                    </ul>
                  </li>
                  <li>
                    <strong>Vertical:</strong> characters of chat text per week
                    <ul>
                      <li>What the person typed plus what the model wrote back</li>
                      <li>Attachments, file uploads, tool calls and reasoning summaries excluded</li>
                    </ul>
                  </li>
                  <li>Both rates are per week of that person&rsquo;s own exposure inside the period, so somebody who arrived halfway through is not counted as idle</li>
                  <li>Every panel uses the same pair of scales, so the clouds are directly comparable</li>
                  <li>
                    <strong>Medians:</strong> vertical over everybody in the panel, horizontal only over the people who reviewed at all
                    <ul>
                      <li>Most people in a panel never review, so the true median review rate is zero, and a line in the zero strip would say nothing about how the people who study are studying</li>
                    </ul>
                  </li>
                </ul>
              </li>
              <li>
                <strong>Periods</strong>
                <ul>
                  <li>Equal-length and anchored at the recent end of the range, so the most recent one is always whole and leftover days fall off the old end rather than forming a short panel</li>
                  <li>
                    A person is in a period when they have any review or chat message inside it
                    <ul>
                      <li>Left out of a period they had fewer than {minAiUsageExposureDays} days of exposure in, counted from their first ever review or chat message</li>
                    </ul>
                  </li>
                  <li>No free period lengths: a length nobody else uses produces panels nobody can compare</li>
                </ul>
              </li>
              <li>
                <strong>Filters:</strong> the date range is the only shared one
                <ul>
                  <li>A chat message carries no platform, cohort, catalog click or locale of its own, and narrowing only the review half of every dot would move people across the chart instead of removing them</li>
                </ul>
              </li>
            </ul>
          </ExplanationTip>
        </div>
      </header>

      <div className="ai-usage-controls">
        <ModeButtons
          title="Period length"
          controlId="period-length"
          options={aiUsagePeriodWeekOptions}
          selected={periodWeeks}
          isDisabled={props.isRangeLoading}
          buildLabel={(weeks: AiUsagePeriodWeeks) => (weeks === 1 ? "1 week" : `${weeks} weeks`)}
          onSelect={(weeks: AiUsagePeriodWeeks) => selectControls({ ...controls, periodWeeks: weeks })}
        />
        <ModeButtons
          title="Who the panels count"
          controlId="audience"
          options={aiUsageAudiences}
          selected={audience}
          isDisabled={props.isRangeLoading}
          buildLabel={(mode: AiUsageAudience) => aiUsageAudienceLabels[mode]}
          onSelect={(mode: AiUsageAudience) => selectControls({ ...controls, audience: mode })}
        />
      </div>
      <p className="ai-usage-explanation" aria-live="polite">
        {aiUsageAudienceExplanations[audience]}
      </p>

      <div className="funnel-filter-panel">
        <span>{props.filters.dateRange.from} to {props.filters.dateRange.to}, inclusive</span>
      </div>

      {props.isRangeLoading || loadState.status === "loading"
        ? (loadingPeriods.length === 0
          ? <p className="report-state" aria-live="polite">Loading Study vs AI…</p>
          : <AiUsagePanelPlaceholders periods={loadingPeriods} />)
        : null}
      {!props.isRangeLoading && loadState.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>Study vs AI query failed.</strong><span>{loadState.message}</span>
          <button
            className="filter-button"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >Retry</button>
        </div>
      ) : null}
      {!props.isRangeLoading && loadState.status === "ready"
        ? <AiUsageResults report={loadState.report} />
        : null}
    </section>
  );
}

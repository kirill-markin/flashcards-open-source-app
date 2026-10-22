import { useMemo, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { getAnalyticsAreaPath } from "../../routing";
import { FunnelsLink } from "../funnels/FunnelsLink";
import type { FunnelReportProps } from "../funnels/funnelSections";
import { BreakdownSection } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import { useReviewPromptCoverage } from "./coverageQuery";
import { loadReviewPromptOutcomesReport, reviewPromptGroupByDimensions } from "./detailsQuery";
import { buildReviewPromptsAreaFilters } from "./ReviewPromptsArea";
import { ReviewPromptFunnelBreakdownSection, ReviewPromptFunnelSection } from "./ReviewPromptFunnelSections";
import {
  formatReviewPromptActedWindow,
  getReviewPrompt,
  reviewPromptGoneWindowDays,
  type ReviewPrompt,
  type ReviewPromptId,
} from "./reviewPromptDefinitions";

/** The back link and title above a prompt's Details page; the link keeps the query string. */
export function ReviewPromptDetailsHeader(
  props: Readonly<{ promptId: ReviewPromptId; onNavigate: (path: string) => void }>,
): JSX.Element {
  return (
    <header className="level-1-metric-details-header">
      <FunnelsLink
        className="state-link"
        path={getAnalyticsAreaPath("review-prompts")}
        testId="review-prompt-details-back"
        onNavigate={props.onNavigate}
      >← Review prompts</FunnelsLink>
      <h2 data-testid="review-prompt-details-title">{getReviewPrompt(props.promptId).title} details</h2>
    </header>
  );
}

function formatOutcome(value: string): string {
  return value;
}

/**
 * Showings per UTC day by outcome, on range A only. It reloads whenever its loader changes, so it
 * follows the selection only once that settles, and ignores the comparison range it never reads.
 */
function ReviewPromptOutcomesSection(props: FunnelReportProps & Readonly<{ prompt: ReviewPrompt }>): JSX.Element {
  const { prompt } = props;
  const requestKey = JSON.stringify({ ...props.filters, comparisonDateRange: null });
  const [settled, setSettled] = useState<Readonly<{ key: string; filters: AnalyticsFilterState }>>({ key: requestKey, filters: props.filters });
  if (props.isRangeLoading === false && settled.key !== requestKey) {
    setSettled({ key: requestKey, filters: props.filters });
  }

  const settledFilters = settled.filters;
  const loadReport = useMemo<BreakdownReportLoader>(
    () => (config, dateRange, period, signal) => loadReviewPromptOutcomesReport(config, { ...settledFilters, dateRange }, prompt.id, period, signal),
    [prompt.id, settledFilters],
  );

  return (
    <BreakdownSection
      config={props.config}
      dateRange={settledFilters.dateRange}
      period="day"
      onTerminalAdminError={props.onTerminalAdminError}
      title={`${prompt.title} showings by outcome`}
      testId="review-prompt-outcomes-section"
      explanationId="review-prompt-outcomes-explanation"
      explanation={<>
        <li>Every showing on its UTC day, in exactly one outcome, so a bar adds up to that day&rsquo;s showings; a comparison range is not drawn here.</li>
        {prompt.acted.kind === "rule"
          ? <li><strong>Acted:</strong> {prompt.acted.rule} within {formatReviewPromptActedWindow(prompt.acted.window)}.</li>
          : null}
        <li><strong>Maturing:</strong> not acted yet, while its Gone or Acted window is still open.</li>
        <li><strong>Gone:</strong> the same person neither opened the app nor answered a card for {reviewPromptGoneWindowDays} days after it.</li>
        <li><strong>Other:</strong> the person stayed without acting.</li>
      </>}
      countLabel="Showings"
      unavailableBarText="Unavailable."
      noAvailableBarText="No showings are available in this range."
      loadReport={loadReport}
      formatValue={formatOutcome}
      buildExtraNotes={null}
      keyLink={null}
    />
  );
}

/**
 * A prompt's Details page in the Level 1 grid: its funnel of showings, the funnel split by each
 * dimension, then its showings per day by outcome.
 */
export function ReviewPromptDetailsPage(
  props: Readonly<{
    promptId: ReviewPromptId;
    config: AdminAppConfig;
    filters: AnalyticsFilterState;
    isRangeLoading: boolean;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  const prompt = getReviewPrompt(props.promptId);
  const coverageLoad = useReviewPromptCoverage(props.config, props.onTerminalAdminError);
  // Memoized on the selection, because every card reloads whenever the object it is given changes.
  const filters = useMemo(
    () => ({ ...buildReviewPromptsAreaFilters(props.filters), comparisonDateRange: props.filters.comparisonDateRange }),
    [props.filters],
  );
  const cardProps: FunnelReportProps = {
    config: props.config,
    filters,
    isRangeLoading: props.isRangeLoading,
    onTerminalAdminError: props.onTerminalAdminError,
  };

  return (
    <div className="level-1-metrics-grid" data-testid="review-prompt-details">
      <ReviewPromptFunnelSection {...cardProps} prompt={prompt} coverageLoad={coverageLoad} />
      {reviewPromptGroupByDimensions.map((dimension) => (
        <ReviewPromptFunnelBreakdownSection key={dimension.id} {...cardProps} prompt={prompt} dimension={dimension} />
      ))}
      <ReviewPromptOutcomesSection {...cardProps} prompt={prompt} />
    </div>
  );
}

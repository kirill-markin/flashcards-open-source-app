import { useMemo, type JSX } from "react";
import { formatGeneratedAt } from "../../charts/formatting";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip, WarningTip } from "../../explanations/ExplanationTip";
import { buildDefaultAnalyticsFilterState, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import { useFunnelRangeReports } from "../funnels/funnelRangeReports";
import { loadReviewPromptsTable, type ReviewPromptCounts } from "./query";
import {
  buildReviewPromptWarnings,
  formatReviewPromptActedWindow,
  formatReviewPromptPlatforms,
  reviewPromptGoneWindowDays,
  reviewPrompts,
  type ReviewPrompt,
} from "./reviewPromptDefinitions";

const detailsButtonClassName = "filter-button filter-button-compact level-1-metric-details-link";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected review prompts error.";
}

/**
 * The selection with only the fields this area offers, so a value carried over from another area
 * cannot reload the table unseen.
 */
function buildReviewPromptsAreaFilters(filters: AnalyticsFilterState): AnalyticsFilterState {
  return {
    ...buildDefaultAnalyticsFilterState(filters.dateRange),
    eventPlatforms: filters.eventPlatforms,
    connectionCountries: filters.connectionCountries,
    appUiLanguages: filters.appUiLanguages,
  };
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

function ReviewPromptRow(props: Readonly<{
  prompt: ReviewPrompt;
  counts: ReviewPromptCounts;
  filters: AnalyticsFilterState;
}>): JSX.Element {
  const { prompt, counts } = props;
  const warnings = buildReviewPromptWarnings(prompt, counts, props.filters);
  const testId = `review-prompt-${prompt.id}`;

  return (
    <tr data-testid={`${testId}-row`}>
      <th scope="row" className="funnel-group-table-name">
        <div className="explained-heading-row">
          <span>{prompt.title}</span>
          {warnings.map((warning) => (
            <WarningTip
              key={warning.id}
              label={`${prompt.title} data warning`}
              explanationId={`${testId}-${warning.id}-warning`}
            >{warning.text}</WarningTip>
          ))}
        </div>
      </th>
      <td className="review-prompts-text-cell">{formatReviewPromptPlatforms(prompt)}</td>
      <td className="review-prompts-text-cell review-prompts-rule-cell">
        {prompt.acted.kind === "rule"
          ? `${prompt.acted.rule} within ${formatReviewPromptActedWindow(prompt.acted.window)}`
          : "Not reported"}
      </td>
      <td>{formatCount(counts.shownCount)}</td>
      <td>
        {prompt.acted.kind === "rule" ? formatCount(counts.actedCount) : (
          <div className="explained-heading-row">
            <span>—</span>
            <ExplanationTip label={`Why ${prompt.title} has no Acted count`} explanationId={`${testId}-acted-explanation`}>
              {prompt.acted.reason}
            </ExplanationTip>
          </div>
        )}
      </td>
      <td>{formatCount(counts.goneCount)}</td>
      <td>
        {/* The hint sits on a wrapper, because some browsers show no tooltip for a disabled control. */}
        <span title="Coming soon">
          <button className={detailsButtonClassName} type="button" data-testid={`${testId}-details-button`} disabled>Details</button>
        </span>
      </td>
    </tr>
  );
}

/** The Review prompts area: one row per prompt that can appear after a review. */
export function ReviewPromptsArea(
  props: Readonly<{
    config: AdminAppConfig;
    filters: AnalyticsFilterState;
    isReportLoading: boolean;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  // Memoized on the selection, because the table reloads whenever the object it is given changes.
  const filters = useMemo(() => buildReviewPromptsAreaFilters(props.filters), [props.filters]);
  const { state, retry } = useFunnelRangeReports(
    {
      config: props.config,
      filters,
      isRangeLoading: props.isReportLoading,
      onTerminalAdminError: props.onTerminalAdminError,
    },
    loadReviewPromptsTable,
    getErrorMessage,
  );
  const table = state.status === "ready" ? state.ranges[0]?.report ?? null : null;

  return (
    <section className="dashboard-section" data-testid="review-prompts-section">
      <header className="dashboard-section-header">
        <div className="explained-heading-row">
          <h2>Review prompts</h2>
          <ExplanationTip label="How Review prompts are counted" explanationId="review-prompts-explanation">
            <ul>
              <li><strong>Shown:</strong> showings on the selected UTC days, so one person shown a prompt twice counts twice. The rating request counts requests sent to Apple or Google, which decide on their own whether a dialog appears.</li>
              <li><strong>Acted:</strong> showings followed by that prompt&rsquo;s rule, by the same person and inside its window, which can end after the last selected day.</li>
              <li><strong>Gone:</strong> showings after which the same person neither opened the app nor answered a card for {reviewPromptGoneWindowDays} days. Showings younger than that with neither yet are left out until their days pass.</li>
              <li>A guest and the account it became are one person. Test accounts, admins and excluded actors are left out, and a showing counts only on its prompt&rsquo;s platforms from their first counted day.</li>
              {table !== null ? <li>Generated {formatGeneratedAt(table.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>

      {state.status === "loading" ? <p className="report-state" aria-live="polite">Loading review prompts…</p> : null}
      {state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>Review prompts query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={retry}>Retry</button>
        </div>
      ) : null}
      {table !== null ? (
        <table className="funnel-group-table review-prompts-table">
          <thead>
            <tr>
              <th scope="col">Prompt</th>
              <th scope="col">Platforms</th>
              <th scope="col">Acted when</th>
              <th scope="col">Shown</th>
              <th scope="col">Acted</th>
              <th scope="col">Gone</th>
              <th scope="col"><span className="visually-hidden">Details</span></th>
            </tr>
          </thead>
          <tbody>
            {reviewPrompts.map((prompt) => (
              <ReviewPromptRow key={prompt.id} prompt={prompt} counts={table.counts[prompt.id]} filters={filters} />
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

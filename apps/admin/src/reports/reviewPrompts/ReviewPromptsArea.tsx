import { useMemo, useState, type JSX } from "react";
import { formatGeneratedAt } from "../../charts/formatting";
import type { AdminAppConfig } from "../../config";
import { ExplanationTip, WarningTip } from "../../explanations/ExplanationTip";
import { buildDefaultAnalyticsFilterState, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import { getReviewPromptDetailsPath } from "../../routing";
import { FunnelsLink } from "../funnels/FunnelsLink";
import { useFunnelRangeReports } from "../funnels/funnelRangeReports";
import { useReviewPromptCoverage } from "./coverageQuery";
import { loadReviewPromptsTable, type ReviewPromptCounts } from "./query";
import {
  buildReviewPromptWarnings,
  formatReviewPromptActedWindow,
  formatReviewPromptPlatforms,
  reviewPromptConfigVersion,
  reviewPromptGoneWindowDays,
  reviewPrompts,
  type ReviewPrompt,
  type ReviewPromptConfigRules,
  type ReviewPromptCoverage,
} from "./reviewPromptDefinitions";

const detailsButtonClassName = "filter-button filter-button-compact level-1-metric-details-link";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected review prompts error.";
}

/**
 * The selection with only the fields this area offers, so a value carried over from another area
 * cannot reload the table unseen.
 */
export function buildReviewPromptsAreaFilters(filters: AnalyticsFilterState): AnalyticsFilterState {
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

function formatSetting(value: number | undefined): string {
  return value === undefined ? "—" : formatCount(value);
}

function formatCooldown(days: number | undefined): string {
  return days === undefined ? "—" : days === 1 ? "1 day" : `${formatCount(days)} days`;
}

/** A count from the table query: a spinner while it runs, and a dash once it failed. */
function ReviewPromptCount(props: Readonly<{ count: number | null; isLoading: boolean }>): JSX.Element {
  if (props.isLoading) {
    return (
      <span>
        <span className="review-prompts-count-spinner" aria-hidden="true" />
        <span className="visually-hidden">Loading</span>
      </span>
    );
  }

  return <span>{props.count === null ? "—" : formatCount(props.count)}</span>;
}

function ReviewPromptConfigCells(props: Readonly<{ rules: ReviewPromptConfigRules }>): JSX.Element {
  if (props.rules.kind === "never") {
    return <td colSpan={4} className="review-prompts-never-cell">{props.rules.reason}</td>;
  }

  const { settings } = props.rules;
  return (
    <>
      <td>{formatSetting(settings.minTotalReviews)}</td>
      <td>{formatSetting(settings.minReviewsToday)}</td>
      <td>{formatSetting(settings.minReviewDays)}</td>
      <td>{formatCooldown(settings.cooldownDays)}</td>
    </>
  );
}

function ReviewPromptRow(props: Readonly<{
  prompt: ReviewPrompt;
  /** `null` while the table query runs or after it failed. */
  counts: ReviewPromptCounts | null;
  isCountsLoading: boolean;
  /** `null` while the coverage query runs or after it failed. */
  coverage: ReviewPromptCoverage | null;
  filters: AnalyticsFilterState;
  openWarningId: string | null;
  onOpenWarningIdChange: (update: (current: string | null) => string | null) => void;
  onNavigate: (path: string) => void;
}>): JSX.Element {
  const { prompt, counts } = props;
  // Shown only once both queries are in, because coverage contributes notes of its own.
  const warnings = counts !== null && props.coverage !== null
    ? buildReviewPromptWarnings(prompt, counts, props.coverage, props.filters)
    : [];
  const testId = `review-prompt-${prompt.id}`;

  return (
    <tr data-testid={`${testId}-row`}>
      <td>
        <FunnelsLink
          className={detailsButtonClassName}
          path={getReviewPromptDetailsPath(prompt.id)}
          testId={`${testId}-details-button`}
          onNavigate={props.onNavigate}
        >Details</FunnelsLink>
      </td>
      <th scope="row" className="funnel-group-table-name">
        <div className="explained-heading-row">
          <span>{prompt.title}</span>
          {warnings.map((warning) => {
            const warningId = `${prompt.id}-${warning.id}`;
            return (
              <WarningTip
                key={warning.id}
                label={`${prompt.title} data warning: ${warning.label}`}
                explanationId={`${testId}-${warning.id}-warning`}
                isOpen={props.openWarningId === warningId}
                onOpenChange={(isOpen) => props.onOpenWarningIdChange((current) => (
                  isOpen ? warningId : current === warningId ? null : current
                ))}
              >{warning.text}</WarningTip>
            );
          })}
        </div>
      </th>
      <td><ReviewPromptCount count={counts?.shownCount ?? null} isLoading={props.isCountsLoading} /></td>
      <td>
        {prompt.acted.kind === "rule" ? (
          <div className="explained-heading-row">
            <ReviewPromptCount count={counts?.actedCount ?? null} isLoading={props.isCountsLoading} />
            <ExplanationTip label={`When ${prompt.title} counts as Acted`} explanationId={`${testId}-acted-explanation`}>
              {prompt.acted.rule} within {formatReviewPromptActedWindow(prompt.acted.window)}
            </ExplanationTip>
          </div>
        ) : (
          <div className="explained-heading-row">
            <span>—</span>
            <ExplanationTip label={`Why ${prompt.title} has no Acted count`} explanationId={`${testId}-acted-explanation`}>
              {prompt.acted.reason}
            </ExplanationTip>
          </div>
        )}
      </td>
      <td><ReviewPromptCount count={counts?.goneCount ?? null} isLoading={props.isCountsLoading} /></td>
      <td className="review-prompts-text-cell">{formatReviewPromptPlatforms(prompt)}</td>
      <ReviewPromptConfigCells rules={prompt.configRules} />
      <td className="review-prompts-text-cell review-prompts-rule-cell">{prompt.fixedRule}</td>
    </tr>
  );
}

/** The Review prompts area: one row per prompt that can appear after a review. */
export function ReviewPromptsArea(
  props: Readonly<{
    config: AdminAppConfig;
    filters: AnalyticsFilterState;
    isReportLoading: boolean;
    onNavigate: (path: string) => void;
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
  const coverageLoad = useReviewPromptCoverage(props.config, props.onTerminalAdminError);
  const isCountsLoading = state.status === "loading";
  const table = state.status === "ready" ? state.ranges[0]?.report ?? null : null;
  const coverage = coverageLoad.state.status === "ready" ? coverageLoad.state.coverage : null;
  const failure = state.status === "error"
    ? { message: state.message, retry }
    : coverageLoad.state.status === "error" ? { message: coverageLoad.state.message, retry: coverageLoad.retry } : null;
  // One warning text open at a time across the whole table.
  const [openWarningId, setOpenWarningId] = useState<string | null>(null);

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
              <li>A guest and the account it became are one person. Test accounts, admins and excluded actors are left out, and a showing counts only on its prompt&rsquo;s platforms.</li>
              <li>A platform&rsquo;s first report of a prompt is the first day its events arrived, so a test build can make it a few days early.</li>
              {table !== null ? <li>Generated {formatGeneratedAt(table.generatedAtUtc)}.</li> : null}
            </ul>
          </ExplanationTip>
        </div>
      </header>

      {failure !== null ? (
        <div className="report-state report-state-error">
          <strong>Review prompts query failed.</strong><span>{failure.message}</span>
          <button className="filter-button" type="button" onClick={failure.retry}>Retry</button>
        </div>
      ) : null}
      <div className="funnel-group-table-shell">
        <table className="funnel-group-table review-prompts-table" aria-busy={isCountsLoading}>
          <thead>
            <tr>
              <th scope="col"><span className="visually-hidden">Details</span></th>
              <th scope="col">Prompt</th>
              <th scope="col">Shown</th>
              <th scope="col">Acted</th>
              <th scope="col">Gone</th>
              <th scope="col" className="review-prompts-text-cell">Platforms</th>
              <th scope="col">Total reviews ≥</th>
              <th scope="col">Reviews today ≥</th>
              <th scope="col">Review days ≥</th>
              <th scope="col">Cooldown</th>
              <th scope="col" className="review-prompts-text-cell">Fixed in code</th>
            </tr>
          </thead>
          <tbody>
            {reviewPrompts.map((prompt) => (
              <ReviewPromptRow
                key={prompt.id}
                prompt={prompt}
                counts={table === null ? null : table.counts[prompt.id]}
                isCountsLoading={isCountsLoading}
                coverage={coverage}
                filters={filters}
                openWarningId={openWarningId}
                onOpenWarningIdChange={setOpenWarningId}
                onNavigate={props.onNavigate}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="review-prompts-config-version">Config version {reviewPromptConfigVersion}</p>
    </section>
  );
}

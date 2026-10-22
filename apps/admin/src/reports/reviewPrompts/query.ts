import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { assertIsString, toInteger } from "../reportValues";
import { reviewPromptIds, type ReviewPromptId } from "./reviewPromptDefinitions";
import { buildReviewPromptShowingsCtes } from "./showingsSql";

const reportLabel = "Review prompts";

export type ReviewPromptCounts = Readonly<{
  shownCount: number;
  actedCount: number;
  goneCount: number;
  maturingCount: number;
  actedPendingCount: number;
}>;

export type ReviewPromptsTable = Readonly<{
  generatedAtUtc: string;
  counts: Readonly<Record<ReviewPromptId, ReviewPromptCounts>>;
}>;

const emptyCounts: ReviewPromptCounts = {
  shownCount: 0,
  actedCount: 0,
  goneCount: 0,
  maturingCount: 0,
  actedPendingCount: 0,
};

export function buildReviewPromptsTableSql(filters: AnalyticsFilterState): string {
  return `${buildReviewPromptShowingsCtes(filters)}
SELECT showing.prompt_id,
  COUNT(*)::int AS shown_count,
  (COUNT(*) FILTER (WHERE showing.acted))::int AS acted_count,
  (COUNT(*) FILTER (WHERE showing.gone_state = 'gone'))::int AS gone_count,
  (COUNT(*) FILTER (WHERE showing.gone_state = 'maturing'))::int AS maturing_count,
  (COUNT(*) FILTER (WHERE showing.acted_settles_at > now()))::int AS acted_pending_count
FROM showings AS showing
GROUP BY showing.prompt_id`;
}

function parsePromptId(value: string): ReviewPromptId {
  const promptId = reviewPromptIds.find((candidate) => candidate === value);
  if (promptId === undefined) {
    throw new Error(`${reportLabel} returned an unknown prompt_id "${value}".`);
  }

  return promptId;
}

/** Every prompt's counts for the selection; a prompt nobody was shown counts zero. */
export async function loadReviewPromptsTable(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  signal: AbortSignal,
): Promise<ReviewPromptsTable> {
  const response = await runAdminQuery(config, buildReviewPromptsTableSql(filters), signal);
  if (response.resultSets.length !== 1) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  const counts: Record<ReviewPromptId, ReviewPromptCounts> = Object.fromEntries(
    reviewPromptIds.map((promptId) => [promptId, emptyCounts]),
  ) as Record<ReviewPromptId, ReviewPromptCounts>;
  for (const row of response.resultSets[0]?.rows ?? []) {
    const count = (fieldName: string): number => toInteger(row[fieldName] ?? null, reportLabel, fieldName);
    counts[parsePromptId(assertIsString(row.prompt_id ?? null, reportLabel, "prompt_id"))] = {
      shownCount: count("shown_count"),
      actedCount: count("acted_count"),
      goneCount: count("gone_count"),
      maturingCount: count("maturing_count"),
      actedPendingCount: count("acted_pending_count"),
    };
  }

  return { generatedAtUtc: response.executedAtUtc, counts };
}

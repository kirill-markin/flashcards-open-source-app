import type { FsrsStateSnapshot, TimestampValue } from "../../../cards/types";
import type { DatabaseExecutor } from "../../../database";
import type { ReviewRating } from "../../../scheduling";
import { loadWorkspaceSchedulerSettingsInExecutor } from "../../../scheduling/workspaceSettings";
import type { WorkspaceSchedulerConfig } from "../../../scheduling/workspaceConfig";

type AnkiExportCardState = FsrsStateSnapshot & Readonly<{ card_id: string }>;

export type AnkiExportReview = Readonly<{
  card_id: string;
  rating: ReviewRating;
  reviewed_at_client: TimestampValue;
  matches_last_review: boolean;
  in_current_run: boolean;
}>;

export type AnkiStudyProgress = Readonly<{
  settings: WorkspaceSchedulerConfig;
  cards: ReadonlyMap<string, AnkiExportCardState>;
  reviews: ReadonlyArray<AnkiExportReview>;
}>;

export async function loadAnkiStudyProgressInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardIds: ReadonlyArray<string>,
): Promise<AnkiStudyProgress> {
  const settings = await loadWorkspaceSchedulerSettingsInExecutor(executor, workspaceId);
  const cards = await executor.query<AnkiExportCardState>(
    [
      "SELECT card_id, due_at, reps, lapses, fsrs_card_state, fsrs_step_index, fsrs_stability,",
      "fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days",
      "FROM content.cards WHERE workspace_id = $1 AND card_id = ANY($2::uuid[])",
    ].join(" "),
    [workspaceId, cardIds],
  );
  const reviews = await executor.query<AnkiExportReview>(
    [
      "SELECT e.card_id, e.rating, e.reviewed_at_client,",
      "(e.reviewed_at_client IS NOT DISTINCT FROM c.fsrs_last_reviewed_at) AS matches_last_review,",
      "(c.fsrs_last_reviewed_at IS NOT NULL AND e.reviewed_at_client <= c.fsrs_last_reviewed_at",
      "AND (c.maintenance_reset_at IS NULL OR e.reviewed_at_client > c.maintenance_reset_at)) AS in_current_run",
      "FROM content.review_events e JOIN content.cards c USING (workspace_id, card_id)",
      "WHERE e.workspace_id = $1 AND e.card_id = ANY($2::uuid[])",
      "ORDER BY e.reviewed_at_client, e.review_sequence",
    ].join(" "),
    [workspaceId, cardIds],
  );
  return { settings, cards: new Map(cards.rows.map((card) => [card.card_id, card])), reviews: reviews.rows };
}

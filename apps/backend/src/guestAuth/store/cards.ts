import type { EffortLevel } from "../../cards";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import type { FsrsCardState } from "../../scheduling";

type CardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  tags: ReadonlyArray<string>;
  effort_level: string;
  due_at: Date | string | null;
  created_at: Date | string;
  reps: number;
  lapses: number;
  fsrs_card_state: string;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: Date | string | null;
  fsrs_scheduled_days: number | null;
  client_updated_at: Date | string;
  last_modified_by_replica_id: string;
  last_operation_id: string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}>;

export type GuestCardRecord = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
  dueAt: Date | string | null;
  createdAt: Date | string;
  reps: number;
  lapses: number;
  fsrsCardState: FsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: Date | string | null;
  fsrsScheduledDays: number | null;
  clientUpdatedAt: Date | string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}>;

function mapGuestCardRecord(row: CardRow): GuestCardRecord {
  return {
    cardId: row.card_id,
    frontText: row.front_text,
    backText: row.back_text,
    tags: row.tags,
    effortLevel: row.effort_level as EffortLevel,
    dueAt: row.due_at,
    createdAt: row.created_at,
    reps: row.reps,
    lapses: row.lapses,
    fsrsCardState: row.fsrs_card_state as FsrsCardState,
    fsrsStepIndex: row.fsrs_step_index,
    fsrsStability: row.fsrs_stability,
    fsrsDifficulty: row.fsrs_difficulty,
    fsrsLastReviewedAt: row.fsrs_last_reviewed_at,
    fsrsScheduledDays: row.fsrs_scheduled_days,
    clientUpdatedAt: row.client_updated_at,
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: row.last_operation_id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function loadGuestCardsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<GuestCardRecord>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<CardRow>(
    [
      "SELECT",
      "card_id, front_text, back_text, tags, effort_level, due_at, created_at, reps, lapses,",
      "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
      "client_updated_at, last_modified_by_replica_id, last_operation_id, updated_at, deleted_at",
      "FROM content.cards",
      "WHERE workspace_id = $1",
      "ORDER BY created_at ASC, card_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows.map(mapGuestCardRecord);
}

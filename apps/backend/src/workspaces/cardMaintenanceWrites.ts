import { randomUUID } from "node:crypto";
import { CARD_COLUMNS, mapCard, recordCardSyncChange } from "../cards/shared";
import type { CardRow } from "../cards/types";
import type { DatabaseExecutor } from "../database";
import { HttpError } from "../shared/errors";
import { ensureSystemWorkspaceReplicaInExecutor } from "../sync/identity/replica";
import type { HotChangeWriteLock } from "../sync/replication/changes";

const cardMaintenanceWriteMetadataSql = [
  "client_updated_at = GREATEST($1::timestamptz, date_trunc('milliseconds', client_updated_at) + interval '1 millisecond'),",
  "last_modified_by_replica_id = $2, last_operation_id = $3, updated_at = now()",
].join(" ");

export async function ensureCardMaintenanceReplicaInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  actorKey: "reset-progress" | "remove-tag",
): Promise<string> {
  return ensureSystemWorkspaceReplicaInExecutor(executor, {
    workspaceId,
    userId,
    actorKind: "workspace_reset",
    actorKey,
    platform: "system",
    appVersion: null,
    signal: null,
  });
}

export async function resetCardProgressInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  hotChangeWriteLock: HotChangeWriteLock,
  replicaId: string,
  cardId: string,
): Promise<void> {
  const clientUpdatedAt = new Date().toISOString();
  const operationId = randomUUID();

  const result = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      "SET due_at = NULL, reps = 0, lapses = 0, fsrs_card_state = 'new', fsrs_step_index = NULL,",
      "fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_last_reviewed_at = NULL, fsrs_scheduled_days = NULL,",
      cardMaintenanceWriteMetadataSql,
      "WHERE workspace_id = $4 AND card_id = $5 AND deleted_at IS NULL",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [clientUpdatedAt, replicaId, operationId, workspaceId, cardId],
  );

  const updatedCardRow = result.rows[0];
  if (updatedCardRow === undefined) {
    throw new HttpError(404, "Card not found");
  }

  const updatedCard = mapCard(updatedCardRow);
  await recordCardSyncChange(executor, workspaceId, hotChangeWriteLock, updatedCard);
}

export async function removeCardTagsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  hotChangeWriteLock: HotChangeWriteLock,
  replicaId: string,
  cardId: string,
  tags: ReadonlyArray<string>,
): Promise<void> {
  const result = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      "SET tags = ARRAY(SELECT tag FROM unnest(tags) WITH ORDINALITY AS entries(tag, position)",
      "WHERE (tag = ANY($5::text[])) IS NOT TRUE ORDER BY position),",
      cardMaintenanceWriteMetadataSql,
      "WHERE workspace_id = $4 AND card_id = $6 AND deleted_at IS NULL",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [new Date().toISOString(), replicaId, randomUUID(), workspaceId, tags, cardId],
  );
  const updatedCard = result.rows[0];
  if (updatedCard === undefined) {
    throw new Error("Tag removal did not update the selected card");
  }

  await recordCardSyncChange(executor, workspaceId, hotChangeWriteLock, mapCard(updatedCard));
}

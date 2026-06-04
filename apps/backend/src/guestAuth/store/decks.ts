import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import type { DeckFilterDefinition } from "../../decks";

type DeckRow = Readonly<{
  deck_id: string;
  name: string;
  filter_definition: Readonly<Record<string, unknown>>;
  created_at: Date | string;
  client_updated_at: Date | string;
  last_modified_by_replica_id: string;
  last_operation_id: string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}>;

export type GuestDeckRecord = Readonly<{
  deckId: string;
  name: string;
  filterDefinition: DeckFilterDefinition;
  createdAt: Date | string;
  clientUpdatedAt: Date | string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}>;

function mapGuestDeckRecord(row: DeckRow): GuestDeckRecord {
  return {
    deckId: row.deck_id,
    name: row.name,
    filterDefinition: row.filter_definition as DeckFilterDefinition,
    createdAt: row.created_at,
    clientUpdatedAt: row.client_updated_at,
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: row.last_operation_id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function loadGuestDecksInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<GuestDeckRecord>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<DeckRow>(
    [
      "SELECT",
      "deck_id, name, filter_definition, created_at, client_updated_at,",
      "last_modified_by_replica_id, last_operation_id, updated_at, deleted_at",
      "FROM content.decks",
      "WHERE workspace_id = $1",
      "ORDER BY created_at ASC, deck_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows.map(mapGuestDeckRecord);
}

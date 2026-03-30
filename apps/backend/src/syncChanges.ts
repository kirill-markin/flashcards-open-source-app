import type { DatabaseExecutor } from "./db";
import { normalizeIsoTimestamp } from "./lww";

export type SyncEntityType = "card" | "deck" | "workspace_scheduler_settings";
export type SyncChangeAction = "upsert";

type ChangeIdRow = Readonly<{
  change_id: string | number;
}>;

type WorkspaceSyncMetadataRow = Readonly<{
  min_available_hot_change_id: string | number;
}>;

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

/**
 * Ensures the workspace-scoped sync metadata row exists before hot-state reads
 * or writes touch the workspace. This keeps cursor-expiry checks and retention
 * floor updates explicit instead of relying on hidden insert side effects.
 */
export async function ensureWorkspaceSyncMetadataInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at)",
      "VALUES ($1, 0, now())",
      "ON CONFLICT (workspace_id) DO NOTHING",
    ].join(" "),
    [workspaceId],
  );
}

/**
 * Records one mutable-root winner in the compact hot-state change log. Review
 * history is intentionally excluded from this lane and syncs through its own
 * append-only cursor.
 */
export async function insertSyncChange(
  executor: DatabaseExecutor,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
  action: SyncChangeAction,
  replicaId: string,
  operationId: string,
  clientUpdatedAt: string,
): Promise<number> {
  await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);

  const result = await executor.query<ChangeIdRow>(
    [
      "INSERT INTO sync.hot_changes",
      "(",
      "workspace_id, entity_type, entity_id, action, replica_id, operation_id, client_updated_at",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7)",
      "RETURNING change_id",
    ].join(" "),
    [
      workspaceId,
      entityType,
      entityId,
      action,
      replicaId,
      operationId,
      normalizeIsoTimestamp(clientUpdatedAt, "clientUpdatedAt"),
    ],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Hot sync change insert did not return change_id");
  }

  return toNumber(row.change_id);
}

/**
 * Loads the latest hot-state cursor that currently represents one mutable sync
 * root. Callers use this when an incoming LWW mutation loses so the push ACK
 * can still point clients at the canonical winner.
 */
export async function findLatestSyncChangeId(
  executor: DatabaseExecutor,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
): Promise<number | null> {
  const result = await executor.query<ChangeIdRow>(
    [
      "SELECT change_id",
      "FROM sync.hot_changes",
      "WHERE workspace_id = $1 AND entity_type = $2 AND entity_id = $3",
      "ORDER BY change_id DESC",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, entityType, entityId],
  );

  const row = result.rows[0];
  return row === undefined ? null : toNumber(row.change_id);
}

/**
 * Returns the oldest hot cursor still guaranteed to be pullable for the
 * workspace. Clients older than this floor must re-bootstrap from canonical
 * current-state tables instead of replaying an expired hot log.
 */
export async function loadMinAvailableHotChangeId(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<number> {
  await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);

  const result = await executor.query<WorkspaceSyncMetadataRow>(
    [
      "SELECT min_available_hot_change_id",
      "FROM sync.workspace_sync_metadata",
      "WHERE workspace_id = $1",
      "LIMIT 1",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Workspace sync metadata row is missing");
  }

  return toNumber(row.min_available_hot_change_id);
}

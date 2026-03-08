import type { DatabaseExecutor } from "./db";

export type SyncEntityType = "card" | "deck" | "workspace_scheduler_settings" | "review_event";
export type SyncChangeAction = "upsert" | "append";

type ChangeIdRow = Readonly<{
  change_id: string | number;
}>;

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

export async function insertSyncChange(
  executor: DatabaseExecutor,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
  action: SyncChangeAction,
  deviceId: string,
  operationId: string,
  payloadJson: string,
): Promise<number> {
  const result = await executor.query<ChangeIdRow>(
    [
      "INSERT INTO sync.changes",
      "(workspace_id, entity_type, entity_id, action, device_id, operation_id, payload)",
      "VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
      "RETURNING change_id",
    ].join(" "),
    [workspaceId, entityType, entityId, action, deviceId, operationId, payloadJson],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Sync change insert did not return change_id");
  }

  return toNumber(row.change_id);
}

export async function findLatestSyncChangeId(
  executor: DatabaseExecutor,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
): Promise<number | null> {
  const result = await executor.query<ChangeIdRow>(
    [
      "SELECT change_id",
      "FROM sync.changes",
      "WHERE workspace_id = $1 AND entity_type = $2 AND entity_id = $3",
      "ORDER BY change_id DESC",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, entityType, entityId],
  );

  const row = result.rows[0];
  return row === undefined ? null : toNumber(row.change_id);
}

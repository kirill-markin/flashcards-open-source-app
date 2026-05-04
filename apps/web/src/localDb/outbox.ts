import type { SyncPushOperation } from "../types";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getAllFromStore,
  runReadonly,
  runReadwrite,
} from "./core";

export type PersistedOutboxRecord = Readonly<{
  operationId: string;
  workspaceId: string;
  createdAt: string;
  attemptCount: number;
  lastError: string;
  affectsReviewSchedule?: boolean;
  operation: SyncPushOperation;
}>;

type CardUpsertOutboxOperation = Extract<
  SyncPushOperation,
  Readonly<{ entityType: "card"; action: "upsert" }>
>;

export type ScheduleRelevantCardOutboxRecord = PersistedOutboxRecord & Readonly<{
  operation: CardUpsertOutboxOperation;
}>;

export function isScheduleRelevantCardOutboxRecord(
  record: PersistedOutboxRecord,
): record is ScheduleRelevantCardOutboxRecord {
  return record.operation.entityType === "card"
    && record.operation.action === "upsert"
    && (record.affectsReviewSchedule ?? true);
}

export async function putOutboxRecord(record: PersistedOutboxRecord): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["outbox"], (transaction) => transaction.objectStore("outbox").put(record));
  });
}

export async function deleteOutboxRecord(workspaceId: string, operationId: string): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["outbox"], (transaction) => transaction.objectStore("outbox").delete([workspaceId, operationId]));
  });
}

export async function listOutboxRecords(workspaceId: string): Promise<ReadonlyArray<PersistedOutboxRecord>> {
  return closeDatabaseAfter(async (database) => {
    const rows = await runReadonly(
      database,
      "outbox",
      (store) => store.index("workspaceId_createdAt").getAll(),
    ) as ReadonlyArray<PersistedOutboxRecord>;

    return rows.filter((row) => row.workspaceId === workspaceId);
  });
}

export async function listOutboxRecordsForWorkspaces(
  workspaceIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<PersistedOutboxRecord>> {
  if (workspaceIds.length === 0) {
    return [];
  }

  return closeDatabaseAfter(async (database) => {
    const rows = await getAllFromStore<PersistedOutboxRecord>(database, "outbox");
    const allowedWorkspaceIds = new Set<string>(workspaceIds);

    return rows.filter((row) => allowedWorkspaceIds.has(row.workspaceId));
  });
}

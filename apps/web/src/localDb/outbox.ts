import type { SyncPushOperation } from "../types";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getAllFromStore,
  runReadwrite,
} from "./core";

export type PersistedOutboxRecord = Readonly<{
  operationId: string;
  workspaceId: string;
  createdAt: string;
  attemptCount: number;
  lastError: string;
  operation: SyncPushOperation;
}>;

export async function putOutboxRecord(record: PersistedOutboxRecord): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["outbox"], (transaction) => transaction.objectStore("outbox").put(record));
  });
}

export async function deleteOutboxRecord(operationId: string): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["outbox"], (transaction) => transaction.objectStore("outbox").delete(operationId));
  });
}

export async function listOutboxRecords(workspaceId: string): Promise<ReadonlyArray<PersistedOutboxRecord>> {
  const rows = await closeDatabaseAfter((database) => getAllFromStore<PersistedOutboxRecord>(database, "outbox"));
  return rows
    .filter((row) => row.workspaceId === workspaceId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

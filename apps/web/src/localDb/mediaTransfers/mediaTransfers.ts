import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  describeIndexedDbError,
  getFromStore,
  runReadwrite,
} from "../core/database";

export type MediaBlobCacheRecord = Readonly<{
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
  createdAt: string;
  lastAccessedAt: string;
  sourceMediaAssetId?: string;
}>;

export type MediaTransferKind = "download" | "upload";
export type MediaTransferStatus = "queued" | "in_progress" | "completed" | "failed";

export type MediaTransferQueueRecord = Readonly<{
  transferId: string;
  workspaceId: string;
  kind: MediaTransferKind;
  status: MediaTransferStatus;
  mediaAssetId: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  sourceBlobCacheKey: string | null;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}>;

export type EnqueueMediaTransferDownloadInput = Readonly<{
  transferId: string;
  workspaceId: string;
  mediaAssetId: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  nextAttemptAt: string;
}>;

export type EnqueueMediaTransferUploadInput = Readonly<{
  transferId: string;
  workspaceId: string;
  mediaAssetId: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  sourceBlobCacheKey: string;
  createdAt: string;
  nextAttemptAt: string;
}>;

type ClaimableMediaTransferStatus = "queued" | "failed";

function createQueuedMediaTransferRecord(
  input: EnqueueMediaTransferDownloadInput | EnqueueMediaTransferUploadInput,
  kind: MediaTransferKind,
  sourceBlobCacheKey: string | null,
): MediaTransferQueueRecord {
  return {
    transferId: input.transferId,
    workspaceId: input.workspaceId,
    kind,
    status: "queued",
    mediaAssetId: input.mediaAssetId,
    sha256: input.sha256,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sourceBlobCacheKey,
    attemptCount: 0,
    nextAttemptAt: input.nextAttemptAt,
    lastError: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    claimedAt: null,
    completedAt: null,
  };
}

function makeDueTransferRange(
  workspaceId: string,
  status: ClaimableMediaTransferStatus,
  dueAt: string,
): IDBKeyRange {
  return IDBKeyRange.bound([workspaceId, status, ""], [workspaceId, status, dueAt, [], []]);
}

function readFirstRecord(
  records: ReadonlyArray<MediaTransferQueueRecord>,
): MediaTransferQueueRecord | null {
  return records[0] ?? null;
}

function compareMediaTransferClaimPriority(
  left: MediaTransferQueueRecord,
  right: MediaTransferQueueRecord,
): number {
  const nextAttemptComparison = left.nextAttemptAt.localeCompare(right.nextAttemptAt);
  if (nextAttemptComparison !== 0) {
    return nextAttemptComparison;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return left.transferId.localeCompare(right.transferId);
}

function selectNextDueTransfer(
  queuedRecord: MediaTransferQueueRecord | null,
  failedRecord: MediaTransferQueueRecord | null,
): MediaTransferQueueRecord | null {
  if (queuedRecord === null) {
    return failedRecord;
  }

  if (failedRecord === null) {
    return queuedRecord;
  }

  return compareMediaTransferClaimPriority(queuedRecord, failedRecord) <= 0 ? queuedRecord : failedRecord;
}

function toClaimedTransferRecord(
  record: MediaTransferQueueRecord,
  claimedAt: string,
): MediaTransferQueueRecord {
  return {
    ...record,
    status: "in_progress",
    claimedAt,
    updatedAt: claimedAt,
  };
}

function rejectIndexedDbTransaction(
  transaction: IDBTransaction,
  reject: (error: Error) => void,
  error: Error,
): void {
  try {
    transaction.abort();
  } catch {
    // The transaction may already be completing or aborted; preserve the original error.
  }

  reject(error);
}

export async function loadMediaBlobCacheRecord(sha256: string): Promise<MediaBlobCacheRecord | null> {
  const record = await closeDatabaseAfter((database) => getFromStore<MediaBlobCacheRecord>(
    database,
    "mediaBlobCache",
    sha256,
  ));
  return record ?? null;
}

export async function writeMediaBlobCacheRecord(record: MediaBlobCacheRecord): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["mediaBlobCache"], (transaction) => (
      transaction.objectStore("mediaBlobCache").put(record)
    ));
  });
}

export async function deleteMediaBlobCacheRecord(sha256: string): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["mediaBlobCache"], (transaction) => (
      transaction.objectStore("mediaBlobCache").delete(sha256)
    ));
  });
}

async function putMediaTransferQueueRecord(record: MediaTransferQueueRecord): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["mediaTransferQueue"], (transaction) => (
      transaction.objectStore("mediaTransferQueue").put(record)
    ));
  });
}

export async function enqueueMediaTransferDownload(
  input: EnqueueMediaTransferDownloadInput,
): Promise<MediaTransferQueueRecord> {
  const record = createQueuedMediaTransferRecord(input, "download", null);
  await putMediaTransferQueueRecord(record);
  return record;
}

export async function enqueueMediaTransferUpload(
  input: EnqueueMediaTransferUploadInput,
): Promise<MediaTransferQueueRecord> {
  const record = createQueuedMediaTransferRecord(input, "upload", input.sourceBlobCacheKey);
  await putMediaTransferQueueRecord(record);
  return record;
}

export async function claimNextDueMediaTransfer(
  workspaceId: string,
  claimedAt: string,
): Promise<MediaTransferQueueRecord | null> {
  return closeDatabaseAfter(async (database) => new Promise<MediaTransferQueueRecord | null>((resolve, reject) => {
    const transaction = database.transaction(["mediaTransferQueue"], "readwrite");
    const store = transaction.objectStore("mediaTransferQueue");
    const index = store.index("workspaceId_status_nextAttemptAt_createdAt_transferId");
    const queuedRequest = index.getAll(makeDueTransferRange(workspaceId, "queued", claimedAt), 1);
    const failedRequest = index.getAll(makeDueTransferRange(workspaceId, "failed", claimedAt), 1);
    let queuedRecord: MediaTransferQueueRecord | null = null;
    let failedRecord: MediaTransferQueueRecord | null = null;
    let pendingReadCount = 2;
    let claimedRecord: MediaTransferQueueRecord | null = null;
    let didReject = false;

    const rejectOnce = (error: Error): void => {
      if (didReject) {
        return;
      }

      didReject = true;
      rejectIndexedDbTransaction(transaction, reject, error);
    };

    const claimAfterReadsComplete = (): void => {
      pendingReadCount -= 1;
      if (pendingReadCount > 0 || didReject) {
        return;
      }

      const nextRecord = selectNextDueTransfer(queuedRecord, failedRecord);
      if (nextRecord === null) {
        return;
      }

      claimedRecord = toClaimedTransferRecord(nextRecord, claimedAt);
      const putRequest = store.put(claimedRecord);
      putRequest.onerror = () => {
        rejectOnce(describeIndexedDbError("IndexedDB media transfer claim write failed", putRequest.error));
      };
    };

    queuedRequest.onerror = () => {
      rejectOnce(describeIndexedDbError("IndexedDB media transfer queued claim lookup failed", queuedRequest.error));
    };
    queuedRequest.onsuccess = () => {
      queuedRecord = readFirstRecord(queuedRequest.result as ReadonlyArray<MediaTransferQueueRecord>);
      claimAfterReadsComplete();
    };

    failedRequest.onerror = () => {
      rejectOnce(describeIndexedDbError("IndexedDB media transfer failed claim lookup failed", failedRequest.error));
    };
    failedRequest.onsuccess = () => {
      failedRecord = readFirstRecord(failedRequest.result as ReadonlyArray<MediaTransferQueueRecord>);
      claimAfterReadsComplete();
    };

    transaction.onerror = () => {
      if (didReject === false) {
        reject(describeIndexedDbError("IndexedDB media transfer claim failed", transaction.error));
      }
    };
    transaction.onabort = () => {
      if (didReject === false) {
        reject(describeIndexedDbError("IndexedDB media transfer claim aborted", transaction.error));
      }
    };
    transaction.oncomplete = () => {
      resolve(claimedRecord);
    };
  }));
}

async function updateMediaTransferQueueRecord(
  transferId: string,
  updatedAt: string,
  updateRecord: (record: MediaTransferQueueRecord) => MediaTransferQueueRecord,
  errorPrefix: string,
): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(["mediaTransferQueue"], "readwrite");
    const store = transaction.objectStore("mediaTransferQueue");
    const request = store.get(transferId);
    let didReject = false;

    const rejectOnce = (error: Error): void => {
      if (didReject) {
        return;
      }

      didReject = true;
      rejectIndexedDbTransaction(transaction, reject, error);
    };

    request.onerror = () => {
      rejectOnce(describeIndexedDbError(`${errorPrefix} lookup failed`, request.error));
    };
    request.onsuccess = () => {
      const record = request.result as MediaTransferQueueRecord | undefined;
      if (record === undefined) {
        rejectOnce(new Error(`${errorPrefix}: transfer not found. transferId=${transferId}`));
        return;
      }

      const putRequest = store.put(updateRecord({
        ...record,
        updatedAt,
      }));
      putRequest.onerror = () => {
        rejectOnce(describeIndexedDbError(`${errorPrefix} write failed`, putRequest.error));
      };
    };

    transaction.onerror = () => {
      if (didReject === false) {
        reject(describeIndexedDbError(errorPrefix, transaction.error));
      }
    };
    transaction.onabort = () => {
      if (didReject === false) {
        reject(describeIndexedDbError(`${errorPrefix} aborted`, transaction.error));
      }
    };
    transaction.oncomplete = () => {
      resolve();
    };
  }));
}

export async function markMediaTransferSucceeded(
  transferId: string,
  completedAt: string,
): Promise<void> {
  await updateMediaTransferQueueRecord(
    transferId,
    completedAt,
    (record) => ({
      ...record,
      status: "completed",
      lastError: null,
      claimedAt: null,
      completedAt,
    }),
    "IndexedDB media transfer success update failed",
  );
}

export async function markMediaTransferFailed(
  transferId: string,
  failedAt: string,
  lastError: string,
  nextAttemptAt: string,
): Promise<void> {
  await updateMediaTransferQueueRecord(
    transferId,
    failedAt,
    (record) => ({
      ...record,
      status: "failed",
      attemptCount: record.attemptCount + 1,
      nextAttemptAt,
      lastError,
      claimedAt: null,
      completedAt: null,
    }),
    "IndexedDB media transfer failure update failed",
  );
}

export async function clearCompletedMediaTransfersForWorkspace(workspaceId: string): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(["mediaTransferQueue"], "readwrite");
    const index = transaction.objectStore("mediaTransferQueue").index("workspaceId_status_nextAttemptAt");
    const request = index.openCursor(IDBKeyRange.bound([workspaceId, "completed", ""], [workspaceId, "completed", []]));

    request.onerror = () => {
      rejectIndexedDbTransaction(
        transaction,
        reject,
        describeIndexedDbError("IndexedDB completed media transfer cleanup lookup failed", request.error),
      );
    };
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) {
        return;
      }

      cursor.delete();
      cursor.continue();
    };

    transaction.onerror = () => {
      reject(describeIndexedDbError("IndexedDB completed media transfer cleanup failed", transaction.error));
    };
    transaction.onabort = () => {
      reject(describeIndexedDbError("IndexedDB completed media transfer cleanup aborted", transaction.error));
    };
    transaction.oncomplete = () => {
      resolve();
    };
  }));
}

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

export type RecoverStaleInProgressMediaTransfersByKindInput = Readonly<{
  workspaceId: string;
  kind: MediaTransferKind;
  staleClaimedBefore: string;
  recoveredAt: string;
  nextAttemptAt: string;
  lastError: string;
}>;

export type RenewInProgressMediaTransferClaimInput = Readonly<{
  transferId: string;
  kind: MediaTransferKind;
  expectedClaimedAt: string;
  renewedAt: string;
}>;

export type MarkClaimedMediaTransferSucceededInput = Readonly<{
  transferId: string;
  kind: MediaTransferKind;
  expectedClaimedAt: string;
  completedAt: string;
}>;

export type MarkClaimedMediaTransferFailedInput = Readonly<{
  transferId: string;
  kind: MediaTransferKind;
  expectedClaimedAt: string;
  failedAt: string;
  lastError: string;
  nextAttemptAt: string;
}>;

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

function makePendingTransferRange(
  workspaceId: string,
  status: ClaimableMediaTransferStatus,
): IDBKeyRange {
  return IDBKeyRange.bound([workspaceId, status, ""], [workspaceId, status, []]);
}

function makeStatusTransferRange(
  workspaceId: string,
  status: MediaTransferStatus,
): IDBKeyRange {
  return IDBKeyRange.bound([workspaceId, status, ""], [workspaceId, status, []]);
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

export async function loadMediaTransferQueueRecord(
  transferId: string,
): Promise<MediaTransferQueueRecord | null> {
  const record = await closeDatabaseAfter((database) => getFromStore<MediaTransferQueueRecord>(
    database,
    "mediaTransferQueue",
    transferId,
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

async function claimNextDueMediaTransferWithSelector(
  workspaceId: string,
  claimedAt: string,
  shouldClaimRecord: (record: MediaTransferQueueRecord) => boolean,
): Promise<MediaTransferQueueRecord | null> {
  return closeDatabaseAfter(async (database) => new Promise<MediaTransferQueueRecord | null>((resolve, reject) => {
    const transaction = database.transaction(["mediaTransferQueue"], "readwrite");
    const store = transaction.objectStore("mediaTransferQueue");
    const index = store.index("workspaceId_status_nextAttemptAt_createdAt_transferId");
    const queuedRequest = index.openCursor(makeDueTransferRange(workspaceId, "queued", claimedAt));
    const failedRequest = index.openCursor(makeDueTransferRange(workspaceId, "failed", claimedAt));
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
      const cursor = queuedRequest.result;
      if (cursor === null) {
        claimAfterReadsComplete();
        return;
      }

      const record = cursor.value as MediaTransferQueueRecord;
      if (shouldClaimRecord(record)) {
        queuedRecord = record;
        claimAfterReadsComplete();
        return;
      }

      cursor.continue();
    };

    failedRequest.onerror = () => {
      rejectOnce(describeIndexedDbError("IndexedDB media transfer failed claim lookup failed", failedRequest.error));
    };
    failedRequest.onsuccess = () => {
      const cursor = failedRequest.result;
      if (cursor === null) {
        claimAfterReadsComplete();
        return;
      }

      const record = cursor.value as MediaTransferQueueRecord;
      if (shouldClaimRecord(record)) {
        failedRecord = record;
        claimAfterReadsComplete();
        return;
      }

      cursor.continue();
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

export async function claimNextDueMediaTransfer(
  workspaceId: string,
  claimedAt: string,
): Promise<MediaTransferQueueRecord | null> {
  return claimNextDueMediaTransferWithSelector(workspaceId, claimedAt, () => true);
}

export async function claimNextDueMediaTransferByKind(
  workspaceId: string,
  kind: MediaTransferKind,
  claimedAt: string,
): Promise<MediaTransferQueueRecord | null> {
  return claimNextDueMediaTransferWithSelector(
    workspaceId,
    claimedAt,
    (record) => record.kind === kind,
  );
}

async function loadNextPendingMediaTransferByStatusAndKind(
  workspaceId: string,
  status: ClaimableMediaTransferStatus,
  kind: MediaTransferKind,
): Promise<MediaTransferQueueRecord | null> {
  return closeDatabaseAfter(async (database) => new Promise<MediaTransferQueueRecord | null>((resolve, reject) => {
    const transaction = database.transaction(["mediaTransferQueue"], "readonly");
    const index = transaction.objectStore("mediaTransferQueue").index("workspaceId_status_nextAttemptAt_createdAt_transferId");
    const request = index.openCursor(makePendingTransferRange(workspaceId, status));
    let matchingRecord: MediaTransferQueueRecord | null = null;
    let didReject = false;

    const rejectOnce = (error: Error): void => {
      if (didReject) {
        return;
      }

      didReject = true;
      rejectIndexedDbTransaction(transaction, reject, error);
    };

    request.onerror = () => {
      rejectOnce(describeIndexedDbError("IndexedDB pending media transfer lookup failed", request.error));
    };
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null || matchingRecord !== null) {
        return;
      }

      const record = cursor.value as MediaTransferQueueRecord;
      if (record.kind === kind) {
        matchingRecord = record;
        return;
      }

      cursor.continue();
    };

    transaction.onerror = () => {
      if (didReject === false) {
        reject(describeIndexedDbError("IndexedDB pending media transfer lookup failed", transaction.error));
      }
    };
    transaction.onabort = () => {
      if (didReject === false) {
        reject(describeIndexedDbError("IndexedDB pending media transfer lookup aborted", transaction.error));
      }
    };
    transaction.oncomplete = () => {
      resolve(matchingRecord);
    };
  }));
}

export async function loadNextPendingMediaTransferAttemptAtByKind(
  workspaceId: string,
  kind: MediaTransferKind,
): Promise<string | null> {
  const [queuedRecord, failedRecord] = await Promise.all([
    loadNextPendingMediaTransferByStatusAndKind(workspaceId, "queued", kind),
    loadNextPendingMediaTransferByStatusAndKind(workspaceId, "failed", kind),
  ]);
  return selectNextDueTransfer(queuedRecord, failedRecord)?.nextAttemptAt ?? null;
}

export async function recoverStaleInProgressMediaTransfersByKind(
  input: RecoverStaleInProgressMediaTransfersByKindInput,
): Promise<number> {
  return closeDatabaseAfter(async (database) => new Promise<number>((resolve, reject) => {
    const transaction = database.transaction(["mediaTransferQueue"], "readwrite");
    const store = transaction.objectStore("mediaTransferQueue");
    const index = store.index("workspaceId_status_nextAttemptAt_createdAt_transferId");
    const request = index.openCursor(makeStatusTransferRange(input.workspaceId, "in_progress"));
    let recoveredCount = 0;
    let didReject = false;

    const rejectOnce = (error: Error): void => {
      if (didReject) {
        return;
      }

      didReject = true;
      rejectIndexedDbTransaction(transaction, reject, error);
    };

    request.onerror = () => {
      rejectOnce(describeIndexedDbError("IndexedDB stale media transfer recovery lookup failed", request.error));
    };
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null || didReject) {
        return;
      }

      const record = cursor.value as MediaTransferQueueRecord;
      if (
        record.kind === input.kind
        && record.claimedAt !== null
        && record.claimedAt <= input.staleClaimedBefore
      ) {
        const updateRequest = cursor.update({
          ...record,
          status: "failed",
          attemptCount: record.attemptCount + 1,
          nextAttemptAt: input.nextAttemptAt,
          lastError: input.lastError,
          updatedAt: input.recoveredAt,
          claimedAt: null,
          completedAt: null,
        } satisfies MediaTransferQueueRecord);
        recoveredCount += 1;
        updateRequest.onerror = () => {
          rejectOnce(describeIndexedDbError("IndexedDB stale media transfer recovery write failed", updateRequest.error));
        };
      }

      cursor.continue();
    };

    transaction.onerror = () => {
      if (didReject === false) {
        reject(describeIndexedDbError("IndexedDB stale media transfer recovery failed", transaction.error));
      }
    };
    transaction.onabort = () => {
      if (didReject === false) {
        reject(describeIndexedDbError("IndexedDB stale media transfer recovery aborted", transaction.error));
      }
    };
    transaction.oncomplete = () => {
      resolve(recoveredCount);
    };
  }));
}

function assertClaimedMediaTransferMatchesToken(
  record: MediaTransferQueueRecord,
  kind: MediaTransferKind,
  expectedClaimedAt: string,
  errorPrefix: string,
): void {
  if (record.kind !== kind) {
    throw new Error(`${errorPrefix}: transfer kind mismatch. transferId=${record.transferId}, expectedKind=${kind}, actualKind=${record.kind}`);
  }

  if (record.status !== "in_progress") {
    throw new Error(`${errorPrefix}: transfer is not in progress. transferId=${record.transferId}, status=${record.status}`);
  }

  if (record.claimedAt !== expectedClaimedAt) {
    throw new Error(`${errorPrefix}: transfer claim token mismatch. transferId=${record.transferId}, expectedClaimedAt=${expectedClaimedAt}, actualClaimedAt=${record.claimedAt ?? "none"}`);
  }
}

async function updateClaimedMediaTransferQueueRecord(
  transferId: string,
  kind: MediaTransferKind,
  expectedClaimedAt: string,
  updatedAt: string,
  updateRecord: (record: MediaTransferQueueRecord) => MediaTransferQueueRecord,
  errorPrefix: string,
): Promise<MediaTransferQueueRecord> {
  return closeDatabaseAfter(async (database) => new Promise<MediaTransferQueueRecord>((resolve, reject) => {
    const transaction = database.transaction(["mediaTransferQueue"], "readwrite");
    const store = transaction.objectStore("mediaTransferQueue");
    const request = store.get(transferId);
    let updatedRecord: MediaTransferQueueRecord | null = null;
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

      try {
        assertClaimedMediaTransferMatchesToken(record, kind, expectedClaimedAt, errorPrefix);
        updatedRecord = updateRecord({
          ...record,
          updatedAt,
        });
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error(`${errorPrefix}: transfer update failed`));
        return;
      }

      const putRequest = store.put(updatedRecord);
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
      if (updatedRecord === null) {
        reject(new Error(`${errorPrefix}: update did not complete. transferId=${transferId}`));
        return;
      }

      resolve(updatedRecord);
    };
  }));
}

export async function renewInProgressMediaTransferClaim(
  input: RenewInProgressMediaTransferClaimInput,
): Promise<MediaTransferQueueRecord> {
  return updateClaimedMediaTransferQueueRecord(
    input.transferId,
    input.kind,
    input.expectedClaimedAt,
    input.renewedAt,
    (record) => ({
      ...record,
      claimedAt: input.renewedAt,
    }),
    "IndexedDB media transfer claim renewal failed",
  );
}

export async function markClaimedMediaTransferSucceeded(
  input: MarkClaimedMediaTransferSucceededInput,
): Promise<void> {
  await updateClaimedMediaTransferQueueRecord(
    input.transferId,
    input.kind,
    input.expectedClaimedAt,
    input.completedAt,
    (record) => ({
      ...record,
      status: "completed",
      lastError: null,
      claimedAt: null,
      completedAt: input.completedAt,
    }),
    "IndexedDB claimed media transfer success update failed",
  );
}

export async function markClaimedMediaTransferFailed(
  input: MarkClaimedMediaTransferFailedInput,
): Promise<void> {
  await updateClaimedMediaTransferQueueRecord(
    input.transferId,
    input.kind,
    input.expectedClaimedAt,
    input.failedAt,
    (record) => ({
      ...record,
      status: "failed",
      attemptCount: record.attemptCount + 1,
      nextAttemptAt: input.nextAttemptAt,
      lastError: input.lastError,
      claimedAt: null,
      completedAt: null,
    }),
    "IndexedDB claimed media transfer failure update failed",
  );
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

import { loadMediaAssetDownloadUrl } from "../../../../../api";
import type { IndexedDbOpenRecoveryState } from "../../../../../appError/AppErrorContext";
import { loadMediaAssetRecord } from "../../../../../localDb/mediaAssets";
import {
  loadMediaBlobCacheRecord,
  writeMediaBlobCacheRecord,
  type MediaBlobCacheRecord,
} from "../../../../../localDb/mediaTransfers";
import type { MediaAsset } from "../../../../../types";

const MANAGED_MEDIA_DOWNLOAD_ATTEMPT_COUNT = 2;
const MANAGED_MEDIA_DOWNLOAD_RANGE_SIZE_BYTES = 4 * 1024 * 1024;

export type ManagedMediaBlobLoadResult = Readonly<{
  mediaAsset: MediaAsset;
  cacheRecord: MediaBlobCacheRecord;
}>;
type ManagedMediaDownloadRange = Readonly<{
  startByte: number;
  endByte: number;
}>;
type ManagedMediaDownloadTask = Readonly<{
  abortController: AbortController;
  promise: Promise<MediaBlobCacheRecord>;
}>;

async function waitForRecoveryGuardedManagedMediaPhase<ResultType>(
  createPhase: () => Promise<ResultType>,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<ResultType> {
  try {
    indexedDbOpenRecoveryState.throwIfFailed();
    const result = await createPhase();
    indexedDbOpenRecoveryState.throwIfFailed();
    return result;
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    indexedDbOpenRecoveryState.markFailed(error);
    indexedDbOpenRecoveryState.throwIfFailed();
    throw error;
  }
}

function throwIfManagedMediaDownloadAborted(signal: AbortSignal): void {
  if (signal.aborted === false) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  throw new DOMException("Managed media download was aborted", "AbortError");
}

async function waitForRecoveryAndAbortGuardedManagedMediaPhase<ResultType>(
  createPhase: () => Promise<ResultType>,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
  signal: AbortSignal,
): Promise<ResultType> {
  try {
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    const result = await createPhase();
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    return result;
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    indexedDbOpenRecoveryState.markFailed(error);
    indexedDbOpenRecoveryState.throwIfFailed();
    throw error;
  }
}

const activeManagedMediaDownloadTasks = new Map<string, ManagedMediaDownloadTask>();

function readErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== "") {
    return error.name;
  }

  return typeof error;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return String(error);
}

function warnManagedMediaDownloadRetry(
  workspaceId: string,
  mediaAssetId: string,
  sha256: string,
  attemptNumber: number,
  error: unknown,
): void {
  console.warn("Managed media signed URL download retrying", {
    workspaceId,
    mediaAssetId,
    sha256,
    attemptNumber,
    errorName: readErrorName(error),
    errorMessage: readErrorMessage(error),
  });
}

function requireSha256Digest(): SubtleCrypto {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.subtle === undefined) {
    throw new Error("Managed media verification failed: Web Crypto SHA-256 digest is unavailable");
  }

  return cryptoApi.subtle;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function calculateSha256Hex(
  bytes: ArrayBuffer,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
  signal: AbortSignal,
): Promise<string> {
  const digest = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
    () => requireSha256Digest().digest("SHA-256", bytes),
    indexedDbOpenRecoveryState,
    signal,
  );
  indexedDbOpenRecoveryState.throwIfFailed();
  throwIfManagedMediaDownloadAborted(signal);
  return bytesToHex(new Uint8Array(digest));
}

async function readDownloadFailureBody(
  response: Response,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
  signal: AbortSignal,
): Promise<string> {
  try {
    const responseBody = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
      () => response.text(),
      indexedDbOpenRecoveryState,
      signal,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    return responseBody;
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    return `failed to read response body: ${readErrorMessage(error)}`;
  }
}

function planManagedMediaDownloadRanges(sizeBytes: number, rangeSizeBytes: number): ReadonlyArray<ManagedMediaDownloadRange> {
  if (Number.isSafeInteger(sizeBytes) === false || sizeBytes < 0) {
    throw new RangeError(`Managed media download range planning failed: sizeBytes must be a non-negative safe integer, actualSizeBytes=${sizeBytes}`);
  }

  if (Number.isSafeInteger(rangeSizeBytes) === false || rangeSizeBytes < 1) {
    throw new RangeError(`Managed media download range planning failed: rangeSizeBytes must be a positive safe integer, actualRangeSizeBytes=${rangeSizeBytes}`);
  }

  const ranges: Array<ManagedMediaDownloadRange> = [];
  for (let startByte = 0; startByte < sizeBytes; startByte += rangeSizeBytes) {
    ranges.push({
      startByte,
      endByte: Math.min(startByte + rangeSizeBytes - 1, sizeBytes - 1),
    });
  }

  return ranges;
}

function readManagedMediaDownloadRangeSize(range: ManagedMediaDownloadRange): number {
  return range.endByte - range.startByte + 1;
}

async function readManagedMediaResponseBytes(
  mediaAsset: MediaAsset,
  response: Response,
  rangeHeader: string,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  try {
    const bytes = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
      () => response.arrayBuffer(),
      indexedDbOpenRecoveryState,
      signal,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    return bytes;
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    throw new Error(`Managed media download response body read failed: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, range=${rangeHeader}, status=${response.status}, error=${readErrorMessage(error)}`);
  }
}

async function fetchManagedMediaRangeBytes(
  mediaAsset: MediaAsset,
  downloadMethod: "GET",
  downloadUrl: string,
  range: ManagedMediaDownloadRange,
  isSingleRange: boolean,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const rangeHeader = `bytes=${range.startByte}-${range.endByte}`;
  let response: Response;
  try {
    response = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
      () => fetch(downloadUrl, {
        method: downloadMethod,
        headers: {
          Range: rangeHeader,
        },
        signal,
      }),
      indexedDbOpenRecoveryState,
      signal,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    throw new Error(`Managed media ranged download request failed: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, range=${rangeHeader}, error=${readErrorMessage(error)}`);
  }

  if (response.status === 206) {
    const bytes = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
      () => readManagedMediaResponseBytes(mediaAsset, response, rangeHeader, indexedDbOpenRecoveryState, signal),
      indexedDbOpenRecoveryState,
      signal,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    const expectedRangeSizeBytes = readManagedMediaDownloadRangeSize(range);
    if (bytes.byteLength !== expectedRangeSizeBytes) {
      throw new Error(`Managed media ranged download size mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, range=${rangeHeader}, expectedRangeSizeBytes=${expectedRangeSizeBytes}, actualRangeSizeBytes=${bytes.byteLength}, status=${response.status}`);
    }

    return bytes;
  }

  if (isSingleRange && response.status === 200) {
    const bytes = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
      () => readManagedMediaResponseBytes(mediaAsset, response, rangeHeader, indexedDbOpenRecoveryState, signal),
      indexedDbOpenRecoveryState,
      signal,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    if (bytes.byteLength !== mediaAsset.sizeBytes) {
      throw new Error(`Managed media full download size mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, range=${rangeHeader}, expectedSizeBytes=${mediaAsset.sizeBytes}, actualSizeBytes=${bytes.byteLength}, status=${response.status}`);
    }

    return bytes;
  }

  if (response.ok === false) {
    const responseBody = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
      () => readDownloadFailureBody(response, indexedDbOpenRecoveryState, signal),
      indexedDbOpenRecoveryState,
      signal,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    throw new Error(`Managed media ranged download failed: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, range=${rangeHeader}, status=${response.status}, statusText=${response.statusText}, responseBody=${responseBody}`);
  }

  throw new Error(`Managed media ranged download returned unexpected status: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, range=${rangeHeader}, expectedStatus=206, actualStatus=${response.status}, statusText=${response.statusText}`);
}

function combineManagedMediaRangeBytes(mediaAsset: MediaAsset, chunks: ReadonlyArray<ArrayBuffer>): ArrayBuffer {
  const totalByteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (totalByteLength !== mediaAsset.sizeBytes) {
    throw new Error(`Managed media ranged download total size mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, expectedSizeBytes=${mediaAsset.sizeBytes}, actualSizeBytes=${totalByteLength}`);
  }

  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(totalByteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return bytes.buffer;
}

async function fetchManagedMediaBytes(
  mediaAsset: MediaAsset,
  downloadMethod: "GET",
  downloadUrl: string,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const ranges = planManagedMediaDownloadRanges(mediaAsset.sizeBytes, MANAGED_MEDIA_DOWNLOAD_RANGE_SIZE_BYTES);
  const chunks: Array<ArrayBuffer> = [];
  for (const range of ranges) {
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    const chunk = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
      () => fetchManagedMediaRangeBytes(
        mediaAsset,
        downloadMethod,
        downloadUrl,
        range,
        ranges.length === 1,
        indexedDbOpenRecoveryState,
        signal,
      ),
      indexedDbOpenRecoveryState,
      signal,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    chunks.push(chunk);
  }

  indexedDbOpenRecoveryState.throwIfFailed();
  throwIfManagedMediaDownloadAborted(signal);
  return combineManagedMediaRangeBytes(mediaAsset, chunks);
}

async function verifyManagedMediaBytes(
  mediaAsset: MediaAsset,
  bytes: ArrayBuffer,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
  signal: AbortSignal,
): Promise<Blob> {
  indexedDbOpenRecoveryState.throwIfFailed();
  throwIfManagedMediaDownloadAborted(signal);
  if (bytes.byteLength !== mediaAsset.sizeBytes) {
    throw new Error(`Managed media download size mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, expectedSizeBytes=${mediaAsset.sizeBytes}, actualSizeBytes=${bytes.byteLength}`);
  }

  const actualSha256 = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
    () => calculateSha256Hex(bytes, indexedDbOpenRecoveryState, signal),
    indexedDbOpenRecoveryState,
    signal,
  );
  indexedDbOpenRecoveryState.throwIfFailed();
  throwIfManagedMediaDownloadAborted(signal);
  if (actualSha256 !== mediaAsset.sha256) {
    throw new Error(`Managed media download sha256 mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, expectedSha256=${mediaAsset.sha256}, actualSha256=${actualSha256}`);
  }

  throwIfManagedMediaDownloadAborted(signal);
  return new Blob([bytes], { type: mediaAsset.mimeType });
}

function assertUsableMediaBlobCacheRecord(
  mediaAsset: MediaAsset,
  cacheRecord: MediaBlobCacheRecord,
): void {
  if (cacheRecord.sha256 !== mediaAsset.sha256) {
    throw new Error(`Managed media cache sha256 mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, expectedSha256=${mediaAsset.sha256}, actualSha256=${cacheRecord.sha256}`);
  }

  if (cacheRecord.sizeBytes !== mediaAsset.sizeBytes) {
    throw new Error(`Managed media cache size metadata mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, expectedSizeBytes=${mediaAsset.sizeBytes}, actualSizeBytes=${cacheRecord.sizeBytes}`);
  }

  if (cacheRecord.blob.size !== mediaAsset.sizeBytes) {
    throw new Error(`Managed media cache blob size mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, expectedSizeBytes=${mediaAsset.sizeBytes}, actualSizeBytes=${cacheRecord.blob.size}`);
  }
}

function assertDownloadMediaAssetMatchesLocal(localMediaAsset: MediaAsset, downloadMediaAsset: MediaAsset): void {
  if (downloadMediaAsset.workspaceId !== localMediaAsset.workspaceId) {
    throw new Error(`Managed media download asset workspace mismatch: expectedWorkspaceId=${localMediaAsset.workspaceId}, actualWorkspaceId=${downloadMediaAsset.workspaceId}, mediaAssetId=${localMediaAsset.mediaAssetId}`);
  }

  if (downloadMediaAsset.mediaAssetId !== localMediaAsset.mediaAssetId) {
    throw new Error(`Managed media download asset id mismatch: workspaceId=${localMediaAsset.workspaceId}, expectedMediaAssetId=${localMediaAsset.mediaAssetId}, actualMediaAssetId=${downloadMediaAsset.mediaAssetId}`);
  }

  if (downloadMediaAsset.sha256 !== localMediaAsset.sha256) {
    throw new Error(`Managed media download asset sha256 mismatch: workspaceId=${localMediaAsset.workspaceId}, mediaAssetId=${localMediaAsset.mediaAssetId}, expectedSha256=${localMediaAsset.sha256}, actualSha256=${downloadMediaAsset.sha256}`);
  }

  if (downloadMediaAsset.sizeBytes !== localMediaAsset.sizeBytes) {
    throw new Error(`Managed media download asset size mismatch: workspaceId=${localMediaAsset.workspaceId}, mediaAssetId=${localMediaAsset.mediaAssetId}, expectedSizeBytes=${localMediaAsset.sizeBytes}, actualSizeBytes=${downloadMediaAsset.sizeBytes}`);
  }

  if (downloadMediaAsset.deletedAt !== null) {
    throw new Error(`Managed media download asset is deleted: workspaceId=${localMediaAsset.workspaceId}, mediaAssetId=${localMediaAsset.mediaAssetId}, deletedAt=${downloadMediaAsset.deletedAt}`);
  }
}

async function downloadVerifiedMediaBlob(
  mediaAsset: MediaAsset,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
  signal: AbortSignal,
): Promise<Blob> {
  let lastError: unknown = null;
  for (let attemptNumber = 1; attemptNumber <= MANAGED_MEDIA_DOWNLOAD_ATTEMPT_COUNT; attemptNumber += 1) {
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    const downloadResult = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
      () => loadMediaAssetDownloadUrl(mediaAsset.workspaceId, mediaAsset.mediaAssetId, signal),
      indexedDbOpenRecoveryState,
      signal,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    assertDownloadMediaAssetMatchesLocal(mediaAsset, downloadResult.mediaAsset);
    let bytes: ArrayBuffer;
    try {
      bytes = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
        () => fetchManagedMediaBytes(
          mediaAsset,
          downloadResult.download.method,
          downloadResult.download.url,
          indexedDbOpenRecoveryState,
          signal,
        ),
        indexedDbOpenRecoveryState,
        signal,
      );
      indexedDbOpenRecoveryState.throwIfFailed();
      throwIfManagedMediaDownloadAborted(signal);
    } catch (error) {
      indexedDbOpenRecoveryState.throwIfFailed();
      throwIfManagedMediaDownloadAborted(signal);
      lastError = error;
      if (attemptNumber >= MANAGED_MEDIA_DOWNLOAD_ATTEMPT_COUNT) {
        break;
      }

      warnManagedMediaDownloadRetry(
        mediaAsset.workspaceId,
        mediaAsset.mediaAssetId,
        mediaAsset.sha256,
        attemptNumber,
        error,
      );
      continue;
    }

    const verifiedBlob = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
      () => verifyManagedMediaBytes(mediaAsset, bytes, indexedDbOpenRecoveryState, signal),
      indexedDbOpenRecoveryState,
      signal,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(signal);
    return verifiedBlob;
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function downloadMediaBlobCacheRecord(
  mediaAsset: MediaAsset,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<MediaBlobCacheRecord> {
  const activeDownloadTask = activeManagedMediaDownloadTasks.get(mediaAsset.sha256);
  if (activeDownloadTask !== undefined) {
    const activeCacheRecord = await waitForRecoveryGuardedManagedMediaPhase(
      () => activeDownloadTask.promise,
      indexedDbOpenRecoveryState,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    return activeCacheRecord;
  }

  const abortController = new AbortController();
  const abortForRecovery = (): void => {
    if (abortController.signal.aborted === false) {
      abortController.abort(indexedDbOpenRecoveryState.signal.reason);
    }
  };
  if (indexedDbOpenRecoveryState.signal.aborted) {
    abortForRecovery();
  } else {
    indexedDbOpenRecoveryState.signal.addEventListener("abort", abortForRecovery, { once: true });
  }
  let downloadTask: ManagedMediaDownloadTask;
  const downloadPromise = (async (): Promise<MediaBlobCacheRecord> => {
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(abortController.signal);
    const downloadedBlob = await waitForRecoveryAndAbortGuardedManagedMediaPhase(
      () => downloadVerifiedMediaBlob(
        mediaAsset,
        indexedDbOpenRecoveryState,
        abortController.signal,
      ),
      indexedDbOpenRecoveryState,
      abortController.signal,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(abortController.signal);
    const now = new Date().toISOString();
    const cacheRecord: MediaBlobCacheRecord = {
      sha256: mediaAsset.sha256,
      mimeType: mediaAsset.mimeType,
      sizeBytes: mediaAsset.sizeBytes,
      blob: downloadedBlob,
      createdAt: now,
      lastAccessedAt: now,
      sourceMediaAssetId: mediaAsset.mediaAssetId,
    };
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(abortController.signal);
    await waitForRecoveryGuardedManagedMediaPhase(
      () => writeMediaBlobCacheRecord(cacheRecord),
      indexedDbOpenRecoveryState,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    throwIfManagedMediaDownloadAborted(abortController.signal);
    return cacheRecord;
  })().finally(() => {
    indexedDbOpenRecoveryState.signal.removeEventListener("abort", abortForRecovery);
    if (activeManagedMediaDownloadTasks.get(mediaAsset.sha256) === downloadTask) {
      activeManagedMediaDownloadTasks.delete(mediaAsset.sha256);
    }
  });
  downloadTask = {
    abortController,
    promise: downloadPromise,
  };
  activeManagedMediaDownloadTasks.set(mediaAsset.sha256, downloadTask);
  const cacheRecord = await waitForRecoveryGuardedManagedMediaPhase(
    () => downloadPromise,
    indexedDbOpenRecoveryState,
  );
  indexedDbOpenRecoveryState.throwIfFailed();
  return cacheRecord;
}

async function loadMediaBlobForReview(
  mediaAsset: MediaAsset,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<MediaBlobCacheRecord> {
  indexedDbOpenRecoveryState.throwIfFailed();
  const cacheRecord = await waitForRecoveryGuardedManagedMediaPhase(
    () => loadMediaBlobCacheRecord(mediaAsset.sha256),
    indexedDbOpenRecoveryState,
  );
  indexedDbOpenRecoveryState.throwIfFailed();
  if (cacheRecord !== null) {
    assertUsableMediaBlobCacheRecord(mediaAsset, cacheRecord);
    const accessedRecord: MediaBlobCacheRecord = {
      ...cacheRecord,
      lastAccessedAt: new Date().toISOString(),
    };
    indexedDbOpenRecoveryState.throwIfFailed();
    await waitForRecoveryGuardedManagedMediaPhase(
      () => writeMediaBlobCacheRecord(accessedRecord),
      indexedDbOpenRecoveryState,
    );
    indexedDbOpenRecoveryState.throwIfFailed();
    return accessedRecord;
  }

  indexedDbOpenRecoveryState.throwIfFailed();
  const downloadedCacheRecord = await waitForRecoveryGuardedManagedMediaPhase(
    () => downloadMediaBlobCacheRecord(mediaAsset, indexedDbOpenRecoveryState),
    indexedDbOpenRecoveryState,
  );
  indexedDbOpenRecoveryState.throwIfFailed();
  return downloadedCacheRecord;
}

export async function loadManagedMediaBlob(
  workspaceId: string,
  mediaAssetId: string,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<ManagedMediaBlobLoadResult | null> {
  indexedDbOpenRecoveryState.throwIfFailed();
  const mediaAsset = await waitForRecoveryGuardedManagedMediaPhase(
    () => loadMediaAssetRecord(workspaceId, mediaAssetId),
    indexedDbOpenRecoveryState,
  );
  indexedDbOpenRecoveryState.throwIfFailed();
  if (mediaAsset === null || mediaAsset.deletedAt !== null) {
    return null;
  }

  indexedDbOpenRecoveryState.throwIfFailed();
  const cacheRecord = await waitForRecoveryGuardedManagedMediaPhase(
    () => loadMediaBlobForReview(mediaAsset, indexedDbOpenRecoveryState),
    indexedDbOpenRecoveryState,
  );
  indexedDbOpenRecoveryState.throwIfFailed();
  return {
    mediaAsset,
    cacheRecord,
  };
}


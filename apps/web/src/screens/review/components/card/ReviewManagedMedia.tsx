import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { defaultUrlTransform } from "react-markdown";
import { loadMediaAssetDownloadUrl } from "../../../../api";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
  useAppErrorDialog,
} from "../../../../appError/AppErrorContext";
import { useI18n } from "../../../../i18n";
import { loadMediaAssetRecord } from "../../../../localDb/mediaAssets";
import {
  loadMediaBlobCacheRecord,
  writeMediaBlobCacheRecord,
  type MediaBlobCacheRecord,
} from "../../../../localDb/mediaTransfers";
import {
  parseManagedMediaAssetId,
  parseManagedMediaUrlReference,
  type ManagedMediaReferenceState,
} from "../../../../media/managedMediaMarkdown";
import type { MediaAsset } from "../../../../types";

export { parseManagedMediaAssetId, parseManagedMediaUrlReference };

const MANAGED_MEDIA_DOWNLOAD_ATTEMPT_COUNT = 2;
const MANAGED_MEDIA_DOWNLOAD_RANGE_SIZE_BYTES = 4 * 1024 * 1024;

type ManagedMediaKind = "image" | "audio" | "video" | "attachment";
type ManagedMediaReferencePresentation = "image" | "link";
type ManagedMediaImageDimensions = Readonly<{
  height: number;
  width: number;
}>;
type ManagedMediaLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable"; mediaAsset: MediaAsset | null }>
  | Readonly<{
    imageDimensions: ManagedMediaImageDimensions | null;
    status: "ready";
    mediaAsset: MediaAsset;
    objectUrlLease: ManagedMediaObjectUrlLease;
    releaseProvisionalObjectUrlLease: (() => void) | null;
    url: string;
  }>;
type ManagedMediaBlobLoadResult = Readonly<{
  mediaAsset: MediaAsset;
  cacheRecord: MediaBlobCacheRecord;
}>;
type ManagedMediaObjectUrlLease = Readonly<{
  key: string;
  url: string;
}>;
type ManagedMediaObjectUrlRetention = Readonly<{
  isAcquiredLease: boolean;
  objectUrlLease: ManagedMediaObjectUrlLease;
}>;
type ManagedMediaObjectUrlCacheEntry = {
  referenceCount: number;
  url: string;
};
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
const managedMediaObjectUrlCache = new Map<string, ManagedMediaObjectUrlCacheEntry>();

export function reviewMarkdownUrlTransform(url: string): string {
  return parseManagedMediaAssetId(url) === null ? defaultUrlTransform(url) : url;
}

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

function warnManagedMediaUnavailable(workspaceId: string, mediaAssetId: string, error: unknown): void {
  console.warn("Managed media download unavailable", {
    workspaceId,
    mediaAssetId,
    errorName: readErrorName(error),
    errorMessage: readErrorMessage(error),
  });
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

function createManagedMediaObjectUrlKey(mediaAsset: MediaAsset): string {
  return JSON.stringify([
    mediaAsset.workspaceId,
    mediaAsset.mediaAssetId,
    mediaAsset.sha256,
    mediaAsset.mimeType,
    mediaAsset.sizeBytes,
  ]);
}

function acquireManagedMediaObjectUrl(mediaAsset: MediaAsset, blob: Blob): ManagedMediaObjectUrlLease {
  const key = createManagedMediaObjectUrlKey(mediaAsset);
  const cachedEntry = managedMediaObjectUrlCache.get(key);
  if (cachedEntry !== undefined) {
    cachedEntry.referenceCount += 1;
    return {
      key,
      url: cachedEntry.url,
    };
  }

  const url = URL.createObjectURL(blob);
  managedMediaObjectUrlCache.set(key, {
    referenceCount: 1,
    url,
  });
  return {
    key,
    url,
  };
}

function releaseManagedMediaObjectUrl(lease: ManagedMediaObjectUrlLease): void {
  const cachedEntry = managedMediaObjectUrlCache.get(lease.key);
  if (cachedEntry === undefined) {
    throw new Error(`Managed media object URL release failed: cache entry was missing for key=${lease.key}`);
  }

  if (cachedEntry.url !== lease.url) {
    throw new Error(`Managed media object URL release failed: cache URL mismatch for key=${lease.key}`);
  }

  if (cachedEntry.referenceCount < 1) {
    throw new RangeError(`Managed media object URL release failed: invalid referenceCount=${cachedEntry.referenceCount} for key=${lease.key}`);
  }

  const nextReferenceCount = cachedEntry.referenceCount - 1;
  if (nextReferenceCount === 0) {
    URL.revokeObjectURL(cachedEntry.url);
    managedMediaObjectUrlCache.delete(lease.key);
    return;
  }

  cachedEntry.referenceCount = nextReferenceCount;
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

async function loadManagedMediaBlob(
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

function classifyManagedMediaKind(mimeType: string): ManagedMediaKind {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }

  if (normalizedMimeType.startsWith("audio/")) {
    return "audio";
  }

  if (normalizedMimeType.startsWith("video/")) {
    return "video";
  }

  return "attachment";
}

function resolveManagedMediaLabel(
  mediaAsset: MediaAsset,
  explicitLabel: string,
  fallbackLabel: string,
): string {
  const trimmedExplicitLabel = explicitLabel.trim();
  if (trimmedExplicitLabel !== "") {
    return trimmedExplicitLabel;
  }

  if (mediaAsset.sourceUrl !== null) {
    try {
      const sourceUrl = new URL(mediaAsset.sourceUrl);
      const fileName = sourceUrl.pathname.split("/").filter((part) => part !== "").at(-1) ?? "";
      if (fileName !== "") {
        return decodeURIComponent(fileName);
      }
    } catch {
      return fallbackLabel;
    }
  }

  return fallbackLabel;
}

function readTextFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(readTextFromReactNode).join("");
  }

  return "";
}

function readDecodedManagedImageDimensions(image: HTMLImageElement): ManagedMediaImageDimensions | null {
  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
    return {
      height: image.naturalHeight,
      width: image.naturalWidth,
    };
  }

  return null;
}

function waitForManagedImageLoad(image: HTMLImageElement, url: string): Promise<void> {
  if (image.complete) {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      return Promise.resolve();
    }

    return Promise.reject(new Error(`Managed media image load failed: objectUrl=${url}`));
  }

  return new Promise<void>((resolve, reject) => {
    image.onload = (): void => {
      resolve();
    };
    image.onerror = (): void => {
      reject(new Error(`Managed media image load failed: objectUrl=${url}`));
    };
  });
}

async function decodeManagedImageObjectUrl(
  url: string,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<ManagedMediaImageDimensions | null> {
  indexedDbOpenRecoveryState.throwIfFailed();
  const image = new Image();
  image.src = url;

  try {
    if (typeof image.decode === "function") {
      await waitForRecoveryGuardedManagedMediaPhase(
        () => image.decode(),
        indexedDbOpenRecoveryState,
      );
      indexedDbOpenRecoveryState.throwIfFailed();
    } else {
      await waitForRecoveryGuardedManagedMediaPhase(
        () => waitForManagedImageLoad(image, url),
        indexedDbOpenRecoveryState,
      );
      indexedDbOpenRecoveryState.throwIfFailed();
    }
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    throw new Error(`Managed media image decode failed: objectUrl=${url}, error=${readErrorMessage(error)}`);
  }

  return readDecodedManagedImageDimensions(image);
}

function createManagedImageStyle(imageDimensions: ManagedMediaImageDimensions | null): CSSProperties | undefined {
  if (imageDimensions === null) {
    return undefined;
  }

  return {
    aspectRatio: `${imageDimensions.width} / ${imageDimensions.height}`,
  };
}

function isReadyManagedMediaReference(
  loadState: ManagedMediaLoadState,
  workspaceId: string,
  mediaAssetId: string,
): boolean {
  return loadState.status === "ready"
    && loadState.mediaAsset.workspaceId === workspaceId
    && loadState.mediaAsset.mediaAssetId === mediaAssetId;
}

function ManagedMediaFallback(props: Readonly<{
  mediaAssetId: string;
  message: string;
}>): ReactElement {
  const { mediaAssetId, message } = props;

  return (
    <span
      className="review-markdown-managed-media review-markdown-media-fallback"
      data-fcasset-id={mediaAssetId}
      role="note"
    >
      {message}
    </span>
  );
}

function GeneratedImagePlaceholder(props: Readonly<{
  label: string;
  mediaAssetId: string;
  state: Exclude<ManagedMediaReferenceState, "ready">;
}>): ReactElement {
  const { label, mediaAssetId, state } = props;
  const { t } = useI18n();
  const isPending = state === "pending";

  return (
    <span
      className="review-markdown-managed-media review-markdown-media-image-placeholder"
      data-fcasset-id={mediaAssetId}
      data-state={state}
      aria-busy={isPending ? "true" : undefined}
      aria-label={t(
        isPending
          ? "reviewScreen.media.imagePendingAccessible"
          : "reviewScreen.media.imageFailedAccessible",
        { label },
      )}
      role={isPending ? "status" : "alert"}
    >
      {isPending ? null : (
        <svg
          className="review-markdown-media-image-placeholder-icon"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path d="M12 8V13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12 16.5H12.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M10.2 4.9L3.5 16.5C2.8 17.7 3.7 19.2 5.1 19.2H18.9C20.3 19.2 21.2 17.7 20.5 16.5L13.8 4.9C13 3.7 11 3.7 10.2 4.9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      )}
      <span className="review-markdown-media-image-placeholder-copy">
        {t(isPending ? "reviewScreen.media.imagePending" : "reviewScreen.media.imageFailed")}
      </span>
    </span>
  );
}

export function ManagedMediaReference(props: Readonly<{
  altText: string;
  children: ReactNode;
  localReadVersion: number;
  mediaAssetId: string;
  referencePresentation: ManagedMediaReferencePresentation;
  referenceState: ManagedMediaReferenceState;
  workspaceId: string | null;
}>): ReactElement {
  const {
    altText,
    children,
    localReadVersion,
    mediaAssetId,
    referencePresentation,
    referenceState,
    workspaceId,
  } = props;
  const { t } = useI18n();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const [loadState, setLoadState] = useState<ManagedMediaLoadState>({ status: "loading" });
  const loadStateRef = useRef<ManagedMediaLoadState>(loadState);

  function updateLoadState(nextLoadState: ManagedMediaLoadState): void {
    loadStateRef.current = nextLoadState;
    setLoadState(nextLoadState);
  }

  function retainObjectUrlForReadyMedia(
    currentLoadState: ManagedMediaLoadState,
    mediaAsset: MediaAsset,
    cacheRecord: MediaBlobCacheRecord,
  ): ManagedMediaObjectUrlRetention {
    const nextKey = createManagedMediaObjectUrlKey(mediaAsset);
    if (currentLoadState.status === "ready" && currentLoadState.objectUrlLease.key === nextKey) {
      return {
        isAcquiredLease: false,
        objectUrlLease: currentLoadState.objectUrlLease,
      };
    }

    return {
      isAcquiredLease: true,
      objectUrlLease: acquireManagedMediaObjectUrl(mediaAsset, cacheRecord.blob),
    };
  }

  const committedObjectUrlLease = referenceState === "ready" && loadState.status === "ready"
    ? loadState.objectUrlLease
    : null;

  useEffect(() => {
    if (committedObjectUrlLease === null) {
      return undefined;
    }

    if (loadState.status === "ready") {
      loadState.releaseProvisionalObjectUrlLease?.();
    }

    return () => {
      releaseManagedMediaObjectUrl(committedObjectUrlLease);
    };
  }, [committedObjectUrlLease]);

  useEffect(() => {
    if (referenceState !== "ready") {
      return undefined;
    }

    let isCancelled = false;
    let provisionalObjectUrlLease: ManagedMediaObjectUrlLease | null = null;

    function clearProvisionalObjectUrlLease(): void {
      provisionalObjectUrlLease = null;
    }

    function releaseProvisionalObjectUrlLease(): void {
      if (provisionalObjectUrlLease === null) {
        return;
      }

      releaseManagedMediaObjectUrl(provisionalObjectUrlLease);
      provisionalObjectUrlLease = null;
    }

    async function loadManagedMedia(): Promise<void> {
      try {
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error);
        return;
      }

      if (workspaceId === null) {
        updateLoadState({ status: "unavailable", mediaAsset: null });
        return;
      }

      if (isReadyManagedMediaReference(loadStateRef.current, workspaceId, mediaAssetId) === false) {
        updateLoadState({ status: "loading" });
      }

      let loadResult: ManagedMediaBlobLoadResult | null;
      try {
        loadResult = await waitForRecoveryGuardedManagedMediaPhase(
          () => loadManagedMediaBlob(
            workspaceId,
            mediaAssetId,
            indexedDbOpenRecoveryState,
          ),
          indexedDbOpenRecoveryState,
        );
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }
        if (isCancelled) {
          return;
        }

        warnManagedMediaUnavailable(workspaceId, mediaAssetId, error);
        updateLoadState({ status: "unavailable", mediaAsset: null });
        return;
      }

      if (isCancelled) {
        return;
      }

      if (loadResult === null) {
        updateLoadState({ status: "unavailable", mediaAsset: null });
        return;
      }

      let objectUrlRetention: ManagedMediaObjectUrlRetention;
      let imageDimensions: ManagedMediaImageDimensions | null = null;
      try {
        indexedDbOpenRecoveryState.throwIfFailed();
        const currentLoadState = loadStateRef.current;
        objectUrlRetention = retainObjectUrlForReadyMedia(currentLoadState, loadResult.mediaAsset, loadResult.cacheRecord);
        if (objectUrlRetention.isAcquiredLease) {
          provisionalObjectUrlLease = objectUrlRetention.objectUrlLease;
        }

        if (classifyManagedMediaKind(loadResult.mediaAsset.mimeType) === "image") {
          if (objectUrlRetention.isAcquiredLease) {
            imageDimensions = await waitForRecoveryGuardedManagedMediaPhase(
              () => decodeManagedImageObjectUrl(
                objectUrlRetention.objectUrlLease.url,
                indexedDbOpenRecoveryState,
              ),
              indexedDbOpenRecoveryState,
            );
            indexedDbOpenRecoveryState.throwIfFailed();
          } else {
            imageDimensions = currentLoadState.status === "ready"
              ? currentLoadState.imageDimensions
              : null;
          }
        }
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          releaseProvisionalObjectUrlLease();
          return;
        }
        if (isCancelled) {
          releaseProvisionalObjectUrlLease();
          return;
        }

        releaseProvisionalObjectUrlLease();
        warnManagedMediaUnavailable(workspaceId, mediaAssetId, error);
        updateLoadState({ status: "unavailable", mediaAsset: loadResult.mediaAsset });
        return;
      }

      if (isCancelled) {
        releaseProvisionalObjectUrlLease();
        return;
      }
      updateLoadState({
        imageDimensions,
        status: "ready",
        mediaAsset: loadResult.mediaAsset,
        objectUrlLease: objectUrlRetention.objectUrlLease,
        releaseProvisionalObjectUrlLease: objectUrlRetention.isAcquiredLease
          ? clearProvisionalObjectUrlLease
          : null,
        url: objectUrlRetention.objectUrlLease.url,
      });
    }

    void loadManagedMedia();

    return () => {
      isCancelled = true;
      releaseProvisionalObjectUrlLease();
    };
  }, [indexedDbOpenRecoveryState, localReadVersion, mediaAssetId, referenceState, workspaceId]);

  const childrenText = readTextFromReactNode(children);
  if (referenceState !== "ready") {
    const trimmedAltText = altText.trim();
    const trimmedChildrenText = childrenText.trim();
    const label = trimmedAltText !== ""
      ? trimmedAltText
      : trimmedChildrenText !== ""
        ? trimmedChildrenText
        : t("reviewScreen.media.imageAlt");
    return (
      <GeneratedImagePlaceholder
        label={label}
        mediaAssetId={mediaAssetId}
        state={referenceState}
      />
    );
  }

  if (loadState.status === "loading") {
    if (referencePresentation === "image") {
      return (
        <span
          className="review-markdown-managed-media review-markdown-media-image-loading"
          data-fcasset-id={mediaAssetId}
          aria-busy="true"
          aria-label={t("reviewScreen.media.loading")}
          role="status"
        />
      );
    }

    return (
      <span
        className="review-markdown-managed-media review-markdown-media-loading"
        data-fcasset-id={mediaAssetId}
        aria-busy="true"
      >
        {t("reviewScreen.media.loading")}
      </span>
    );
  }

  if (loadState.status === "unavailable") {
    return (
      <ManagedMediaFallback
        mediaAssetId={mediaAssetId}
        message={t("reviewScreen.media.unavailable")}
      />
    );
  }

  const mediaKind = classifyManagedMediaKind(loadState.mediaAsset.mimeType);
  const fallbackLabel = mediaKind === "audio"
    ? t("reviewScreen.media.audioLabel")
    : mediaKind === "video"
      ? t("reviewScreen.media.videoLabel")
      : mediaKind === "image"
        ? t("reviewScreen.media.imageAlt")
        : t("reviewScreen.media.attachmentLabel");
  const label = resolveManagedMediaLabel(loadState.mediaAsset, childrenText, fallbackLabel);

  if (mediaKind === "image") {
    return (
      <img
        className="review-markdown-media-image"
        src={loadState.url}
        alt={altText.trim() === "" ? t("reviewScreen.media.imageAlt") : altText}
        loading="lazy"
        decoding="async"
        style={createManagedImageStyle(loadState.imageDimensions)}
      />
    );
  }

  if (mediaKind === "audio") {
    return (
      <span className="review-markdown-managed-media review-markdown-media-audio" data-fcasset-id={mediaAssetId}>
        <span className="review-markdown-media-label">{label}</span>
        <audio className="review-markdown-media-control" src={loadState.url} controls preload="metadata" aria-label={label} />
      </span>
    );
  }

  if (mediaKind === "video") {
    return (
      <span className="review-markdown-managed-media review-markdown-media-video" data-fcasset-id={mediaAssetId}>
        <span className="review-markdown-media-label">{label}</span>
        <video className="review-markdown-media-control" src={loadState.url} controls preload="metadata" aria-label={label} />
      </span>
    );
  }

  return (
    <a
      className="review-markdown-managed-media review-markdown-media-attachment"
      href={loadState.url}
      target="_blank"
      rel="noreferrer"
      data-fcasset-id={mediaAssetId}
    >
      {label}
    </a>
  );
}

import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { defaultUrlTransform } from "react-markdown";
import { loadMediaAssetDownloadUrl } from "../../../api";
import { useI18n } from "../../../i18n";
import { loadMediaAssetRecord } from "../../../localDb/mediaAssets";
import {
  loadMediaBlobCacheRecord,
  writeMediaBlobCacheRecord,
  type MediaBlobCacheRecord,
} from "../../../localDb/mediaTransfers";
import type { MediaAsset } from "../../../types";

const FCASSET_URL_PREFIX = "fcasset:";
const MANAGED_MEDIA_DOWNLOAD_ATTEMPT_COUNT = 2;
const MANAGED_MEDIA_DOWNLOAD_RANGE_SIZE_BYTES = 4 * 1024 * 1024;

type ManagedMediaKind = "image" | "audio" | "video" | "attachment";
type ManagedMediaLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable"; mediaAsset: MediaAsset | null }>
  | Readonly<{
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

const activeManagedMediaDownloadPromises = new Map<string, Promise<MediaBlobCacheRecord>>();
const managedMediaObjectUrlCache = new Map<string, ManagedMediaObjectUrlCacheEntry>();

export function parseManagedMediaAssetId(url: string | null | undefined): string | null {
  if (url === null || url === undefined) {
    return null;
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.toLowerCase().startsWith(FCASSET_URL_PREFIX) === false) {
    return null;
  }

  const rawReference = trimmedUrl.slice(FCASSET_URL_PREFIX.length).replace(/^\/+/, "");
  const mediaAssetId = rawReference.split(/[?#]/, 1)[0]?.trim() ?? "";
  return mediaAssetId === "" ? null : mediaAssetId;
}

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

async function calculateSha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await requireSha256Digest().digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function readDownloadFailureBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
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
): Promise<ArrayBuffer> {
  try {
    return await response.arrayBuffer();
  } catch (error) {
    throw new Error(`Managed media download response body read failed: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, range=${rangeHeader}, status=${response.status}, error=${readErrorMessage(error)}`);
  }
}

async function fetchManagedMediaRangeBytes(
  mediaAsset: MediaAsset,
  downloadMethod: "GET",
  downloadUrl: string,
  range: ManagedMediaDownloadRange,
  isSingleRange: boolean,
): Promise<ArrayBuffer> {
  const rangeHeader = `bytes=${range.startByte}-${range.endByte}`;
  let response: Response;
  try {
    response = await fetch(downloadUrl, {
      method: downloadMethod,
      headers: {
        Range: rangeHeader,
      },
    });
  } catch (error) {
    throw new Error(`Managed media ranged download request failed: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, range=${rangeHeader}, error=${readErrorMessage(error)}`);
  }

  if (response.status === 206) {
    const bytes = await readManagedMediaResponseBytes(mediaAsset, response, rangeHeader);
    const expectedRangeSizeBytes = readManagedMediaDownloadRangeSize(range);
    if (bytes.byteLength !== expectedRangeSizeBytes) {
      throw new Error(`Managed media ranged download size mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, range=${rangeHeader}, expectedRangeSizeBytes=${expectedRangeSizeBytes}, actualRangeSizeBytes=${bytes.byteLength}, status=${response.status}`);
    }

    return bytes;
  }

  if (isSingleRange && response.status === 200) {
    const bytes = await readManagedMediaResponseBytes(mediaAsset, response, rangeHeader);
    if (bytes.byteLength !== mediaAsset.sizeBytes) {
      throw new Error(`Managed media full download size mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, sha256=${mediaAsset.sha256}, range=${rangeHeader}, expectedSizeBytes=${mediaAsset.sizeBytes}, actualSizeBytes=${bytes.byteLength}, status=${response.status}`);
    }

    return bytes;
  }

  if (response.ok === false) {
    const responseBody = await readDownloadFailureBody(response);
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
): Promise<ArrayBuffer> {
  const ranges = planManagedMediaDownloadRanges(mediaAsset.sizeBytes, MANAGED_MEDIA_DOWNLOAD_RANGE_SIZE_BYTES);
  const chunks: Array<ArrayBuffer> = [];
  for (const range of ranges) {
    chunks.push(await fetchManagedMediaRangeBytes(mediaAsset, downloadMethod, downloadUrl, range, ranges.length === 1));
  }

  return combineManagedMediaRangeBytes(mediaAsset, chunks);
}

async function verifyManagedMediaBytes(mediaAsset: MediaAsset, bytes: ArrayBuffer): Promise<Blob> {
  if (bytes.byteLength !== mediaAsset.sizeBytes) {
    throw new Error(`Managed media download size mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, expectedSizeBytes=${mediaAsset.sizeBytes}, actualSizeBytes=${bytes.byteLength}`);
  }

  const actualSha256 = await calculateSha256Hex(bytes);
  if (actualSha256 !== mediaAsset.sha256) {
    throw new Error(`Managed media download sha256 mismatch: workspaceId=${mediaAsset.workspaceId}, mediaAssetId=${mediaAsset.mediaAssetId}, expectedSha256=${mediaAsset.sha256}, actualSha256=${actualSha256}`);
  }

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

async function downloadVerifiedMediaBlob(mediaAsset: MediaAsset): Promise<Blob> {
  let lastError: unknown = null;
  for (let attemptNumber = 1; attemptNumber <= MANAGED_MEDIA_DOWNLOAD_ATTEMPT_COUNT; attemptNumber += 1) {
    const downloadResult = await loadMediaAssetDownloadUrl(mediaAsset.workspaceId, mediaAsset.mediaAssetId);
    assertDownloadMediaAssetMatchesLocal(mediaAsset, downloadResult.mediaAsset);
    let bytes: ArrayBuffer;
    try {
      bytes = await fetchManagedMediaBytes(mediaAsset, downloadResult.download.method, downloadResult.download.url);
    } catch (error) {
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

    return verifyManagedMediaBytes(mediaAsset, bytes);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function downloadMediaBlobCacheRecord(mediaAsset: MediaAsset): Promise<MediaBlobCacheRecord> {
  const activeDownloadPromise = activeManagedMediaDownloadPromises.get(mediaAsset.sha256);
  if (activeDownloadPromise !== undefined) {
    return activeDownloadPromise;
  }

  const downloadPromise = (async (): Promise<MediaBlobCacheRecord> => {
    const downloadedBlob = await downloadVerifiedMediaBlob(mediaAsset);
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
    await writeMediaBlobCacheRecord(cacheRecord);
    return cacheRecord;
  })().finally(() => {
    activeManagedMediaDownloadPromises.delete(mediaAsset.sha256);
  });
  activeManagedMediaDownloadPromises.set(mediaAsset.sha256, downloadPromise);
  return downloadPromise;
}

async function loadMediaBlobForReview(mediaAsset: MediaAsset): Promise<MediaBlobCacheRecord> {
  const cacheRecord = await loadMediaBlobCacheRecord(mediaAsset.sha256);
  if (cacheRecord !== null) {
    assertUsableMediaBlobCacheRecord(mediaAsset, cacheRecord);
    const accessedRecord: MediaBlobCacheRecord = {
      ...cacheRecord,
      lastAccessedAt: new Date().toISOString(),
    };
    await writeMediaBlobCacheRecord(accessedRecord);
    return accessedRecord;
  }

  return downloadMediaBlobCacheRecord(mediaAsset);
}

async function loadManagedMediaBlob(
  workspaceId: string,
  mediaAssetId: string,
): Promise<ManagedMediaBlobLoadResult | null> {
  const mediaAsset = await loadMediaAssetRecord(workspaceId, mediaAssetId);
  if (mediaAsset === null || mediaAsset.deletedAt !== null) {
    return null;
  }

  return {
    mediaAsset,
    cacheRecord: await loadMediaBlobForReview(mediaAsset),
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

export function ManagedMediaReference(props: Readonly<{
  altText: string;
  children: ReactNode;
  localReadVersion: number;
  mediaAssetId: string;
  workspaceId: string | null;
}>): ReactElement {
  const {
    altText,
    children,
    localReadVersion,
    mediaAssetId,
    workspaceId,
  } = props;
  const { t } = useI18n();
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

  const committedObjectUrlLease = loadState.status === "ready" ? loadState.objectUrlLease : null;

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
      if (workspaceId === null) {
        updateLoadState({ status: "unavailable", mediaAsset: null });
        return;
      }

      if (isReadyManagedMediaReference(loadStateRef.current, workspaceId, mediaAssetId) === false) {
        updateLoadState({ status: "loading" });
      }

      let loadResult: ManagedMediaBlobLoadResult | null;
      try {
        loadResult = await loadManagedMediaBlob(workspaceId, mediaAssetId);
      } catch (error) {
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
      try {
        objectUrlRetention = retainObjectUrlForReadyMedia(loadStateRef.current, loadResult.mediaAsset, loadResult.cacheRecord);
        if (objectUrlRetention.isAcquiredLease) {
          provisionalObjectUrlLease = objectUrlRetention.objectUrlLease;
        }
      } catch (error) {
        warnManagedMediaUnavailable(workspaceId, mediaAssetId, error);
        updateLoadState({ status: "unavailable", mediaAsset: loadResult.mediaAsset });
        return;
      }

      if (isCancelled) {
        releaseProvisionalObjectUrlLease();
        return;
      }
      updateLoadState({
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
  }, [localReadVersion, mediaAssetId, workspaceId]);

  if (loadState.status === "loading") {
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
  const childrenText = readTextFromReactNode(children);
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

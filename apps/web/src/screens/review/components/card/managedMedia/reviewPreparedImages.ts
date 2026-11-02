/**
 * Decoded review images kept ready before their card side mounts, so the card shown after a rating
 * and a revealed answer paint their images on the first frame: docs/fsrs-scheduling-logic.md#non-blocking-review
 */
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
} from "../../../../../appError/AppErrorContext";
import { parseManagedImageMarkdownReferences } from "../../../../../media/managedMediaMarkdown";
import type { MediaAsset } from "../../../../../types";
import {
  acquireManagedMediaObjectUrl,
  releaseManagedMediaObjectUrl,
  type ManagedMediaObjectUrlLease,
} from "./objectUrlLease";
import {
  loadManagedMediaBlob,
  readErrorMessage,
  readErrorName,
  waitForRecoveryGuardedManagedMediaPhase,
} from "./verifiedBlobLoader";

export type ManagedMediaImageDimensions = Readonly<{
  height: number;
  width: number;
}>;
export type PreparedReviewImage = Readonly<{
  blob: Blob;
  // Held so the browser keeps the decoded pixels for the card side's <img> with the same object URL.
  decodedImage: HTMLImageElement;
  imageDimensions: ManagedMediaImageDimensions | null;
  mediaAsset: MediaAsset;
  objectUrlLease: ManagedMediaObjectUrlLease;
}>;

// Keyed by workspace and media asset id because a card side knows only those before any async read.
const preparedReviewImages = new Map<string, PreparedReviewImage>();

function createPreparedReviewImageKey(workspaceId: string, mediaAssetId: string): string {
  return JSON.stringify([workspaceId, mediaAssetId]);
}

export function readManagedImageDimensions(image: HTMLImageElement): ManagedMediaImageDimensions | null {
  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
    return {
      height: image.naturalHeight,
      width: image.naturalWidth,
    };
  }

  return null;
}

/** Loads an image object URL; its natural size is readable afterwards, before the pixels are decoded. */
export async function loadManagedImageObjectUrl(
  url: string,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<HTMLImageElement> {
  indexedDbOpenRecoveryState.throwIfFailed();
  const image = new Image();
  const loadPromise = new Promise<void>((resolve, reject) => {
    image.onload = (): void => {
      resolve();
    };
    image.onerror = (): void => {
      reject(new Error(`Managed media image load failed: objectUrl=${url}`));
    };
  });
  image.src = url;

  try {
    await waitForRecoveryGuardedManagedMediaPhase(() => loadPromise, indexedDbOpenRecoveryState);
    indexedDbOpenRecoveryState.throwIfFailed();
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    throw new Error(`Managed media image load failed: objectUrl=${url}, error=${readErrorMessage(error)}`);
  }

  return image;
}

export async function decodeLoadedManagedImage(
  image: HTMLImageElement,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<void> {
  if (typeof image.decode !== "function") {
    return;
  }

  try {
    await waitForRecoveryGuardedManagedMediaPhase(() => image.decode(), indexedDbOpenRecoveryState);
    indexedDbOpenRecoveryState.throwIfFailed();
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    throw new Error(`Managed media image decode failed: objectUrl=${image.src}, error=${readErrorMessage(error)}`);
  }
}

/** Ready image media asset ids referenced by the given card side texts, in first-seen order. */
export function collectReviewImageMediaAssetIds(texts: ReadonlyArray<string>): ReadonlyArray<string> {
  const mediaAssetIds = new Set<string>();
  for (const text of texts) {
    for (const reference of parseManagedImageMarkdownReferences(text)) {
      if (reference.state === "ready") {
        mediaAssetIds.add(reference.mediaAssetId);
      }
    }
  }

  return [...mediaAssetIds];
}

export function getPreparedReviewImage(workspaceId: string, mediaAssetId: string): PreparedReviewImage | null {
  return preparedReviewImages.get(createPreparedReviewImageKey(workspaceId, mediaAssetId)) ?? null;
}

/** Releases every prepared image except the kept ids of `workspaceId`; a null workspace keeps nothing. */
export function releasePreparedImagesExcept(
  workspaceId: string | null,
  keptMediaAssetIds: ReadonlyArray<string>,
): void {
  const keptKeys = new Set(workspaceId === null
    ? []
    : keptMediaAssetIds.map((mediaAssetId) => createPreparedReviewImageKey(workspaceId, mediaAssetId)));
  for (const [key, preparedImage] of [...preparedReviewImages]) {
    if (keptKeys.has(key) === false) {
      preparedReviewImages.delete(key);
      releaseManagedMediaObjectUrl(preparedImage.objectUrlLease);
    }
  }
}

async function prepareReviewImage(
  workspaceId: string,
  mediaAssetId: string,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
  signal: AbortSignal,
): Promise<void> {
  const loadResult = await loadManagedMediaBlob(workspaceId, mediaAssetId, indexedDbOpenRecoveryState);
  if (
    signal.aborted
    || loadResult === null
    || loadResult.mediaAsset.mimeType.toLowerCase().startsWith("image/") === false
  ) {
    return;
  }

  const objectUrlLease = acquireManagedMediaObjectUrl(loadResult.mediaAsset, loadResult.cacheRecord.blob);
  let decodedImage: HTMLImageElement;
  try {
    decodedImage = await loadManagedImageObjectUrl(objectUrlLease.url, indexedDbOpenRecoveryState);
    await decodeLoadedManagedImage(decodedImage, indexedDbOpenRecoveryState);
  } catch (error) {
    releaseManagedMediaObjectUrl(objectUrlLease);
    throw error;
  }

  const key = createPreparedReviewImageKey(workspaceId, mediaAssetId);
  if (signal.aborted || preparedReviewImages.has(key)) {
    releaseManagedMediaObjectUrl(objectUrlLease);
    return;
  }

  preparedReviewImages.set(key, {
    blob: loadResult.cacheRecord.blob,
    decodedImage,
    imageDimensions: readManagedImageDimensions(decodedImage),
    mediaAsset: loadResult.mediaAsset,
    objectUrlLease,
  });
}

/**
 * Loads, decodes and stores the given images. A failed image is logged and left to the card side's
 * own on-screen loading path; abort stops storing results for a review pair that is no longer current.
 */
export async function prepareReviewImages(
  workspaceId: string,
  mediaAssetIds: ReadonlyArray<string>,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
  signal: AbortSignal,
): Promise<void> {
  await Promise.all(mediaAssetIds.map(async (mediaAssetId): Promise<void> => {
    if (getPreparedReviewImage(workspaceId, mediaAssetId) !== null) {
      return;
    }

    try {
      await prepareReviewImage(workspaceId, mediaAssetId, indexedDbOpenRecoveryState, signal);
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error) || signal.aborted) {
        return;
      }

      console.warn("Review image preparation failed", {
        workspaceId,
        mediaAssetId,
        errorName: readErrorName(error),
        errorMessage: readErrorMessage(error),
      });
    }
  }));
}

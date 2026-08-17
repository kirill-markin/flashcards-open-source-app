import type { MediaAsset } from "../../../../../types";

export type ManagedMediaObjectUrlLease = Readonly<{
  key: string;
  url: string;
}>;
type ManagedMediaObjectUrlCacheEntry = {
  referenceCount: number;
  url: string;
};

const managedMediaObjectUrlCache = new Map<string, ManagedMediaObjectUrlCacheEntry>();

export function createManagedMediaObjectUrlKey(mediaAsset: MediaAsset): string {
  return JSON.stringify([
    mediaAsset.workspaceId,
    mediaAsset.mediaAssetId,
    mediaAsset.sha256,
    mediaAsset.mimeType,
    mediaAsset.sizeBytes,
  ]);
}

export function acquireManagedMediaObjectUrl(mediaAsset: MediaAsset, blob: Blob): ManagedMediaObjectUrlLease {
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

export function releaseManagedMediaObjectUrl(lease: ManagedMediaObjectUrlLease): void {
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

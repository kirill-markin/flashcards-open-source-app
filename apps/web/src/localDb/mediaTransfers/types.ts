import type { MediaAsset } from "../../types";

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

export type PersistLocalMediaUploadInput = Readonly<{
  mediaAsset: MediaAsset;
  cacheRecord: MediaBlobCacheRecord;
  upload: EnqueueMediaTransferUploadInput;
}>;

export type MediaUploadTransferForMediaAsset = Readonly<{
  mediaAssetId: string;
  transfer: MediaTransferQueueRecord;
}>;

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

export type MarkMediaUploadTransferDueForRetryInput = Readonly<{
  transferId: string;
  workspaceId: string;
  mediaAssetId: string;
  retryAt: string;
}>;

export type MarkMediaUploadTransferCompletionTerminalInput = Readonly<{
  transferId: string;
  workspaceId: string;
  mediaAssetId: string;
  failedAt: string;
  lastError: string;
  nextAttemptAt: string;
}>;

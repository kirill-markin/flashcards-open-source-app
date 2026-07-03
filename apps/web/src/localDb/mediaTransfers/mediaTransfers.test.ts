// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearWebSyncCache } from "../core/cache";
import {
  claimNextDueMediaTransfer,
  claimNextDueMediaTransferByKind,
  enqueueMediaTransferDownload,
  enqueueMediaTransferUpload,
  loadMediaTransferQueueRecord,
  loadNextPendingMediaTransferAttemptAtByKind,
  markClaimedMediaTransferSucceeded,
  markMediaTransferFailed,
  recoverStaleInProgressMediaTransfersByKind,
  renewInProgressMediaTransferClaim,
} from "./mediaTransfers";

describe("localDb media transfers", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
  });

  it("claims due transfers by next attempt time, creation time, and transfer id", async () => {
    await enqueueMediaTransferDownload({
      transferId: "transfer-z",
      workspaceId: "workspace-1",
      mediaAssetId: "media-asset-1",
      sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      createdAt: "2026-03-10T09:00:00.000Z",
      nextAttemptAt: "2026-03-10T10:00:00.000Z",
    });
    await enqueueMediaTransferDownload({
      transferId: "transfer-a",
      workspaceId: "workspace-1",
      mediaAssetId: "media-asset-2",
      sha256: "6e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      createdAt: "2026-03-10T09:05:00.000Z",
      nextAttemptAt: "2026-03-10T10:00:00.000Z",
    });

    await expect(claimNextDueMediaTransfer(
      "workspace-1",
      "2026-03-10T10:00:00.000Z",
    )).resolves.toEqual(expect.objectContaining({
      transferId: "transfer-z",
      status: "in_progress",
      claimedAt: "2026-03-10T10:00:00.000Z",
    }));
  });

  it("claims due upload transfers without taking due download work", async () => {
    await enqueueMediaTransferDownload({
      transferId: "download-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "media-asset-download",
      sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      createdAt: "2026-03-10T09:00:00.000Z",
      nextAttemptAt: "2026-03-10T09:30:00.000Z",
    });
    await enqueueMediaTransferUpload({
      transferId: "upload-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "media-asset-upload",
      sha256: "6e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      sourceBlobCacheKey: "6e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      createdAt: "2026-03-10T09:05:00.000Z",
      nextAttemptAt: "2026-03-10T09:45:00.000Z",
    });

    await expect(claimNextDueMediaTransferByKind(
      "workspace-1",
      "upload",
      "2026-03-10T10:00:00.000Z",
    )).resolves.toEqual(expect.objectContaining({
      transferId: "upload-transfer",
      kind: "upload",
      status: "in_progress",
      claimedAt: "2026-03-10T10:00:00.000Z",
    }));

    await expect(claimNextDueMediaTransfer(
      "workspace-1",
      "2026-03-10T10:01:00.000Z",
    )).resolves.toEqual(expect.objectContaining({
      transferId: "download-transfer",
      kind: "download",
    }));
  });

  it("loads the earliest pending upload attempt time without using download work", async () => {
    await enqueueMediaTransferDownload({
      transferId: "download-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "media-asset-download",
      sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      createdAt: "2026-03-10T09:00:00.000Z",
      nextAttemptAt: "2026-03-10T09:05:00.000Z",
    });
    await enqueueMediaTransferUpload({
      transferId: "queued-upload-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "queued-media-asset-upload",
      sha256: "6e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      sourceBlobCacheKey: "6e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      createdAt: "2026-03-10T09:10:00.000Z",
      nextAttemptAt: "2026-03-10T09:40:00.000Z",
    });
    await enqueueMediaTransferUpload({
      transferId: "retry-upload-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "retry-media-asset-upload",
      sha256: "7e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      sourceBlobCacheKey: "7e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      createdAt: "2026-03-10T09:15:00.000Z",
      nextAttemptAt: "2026-03-10T09:45:00.000Z",
    });
    await markMediaTransferFailed(
      "retry-upload-transfer",
      "2026-03-10T09:20:00.000Z",
      "retryable upload failure",
      "2026-03-10T09:30:00.000Z",
    );

    await expect(loadNextPendingMediaTransferAttemptAtByKind(
      "workspace-1",
      "upload",
    )).resolves.toBe("2026-03-10T09:30:00.000Z");
  });

  it("recovers only stale in-progress upload transfers for retry", async () => {
    await enqueueMediaTransferUpload({
      transferId: "stale-upload-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "stale-media-asset-upload",
      sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      sourceBlobCacheKey: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      createdAt: "2026-03-10T09:00:00.000Z",
      nextAttemptAt: "2026-03-10T09:00:00.000Z",
    });
    await enqueueMediaTransferUpload({
      transferId: "fresh-upload-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "fresh-media-asset-upload",
      sha256: "6e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      sourceBlobCacheKey: "6e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      createdAt: "2026-03-10T09:01:00.000Z",
      nextAttemptAt: "2026-03-10T09:01:00.000Z",
    });
    await enqueueMediaTransferDownload({
      transferId: "stale-download-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "stale-media-asset-download",
      sha256: "7e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      createdAt: "2026-03-10T09:02:00.000Z",
      nextAttemptAt: "2026-03-10T09:02:00.000Z",
    });

    await expect(claimNextDueMediaTransferByKind(
      "workspace-1",
      "upload",
      "2026-03-10T10:00:00.000Z",
    )).resolves.toEqual(expect.objectContaining({
      transferId: "stale-upload-transfer",
      status: "in_progress",
    }));
    await expect(claimNextDueMediaTransferByKind(
      "workspace-1",
      "upload",
      "2026-03-10T10:10:00.000Z",
    )).resolves.toEqual(expect.objectContaining({
      transferId: "fresh-upload-transfer",
      status: "in_progress",
    }));
    await expect(claimNextDueMediaTransfer(
      "workspace-1",
      "2026-03-10T10:00:00.000Z",
    )).resolves.toEqual(expect.objectContaining({
      transferId: "stale-download-transfer",
      status: "in_progress",
    }));

    await expect(recoverStaleInProgressMediaTransfersByKind({
      workspaceId: "workspace-1",
      kind: "upload",
      staleClaimedBefore: "2026-03-10T10:05:00.000Z",
      recoveredAt: "2026-03-10T10:30:00.000Z",
      nextAttemptAt: "2026-03-10T10:30:00.000Z",
      lastError: "stale upload claim recovered",
    })).resolves.toBe(1);

    await expect(loadMediaTransferQueueRecord("stale-upload-transfer")).resolves.toEqual(expect.objectContaining({
      transferId: "stale-upload-transfer",
      kind: "upload",
      status: "failed",
      attemptCount: 1,
      nextAttemptAt: "2026-03-10T10:30:00.000Z",
      lastError: "stale upload claim recovered",
      claimedAt: null,
      completedAt: null,
      updatedAt: "2026-03-10T10:30:00.000Z",
    }));
    await expect(loadMediaTransferQueueRecord("fresh-upload-transfer")).resolves.toEqual(expect.objectContaining({
      transferId: "fresh-upload-transfer",
      kind: "upload",
      status: "in_progress",
      claimedAt: "2026-03-10T10:10:00.000Z",
    }));
    await expect(loadMediaTransferQueueRecord("stale-download-transfer")).resolves.toEqual(expect.objectContaining({
      transferId: "stale-download-transfer",
      kind: "download",
      status: "in_progress",
      claimedAt: "2026-03-10T10:00:00.000Z",
    }));
  });

  it("renews in-progress upload claims and rejects stale claim tokens", async () => {
    await enqueueMediaTransferUpload({
      transferId: "renewed-upload-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "renewed-media-asset-upload",
      sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      sourceBlobCacheKey: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      createdAt: "2026-03-10T09:00:00.000Z",
      nextAttemptAt: "2026-03-10T09:00:00.000Z",
    });
    await expect(claimNextDueMediaTransferByKind(
      "workspace-1",
      "upload",
      "2026-03-10T10:00:00.000Z",
    )).resolves.toEqual(expect.objectContaining({
      transferId: "renewed-upload-transfer",
      status: "in_progress",
      claimedAt: "2026-03-10T10:00:00.000Z",
    }));

    await expect(renewInProgressMediaTransferClaim({
      transferId: "renewed-upload-transfer",
      kind: "upload",
      expectedClaimedAt: "2026-03-10T10:00:00.000Z",
      renewedAt: "2026-03-10T10:20:00.000Z",
    })).resolves.toEqual(expect.objectContaining({
      transferId: "renewed-upload-transfer",
      status: "in_progress",
      claimedAt: "2026-03-10T10:20:00.000Z",
    }));

    await expect(recoverStaleInProgressMediaTransfersByKind({
      workspaceId: "workspace-1",
      kind: "upload",
      staleClaimedBefore: "2026-03-10T10:05:00.000Z",
      recoveredAt: "2026-03-10T10:30:00.000Z",
      nextAttemptAt: "2026-03-10T10:30:00.000Z",
      lastError: "stale upload claim recovered",
    })).resolves.toBe(0);
    await expect(markClaimedMediaTransferSucceeded({
      transferId: "renewed-upload-transfer",
      kind: "upload",
      expectedClaimedAt: "2026-03-10T10:00:00.000Z",
      completedAt: "2026-03-10T10:31:00.000Z",
    })).rejects.toThrow("transfer claim token mismatch");
    await expect(markClaimedMediaTransferSucceeded({
      transferId: "renewed-upload-transfer",
      kind: "upload",
      expectedClaimedAt: "2026-03-10T10:20:00.000Z",
      completedAt: "2026-03-10T10:31:00.000Z",
    })).resolves.toBeUndefined();
  });
});

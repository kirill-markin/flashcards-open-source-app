// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearWebSyncCache } from "../core/cache";
import {
  claimNextDueMediaTransfer,
  enqueueMediaTransferDownload,
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
});

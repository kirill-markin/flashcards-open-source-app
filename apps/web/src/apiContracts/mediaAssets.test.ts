import { describe, expect, it } from "vitest";
import type { MediaAsset } from "../types";
import { parseSyncPullResultResponse } from "./sync";

const mediaAssetFixture: MediaAsset = {
  mediaAssetId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  mimeType: "image/png",
  sizeBytes: 42817,
  sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
  storageKey: "media-assets/workspaces/11111111-1111-4111-8111-111111111111/assets/22222222-2222-4222-8222-222222222222/5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
  sourceUrl: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  clientUpdatedAt: "2026-03-10T09:00:01.000Z",
  lastModifiedByReplicaId: "33333333-3333-4333-8333-333333333333",
  lastOperationId: "operation-1",
  updatedAt: "2026-03-10T09:00:02.000Z",
  deletedAt: "2026-03-10T09:30:00.000Z",
};

describe("media asset API contracts", () => {
  it("parses media asset hot sync tombstones", () => {
    const result = parseSyncPullResultResponse({
      changes: [
        {
          changeId: 10,
          entityType: "media_asset",
          entityId: mediaAssetFixture.mediaAssetId,
          action: "upsert",
          payload: mediaAssetFixture,
        },
      ],
      nextHotChangeId: 10,
      hasMore: false,
    }, "POST /sync/pull");

    const change = result.changes[0];
    expect(change?.entityType).toBe("media_asset");
    if (change?.entityType !== "media_asset") {
      throw new Error("Expected sync change to parse as a media asset");
    }

    expect(change.payload).toEqual(mediaAssetFixture);
  });
});

import { describe, expect, it } from "vitest";
import type { MediaAsset } from "../types";
import {
  parseMediaAssetDownloadUrlResponse,
  parseMediaAssetUploadSessionAbortResponse,
  parseMediaAssetUploadSessionCompleteResponse,
  parseMediaAssetUploadSessionCreateResponse,
  parseMediaAssetUploadSessionPartUrlsResponse,
} from "./mediaAssets";
import { parseSyncPullResultResponse } from "./sync";

const mediaAssetFixture: MediaAsset = {
  mediaAssetId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  mimeType: "image/png",
  sizeBytes: 42817,
  sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
  sourceUrl: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  clientUpdatedAt: "2026-03-10T09:00:01.000Z",
  lastModifiedByReplicaId: "33333333-3333-4333-8333-333333333333",
  lastOperationId: "operation-1",
  updatedAt: "2026-03-10T09:00:02.000Z",
  deletedAt: "2026-03-10T09:30:00.000Z",
};

describe("media asset API contracts", () => {
  it("parses direct media download URLs with range support", () => {
    const result = parseMediaAssetDownloadUrlResponse({
      mediaAsset: {
        ...mediaAssetFixture,
        deletedAt: null,
      },
      download: {
        method: "GET",
        url: "https://downloads.example.test/media-object",
        expiresAt: "2026-03-10T10:00:00.000Z",
        rangeRequests: true,
      },
    }, "GET /workspaces/workspace-1/media-assets/media-asset-1/download-url");

    expect(result).toEqual({
      mediaAsset: {
        ...mediaAssetFixture,
        deletedAt: null,
      },
      download: {
        method: "GET",
        url: "https://downloads.example.test/media-object",
        expiresAt: "2026-03-10T10:00:00.000Z",
        rangeRequests: true,
      },
    });
  });

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

  it("parses upload-session reuse responses without backend-only blob fields", () => {
    const result = parseMediaAssetUploadSessionCreateResponse({
      workspaceId: mediaAssetFixture.workspaceId,
      mediaAssetId: mediaAssetFixture.mediaAssetId,
      status: "already_available",
      mediaAsset: {
        ...mediaAssetFixture,
        storageKey: "private/backend/object",
        mediaBlobId: "blob-1",
      },
      uploadSession: null,
    }, "POST /workspaces/workspace-1/media-assets/upload-sessions");

    expect(result).toEqual({
      workspaceId: mediaAssetFixture.workspaceId,
      mediaAssetId: mediaAssetFixture.mediaAssetId,
      status: "already_available",
      mediaAsset: mediaAssetFixture,
      uploadSession: null,
    });
    expect(result.mediaAsset).not.toHaveProperty("storageKey");
    expect(result.mediaAsset).not.toHaveProperty("mediaBlobId");
  });

  it("parses upload-session creation responses", () => {
    const result = parseMediaAssetUploadSessionCreateResponse({
      workspaceId: mediaAssetFixture.workspaceId,
      mediaAssetId: mediaAssetFixture.mediaAssetId,
      status: "upload_required",
      mediaAsset: null,
      uploadSession: {
        sessionId: "55555555-5555-4555-8555-555555555555",
        expiresAt: "2026-03-10T10:00:00.000Z",
        partSizeBytes: 8388608,
        partCount: 2,
        storageKey: "private/backend/staging",
      },
    }, "POST /workspaces/workspace-1/media-assets/upload-sessions");

    expect(result).toEqual({
      workspaceId: mediaAssetFixture.workspaceId,
      mediaAssetId: mediaAssetFixture.mediaAssetId,
      status: "upload_required",
      mediaAsset: null,
      uploadSession: {
        sessionId: "55555555-5555-4555-8555-555555555555",
        expiresAt: "2026-03-10T10:00:00.000Z",
        partSizeBytes: 8388608,
        partCount: 2,
      },
    });
    expect(result.uploadSession).not.toHaveProperty("storageKey");
  });

  it("parses upload part URL responses", () => {
    const result = parseMediaAssetUploadSessionPartUrlsResponse({
      sessionId: "55555555-5555-4555-8555-555555555555",
      partUrls: [
        {
          partNumber: 1,
          method: "PUT",
          url: "https://uploads.example.test/part-1",
          expiresAt: "2026-03-10T10:00:00.000Z",
          headers: {
            "x-amz-checksum-sha256": "checksum-1",
            "content-type": "image/png",
          },
        },
      ],
    }, "POST /workspaces/workspace-1/media-assets/upload-sessions/session-1/parts");

    expect(result).toEqual({
      sessionId: "55555555-5555-4555-8555-555555555555",
      partUrls: [
        {
          partNumber: 1,
          method: "PUT",
          url: "https://uploads.example.test/part-1",
          expiresAt: "2026-03-10T10:00:00.000Z",
          headers: {
            "x-amz-checksum-sha256": "checksum-1",
            "content-type": "image/png",
          },
        },
      ],
    });
  });

  it("parses upload completion and abort responses", () => {
    expect(parseMediaAssetUploadSessionCompleteResponse({
      mediaAsset: mediaAssetFixture,
      applied: true,
    }, "POST /workspaces/workspace-1/media-assets/upload-sessions/session-1/complete")).toEqual({
      mediaAsset: mediaAssetFixture,
      applied: true,
    });

    expect(parseMediaAssetUploadSessionAbortResponse({
      sessionId: "55555555-5555-4555-8555-555555555555",
      abortedAt: "2026-03-10T10:05:00.000Z",
    }, "POST /workspaces/workspace-1/media-assets/upload-sessions/session-1/abort")).toEqual({
      sessionId: "55555555-5555-4555-8555-555555555555",
      abortedAt: "2026-03-10T10:05:00.000Z",
    });
  });

  it("reports endpoint and field path for invalid upload part URL headers", () => {
    expect(() => parseMediaAssetUploadSessionPartUrlsResponse({
      sessionId: "55555555-5555-4555-8555-555555555555",
      partUrls: [
        {
          partNumber: 1,
          method: "PUT",
          url: "https://uploads.example.test/part-1",
          expiresAt: "2026-03-10T10:00:00.000Z",
          headers: {
            "x-amz-checksum-sha256": 123,
          },
        },
      ],
    }, "POST /workspaces/workspace-1/media-assets/upload-sessions/session-1/parts")).toThrow(
      "Invalid API response for POST /workspaces/workspace-1/media-assets/upload-sessions/session-1/parts: partUrls[0].headers.x-amz-checksum-sha256 must be string",
    );
  });
});

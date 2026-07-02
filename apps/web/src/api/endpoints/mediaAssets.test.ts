// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import { createJsonResponse } from "../ApiTestSupport";
import { primeSessionCsrfToken } from "../transport/transport";
import type { MediaAsset, MediaAssetUploadSessionCreateInput } from "../../types";
import {
  abortMediaAssetUploadSession,
  completeMediaAssetUploadSession,
  createMediaAssetUploadPartUrls,
  createMediaAssetUploadSession,
} from "./mediaAssets";

const mediaAssetFixture: MediaAsset = {
  mediaAssetId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "workspace-1",
  mimeType: "image/png",
  sizeBytes: 42817,
  sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
  sourceUrl: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  clientUpdatedAt: "2026-03-10T09:00:01.000Z",
  lastModifiedByReplicaId: "33333333-3333-4333-8333-333333333333",
  lastOperationId: "operation-1",
  updatedAt: "2026-03-10T09:00:02.000Z",
  deletedAt: null,
};

const uploadSessionCreateInput: MediaAssetUploadSessionCreateInput = {
  mediaAssetId: mediaAssetFixture.mediaAssetId,
  mimeType: mediaAssetFixture.mimeType,
  sizeBytes: mediaAssetFixture.sizeBytes,
  sha256: mediaAssetFixture.sha256,
  partSizeBytes: 8388608,
  partCount: 1,
  sourceUrl: null,
  createdAt: mediaAssetFixture.createdAt,
  clientUpdatedAt: mediaAssetFixture.clientUpdatedAt,
  lastModifiedByReplicaId: mediaAssetFixture.lastModifiedByReplicaId,
  lastOperationId: mediaAssetFixture.lastOperationId,
};

describe("media asset API endpoints", () => {
  it("creates media upload sessions with JSON payloads", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        workspaceId: "workspace-1",
        mediaAssetId: mediaAssetFixture.mediaAssetId,
        status: "upload_required",
        mediaAsset: null,
        uploadSession: {
          sessionId: "55555555-5555-4555-8555-555555555555",
          expiresAt: "2026-03-10T10:00:00.000Z",
          partSizeBytes: 8388608,
          partCount: 1,
        },
      }), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createMediaAssetUploadSession("workspace-1", uploadSessionCreateInput);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/workspaces/workspace-1/media-assets/upload-sessions");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify(uploadSessionCreateInput));
    expect(result).toEqual({
      workspaceId: "workspace-1",
      mediaAssetId: mediaAssetFixture.mediaAssetId,
      status: "upload_required",
      mediaAsset: null,
      uploadSession: {
        sessionId: "55555555-5555-4555-8555-555555555555",
        expiresAt: "2026-03-10T10:00:00.000Z",
        partSizeBytes: 8388608,
        partCount: 1,
      },
    });
  });

  it("calls media upload part, complete, and abort endpoints", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const partUrlsInput = {
      parts: [
        {
          partNumber: 1,
          sha256: "1e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
        },
      ],
    };
    const completeInput = {
      parts: [
        {
          partNumber: 1,
          eTag: "etag-1",
          sha256: "1e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
        },
      ],
    };
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        sessionId: "55555555-5555-4555-8555-555555555555",
        partUrls: [
          {
            partNumber: 1,
            method: "PUT",
            url: "https://uploads.example.test/part-1",
            expiresAt: "2026-03-10T10:00:00.000Z",
            headers: {
              "x-amz-checksum-sha256": "checksum-1",
            },
          },
        ],
      }))
      .mockResolvedValueOnce(createJsonResponse({
        mediaAsset: mediaAssetFixture,
        applied: true,
      }))
      .mockResolvedValueOnce(createJsonResponse({
        sessionId: "55555555-5555-4555-8555-555555555555",
        abortedAt: "2026-03-10T10:05:00.000Z",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createMediaAssetUploadPartUrls(
      "workspace-1",
      "55555555-5555-4555-8555-555555555555",
      partUrlsInput,
    )).resolves.toEqual({
      sessionId: "55555555-5555-4555-8555-555555555555",
      partUrls: [
        {
          partNumber: 1,
          method: "PUT",
          url: "https://uploads.example.test/part-1",
          expiresAt: "2026-03-10T10:00:00.000Z",
          headers: {
            "x-amz-checksum-sha256": "checksum-1",
          },
        },
      ],
    });
    await expect(completeMediaAssetUploadSession(
      "workspace-1",
      "55555555-5555-4555-8555-555555555555",
      completeInput,
    )).resolves.toEqual({
      mediaAsset: mediaAssetFixture,
      applied: true,
    });
    await expect(abortMediaAssetUploadSession(
      "workspace-1",
      "55555555-5555-4555-8555-555555555555",
    )).resolves.toEqual({
      sessionId: "55555555-5555-4555-8555-555555555555",
      abortedAt: "2026-03-10T10:05:00.000Z",
    });

    const partUrlsRequest = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const completeRequest = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const abortRequest = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/workspaces/workspace-1/media-assets/upload-sessions/55555555-5555-4555-8555-555555555555/parts");
    expect(partUrlsRequest?.method).toBe("POST");
    expect(partUrlsRequest?.body).toBe(JSON.stringify(partUrlsInput));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8080/v1/workspaces/workspace-1/media-assets/upload-sessions/55555555-5555-4555-8555-555555555555/complete");
    expect(completeRequest?.method).toBe("POST");
    expect(completeRequest?.body).toBe(JSON.stringify(completeInput));
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:8080/v1/workspaces/workspace-1/media-assets/upload-sessions/55555555-5555-4555-8555-555555555555/abort");
    expect(abortRequest?.method).toBe("POST");
    expect(abortRequest?.body).toBeUndefined();
  });
});

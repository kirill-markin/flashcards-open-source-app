// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadMediaAssetRecord } from "../../../localDb/mediaAssets";
import { enqueueMediaTransferUpload } from "../../../localDb/mediaTransfers";
import {
  createJsonResponse,
  createTestBlob,
  createUploadRequiredResponse,
  createdAt,
  futurePartUrlExpiresAt,
  helloWorldSha256,
  installationId,
  loadMediaTransferQueueRecord,
  mediaAssetFixture,
  mediaAssetId,
  parseRequestBody,
  primeSessionCsrfToken,
  processDueMediaUploadTransfersForWorkspace,
  resetMediaUploadTransferTestState,
  seedQueuedUpload,
  textMimeType,
  transferId,
  workspaceId,
  workspaceReplicaId,
} from "./mediaUploadTransferTestSupport";

async function seedQueuedUploadTransferWithoutCacheBlob(): Promise<void> {
  await enqueueMediaTransferUpload({
    transferId,
    workspaceId,
    mediaAssetId,
    sha256: helloWorldSha256,
    mimeType: textMimeType,
    sizeBytes: 11,
    sourceBlobCacheKey: helloWorldSha256,
    createdAt,
    nextAttemptAt: createdAt,
  });
}

describe("media upload transfer runner", () => {
  beforeEach(resetMediaUploadTransferTestState);

  it("uploads a queued cached blob through a multipart session", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponse())
      .mockResolvedValueOnce(createJsonResponse({
        sessionId: "55555555-5555-4555-8555-555555555555",
        partUrls: [
          {
            partNumber: 1,
            method: "PUT",
            url: "https://uploads.example.test/part-1",
            expiresAt: futurePartUrlExpiresAt,
            headers: {
              "x-amz-checksum-sha256": "checksum-1",
            },
          },
        ],
      }))
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: {
          ETag: "\"etag-1\"",
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        mediaAsset: mediaAssetFixture,
        applied: true,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const createSessionInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(parseRequestBody(createSessionInit)).toEqual({
      mediaAssetId,
      mimeType: textMimeType,
      sizeBytes: 11,
      sha256: helloWorldSha256,
      partSizeBytes: 8388608,
      partCount: 1,
      sourceUrl: null,
      createdAt,
      clientUpdatedAt: createdAt,
      lastModifiedByReplicaId: workspaceReplicaId,
      lastOperationId: transferId,
    });
    expect(workspaceReplicaId).not.toBe(installationId);
    const lifecycleSignal = createSessionInit?.signal;
    expect(lifecycleSignal).toBeInstanceOf(AbortSignal);
    const partUrlsInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(partUrlsInit?.signal).toBe(lifecycleSignal);
    expect(parseRequestBody(partUrlsInit)).toEqual({
      parts: [
        {
          partNumber: 1,
          sha256: helloWorldSha256,
        },
      ],
    });

    const signedPutInit = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://uploads.example.test/part-1");
    expect(signedPutInit?.method).toBe("PUT");
    expect(signedPutInit?.signal).toBe(lifecycleSignal);
    expect((signedPutInit?.headers as Readonly<Record<string, string>> | undefined)?.["x-amz-checksum-sha256"]).toBe("checksum-1");
    await expect((signedPutInit?.body as Blob).text()).resolves.toBe("hello world");
    const completionInit = fetchMock.mock.calls[3]?.[1] as RequestInit | undefined;
    expect(completionInit?.signal).toBeInstanceOf(AbortSignal);
    expect(parseRequestBody(completionInit)).toEqual({
      parts: [
        {
          partNumber: 1,
          eTag: "\"etag-1\"",
          sha256: helloWorldSha256,
        },
      ],
    });

    await expect(loadMediaAssetRecord(workspaceId, mediaAssetId)).resolves.toEqual(mediaAssetFixture);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "completed",
      lastError: null,
      completedAt: expect.any(String),
    }));
  });


  it("marks uploads completed when the backend already has matching media bytes", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        workspaceId,
        mediaAssetId,
        status: "already_available",
        mediaAsset: mediaAssetFixture,
        uploadSession: null,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(loadMediaAssetRecord(workspaceId, mediaAssetId)).resolves.toEqual(mediaAssetFixture);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "completed",
      lastError: null,
      completedAt: expect.any(String),
    }));
  });

  it("marks already available uploads completed even when local cached bytes are unavailable", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUploadTransferWithoutCacheBlob();
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        workspaceId,
        mediaAssetId,
        status: "already_available",
        mediaAsset: mediaAssetFixture,
        uploadSession: null,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(loadMediaAssetRecord(workspaceId, mediaAssetId)).resolves.toEqual(mediaAssetFixture);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "completed",
      lastError: null,
      completedAt: expect.any(String),
    }));
  });

  it("rejects upload-required session identity mismatches before reading local bytes", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUploadTransferWithoutCacheBlob();
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        workspaceId: "44444444-4444-4444-8444-444444444444",
        mediaAssetId,
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

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      lastError: expect.stringContaining("session workspace mismatch"),
    }));
  });

});

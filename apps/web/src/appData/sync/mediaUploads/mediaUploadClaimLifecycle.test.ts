// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { primeSessionCsrfToken, setNavigationHandlerForTests } from "../../../api";
import { createJsonResponse } from "../../../api/ApiTestSupport";
import {
  claimNextDueMediaTransferByKind,
  loadMediaTransferQueueRecord,
} from "../../../localDb/mediaTransfers";
import {
  createAbortResponse,
  createTestBlob,
  createUploadRequiredResponse,
  createdAt,
  futurePartUrlExpiresAt,
  mediaAssetFixture,
  mediaTransferRenewMock,
  processDueMediaUploadTransfersForWorkspace,
  resetMediaUploadTransferTestState,
  seedQueuedUpload,
  textMimeType,
  transferId,
  workspaceId,
} from "./mediaUploadTransferTestSupport";

describe("media upload claim lifecycle", () => {
  beforeEach(resetMediaUploadTransferTestState);

  it("reclaims stale in-progress uploads before processing due work", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    await expect(claimNextDueMediaTransferByKind(
      workspaceId,
      "upload",
      createdAt,
    )).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "in_progress",
      claimedAt: createdAt,
    }));
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
            headers: {},
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
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "completed",
      attemptCount: 1,
      lastError: null,
      claimedAt: null,
      completedAt: expect.any(String),
    }));
  });

  it("aborts the upload session before part work when heartbeat renewal fails", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    mediaTransferRenewMock.renewInProgressMediaTransferClaim.mockRejectedValueOnce(new Error("Claim heartbeat renewal failed"));
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponse())
      .mockResolvedValueOnce(createAbortResponse());
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/media-assets/upload-sessions/55555555-5555-4555-8555-555555555555/abort");
    expect(fetchMock.mock.calls.map((call) => String(call[0])).some((url) => url.endsWith("/parts"))).toBe(false);
    expect(fetchMock.mock.calls.map((call) => String(call[0])).some((url) => url.includes("uploads.example.test"))).toBe(false);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      nextAttemptAt: expect.not.stringContaining("9999"),
      claimedAt: null,
      completedAt: null,
    }));
    const failedTransfer = await loadMediaTransferQueueRecord(transferId);
    expect(failedTransfer?.lastError).toContain("Claim heartbeat renewal failed");
  });


  it("marks auth redirects retryable and stops the upload batch", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const navigateMock = vi.fn();
    setNavigationHandlerForTests(navigateMock);
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Session expired",
      }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
        },
      }))
      .mockResolvedValueOnce(new Response("", {
        status: 401,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(processDueMediaUploadTransfersForWorkspace(workspaceId)).rejects.toThrow("Browser session expired. Redirecting to sign in.");

    expect(navigateMock).toHaveBeenCalledTimes(1);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      nextAttemptAt: expect.not.stringContaining("9999"),
      lastError: expect.stringContaining("paused for browser authentication"),
      claimedAt: null,
      completedAt: null,
    }));
  });

});

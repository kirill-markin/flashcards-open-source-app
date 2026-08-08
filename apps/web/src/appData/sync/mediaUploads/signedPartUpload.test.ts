// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { primeSessionCsrfToken } from "../../../api";
import { createJsonResponse } from "../../../api/ApiTestSupport";
import { loadMediaTransferQueueRecord } from "../../../localDb/mediaTransfers";
import {
  processDueMediaUploadTransfersForWorkspace as runDueMediaUploadTransfersForWorkspace,
} from "./mediaUploadTransferRunner";
import {
  createAbortResponse,
  createTestBlob,
  createUploadRequiredResponse,
  futurePartUrlExpiresAt,
  mediaAssetFixture,
  mediaAssetId,
  mediaTransferRenewMock,
  parseRequestBody,
  processDueMediaUploadTransfersForWorkspace,
  resetMediaUploadTransferTestState,
  seedQueuedUpload,
  textMimeType,
  transferId,
  workspaceId,
} from "./mediaUploadTransferTestSupport";

function calculateTestSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createUploadRequiredResponseWithSession(uploadSession: Readonly<{
  sessionId: string;
  expiresAt: string;
  partSizeBytes: number;
  partCount: number;
}>): Response {
  return new Response(JSON.stringify({
    workspaceId,
    mediaAssetId,
    status: "upload_required",
    mediaAsset: null,
    uploadSession,
  }), {
    status: 201,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function waitForFetchCallCount(
  fetchMock: ReturnType<typeof vi.fn<(...args: Array<unknown>) => Promise<Response>>>,
  expectedCallCount: number,
): Promise<void> {
  for (let attemptCount = 0; attemptCount < 20; attemptCount += 1) {
    if (fetchMock.mock.calls.length >= expectedCallCount) {
      return;
    }
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }
  throw new Error(`Expected media upload fetch call count: ${expectedCallCount}`);
}

describe("signed media upload part transport", () => {
  beforeEach(resetMediaUploadTransferTestState);

  it("cancels a pending signed PUT on lifecycle discard and keeps pre-completion abort cleanup", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    const abortController = new AbortController();
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponse())
      .mockResolvedValueOnce(createJsonResponse({
        sessionId: "55555555-5555-4555-8555-555555555555",
        partUrls: [{
          partNumber: 1,
          method: "PUT",
          url: "https://uploads.example.test/part-1",
          expiresAt: futurePartUrlExpiresAt,
          headers: {},
        }],
      }))
      .mockImplementationOnce(async (_url, initValue) => {
        const requestInit = initValue as RequestInit | undefined;
        const signal = requestInit?.signal;
        if (signal === null || signal === undefined) {
          throw new Error("Expected signed PUT lifecycle signal");
        }
        return new Promise<Response>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      })
      .mockResolvedValueOnce(createAbortResponse());
    vi.stubGlobal("fetch", fetchMock);

    const uploadPromise = runDueMediaUploadTransfersForWorkspace(
      workspaceId,
      abortController.signal,
    );
    await waitForFetchCallCount(fetchMock, 3);
    abortController.abort(new Error("Media upload workspace lifecycle discarded"));
    await uploadPromise;

    const signedPutInit = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    expect(signedPutInit?.signal).toBe(abortController.signal);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "https://uploads.example.test/part-1")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/complete"))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/abort"))).toHaveLength(1);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      status: "failed",
      lastError: expect.stringContaining("Media upload workspace lifecycle discarded"),
    }));
  });


  it("does not PUT a signed part when heartbeat fails after part URL loading", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    let heartbeatInterval: (() => void) | null = null;
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation((handler, timeout) => {
      if (timeout === 300000 && typeof handler === "function") {
        heartbeatInterval = handler as () => void;
      }

      return 1;
    });
    const clearIntervalSpy = vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    mediaTransferRenewMock.renewInProgressMediaTransferClaim.mockImplementation(async (input) => {
      if (heartbeatInterval !== null && mediaTransferRenewMock.renewInProgressMediaTransferClaim.mock.calls.length > 1) {
        throw new Error("Claim heartbeat renewal failed after URL load");
      }

      if (mediaTransferRenewMock.defaultRenewInProgressMediaTransferClaim === null) {
        throw new Error("Expected media transfer claim renewal default implementation");
      }

      return mediaTransferRenewMock.defaultRenewInProgressMediaTransferClaim(input);
    });
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponse())
      .mockImplementationOnce(async () => {
        if (heartbeatInterval === null) {
          throw new Error("Expected heartbeat interval callback");
        }

        heartbeatInterval();
        await Promise.resolve();
        return createJsonResponse({
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
        });
      })
      .mockResolvedValueOnce(createAbortResponse());
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDueMediaUploadTransfersForWorkspace(workspaceId);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/parts");
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain("https://uploads.example.test/part-1");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/media-assets/upload-sessions/55555555-5555-4555-8555-555555555555/abort");
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      nextAttemptAt: expect.not.stringContaining("9999"),
      claimedAt: null,
      completedAt: null,
    }));
    const failedTransfer = await loadMediaTransferQueueRecord(transferId);
    expect(failedTransfer?.lastError).toContain("Claim heartbeat renewal failed after URL load");
  });


  it("stores only sanitized signed PUT failure details", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    const longS3Code = `InvalidDigest-${"A".repeat(200)}`;
    const longRequestId = `s3-request-${"B".repeat(200)}`;
    const longHostId = `s3-host-id-${"C".repeat(200)}`;
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponse())
      .mockResolvedValueOnce(createJsonResponse({
        sessionId: "55555555-5555-4555-8555-555555555555",
        partUrls: [
          {
            partNumber: 1,
            method: "PUT",
            url: "https://uploads.example.test/signed-part-url?X-Amz-Signature=secret",
            expiresAt: futurePartUrlExpiresAt,
            headers: {},
          },
        ],
      }))
      .mockResolvedValueOnce(new Response([
        "<Error>",
        `<Code>${longS3Code}</Code>`,
        "<Message>raw storage key private/blob-id and signed URL https://uploads.example.test/signed-part-url?X-Amz-Signature=secret</Message>",
        `<RequestId>${longRequestId}</RequestId>`,
        `<HostId>${longHostId}</HostId>`,
        "</Error>",
      ].join(""), {
        status: 400,
        statusText: "Bad Request",
        headers: {
          "Content-Type": "application/xml",
        },
      }))
      .mockResolvedValueOnce(createAbortResponse());
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      lastError: expect.stringContaining(`s3Code=${longS3Code.slice(0, 128)}...`),
    }));
    const failedTransfer = await loadMediaTransferQueueRecord(transferId);
    expect(failedTransfer?.lastError).toContain(`requestId=${longRequestId.slice(0, 128)}...`);
    expect(failedTransfer?.lastError).toContain(`extendedRequestId=${longHostId.slice(0, 128)}...`);
    expect(failedTransfer?.lastError).not.toContain(longS3Code);
    expect(failedTransfer?.lastError).not.toContain(longRequestId);
    expect(failedTransfer?.lastError).not.toContain(longHostId);
    expect(failedTransfer?.lastError).not.toContain("raw storage key");
    expect(failedTransfer?.lastError).not.toContain("blob-id");
    expect(failedTransfer?.lastError).not.toContain("X-Amz-Signature");
    expect(failedTransfer?.lastError).not.toContain("responseBody=");
  });

  it("requests one fresh signed URL per part before uploading that part", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    const expectedPartSha256s = [
      calculateTestSha256Hex(new TextEncoder().encode("hello")),
      calculateTestSha256Hex(new TextEncoder().encode(" worl")),
      calculateTestSha256Hex(new TextEncoder().encode("d")),
    ];
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponseWithSession({
        sessionId: "55555555-5555-4555-8555-555555555555",
        expiresAt: "2026-03-10T10:00:00.000Z",
        partSizeBytes: 5,
        partCount: 3,
      }))
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
        sessionId: "55555555-5555-4555-8555-555555555555",
        partUrls: [
          {
            partNumber: 2,
            method: "PUT",
            url: "https://uploads.example.test/part-2",
            expiresAt: futurePartUrlExpiresAt,
            headers: {},
          },
        ],
      }))
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: {
          ETag: "\"etag-2\"",
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        sessionId: "55555555-5555-4555-8555-555555555555",
        partUrls: [
          {
            partNumber: 3,
            method: "PUT",
            url: "https://uploads.example.test/part-3",
            expiresAt: futurePartUrlExpiresAt,
            headers: {},
          },
        ],
      }))
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: {
          ETag: "\"etag-3\"",
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        mediaAsset: mediaAssetFixture,
        applied: true,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(parseRequestBody(fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)).toEqual({
      parts: [
        {
          partNumber: 1,
          sha256: expectedPartSha256s[0],
        },
      ],
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://uploads.example.test/part-1");
    expect(parseRequestBody(fetchMock.mock.calls[3]?.[1] as RequestInit | undefined)).toEqual({
      parts: [
        {
          partNumber: 2,
          sha256: expectedPartSha256s[1],
        },
      ],
    });
    expect(fetchMock.mock.calls[4]?.[0]).toBe("https://uploads.example.test/part-2");
    expect(parseRequestBody(fetchMock.mock.calls[5]?.[1] as RequestInit | undefined)).toEqual({
      parts: [
        {
          partNumber: 3,
          sha256: expectedPartSha256s[2],
        },
      ],
    });
    expect(fetchMock.mock.calls[6]?.[0]).toBe("https://uploads.example.test/part-3");
    expect(parseRequestBody(fetchMock.mock.calls[7]?.[1] as RequestInit | undefined)).toEqual({
      parts: [
        {
          partNumber: 1,
          eTag: "\"etag-1\"",
          sha256: expectedPartSha256s[0],
        },
        {
          partNumber: 2,
          eTag: "\"etag-2\"",
          sha256: expectedPartSha256s[1],
        },
        {
          partNumber: 3,
          eTag: "\"etag-3\"",
          sha256: expectedPartSha256s[2],
        },
      ],
    });
  });

  it("does not use signed part URLs that are too close to expiry", async () => {
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
            expiresAt: "1970-01-01T00:00:00.000Z",
            headers: {},
          },
        ],
      }))
      .mockResolvedValueOnce(createJsonResponse({
        sessionId: "55555555-5555-4555-8555-555555555555",
        partUrls: [
          {
            partNumber: 1,
            method: "PUT",
            url: "https://uploads.example.test/part-1-retry",
            expiresAt: "1970-01-01T00:00:00.000Z",
            headers: {},
          },
        ],
      }))
      .mockResolvedValueOnce(createAbortResponse());
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain("https://uploads.example.test/part-1");
    expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain("https://uploads.example.test/part-1-retry");
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      lastError: expect.stringContaining("expires too soon"),
    }));
  });

});

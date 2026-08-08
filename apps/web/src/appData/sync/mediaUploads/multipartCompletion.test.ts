// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { primeSessionCsrfToken, setNavigationHandlerForTests } from "../../../api";
import { createJsonResponse } from "../../../api/ApiTestSupport";
import {
  loadMediaTransferQueueRecord,
  markMediaTransferSucceeded,
} from "../../../localDb/mediaTransfers";
import {
  processDueMediaUploadTransfersForWorkspace as runDueMediaUploadTransfersForWorkspace,
} from "./mediaUploadTransferRunner";
import {
  bufferSourceToBytes,
  createAbortResponse,
  createTestBlob,
  createUploadRequiredResponse,
  futurePartUrlExpiresAt,
  getAlgorithmName,
  helloWorldSha256,
  mediaAssetFixture,
  mediaAssetId,
  mediaTransferRenewMock,
  parseRequestBody,
  processDueMediaUploadTransfersForWorkspace,
  resetMediaUploadTransferTestState,
  seedQueuedUpload,
  textMimeType,
  toArrayBuffer,
  transferId,
  workspaceId,
} from "./mediaUploadTransferTestSupport";

function createServiceUnavailableResponse(): Response {
  return new Response(JSON.stringify({
    error: "storage temporarily unavailable",
  }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createBadRequestResponse(): Response {
  return new Response(JSON.stringify({
    error: "Invalid abort request",
  }), {
    status: 400,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createCompletionErrorResponse(code: string, retryAfterSeconds: number | null): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (retryAfterSeconds !== null) {
    headers.set("Retry-After", String(retryAfterSeconds));
  }

  return new Response(JSON.stringify({
    error: "Completion is still being applied",
    code,
    requestId: "completion-request-1",
  }), {
    status: 503,
    headers,
  });
}

type TestFetchResponse = Response | (() => Promise<Response>);

function createSinglePartUploadFetchMock(
  completionResponses: ReadonlyArray<TestFetchResponse>,
): ReturnType<typeof vi.fn<(...args: Array<unknown>) => Promise<Response>>> {
  const responses: ReadonlyArray<TestFetchResponse> = [
    createUploadRequiredResponse(),
    createJsonResponse({
      sessionId: "55555555-5555-4555-8555-555555555555",
      partUrls: [{
        partNumber: 1,
        method: "PUT",
        url: "https://uploads.example.test/part-1",
        expiresAt: futurePartUrlExpiresAt,
        headers: {},
      }],
    }),
    new Response("", {
      status: 200,
      headers: {
        ETag: "\"etag-1\"",
      },
    }),
    ...completionResponses,
  ];
  let responseIndex = 0;
  return vi.fn(async (): Promise<Response> => {
    const response = responses[responseIndex];
    if (response === undefined) {
      throw new Error(`Unexpected media upload request index: ${responseIndex}`);
    }
    responseIndex += 1;
    return typeof response === "function" ? response() : response;
  });
}

describe("multipart media upload completion", () => {
  beforeEach(resetMediaUploadTransferTestState);

  it("retries deadline and in-progress completion responses with the same session and parts", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation((handler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 1;
    });
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
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
      .mockResolvedValueOnce(createCompletionErrorResponse(
        "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
        null,
      ))
      .mockResolvedValueOnce(createCompletionErrorResponse(
        "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        1,
      ))
      .mockResolvedValueOnce(createJsonResponse({
        mediaAsset: mediaAssetFixture,
        applied: false,
      }));
    vi.stubGlobal("fetch", fetchMock);

    let retryDelays: Array<number | undefined> = [];
    try {
      await processDueMediaUploadTransfersForWorkspace(workspaceId);
      retryDelays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    } finally {
      setTimeoutSpy.mockRestore();
      randomSpy.mockRestore();
    }

    const completionCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/complete"));
    expect(completionCalls).toHaveLength(3);
    expect(completionCalls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("/upload-sessions/55555555-5555-4555-8555-555555555555/complete"),
      expect.stringContaining("/upload-sessions/55555555-5555-4555-8555-555555555555/complete"),
      expect.stringContaining("/upload-sessions/55555555-5555-4555-8555-555555555555/complete"),
    ]);
    expect(completionCalls.map((call) => parseRequestBody(call[1] as RequestInit | undefined))).toEqual([
      {
        parts: [{
          partNumber: 1,
          eTag: "\"etag-1\"",
          sha256: helloWorldSha256,
        }],
      },
      {
        parts: [{
          partNumber: 1,
          eTag: "\"etag-1\"",
          sha256: helloWorldSha256,
        }],
      },
      {
        parts: [{
          partNumber: 1,
          eTag: "\"etag-1\"",
          sha256: helloWorldSha256,
        }],
      },
    ]);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "https://uploads.example.test/part-1")).toHaveLength(1);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/abort"))).toBe(false);
    expect(retryDelays).toContain(1000);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      status: "completed",
      lastError: null,
    }));
  });

  it("does not abort a completion-in-progress session after same-session retries exhaust", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation((handler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 1;
    });
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
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: {
          ETag: "\"etag-1\"",
        },
      }))
      .mockImplementation(async () => createCompletionErrorResponse(
        "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        0,
      ));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDueMediaUploadTransfersForWorkspace(workspaceId);
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/complete"))).toHaveLength(4);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "https://uploads.example.test/part-1")).toHaveLength(1);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/abort"))).toBe(false);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      status: "failed",
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      lastError: expect.stringContaining("MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS"),
    }));

    const requestCountAfterExhaustion = fetchMock.mock.calls.length;
    await processDueMediaUploadTransfersForWorkspace(workspaceId);
    expect(fetchMock).toHaveBeenCalledTimes(requestCountAfterExhaustion);
  });

  it("preserves a concurrently completed transfer when a later terminal completion response arrives", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation((handler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 1;
    });
    const fetchMock = createSinglePartUploadFetchMock([
      createCompletionErrorResponse(
        "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        0,
      ),
      async (): Promise<Response> => {
        await markMediaTransferSucceeded(
          transferId,
          "2026-03-10T09:10:00.000Z",
        );
        return new Response(JSON.stringify({
          error: "Completion payload is invalid",
          code: "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
          requestId: "completion-request-terminal",
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDueMediaUploadTransfersForWorkspace(workspaceId);
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/complete"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "https://uploads.example.test/part-1")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/abort"))).toHaveLength(0);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      status: "completed",
      completedAt: "2026-03-10T09:10:00.000Z",
      lastError: null,
    }));

    const requestCountAfterFailure = fetchMock.mock.calls.length;
    await processDueMediaUploadTransfersForWorkspace(workspaceId);
    expect(fetchMock).toHaveBeenCalledTimes(requestCountAfterFailure);
  });

  it("terminalizes an invalid replay asset after durable completion begins", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation((handler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 1;
    });
    const fetchMock = createSinglePartUploadFetchMock([
      createCompletionErrorResponse(
        "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
        0,
      ),
      createJsonResponse({
        mediaAsset: {
          ...mediaAssetFixture,
          mediaAssetId: "77777777-7777-4777-8777-777777777777",
        },
        applied: false,
      }),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDueMediaUploadTransfersForWorkspace(workspaceId);
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/complete"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "https://uploads.example.test/part-1")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/abort"))).toHaveLength(0);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      status: "failed",
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      lastError: expect.stringMatching(
        /MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED.*Media upload asset id mismatch/,
      ),
    }));

    const requestCountAfterFailure = fetchMock.mock.calls.length;
    await processDueMediaUploadTransfersForWorkspace(workspaceId);
    expect(fetchMock).toHaveBeenCalledTimes(requestCountAfterFailure);
  });

  it("exits completion backoff promptly when the upload claim is cancelled", async () => {
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
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation(() => {
      if (heartbeatInterval === null) {
        throw new Error("Expected upload heartbeat interval");
      }
      heartbeatInterval();
      return 2;
    });
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout").mockImplementation(() => undefined);
    mediaTransferRenewMock.renewInProgressMediaTransferClaim.mockImplementation(async (input) => {
      if (mediaTransferRenewMock.renewInProgressMediaTransferClaim.mock.calls.length > 1) {
        throw new Error("Upload claim cancelled during completion backoff");
      }
      if (mediaTransferRenewMock.defaultRenewInProgressMediaTransferClaim === null) {
        throw new Error("Expected media transfer claim renewal default implementation");
      }
      return mediaTransferRenewMock.defaultRenewInProgressMediaTransferClaim(input);
    });
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
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: {
          ETag: "\"etag-1\"",
        },
      }))
      .mockResolvedValueOnce(createCompletionErrorResponse(
        "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        60,
      ));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDueMediaUploadTransfersForWorkspace(workspaceId);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }

    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/complete"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "https://uploads.example.test/part-1")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/abort"))).toHaveLength(0);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      status: "failed",
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      lastError: expect.stringContaining("Upload claim cancelled during completion backoff"),
    }));

    const requestCountAfterCancellation = fetchMock.mock.calls.length;
    await processDueMediaUploadTransfersForWorkspace(workspaceId);
    expect(fetchMock).toHaveBeenCalledTimes(requestCountAfterCancellation);
  });

  it("terminalizes lifecycle discard during completion backoff without continuing completion", async () => {
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
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: {
          ETag: "\"etag-1\"",
        },
      }))
      .mockImplementationOnce(async () => {
        queueMicrotask(() => {
          abortController.abort(new Error("Media upload lifecycle discarded during completion backoff"));
        });
        return createCompletionErrorResponse(
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
          60,
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    await runDueMediaUploadTransfersForWorkspace(
      workspaceId,
      abortController.signal,
    );

    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/complete"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "https://uploads.example.test/part-1")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/abort"))).toHaveLength(0);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      status: "failed",
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      lastError: expect.stringContaining("Media upload lifecycle discarded during completion backoff"),
    }));

    const requestCountAfterDiscard = fetchMock.mock.calls.length;
    await processDueMediaUploadTransfersForWorkspace(workspaceId);
    expect(fetchMock).toHaveBeenCalledTimes(requestCountAfterDiscard);
  });

  it("preserves durable completion state when the heartbeat fails during replay success", async () => {
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
      if (mediaTransferRenewMock.renewInProgressMediaTransferClaim.mock.calls.length > 1) {
        throw new Error("Upload claim lost during completion replay");
      }
      if (mediaTransferRenewMock.defaultRenewInProgressMediaTransferClaim === null) {
        throw new Error("Expected media transfer claim renewal default implementation");
      }
      return mediaTransferRenewMock.defaultRenewInProgressMediaTransferClaim(input);
    });
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
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: {
          ETag: "\"etag-1\"",
        },
      }))
      .mockResolvedValueOnce(createCompletionErrorResponse(
        "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        0,
      ))
      .mockImplementationOnce(async () => {
        if (heartbeatInterval === null) {
          throw new Error("Expected upload heartbeat interval");
        }
        heartbeatInterval();
        return createJsonResponse({
          mediaAsset: mediaAssetFixture,
          applied: false,
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDueMediaUploadTransfersForWorkspace(workspaceId);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }

    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/complete"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "https://uploads.example.test/part-1")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/abort"))).toHaveLength(0);
    const replayRequestInit = fetchMock.mock.calls[4]?.[1] as RequestInit | undefined;
    expect(replayRequestInit?.signal?.aborted).toBe(true);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      status: "failed",
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      lastError: expect.stringContaining("Upload claim lost during completion replay"),
    }));

    const requestCountAfterClaimLoss = fetchMock.mock.calls.length;
    await processDueMediaUploadTransfersForWorkspace(workspaceId);
    expect(fetchMock).toHaveBeenCalledTimes(requestCountAfterClaimLoss);
  });

  it("aborts the upload session after a terminal completion failure", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
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
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: {
          ETag: "\"etag-1\"",
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Completion payload is invalid",
        code: "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      }))
      .mockResolvedValueOnce(createAbortResponse());
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/complete"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/abort"))).toHaveLength(1);
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      status: "failed",
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      lastError: expect.stringContaining("MEDIA_ASSET_UPLOAD_PROOF_MISMATCH"),
    }));
  });


  it("marks cached byte hash mismatches as non-retryable after upload is required", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["HELLO WORLD"], textMimeType));
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponse())
      .mockResolvedValueOnce(createAbortResponse());
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/media-assets/upload-sessions/55555555-5555-4555-8555-555555555555/abort");
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      lastError: expect.stringContaining("source sha256 mismatch"),
    }));
  });

  it("keeps verification failures retryable when abort cleanup is transient", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["HELLO WORLD"], textMimeType));
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponse())
      .mockResolvedValueOnce(createServiceUnavailableResponse());
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/media-assets/upload-sessions/55555555-5555-4555-8555-555555555555/abort");
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      nextAttemptAt: expect.not.stringContaining("9999"),
      lastError: expect.stringContaining("Media upload session cleanup failed after upload error"),
    }));
    const failedTransfer = await loadMediaTransferQueueRecord(transferId);
    expect(failedTransfer?.lastError).toContain("source sha256 mismatch");
    expect(failedTransfer?.lastError).toContain("status=503");
  });

  it("keeps permanent abort cleanup details with permanent verification failures", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["HELLO WORLD"], textMimeType));
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponse())
      .mockResolvedValueOnce(createBadRequestResponse());
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/media-assets/upload-sessions/55555555-5555-4555-8555-555555555555/abort");
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      lastError: expect.stringContaining("Media upload session cleanup failed after upload error"),
    }));
    const failedTransfer = await loadMediaTransferQueueRecord(transferId);
    expect(failedTransfer?.lastError).toContain("source sha256 mismatch");
    expect(failedTransfer?.lastError).toContain("status=400");
  });

  it("preserves auth redirects from abort cleanup failures", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const navigateMock = vi.fn();
    setNavigationHandlerForTests(navigateMock);
    await seedQueuedUpload(createTestBlob(["HELLO WORLD"], textMimeType));
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponse())
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

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/media-assets/upload-sessions/55555555-5555-4555-8555-555555555555/abort");
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      nextAttemptAt: expect.not.stringContaining("9999"),
      lastError: expect.stringContaining("paused for browser authentication"),
      claimedAt: null,
      completedAt: null,
    }));
  });

  it("marks unknown local browser failures retryable", async () => {
    primeSessionCsrfToken("csrf-token-1");
    await seedQueuedUpload(createTestBlob(["hello world"], textMimeType));
    let digestCallCount = 0;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        randomUUID: globalThis.crypto?.randomUUID,
        subtle: {
          digest: vi.fn(async (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
            digestCallCount += 1;
            if (digestCallCount === 1) {
              const digest = createHash("sha256").update(bufferSourceToBytes(data)).digest();
              return toArrayBuffer(digest);
            }

            if (getAlgorithmName(algorithm) !== "SHA-256") {
              throw new Error(`Unsupported digest algorithm: ${getAlgorithmName(algorithm)}`);
            }

            throw new Error("Digest temporarily unavailable");
          }),
        },
      },
    });
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createUploadRequiredResponse())
      .mockResolvedValueOnce(createServiceUnavailableResponse());
    vi.stubGlobal("fetch", fetchMock);

    await processDueMediaUploadTransfersForWorkspace(workspaceId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/media-assets/upload-sessions/55555555-5555-4555-8555-555555555555/abort");
    await expect(loadMediaTransferQueueRecord(transferId)).resolves.toEqual(expect.objectContaining({
      transferId,
      status: "failed",
      nextAttemptAt: expect.not.stringContaining("9999"),
      lastError: expect.stringContaining("Media upload transfer failed (retryable)"),
    }));
    const failedTransfer = await loadMediaTransferQueueRecord(transferId);
    expect(failedTransfer?.lastError).toContain("Digest temporarily unavailable");
  });
});

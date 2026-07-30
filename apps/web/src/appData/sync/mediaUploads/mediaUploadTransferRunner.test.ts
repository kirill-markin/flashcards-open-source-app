// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../api/endpoints/endpointsTestSupport";
import { primeSessionCsrfToken, setNavigationHandlerForTests } from "../../../api";
import { createJsonResponse } from "../../../api/ApiTestSupport";
import { clearWebSyncCache } from "../../../localDb/core/cache";
import { loadMediaAssetRecord } from "../../../localDb/mediaAssets";
import {
  claimNextDueMediaTransferByKind,
  enqueueMediaTransferUpload,
  loadMediaTransferQueueRecord,
  markMediaTransferSucceeded,
  type MediaTransferQueueRecord,
  type RenewInProgressMediaTransferClaimInput,
  writeMediaBlobCacheRecord,
} from "../../../localDb/mediaTransfers";
import { putCloudSettings } from "../../../localDb/sync/cloudSettings";
import type { CloudSettings, MediaAsset } from "../../../types";
import {
  processDueMediaUploadTransfersForWorkspace as runDueMediaUploadTransfersForWorkspace,
} from "./mediaUploadTransferRunner";

type RenewMediaTransferClaim = (input: RenewInProgressMediaTransferClaimInput) => Promise<MediaTransferQueueRecord>;

const mediaTransferRenewMock = vi.hoisted(() => ({
  defaultRenewInProgressMediaTransferClaim: null as RenewMediaTransferClaim | null,
  renewInProgressMediaTransferClaim: vi.fn<RenewMediaTransferClaim>(),
}));

vi.mock("../../../localDb/mediaTransfers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../localDb/mediaTransfers")>();
  mediaTransferRenewMock.defaultRenewInProgressMediaTransferClaim = actual.renewInProgressMediaTransferClaim;
  mediaTransferRenewMock.renewInProgressMediaTransferClaim.mockImplementation(actual.renewInProgressMediaTransferClaim);
  return {
    ...actual,
    renewInProgressMediaTransferClaim: mediaTransferRenewMock.renewInProgressMediaTransferClaim,
  };
});

const workspaceId = "11111111-1111-4111-8111-111111111111";
const mediaAssetId = "22222222-2222-4222-8222-222222222222";
const installationId = "33333333-3333-4333-8333-333333333333";
const transferId = "media-upload-transfer-1";
const createdAt = "2026-03-10T09:00:00.000Z";
const helloWorldSha256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
const textMimeType = "text/plain";
const futurePartUrlExpiresAt = "9999-12-31T23:59:59.999Z";

function processDueMediaUploadTransfersForWorkspace(testWorkspaceId: string): Promise<void> {
  return runDueMediaUploadTransfersForWorkspace(
    testWorkspaceId,
    new AbortController().signal,
  );
}

function toTestUuidFromHexDigest(hexDigest: string): string {
  const baseHex = hexDigest.slice(0, 32).split("");
  baseHex[12] = "5";
  baseHex[16] = ((parseInt(baseHex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);

  return [
    baseHex.slice(0, 8).join(""),
    baseHex.slice(8, 12).join(""),
    baseHex.slice(12, 16).join(""),
    baseHex.slice(16, 20).join(""),
    baseHex.slice(20, 32).join(""),
  ].join("-");
}

function buildTestClientWorkspaceReplicaId(workspaceId: string, installationId: string): string {
  return toTestUuidFromHexDigest(createHash("sha256").update(`${workspaceId}:${installationId}`).digest("hex"));
}

const workspaceReplicaId = buildTestClientWorkspaceReplicaId(workspaceId, installationId);

const linkedCloudSettings: CloudSettings = {
  installationId,
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: workspaceId,
  linkedEmail: "user@example.com",
  onboardingCompleted: true,
  updatedAt: createdAt,
};

const mediaAssetFixture: MediaAsset = {
  mediaAssetId,
  workspaceId,
  mimeType: textMimeType,
  sizeBytes: 11,
  sha256: helloWorldSha256,
  sourceUrl: null,
  createdAt,
  clientUpdatedAt: createdAt,
  lastModifiedByReplicaId: workspaceReplicaId,
  lastOperationId: transferId,
  updatedAt: "2026-03-10T09:00:01.000Z",
  deletedAt: null,
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function bufferSourceToBytes(data: BufferSource): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function getAlgorithmName(algorithm: AlgorithmIdentifier): string {
  return typeof algorithm === "string" ? algorithm : algorithm.name;
}

function installDigestMock(): void {
  const cryptoValue = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: typeof cryptoValue?.randomUUID === "function" ? cryptoValue.randomUUID.bind(cryptoValue) : undefined,
      subtle: {
        digest: vi.fn(async (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
          if (getAlgorithmName(algorithm) !== "SHA-256") {
            throw new Error(`Unsupported digest algorithm: ${getAlgorithmName(algorithm)}`);
          }

          const digest = createHash("sha256").update(bufferSourceToBytes(data)).digest();
          return toArrayBuffer(digest);
        }),
      },
    },
  });
}

function createTestBlob(parts: ReadonlyArray<BlobPart>, mimeType: string): Blob {
  return new NodeBlob(parts, { type: mimeType }) as unknown as Blob;
}

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

function createUploadRequiredResponse(): Response {
  return createUploadRequiredResponseWithSession({
    sessionId: "55555555-5555-4555-8555-555555555555",
    expiresAt: "2026-03-10T10:00:00.000Z",
    partSizeBytes: 8388608,
    partCount: 1,
  });
}

function createAbortResponse(): Response {
  return createJsonResponse({
    sessionId: "55555555-5555-4555-8555-555555555555",
    abortedAt: "2026-03-10T09:00:05.000Z",
  });
}

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

async function seedQueuedUpload(blob: Blob): Promise<void> {
  await writeMediaBlobCacheRecord({
    sha256: helloWorldSha256,
    mimeType: textMimeType,
    sizeBytes: 11,
    blob,
    createdAt,
    lastAccessedAt: createdAt,
    sourceMediaAssetId: mediaAssetId,
  });
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

function parseRequestBody(requestInit: RequestInit | undefined): unknown {
  const body = requestInit?.body;
  if (typeof body !== "string") {
    throw new Error("Expected JSON request body");
  }

  return JSON.parse(body) as unknown;
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

describe("media upload transfer runner", () => {
  beforeEach(async () => {
    if (mediaTransferRenewMock.defaultRenewInProgressMediaTransferClaim === null) {
      throw new Error("Expected media transfer claim renewal default implementation");
    }

    mediaTransferRenewMock.renewInProgressMediaTransferClaim.mockReset();
    mediaTransferRenewMock.renewInProgressMediaTransferClaim.mockImplementation(
      mediaTransferRenewMock.defaultRenewInProgressMediaTransferClaim,
    );
    await clearWebSyncCache();
    installDigestMock();
    await putCloudSettings(linkedCloudSettings);
  });

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

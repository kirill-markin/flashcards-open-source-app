import { createHash } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { vi } from "vitest";
import "../../../api/endpoints/endpointsTestSupport";
import { createJsonResponse } from "../../../api/ApiTestSupport";
import { clearWebSyncCache } from "../../../localDb/core/cache";
import {
  enqueueMediaTransferUpload,
  type MediaTransferQueueRecord,
  type RenewInProgressMediaTransferClaimInput,
  writeMediaBlobCacheRecord,
} from "../../../localDb/mediaTransfers";
import { putCloudSettings } from "../../../localDb/sync/cloudSettings";
import type { CloudSettings, MediaAsset } from "../../../types";
import {
  processDueMediaUploadTransfersForWorkspace as runMediaUploadTransferRunner,
} from "./mediaUploadTransferRunner";

type RenewMediaTransferClaim = (input: RenewInProgressMediaTransferClaimInput) => Promise<MediaTransferQueueRecord>;

const mediaTransferRenewMock = vi.hoisted(() => ({
  defaultRenewInProgressMediaTransferClaim: null as RenewMediaTransferClaim | null,
  renewInProgressMediaTransferClaim: vi.fn<RenewMediaTransferClaim>(),
}));

export { mediaTransferRenewMock };

vi.mock("../../../localDb/mediaTransfers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../localDb/mediaTransfers")>();
  mediaTransferRenewMock.defaultRenewInProgressMediaTransferClaim = actual.renewInProgressMediaTransferClaim;
  mediaTransferRenewMock.renewInProgressMediaTransferClaim.mockImplementation(actual.renewInProgressMediaTransferClaim);
  return {
    ...actual,
    renewInProgressMediaTransferClaim: mediaTransferRenewMock.renewInProgressMediaTransferClaim,
  };
});

export const workspaceId = "11111111-1111-4111-8111-111111111111";
export const mediaAssetId = "22222222-2222-4222-8222-222222222222";
export const installationId = "33333333-3333-4333-8333-333333333333";
export const transferId = "media-upload-transfer-1";
export const createdAt = "2026-03-10T09:00:00.000Z";
export const helloWorldSha256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
export const textMimeType = "text/plain";
export const futurePartUrlExpiresAt = "9999-12-31T23:59:59.999Z";

export function processDueMediaUploadTransfersForWorkspace(testWorkspaceId: string): Promise<void> {
  return runMediaUploadTransferRunner(
    testWorkspaceId,
    new AbortController().signal,
    (): boolean => false,
  );
}

export function runDueMediaUploadTransfersForWorkspace(
  testWorkspaceId: string,
  signal: AbortSignal,
): Promise<void> {
  return runMediaUploadTransferRunner(testWorkspaceId, signal, (): boolean => false);
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

export const workspaceReplicaId = buildTestClientWorkspaceReplicaId(workspaceId, installationId);

const linkedCloudSettings: CloudSettings = {
  installationId,
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: workspaceId,
  linkedEmail: "user@example.com",
  onboardingCompleted: true,
  updatedAt: createdAt,
};

export const mediaAssetFixture: MediaAsset = {
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

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function bufferSourceToBytes(data: BufferSource): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export function getAlgorithmName(algorithm: AlgorithmIdentifier): string {
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

export function createTestBlob(parts: ReadonlyArray<BlobPart>, mimeType: string): Blob {
  return new NodeBlob(parts, { type: mimeType }) as unknown as Blob;
}

export function createUploadRequiredResponse(): Response {
  return new Response(JSON.stringify({
    workspaceId,
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
  });
}

export function createAbortResponse(): Response {
  return createJsonResponse({
    sessionId: "55555555-5555-4555-8555-555555555555",
    abortedAt: "2026-03-10T09:00:05.000Z",
  });
}

export async function seedQueuedUpload(blob: Blob): Promise<void> {
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

export function parseRequestBody(requestInit: RequestInit | undefined): unknown {
  const body = requestInit?.body;
  if (typeof body !== "string") {
    throw new Error("Expected JSON request body");
  }

  return JSON.parse(body) as unknown;
}

export async function resetMediaUploadTransferTestState(): Promise<void> {
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
}

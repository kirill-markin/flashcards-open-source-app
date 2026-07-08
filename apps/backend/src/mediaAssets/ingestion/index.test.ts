import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createBackendObservationScope } from "../../observability/sentry";
import { ingestImageMediaAssetWithDependencies, type ImageMediaAssetIngestionDependencies } from "./index";
import { buildMediaBlobStorageKey } from "../storageKeys";
import {
  imageJpegCardMediaBlobMimeType,
  imageJpegCardMediaBlobNormalizationVersion,
  passthroughMediaBlobNormalizationVersion,
  type MediaAsset,
  type MediaAssetImageIngestionMetadataInput,
  type MediaBlob,
  type NormalizedImageMediaAssetInput,
} from "../types";

const testUserId = "user-1";
const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const testMediaBlobId = "33333333-3333-4333-8333-333333333333";
const testReplicaId = "44444444-4444-4444-8444-444444444444";
const testOperationId = "operation-image-1";
const testOriginalBytes = Buffer.from("original-image-bytes");
const testNormalizedBytes = Buffer.from("normalized-jpeg-bytes");
const testNormalizedSha256 = createHash("sha256").update(testNormalizedBytes).digest("hex");
const testObservationScope = createBackendObservationScope(
  "backend-api",
  "request-1",
  "/workspaces/:workspaceId/media-assets/images",
  "POST",
  testUserId,
  testWorkspaceId,
  null,
  null,
  null,
  null,
  null,
);

function createMetadata(): MediaAssetImageIngestionMetadataInput {
  return {
    mediaAssetId: testMediaAssetId,
    sourceUrl: "https://example.com/image.png",
    createdAt: "2026-02-28T09:00:00.000Z",
    clientUpdatedAt: "2026-02-28T10:00:00.000Z",
    lastModifiedByReplicaId: testReplicaId,
    lastOperationId: testOperationId,
  };
}

function createMediaBlob(normalizationVersion: MediaBlob["normalizationVersion"]): MediaBlob {
  return {
    mediaBlobId: testMediaBlobId,
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes: testNormalizedBytes.byteLength,
    sha256: testNormalizedSha256,
    storageKey: buildMediaBlobStorageKey(testNormalizedSha256),
    normalizationVersion,
    createdAt: "2026-02-28T10:00:01.000Z",
    updatedAt: "2026-02-28T10:00:01.000Z",
  };
}

function createMediaAsset(input: NormalizedImageMediaAssetInput): MediaAsset {
  return {
    mediaAssetId: input.mediaAssetId,
    workspaceId: testWorkspaceId,
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    sourceUrl: input.sourceUrl,
    createdAt: input.createdAt,
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
    updatedAt: "2026-02-28T10:00:01.000Z",
    deletedAt: null,
  };
}

function createDependencies(
  reusableBlob: MediaBlob | null,
  storageCalls: Array<string>,
): ImageMediaAssetIngestionDependencies {
  return {
    normalizeImageBytesForCardFn: async (inputBytes: Buffer) => {
      assert.deepEqual(inputBytes, testOriginalBytes);
      return {
        bytes: testNormalizedBytes,
        mimeType: imageJpegCardMediaBlobMimeType,
        sizeBytes: testNormalizedBytes.byteLength,
      };
    },
    loadReusableImageMediaBlobForWorkspaceFn: async (userId, workspaceId, input) => {
      assert.equal(userId, testUserId);
      assert.equal(workspaceId, testWorkspaceId);
      assert.equal(input.mediaAssetId, testMediaAssetId);
      assert.equal(input.sizeBytes, testNormalizedBytes.byteLength);
      assert.equal(input.sha256, testNormalizedSha256);
      return reusableBlob;
    },
    storeMediaAssetBlobBytesIfAbsentFn: async (input) => {
      storageCalls.push(input.storageKey);
      assert.equal(input.workspaceId, testWorkspaceId);
      assert.equal(input.mediaAssetId, testMediaAssetId);
      assert.equal(input.storageKey, buildMediaBlobStorageKey(testNormalizedSha256));
      assert.equal(input.mimeType, imageJpegCardMediaBlobMimeType);
      assert.equal(input.sha256, testNormalizedSha256);
      assert.equal(input.lastOperationId, testOperationId);
      assert.deepEqual(input.bytes, testNormalizedBytes);
    },
    createImageNormalizedMediaAssetForWorkspaceFn: async (userId, workspaceId, input) => {
      assert.equal(userId, testUserId);
      assert.equal(workspaceId, testWorkspaceId);
      assert.equal(input.sha256, testNormalizedSha256);
      assert.notEqual(input.sha256, createHash("sha256").update(testOriginalBytes).digest("hex"));
      return {
        mediaAsset: createMediaAsset(input),
        applied: true,
      };
    },
  };
}

test("ingestImageMediaAssetWithDependencies skips storage when final normalized bytes already have a blob row", async () => {
  const storageCalls: Array<string> = [];
  const result = await ingestImageMediaAssetWithDependencies(
    {
      userId: testUserId,
      workspaceId: testWorkspaceId,
      metadata: createMetadata(),
      imageBytes: testOriginalBytes,
      observationScope: testObservationScope,
    },
    createDependencies(createMediaBlob(passthroughMediaBlobNormalizationVersion), storageCalls),
  );

  assert.equal(result.applied, true);
  assert.equal(result.mediaAsset.sha256, testNormalizedSha256);
  assert.deepEqual(storageCalls, []);
});

test("ingestImageMediaAssetWithDependencies also reuses an existing image-normalized blob row", async () => {
  const storageCalls: Array<string> = [];
  const result = await ingestImageMediaAssetWithDependencies(
    {
      userId: testUserId,
      workspaceId: testWorkspaceId,
      metadata: createMetadata(),
      imageBytes: testOriginalBytes,
      observationScope: testObservationScope,
    },
    createDependencies(createMediaBlob(imageJpegCardMediaBlobNormalizationVersion), storageCalls),
  );

  assert.equal(result.applied, true);
  assert.deepEqual(storageCalls, []);
});

test("ingestImageMediaAssetWithDependencies uploads when no final normalized blob exists", async () => {
  const storageCalls: Array<string> = [];
  const result = await ingestImageMediaAssetWithDependencies(
    {
      userId: testUserId,
      workspaceId: testWorkspaceId,
      metadata: createMetadata(),
      imageBytes: testOriginalBytes,
      observationScope: testObservationScope,
    },
    createDependencies(null, storageCalls),
  );

  assert.equal(result.applied, true);
  assert.deepEqual(storageCalls, [buildMediaBlobStorageKey(testNormalizedSha256)]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../shared/errors";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
  buildMediaUploadStagingStorageKey,
} from "./storageKeys";
import { isValidMediaAssetLastOperationId } from "./lastOperationId";
import {
  maximumImageIngestionOriginalBytes,
  maximumMultipartUploadBytes,
  maximumSinglePutUploadBytes,
  mediaAssetImageIngestionHeaderNames,
  parseMediaAssetImageIngestionMetadataHeaders,
  parseMediaAssetUploadIntentInput,
  parseMediaAssetUploadSessionCreateInput,
  readMediaAssetImageIngestionBytes,
  readMediaAssetImageIngestionBytesWithAbortSignal,
} from "./validators";

const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const testSha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
const maximumTransportSafeImageIngestionOriginalBytes = 4_000_000;

test("buildMediaBlobStorageKey uses a content-addressed blob prefix", () => {
  assert.equal(
    buildMediaBlobStorageKey(testSha256),
    `media/blobs/sha256/5e/88/${testSha256}`,
  );
});

test("buildMediaUploadStagingStorageKey scopes temporary uploads by workspace asset and operation", () => {
  assert.equal(
    buildMediaUploadStagingStorageKey(testWorkspaceId, testMediaAssetId, "operation-media-1"),
    [
      "media/uploads/workspaces",
      testWorkspaceId,
      "assets",
      testMediaAssetId,
      "operations/e12febdf2c87aabeb4f0594f67409b7ec07fe532eb25e0c9e9f8f4f3febb0d6d",
    ].join("/"),
  );
});

test("buildMediaMultipartUploadStagingStorageKey scopes temporary multipart uploads by session", () => {
  assert.equal(
    buildMediaMultipartUploadStagingStorageKey(
      testWorkspaceId,
      testMediaAssetId,
      "33333333-3333-4333-8333-333333333333",
    ),
    [
      "media/uploads/workspaces",
      testWorkspaceId,
      "assets",
      testMediaAssetId,
      "sessions/33333333-3333-4333-8333-333333333333",
    ].join("/"),
  );
});

test("media asset upload validators keep direct uploads compatible and cap multipart promotion size", () => {
  assert.equal(maximumMultipartUploadBytes, maximumSinglePutUploadBytes);
  assert.equal(parseMediaAssetUploadIntentInput({
    mediaAssetId: testMediaAssetId,
    mimeType: "image/png",
    sizeBytes: 0,
    sha256: testSha256,
    lastOperationId: "operation-direct-zero",
  }).sizeBytes, 0);
  assert.equal(parseMediaAssetUploadSessionCreateInput({
    mediaAssetId: testMediaAssetId,
    mimeType: "image/png",
    sizeBytes: maximumMultipartUploadBytes,
    sha256: testSha256,
    partSizeBytes: maximumMultipartUploadBytes,
    partCount: 1,
    sourceUrl: null,
    createdAt: "2026-02-28T09:00:00.000Z",
    clientUpdatedAt: "2026-02-28T10:00:00.000Z",
    lastModifiedByReplicaId: "55555555-5555-4555-8555-555555555555",
    lastOperationId: "operation-multipart-max",
  }).sizeBytes, maximumMultipartUploadBytes);

  assert.throws(
    () => parseMediaAssetUploadSessionCreateInput({
      mediaAssetId: testMediaAssetId,
      mimeType: "image/png",
      sizeBytes: maximumMultipartUploadBytes + 1,
      sha256: testSha256,
      partSizeBytes: maximumMultipartUploadBytes,
      partCount: 2,
      sourceUrl: null,
      createdAt: "2026-02-28T09:00:00.000Z",
      clientUpdatedAt: "2026-02-28T10:00:00.000Z",
      lastModifiedByReplicaId: "55555555-5555-4555-8555-555555555555",
      lastOperationId: "operation-multipart-too-large",
    }),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "MEDIA_ASSET_SIZE_TOO_LARGE");
      return true;
    },
  );
});

test("media asset upload validators reject unsafe last operation identifiers", () => {
  assert.throws(
    () => parseMediaAssetUploadSessionCreateInput({
      mediaAssetId: testMediaAssetId,
      mimeType: "image/png",
      sizeBytes: 42,
      sha256: testSha256,
      partSizeBytes: 42,
      partCount: 1,
      sourceUrl: null,
      createdAt: "2026-02-28T09:00:00.000Z",
      clientUpdatedAt: "2026-02-28T10:00:00.000Z",
      lastModifiedByReplicaId: "55555555-5555-4555-8555-555555555555",
      lastOperationId: "operation\nmultipart",
    }),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "MEDIA_ASSET_LAST_OPERATION_ID_INVALID");
      return true;
    },
  );
});

test("media asset last operation identifiers use one printable ASCII contract", () => {
  const accepted = [
    "550e8400-e29b-41d4-a716-446655440000",
    "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "550e8400-e29b-41d4-a716-446655440000:media:99",
    "operation with internal spaces",
    "a".repeat(1_024),
  ];
  const rejected = [
    "",
    " leading-space",
    "trailing-space ",
    "operation\tcontrol",
    "operation\ncontrol",
    "operation\u00a0nbsp",
    "operation-😀",
    "😀".repeat(512),
    "\ud800",
    "\udc00",
    "a".repeat(1_025),
  ];

  for (const value of accepted) {
    assert.equal(isValidMediaAssetLastOperationId(value), true, value);
  }
  for (const value of rejected) {
    assert.equal(isValidMediaAssetLastOperationId(value), false, value);
  }
});

test("deadline-aware image request reading cancels its underlying body stream", async () => {
  const controller = new AbortController();
  const deadlineError = new HttpError(
    503,
    "Image ingestion deadline reached.",
    "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED",
  );
  let cancelReason: unknown = null;
  const body = new ReadableStream<Uint8Array>({
    pull: async () => new Promise<void>(() => {}),
    cancel: (reason) => {
      cancelReason = reason;
    },
  });
  const request = new Request("https://example.com/media", {
    method: "POST",
    headers: { "content-type": "image/png" },
    body,
    duplex: "half",
  });

  const read = readMediaAssetImageIngestionBytesWithAbortSignal(
    request,
    controller.signal,
  );
  setImmediate(() => controller.abort(deadlineError));

  await assert.rejects(read, (error: unknown) => error === deadlineError);
  assert.equal(cancelReason, deadlineError);
});

test("media asset image ingestion validators parse metadata headers and reject oversized originals", async () => {
  assert.ok(maximumImageIngestionOriginalBytes <= maximumTransportSafeImageIngestionOriginalBytes);

  const headers = new Headers({
    [mediaAssetImageIngestionHeaderNames.mediaAssetId]: testMediaAssetId,
    [mediaAssetImageIngestionHeaderNames.sourceUrl]: " https://example.com/source image.png ",
    [mediaAssetImageIngestionHeaderNames.createdAt]: "2026-02-28T09:00:00.000Z",
    [mediaAssetImageIngestionHeaderNames.clientUpdatedAt]: "2026-02-28T10:00:00.000Z",
    [mediaAssetImageIngestionHeaderNames.lastModifiedByReplicaId]: "66666666-6666-4666-8666-666666666666",
    [mediaAssetImageIngestionHeaderNames.lastOperationId]: "operation-image-1",
  });
  const metadata = parseMediaAssetImageIngestionMetadataHeaders(headers);

  assert.deepEqual(metadata, {
    mediaAssetId: testMediaAssetId,
    sourceUrl: "https://example.com/source%20image.png",
    createdAt: "2026-02-28T09:00:00.000Z",
    clientUpdatedAt: "2026-02-28T10:00:00.000Z",
    lastModifiedByReplicaId: "66666666-6666-4666-8666-666666666666",
    lastOperationId: "operation-image-1",
  });

  await assert.rejects(
    async () => readMediaAssetImageIngestionBytes(new Request("https://example.com/media", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "content-length": String(maximumImageIngestionOriginalBytes + 1),
      },
      body: "x",
    })),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 413);
      assert.equal(error.code, "MEDIA_ASSET_IMAGE_BYTES_TOO_LARGE");
      return true;
    },
  );

  await assert.rejects(
    async () => readMediaAssetImageIngestionBytes(new Request("https://example.com/media", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "content-length": "12x",
      },
      body: "x",
    })),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "CONTENT_LENGTH_INVALID");
      return true;
    },
  );
});

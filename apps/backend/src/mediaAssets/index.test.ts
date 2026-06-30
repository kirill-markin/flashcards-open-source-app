import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import { HttpError } from "../shared/errors";
import {
  beginMediaAssetUploadSessionCompletionInExecutor,
  recoverMediaAssetUploadSessionCompletionInExecutor,
} from ".";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
  buildMediaUploadStagingStorageKey,
} from "./storageKeys";
import {
  maximumImageIngestionOriginalBytes,
  maximumMultipartUploadBytes,
  maximumSinglePutUploadBytes,
  mediaAssetImageIngestionHeaderNames,
  parseMediaAssetImageIngestionMetadataHeaders,
  parseMediaAssetUploadIntentInput,
  parseMediaAssetUploadSessionCreateInput,
  readMediaAssetImageIngestionBytes,
} from "./validators";
import type { MediaAssetUploadSessionRow } from "./types";

const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const testUploadSessionId = "55555555-5555-4555-8555-555555555555";
const testSha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
const testStorageKey = buildMediaBlobStorageKey(testSha256);
const maximumTransportSafeImageIngestionOriginalBytes = 4_000_000;

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createMediaAssetUploadSessionRow(
  state: MediaAssetUploadSessionRow["state"],
): MediaAssetUploadSessionRow {
  return {
    media_upload_session_id: testUploadSessionId,
    workspace_id: testWorkspaceId,
    media_asset_id: testMediaAssetId,
    media_blob_sha256: testSha256,
    staging_storage_key: buildMediaMultipartUploadStagingStorageKey(testWorkspaceId, testMediaAssetId, testUploadSessionId),
    blob_storage_key: testStorageKey,
    s3_upload_id: "s3-upload-id-1",
    mime_type: "image/png",
    size_bytes: 42,
    part_size_bytes: 21,
    part_count: 2,
    state,
    source_url: "https://example.com/source%20image.png",
    asset_created_at: "2026-02-28T09:00:00.000Z",
    client_updated_at: "2026-02-28T10:00:00.000Z",
    last_modified_by_replica_id: "replica-new",
    last_operation_id: "operation-new",
    expires_at: "2099-02-28T10:00:00.000Z",
    created_at: "2026-02-28T10:00:00.000Z",
    completed_at: null,
    aborted_at: null,
  };
}

function createUploadSessionCompletionExecutor(): Readonly<{
  executor: DatabaseExecutor;
  getSessionState: () => MediaAssetUploadSessionRow["state"];
  getCompletionUpdateCount: () => number;
  getRecoveryUpdateCount: () => number;
}> {
  let sessionRow = createMediaAssetUploadSessionRow("active");
  let completionUpdateCount = 0;
  let recoveryUpdateCount = 0;

  return {
    executor: {
      query: async <Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> => {
        if (text.includes("FROM content.media_upload_sessions") && text.includes("FOR UPDATE")) {
          assert.deepEqual(params, [testWorkspaceId, testUploadSessionId]);
          return createQueryResult([sessionRow as unknown as Row]);
        }

        if (text.includes("UPDATE content.media_upload_sessions") && text.includes("SET state = 'completing'")) {
          completionUpdateCount += 1;
          assert.deepEqual(params, [testWorkspaceId, testUploadSessionId]);
          if (sessionRow.state !== "active") {
            return createQueryResult<Row>([]);
          }

          sessionRow = {
            ...sessionRow,
            state: "completing",
          };
          return createQueryResult([sessionRow as unknown as Row]);
        }

        if (text.includes("UPDATE content.media_upload_sessions") && text.includes("SET state = 'active'")) {
          recoveryUpdateCount += 1;
          assert.deepEqual(params, [testWorkspaceId, testUploadSessionId]);
          if (sessionRow.state !== "completing") {
            return createQueryResult<Row>([]);
          }

          sessionRow = {
            ...sessionRow,
            state: "active",
          };
          return createQueryResult([sessionRow as unknown as Row]);
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    },
    getSessionState: () => sessionRow.state,
    getCompletionUpdateCount: () => completionUpdateCount,
    getRecoveryUpdateCount: () => recoveryUpdateCount,
  };
}

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

test("beginMediaAssetUploadSessionCompletionInExecutor validates parts before marking the session completing", async () => {
  const completion = createUploadSessionCompletionExecutor();

  await assert.rejects(
    beginMediaAssetUploadSessionCompletionInExecutor(
      completion.executor,
      testWorkspaceId,
      testUploadSessionId,
      [{ partNumber: 1 }],
    ),
    (error: unknown): boolean => {
      if (!(error instanceof HttpError)) {
        return false;
      }

      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "MEDIA_ASSET_PART_COUNT_MISMATCH");
      return true;
    },
  );
  assert.equal(completion.getSessionState(), "active");
  assert.equal(completion.getCompletionUpdateCount(), 0);

  await assert.rejects(
    beginMediaAssetUploadSessionCompletionInExecutor(
      completion.executor,
      testWorkspaceId,
      testUploadSessionId,
      [{ partNumber: 1 }, { partNumber: 1 }],
    ),
    (error: unknown): boolean => {
      if (!(error instanceof HttpError)) {
        return false;
      }

      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "MEDIA_ASSET_PART_SEQUENCE_INVALID");
      return true;
    },
  );
  assert.equal(completion.getSessionState(), "active");
  assert.equal(completion.getCompletionUpdateCount(), 0);

  const result = await beginMediaAssetUploadSessionCompletionInExecutor(
    completion.executor,
    testWorkspaceId,
    testUploadSessionId,
    [{ partNumber: 1 }, { partNumber: 2 }],
  );

  assert.equal(result.status, "complete_required");
  if (result.status !== "complete_required") {
    assert.fail("Expected completion to be required");
  }
  assert.equal(result.uploadSession.state, "completing");
  assert.equal(completion.getSessionState(), "completing");
  assert.equal(completion.getCompletionUpdateCount(), 1);
});

test("recoverMediaAssetUploadSessionCompletionInExecutor restores storage-rejected completion for retry", async () => {
  const completion = createUploadSessionCompletionExecutor();

  const started = await beginMediaAssetUploadSessionCompletionInExecutor(
    completion.executor,
    testWorkspaceId,
    testUploadSessionId,
    [{ partNumber: 1 }, { partNumber: 2 }],
  );
  assert.equal(started.status, "complete_required");
  assert.equal(completion.getSessionState(), "completing");
  assert.equal(completion.getCompletionUpdateCount(), 1);

  const recovered = await recoverMediaAssetUploadSessionCompletionInExecutor(
    completion.executor,
    testWorkspaceId,
    testUploadSessionId,
  );
  assert.equal(recovered.state, "active");
  assert.equal(completion.getSessionState(), "active");
  assert.equal(completion.getRecoveryUpdateCount(), 1);

  const retried = await beginMediaAssetUploadSessionCompletionInExecutor(
    completion.executor,
    testWorkspaceId,
    testUploadSessionId,
    [{ partNumber: 1 }, { partNumber: 2 }],
  );
  assert.equal(retried.status, "complete_required");
  if (retried.status !== "complete_required") {
    assert.fail("Expected retried completion to be required");
  }
  assert.equal(retried.uploadSession.state, "completing");
  assert.equal(completion.getSessionState(), "completing");
  assert.equal(completion.getCompletionUpdateCount(), 2);
});

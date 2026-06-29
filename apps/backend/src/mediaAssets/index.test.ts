import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import { HttpError } from "../shared/errors";
import {
  beginMediaAssetUploadSessionCompletionInExecutor,
  mapMediaAssetRow,
  recoverMediaAssetUploadSessionCompletionInExecutor,
  upsertMediaAssetSnapshotInExecutor,
} from ".";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
  buildMediaUploadStagingStorageKey,
} from "./storageKeys";
import {
  maximumMultipartUploadBytes,
  maximumSinglePutUploadBytes,
  parseMediaAssetUploadIntentInput,
  parseMediaAssetUploadSessionCreateInput,
} from "./validators";
import type {
  MediaAssetRow,
  MediaAssetSnapshotInput,
  MediaAssetUploadSessionRow,
  MediaBlobRow,
} from "./types";

const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const secondMediaAssetId = "33333333-3333-4333-8333-333333333333";
const testMediaBlobId = "44444444-4444-4444-8444-444444444444";
const testUploadSessionId = "55555555-5555-4555-8555-555555555555";
const testSha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
const testStorageKey = buildMediaBlobStorageKey(testSha256);

type MediaAssetMutationFixture = Readonly<{
  sourceUrl: string | null;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createMediaBlobRow(fixture: Readonly<{
  mediaBlobId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
}>): MediaBlobRow {
  return {
    media_blob_id: fixture.mediaBlobId,
    mime_type: fixture.mimeType,
    size_bytes: fixture.sizeBytes,
    sha256: fixture.sha256,
    storage_key: fixture.storageKey,
    created_at: "2026-02-28T09:00:00.000Z",
    updated_at: "2026-02-28T09:00:00.000Z",
  };
}

function createMediaAssetRow(fixture: MediaAssetMutationFixture & Readonly<{
  mediaAssetId: string;
  mediaBlob: MediaBlobRow;
}>): MediaAssetRow {
  return {
    media_asset_id: fixture.mediaAssetId,
    workspace_id: testWorkspaceId,
    media_blob_id: fixture.mediaBlob.media_blob_id,
    mime_type: fixture.mediaBlob.mime_type,
    size_bytes: fixture.mediaBlob.size_bytes,
    sha256: fixture.mediaBlob.sha256,
    storage_key: fixture.mediaBlob.storage_key,
    blob_created_at: fixture.mediaBlob.created_at,
    blob_updated_at: fixture.mediaBlob.updated_at,
    source_url: fixture.sourceUrl,
    created_at: "2026-02-28T09:00:00.000Z",
    client_updated_at: fixture.clientUpdatedAt,
    last_modified_by_replica_id: fixture.lastModifiedByReplicaId,
    last_operation_id: fixture.lastOperationId,
    updated_at: fixture.updatedAt,
    deleted_at: fixture.deletedAt,
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

function createSnapshotInput(mediaAssetId: string): MediaAssetSnapshotInput {
  return {
    mediaAssetId,
    mimeType: "image/png",
    sizeBytes: 42,
    sha256: testSha256,
    sourceUrl: " https://example.com/source image.png ",
    createdAt: "2026-02-28T09:00:00.000Z",
    deletedAt: null,
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

function createWorkspaceSyncQueryResult<Row extends pg.QueryResultRow>(
  text: string,
  params: ReadonlyArray<SqlValue>,
): pg.QueryResult<Row> | null {
  if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
    return createQueryResult<Row>([]);
  }

  if (text === "SELECT workspace_id FROM sync.workspace_sync_metadata WHERE workspace_id = $1 FOR UPDATE") {
    assert.deepEqual(params, [testWorkspaceId]);
    return createQueryResult<Row>([{ workspace_id: testWorkspaceId } as unknown as Row]);
  }

  return null;
}

function createHotChangeResult<Row extends pg.QueryResultRow>(
  text: string,
  params: ReadonlyArray<SqlValue>,
  changeId: number,
  operationId: string,
): pg.QueryResult<Row> | null {
  if (text.includes("INSERT INTO sync.hot_changes")) {
    assert.deepEqual(params, [
      testWorkspaceId,
      "media_asset",
      params[2],
      "upsert",
      "replica-new",
      operationId,
      "2026-02-28T10:00:00.000Z",
    ]);
    return createQueryResult<Row>([{
      change_id: changeId,
    } as unknown as Row]);
  }

  return null;
}

function createExistingMediaAssetUpdateExecutor(): DatabaseExecutor {
  const queries: string[] = [];
  const mediaBlob = createMediaBlobRow({
    mediaBlobId: testMediaBlobId,
    mimeType: "image/png",
    sizeBytes: 42,
    sha256: testSha256,
    storageKey: testStorageKey,
  });
  const existingRow = createMediaAssetRow({
    mediaAssetId: testMediaAssetId,
    mediaBlob,
    sourceUrl: null,
    clientUpdatedAt: "2026-02-28T09:00:00.000Z",
    lastModifiedByReplicaId: "replica-old",
    lastOperationId: "operation-old",
    updatedAt: "2026-02-28T09:00:00.000Z",
    deletedAt: null,
  });

  return {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      queries.push(text);

      const workspaceSyncResult = createWorkspaceSyncQueryResult<Row>(text, params);
      if (workspaceSyncResult !== null) {
        return workspaceSyncResult;
      }

      if (text.includes("FROM content.media_assets AS media_assets") && text.includes("FOR UPDATE")) {
        assert.deepEqual(queries.slice(0, 3), [
          "INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at) VALUES ($1, 0, now()) ON CONFLICT (workspace_id) DO NOTHING",
          "SELECT workspace_id FROM sync.workspace_sync_metadata WHERE workspace_id = $1 FOR UPDATE",
          text,
        ]);
        assert.deepEqual(params, [testWorkspaceId, testMediaAssetId]);
        return createQueryResult([existingRow as unknown as Row]);
      }

      if (text.startsWith("WITH updated_media_asset AS (")) {
        assert.doesNotMatch(text, /updated_at = now\(\),\s+WHERE/);
        assert.match(text, /INNER JOIN content\.media_blobs AS media_blobs/);
        assert.deepEqual(params, [
          testWorkspaceId,
          testMediaAssetId,
          "https://example.com/updated%20image.png",
          "2026-02-28T09:00:00.000Z",
          "2026-02-28T10:00:00.000Z",
          "2026-02-28T10:00:00.000Z",
          "replica-new",
          "operation-new",
        ]);
        return createQueryResult([{
          ...existingRow,
          source_url: params[2],
          client_updated_at: params[5],
          last_modified_by_replica_id: params[6],
          last_operation_id: params[7],
          updated_at: "2026-02-28T10:00:01.000Z",
          deleted_at: params[4],
        } as MediaAssetRow as unknown as Row]);
      }

      const hotChangeResult = createHotChangeResult<Row>(text, params, 17, "operation-new");
      if (hotChangeResult !== null) {
        return hotChangeResult;
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

function createExistingMediaAssetConflictExecutor(): DatabaseExecutor {
  const conflictingSha256 = "a".repeat(64);
  const mediaBlob = createMediaBlobRow({
    mediaBlobId: testMediaBlobId,
    mimeType: "image/jpeg",
    sizeBytes: 24,
    sha256: conflictingSha256,
    storageKey: buildMediaBlobStorageKey(conflictingSha256),
  });
  const existingRow = createMediaAssetRow({
    mediaAssetId: testMediaAssetId,
    mediaBlob,
    sourceUrl: null,
    clientUpdatedAt: "2026-02-28T09:00:00.000Z",
    lastModifiedByReplicaId: "replica-old",
    lastOperationId: "operation-old",
    updatedAt: "2026-02-28T09:00:00.000Z",
    deletedAt: null,
  });

  return {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      const workspaceSyncResult = createWorkspaceSyncQueryResult<Row>(text, params);
      if (workspaceSyncResult !== null) {
        return workspaceSyncResult;
      }

      if (text.includes("FROM content.media_assets AS media_assets") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testWorkspaceId, testMediaAssetId]);
        return createQueryResult([existingRow as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

function createDuplicateBlobExecutor(): Readonly<{
  executor: DatabaseExecutor;
  assetRowsById: Map<string, MediaAssetRow>;
  blobRowsBySha256: Map<string, MediaBlobRow>;
}> {
  const assetRowsById = new Map<string, MediaAssetRow>();
  const blobRowsBySha256 = new Map<string, MediaBlobRow>();
  let nextChangeId = 20;

  const executor: DatabaseExecutor = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      const workspaceSyncResult = createWorkspaceSyncQueryResult<Row>(text, params);
      if (workspaceSyncResult !== null) {
        return workspaceSyncResult;
      }

      if (text.includes("FROM content.media_assets AS media_assets") && text.includes("FOR UPDATE")) {
        const mediaAssetId = String(params[1]);
        const row = assetRowsById.get(mediaAssetId);
        return createQueryResult(row === undefined ? [] : [row as unknown as Row]);
      }

      if (text.startsWith("INSERT INTO content.media_blobs")) {
        const sha256 = String(params[0]);
        const existingBlob = blobRowsBySha256.get(sha256);
        if (existingBlob !== undefined) {
          return createQueryResult<Row>([]);
        }

        const mediaBlob = createMediaBlobRow({
          mediaBlobId: testMediaBlobId,
          mimeType: String(params[1]),
          sizeBytes: Number(params[2]),
          sha256,
          storageKey: String(params[3]),
        });
        blobRowsBySha256.set(sha256, mediaBlob);
        return createQueryResult([mediaBlob as unknown as Row]);
      }

      if (text.includes("FROM content.media_blobs") && text.includes("WHERE sha256 = $1")) {
        const row = blobRowsBySha256.get(String(params[0]));
        return createQueryResult(row === undefined ? [] : [row as unknown as Row]);
      }

      if (text.startsWith("WITH inserted_media_asset AS (")) {
        const mediaAssetId = String(params[0]);
        if (assetRowsById.has(mediaAssetId)) {
          return createQueryResult<Row>([]);
        }

        const mediaBlob = [...blobRowsBySha256.values()].find((row) => row.media_blob_id === params[2]);
        if (mediaBlob === undefined) {
          throw new Error(`Missing media blob for ${String(params[2])}`);
        }

        const row = createMediaAssetRow({
          mediaAssetId,
          mediaBlob,
          sourceUrl: params[3] === null ? null : String(params[3]),
          clientUpdatedAt: String(params[5]),
          lastModifiedByReplicaId: String(params[6]),
          lastOperationId: String(params[7]),
          updatedAt: "2026-02-28T10:00:01.000Z",
          deletedAt: params[8] === null ? null : String(params[8]),
        });
        assetRowsById.set(mediaAssetId, row);
        return createQueryResult([row as unknown as Row]);
      }

      if (text.includes("INSERT INTO sync.hot_changes")) {
        nextChangeId += 1;
        return createQueryResult<Row>([{
          change_id: nextChangeId,
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  return {
    executor,
    assetRowsById,
    blobRowsBySha256,
  };
}

function createBlobMetadataConflictExecutor(): DatabaseExecutor {
  const conflictingBlob = createMediaBlobRow({
    mediaBlobId: testMediaBlobId,
    mimeType: "image/jpeg",
    sizeBytes: 42,
    sha256: testSha256,
    storageKey: testStorageKey,
  });

  return {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      const workspaceSyncResult = createWorkspaceSyncQueryResult<Row>(text, params);
      if (workspaceSyncResult !== null) {
        return workspaceSyncResult;
      }

      if (text.includes("FROM content.media_assets AS media_assets") && text.includes("FOR UPDATE")) {
        return createQueryResult<Row>([]);
      }

      if (text.startsWith("INSERT INTO content.media_blobs")) {
        return createQueryResult<Row>([]);
      }

      if (text.includes("FROM content.media_blobs") && text.includes("WHERE sha256 = $1")) {
        assert.deepEqual(params, [testSha256]);
        return createQueryResult([conflictingBlob as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
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

test("mapMediaAssetRow omits backend-only blob storage fields from public media assets", () => {
  const mediaBlob = createMediaBlobRow({
    mediaBlobId: testMediaBlobId,
    mimeType: "image/png",
    sizeBytes: 42,
    sha256: testSha256,
    storageKey: testStorageKey,
  });
  const mediaAsset = mapMediaAssetRow(createMediaAssetRow({
    mediaAssetId: testMediaAssetId,
    mediaBlob,
    sourceUrl: null,
    clientUpdatedAt: "2026-02-28T09:00:00.000Z",
    lastModifiedByReplicaId: "replica-old",
    lastOperationId: "operation-old",
    updatedAt: "2026-02-28T09:00:00.000Z",
    deletedAt: null,
  }));

  assert.equal(mediaAsset.mimeType, "image/png");
  assert.equal(mediaAsset.sha256, testSha256);
  assert.equal(Object.prototype.hasOwnProperty.call(mediaAsset, "storageKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(mediaAsset, "mediaBlobId"), false);
});

test("upsertMediaAssetSnapshotInExecutor reuses one blob row for duplicate logical assets", async () => {
  const { executor, assetRowsById, blobRowsBySha256 } = createDuplicateBlobExecutor();

  const firstResult = await upsertMediaAssetSnapshotInExecutor(
    executor,
    testWorkspaceId,
    createSnapshotInput(testMediaAssetId),
    {
      clientUpdatedAt: "2026-02-28T10:00:00.000Z",
      lastModifiedByReplicaId: "replica-new",
      lastOperationId: "operation-one",
    },
  );
  const secondResult = await upsertMediaAssetSnapshotInExecutor(
    executor,
    testWorkspaceId,
    createSnapshotInput(secondMediaAssetId),
    {
      clientUpdatedAt: "2026-02-28T10:00:00.000Z",
      lastModifiedByReplicaId: "replica-new",
      lastOperationId: "operation-two",
    },
  );

  assert.equal(firstResult.applied, true);
  assert.equal(secondResult.applied, true);
  assert.equal(blobRowsBySha256.size, 1);
  assert.equal(assetRowsById.get(testMediaAssetId)?.media_blob_id, testMediaBlobId);
  assert.equal(assetRowsById.get(secondMediaAssetId)?.media_blob_id, testMediaBlobId);
});

test("upsertMediaAssetSnapshotInExecutor rejects sha256 blob metadata collisions", async () => {
  await assert.rejects(
    upsertMediaAssetSnapshotInExecutor(
      createBlobMetadataConflictExecutor(),
      testWorkspaceId,
      createSnapshotInput(testMediaAssetId),
      {
        clientUpdatedAt: "2026-02-28T10:00:00.000Z",
        lastModifiedByReplicaId: "replica-new",
        lastOperationId: "operation-new",
      },
    ),
    (error: unknown): boolean => {
      if (!(error instanceof HttpError)) {
        return false;
      }

      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_BLOB_METADATA_CONFLICT");
      assert.match(error.message, /conflictingFields=mimeType,sizeBytes,sha256/);
      assert.doesNotMatch(error.message, /storageKey|media\/blobs|s3:\/\/|sha256=/);
      assert.doesNotMatch(error.message, new RegExp(testSha256));
      return true;
    },
  );
});

test("upsertMediaAssetSnapshotInExecutor rejects media asset metadata conflicts without echoing hashes", async () => {
  await assert.rejects(
    upsertMediaAssetSnapshotInExecutor(
      createExistingMediaAssetConflictExecutor(),
      testWorkspaceId,
      createSnapshotInput(testMediaAssetId),
      {
        clientUpdatedAt: "2026-02-28T10:00:00.000Z",
        lastModifiedByReplicaId: "replica-new",
        lastOperationId: "operation-new",
      },
    ),
    (error: unknown): boolean => {
      if (!(error instanceof HttpError)) {
        return false;
      }

      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_ID_CONFLICT");
      assert.match(error.message, /conflictingFields=mimeType,sizeBytes,sha256/);
      assert.doesNotMatch(error.message, /existingSha256|requestedSha256|sha256=/);
      assert.doesNotMatch(error.message, new RegExp(testSha256));
      return true;
    },
  );
});

test("upsertMediaAssetSnapshotInExecutor updates existing media asset metadata through valid SQL", async () => {
  const result = await upsertMediaAssetSnapshotInExecutor(
    createExistingMediaAssetUpdateExecutor(),
    testWorkspaceId,
    {
      ...createSnapshotInput(testMediaAssetId),
      sourceUrl: " https://example.com/updated image.png ",
      deletedAt: "2026-02-28T10:00:00.000Z",
    },
    {
      clientUpdatedAt: "2026-02-28T10:00:00.000Z",
      lastModifiedByReplicaId: "replica-new",
      lastOperationId: "operation-new",
    },
  );

  assert.equal(result.applied, true);
  assert.equal(result.changeId, 17);
  assert.equal(result.mediaAsset.sourceUrl, "https://example.com/updated%20image.png");
  assert.equal(result.mediaAsset.deletedAt, "2026-02-28T10:00:00.000Z");
  assert.equal(Object.prototype.hasOwnProperty.call(result.mediaAsset, "storageKey"), false);
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

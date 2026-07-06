import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { HttpError } from "../../shared/errors";
import {
  mapMediaAssetRow,
  mapMediaBlobRow,
  upsertMediaAssetSnapshotInExecutor,
} from "..";
import { buildMediaBlobStorageKey } from "../storageKeys";
import { passthroughMediaBlobNormalizationVersion } from "../types";
import type {
  MediaAssetRow,
  MediaAssetSnapshotInput,
  MediaBlobRow,
} from "../types";

const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const secondMediaAssetId = "33333333-3333-4333-8333-333333333333";
const testMediaBlobId = "44444444-4444-4444-8444-444444444444";
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
    normalization_version: passthroughMediaBlobNormalizationVersion,
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
    blob_normalization_version: fixture.mediaBlob.normalization_version,
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

function createExistingMediaAssetMissingHotChangeExecutor(): Readonly<{
  executor: DatabaseExecutor;
  insertedHotChangeParams: ReadonlyArray<ReadonlyArray<SqlValue>>;
}> {
  const insertedHotChangeParams: ReadonlyArray<SqlValue>[] = [];
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
    clientUpdatedAt: "2026-02-28T11:00:00.000Z",
    lastModifiedByReplicaId: "replica-winner",
    lastOperationId: "operation-winner",
    updatedAt: "2026-02-28T11:00:00.000Z",
    deletedAt: null,
  });

  return {
    executor: {
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

        if (text.includes("SELECT change_id FROM sync.hot_changes")) {
          assert.deepEqual(params, [testWorkspaceId, "media_asset", testMediaAssetId]);
          return createQueryResult<Row>([]);
        }

        if (text.includes("INSERT INTO sync.hot_changes")) {
          assert.deepEqual(params, [
            testWorkspaceId,
            "media_asset",
            testMediaAssetId,
            "upsert",
            "replica-winner",
            "operation-winner",
            "2026-02-28T11:00:00.000Z",
          ]);
          insertedHotChangeParams.push(params);
          return createQueryResult<Row>([{
            change_id: 31,
          } as unknown as Row]);
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    },
    insertedHotChangeParams,
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
        assert.match(text, /normalization_version/);
        const sha256 = String(params[0]);
        const existingBlob = blobRowsBySha256.get(sha256);
        if (existingBlob !== undefined) {
          return createQueryResult<Row>([]);
        }

        assert.equal(params[4], passthroughMediaBlobNormalizationVersion);
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
  assert.equal(Object.prototype.hasOwnProperty.call(mediaAsset, "normalizationVersion"), false);
});

test("mapMediaBlobRow exposes backend-only blob normalization version", () => {
  const mediaBlob = mapMediaBlobRow(createMediaBlobRow({
    mediaBlobId: testMediaBlobId,
    mimeType: "image/png",
    sizeBytes: 42,
    sha256: testSha256,
    storageKey: testStorageKey,
  }));

  assert.equal(mediaBlob.normalizationVersion, passthroughMediaBlobNormalizationVersion);
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

test("upsertMediaAssetSnapshotInExecutor records missing hot change for existing LWW winner", async () => {
  const { executor, insertedHotChangeParams } = createExistingMediaAssetMissingHotChangeExecutor();

  const result = await upsertMediaAssetSnapshotInExecutor(
    executor,
    testWorkspaceId,
    createSnapshotInput(testMediaAssetId),
    {
      clientUpdatedAt: "2026-02-28T10:00:00.000Z",
      lastModifiedByReplicaId: "replica-loser",
      lastOperationId: "operation-loser",
    },
  );

  assert.equal(result.applied, false);
  assert.equal(result.changeId, 31);
  assert.equal(result.mediaAsset.mediaAssetId, testMediaAssetId);
  assert.equal(result.mediaAsset.lastModifiedByReplicaId, "replica-winner");
  assert.equal(result.mediaAsset.lastOperationId, "operation-winner");
  assert.equal(insertedHotChangeParams.length, 1);
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

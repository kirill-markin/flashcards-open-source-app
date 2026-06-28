import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import { buildMediaAssetStorageKey } from "./storageKeys";
import {
  upsertMediaAssetSnapshotInExecutor,
} from ".";
import type { MediaAssetRow } from "./types";

const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const testSha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
const testStorageKey = buildMediaAssetStorageKey(testWorkspaceId, testMediaAssetId, testSha256);

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createMediaAssetRow(fixture: Readonly<{
  sourceUrl: string | null;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>): MediaAssetRow {
  return {
    media_asset_id: testMediaAssetId,
    workspace_id: testWorkspaceId,
    mime_type: "image/png",
    size_bytes: 42,
    sha256: testSha256,
    storage_key: testStorageKey,
    source_url: fixture.sourceUrl,
    created_at: "2026-02-28T09:00:00.000Z",
    client_updated_at: fixture.clientUpdatedAt,
    last_modified_by_replica_id: fixture.lastModifiedByReplicaId,
    last_operation_id: fixture.lastOperationId,
    updated_at: fixture.updatedAt,
    deleted_at: fixture.deletedAt,
  };
}

function createExistingMediaAssetUpdateExecutor(): DatabaseExecutor {
  const queries: string[] = [];
  const existingRow = createMediaAssetRow({
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

      if (text.includes("FROM content.media_assets") && text.includes("FOR UPDATE")) {
        assert.deepEqual(queries.slice(0, 3), [
          "INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at) VALUES ($1, 0, now()) ON CONFLICT (workspace_id) DO NOTHING",
          "SELECT workspace_id FROM sync.workspace_sync_metadata WHERE workspace_id = $1 FOR UPDATE",
          text,
        ]);
        assert.deepEqual(params, [testWorkspaceId, testMediaAssetId]);
        return createQueryResult([existingRow as unknown as Row]);
      }

      if (text.startsWith("UPDATE content.media_assets")) {
        assert.doesNotMatch(text, /updated_at = now\(\),\s+WHERE/);
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

      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        return createQueryResult<Row>([]);
      }

      if (
        text
          === "SELECT workspace_id FROM sync.workspace_sync_metadata WHERE workspace_id = $1 FOR UPDATE"
      ) {
        assert.deepEqual(params, [testWorkspaceId]);
        return createQueryResult<Row>([{ workspace_id: testWorkspaceId } as unknown as Row]);
      }

      if (text.includes("INSERT INTO sync.hot_changes")) {
        assert.deepEqual(params, [
          testWorkspaceId,
          "media_asset",
          testMediaAssetId,
          "upsert",
          "replica-new",
          "operation-new",
          "2026-02-28T10:00:00.000Z",
        ]);
        return createQueryResult<Row>([{
          change_id: 17,
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

test("upsertMediaAssetSnapshotInExecutor updates existing media asset metadata through valid SQL", async () => {
  const result = await upsertMediaAssetSnapshotInExecutor(
    createExistingMediaAssetUpdateExecutor(),
    testWorkspaceId,
    {
      mediaAssetId: testMediaAssetId,
      mimeType: "image/png",
      sizeBytes: 42,
      sha256: testSha256,
      storageKey: testStorageKey,
      sourceUrl: " https://example.com/updated image.png ",
      createdAt: "2026-02-28T09:00:00.000Z",
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
});

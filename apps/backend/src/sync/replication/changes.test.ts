import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import {
  insertSyncChange,
  lockWorkspaceSyncMetadataForHotChangesInExecutor,
} from "./changes";

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

test("lockWorkspaceSyncMetadataForHotChangesInExecutor locks workspace metadata before hot change insert", async () => {
  const queries: string[] = [];
  const workspaceId = "11111111-1111-4111-8111-111111111111";

  const executor: DatabaseExecutor = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      queries.push(text);

      if (text.startsWith("INSERT INTO sync.workspace_sync_metadata")) {
        assert.deepEqual(params, [workspaceId]);
        return createQueryResult<Row>([]);
      }

      if (
        text
          === "SELECT workspace_id FROM sync.workspace_sync_metadata WHERE workspace_id = $1 FOR UPDATE"
      ) {
        assert.deepEqual(params, [workspaceId]);
        return createQueryResult<Row>([{ workspace_id: workspaceId } as unknown as Row]);
      }

      if (text.startsWith("INSERT INTO sync.hot_changes")) {
        assert.deepEqual(params, [
          workspaceId,
          "card",
          "22222222-2222-4222-8222-222222222222",
          "upsert",
          "replica-1",
          "operation-1",
          "2026-02-28T10:00:00.000Z",
        ]);
        return createQueryResult<Row>([{ change_id: 42 } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(
    executor,
    workspaceId,
  );
  const changeId = await insertSyncChange(
    executor,
    workspaceId,
    hotChangeWriteLock,
    "card",
    "22222222-2222-4222-8222-222222222222",
    "upsert",
    "replica-1",
    "operation-1",
    "2026-02-28T10:00:00.000Z",
  );

  assert.equal(changeId, 42);
  assert.deepEqual(queries, [
    "INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at) VALUES ($1, 0, now()) ON CONFLICT (workspace_id) DO NOTHING",
    "SELECT workspace_id FROM sync.workspace_sync_metadata WHERE workspace_id = $1 FOR UPDATE",
    "INSERT INTO sync.hot_changes ( workspace_id, entity_type, entity_id, action, replica_id, operation_id, client_updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING change_id",
  ]);
});

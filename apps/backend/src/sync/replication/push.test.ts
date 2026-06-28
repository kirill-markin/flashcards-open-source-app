import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { CurrentUserPublicProfileResolver } from "../../community/reviewActivityFacts";
import type { DatabaseExecutor, SqlValue } from "../../database";
import type { SyncPushOperation } from "../contracts/input";
import { processOperationInExecutor } from "./push";

function createFailingExecutor(): DatabaseExecutor {
  return {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      throw new Error(`Unexpected query for rejected media_asset sync write: ${text} ${JSON.stringify(params)}`);
    },
  };
}

const resolveReviewedBy: CurrentUserPublicProfileResolver = async () => {
  throw new Error("media_asset sync write rejection must not resolve review profiles");
};

test("processOperationInExecutor rejects media_asset sync writes before storage registration", async () => {
  const operation: SyncPushOperation = {
    operationId: "operation-media-1",
    entityType: "media_asset",
    entityId: "22222222-2222-4222-8222-222222222222",
    action: "upsert",
    clientUpdatedAt: "2026-02-28T10:00:00.000Z",
    payload: {
      mediaAssetId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      mimeType: "image/png",
      sizeBytes: 42,
      sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      sourceUrl: null,
      createdAt: "2026-02-28T10:00:00.000Z",
      deletedAt: null,
    },
  };

  const result = await processOperationInExecutor(
    createFailingExecutor(),
    "11111111-1111-4111-8111-111111111111",
    "33333333-3333-4333-8333-333333333333",
    operation,
    resolveReviewedBy,
  );

  assert.deepEqual(result, {
    operationId: "operation-media-1",
    entityType: "media_asset",
    entityId: "22222222-2222-4222-8222-222222222222",
    status: "rejected",
    resultingHotChangeId: null,
    error: "media_asset sync writes are not accepted; use the media upload API to create or update media assets.",
  });
});

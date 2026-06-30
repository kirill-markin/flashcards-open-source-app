import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import { HttpError } from "../shared/errors";
import {
  beginMediaAssetUploadSessionCompletionInExecutor,
  recoverMediaAssetUploadSessionCompletionInExecutor,
} from "./uploadSessions";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "./storageKeys";
import type { MediaAssetUploadSessionRow } from "./types";

const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const testUploadSessionId = "55555555-5555-4555-8555-555555555555";
const testSha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
const testStorageKey = buildMediaBlobStorageKey(testSha256);

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
    staging_storage_key: buildMediaMultipartUploadStagingStorageKey(
      testWorkspaceId,
      testMediaAssetId,
      testUploadSessionId,
    ),
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

import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { buildMediaBlobStorageKey } from "../storageKeys";

export type MultipartPayload = Readonly<{
  userId: string;
  workspaceId: string;
  sessionId: string;
  mediaAssetId: string;
  replicaId: string;
  lastOperationId: string;
  sha256: string;
  stagingStorageKey: string;
  blobStorageKey: string;
  s3UploadId: string;
  mimeType: string;
  sizeBytes: number;
  partSizeBytes: number;
  partCount: number;
  sourceUrl: string | null;
  assetCreatedAt: string;
  clientUpdatedAt: string;
  sessionExpiresAt: string;
  normalizationVersion: string;
  partsFingerprint: string;
}>;

export type MultipartPayloadFixtureInput = Readonly<{
  userId: string;
  workspaceId: string;
  mediaAssetId: string;
  replicaId: string;
  assetCreatedAt: string;
  clientUpdatedAt: string;
  sessionExpiresAt: string;
}>;

export type MultipartPostgresIdentity = Readonly<{
  userId: string;
  workspaceId: string;
}>;

type QueryExecutor = Pick<pg.Pool | pg.PoolClient, "query">;
type SqlValue = string | number | null;
type MultipartUploadSessionState = "active" | "completing" | "aborting";

export const multipartPayloadCompositeRow = `ROW(
  $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
)::content.multipart_media_blob_writer_attempt_payload`;

export function digest(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

export function createMultipartPayloadFixture(
  input: MultipartPayloadFixtureInput,
): MultipartPayload {
  const sessionId = randomUUID();
  const sha256 = digest();
  return {
    userId: input.userId,
    workspaceId: input.workspaceId,
    sessionId,
    mediaAssetId: input.mediaAssetId,
    replicaId: input.replicaId,
    lastOperationId: randomUUID(),
    sha256,
    stagingStorageKey:
      `media/uploads/workspaces/${input.workspaceId}/assets/${input.mediaAssetId}/sessions/${sessionId}`,
    blobStorageKey: buildMediaBlobStorageKey(sha256),
    s3UploadId: `upload-${randomUUID()}`,
    mimeType: "application/octet-stream",
    sizeBytes: 42,
    partSizeBytes: 42,
    partCount: 1,
    sourceUrl: null,
    assetCreatedAt: input.assetCreatedAt,
    clientUpdatedAt: input.clientUpdatedAt,
    sessionExpiresAt: input.sessionExpiresAt,
    normalizationVersion: "passthrough-v1",
    partsFingerprint: digest(),
  };
}

export function multipartPayloadValues(
  payload: MultipartPayload,
): ReadonlyArray<SqlValue> {
  return [
    payload.userId,
    payload.workspaceId,
    payload.sessionId,
    payload.mediaAssetId,
    payload.replicaId,
    payload.lastOperationId,
    payload.sha256,
    payload.stagingStorageKey,
    payload.blobStorageKey,
    payload.s3UploadId,
    payload.mimeType,
    payload.sizeBytes,
    payload.partSizeBytes,
    payload.partCount,
    payload.sourceUrl,
    payload.assetCreatedAt,
    payload.clientUpdatedAt,
    payload.sessionExpiresAt,
    payload.normalizationVersion,
    payload.partsFingerprint,
  ];
}

export async function withMultipartPostgresTransaction<Result>(
  pool: pg.Pool,
  identity: MultipartPostgresIdentity,
  callback: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
      [identity.userId, identity.workspaceId],
    );
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function insertMultipartUploadSession(
  executor: QueryExecutor,
  payload: MultipartPayload,
  state: MultipartUploadSessionState,
): Promise<void> {
  await executor.query(
    `INSERT INTO content.media_upload_sessions (
       media_upload_session_id,workspace_id,media_asset_id,media_blob_sha256,
       staging_storage_key,blob_storage_key,s3_upload_id,mime_type,size_bytes,
       part_size_bytes,part_count,state,source_url,asset_created_at,client_updated_at,
       last_modified_by_replica_id,last_operation_id,expires_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
     )`,
    [
      payload.sessionId,
      payload.workspaceId,
      payload.mediaAssetId,
      payload.sha256,
      payload.stagingStorageKey,
      payload.blobStorageKey,
      payload.s3UploadId,
      payload.mimeType,
      payload.sizeBytes,
      payload.partSizeBytes,
      payload.partCount,
      state,
      payload.sourceUrl,
      payload.assetCreatedAt,
      payload.clientUpdatedAt,
      payload.replicaId,
      payload.lastOperationId,
      payload.sessionExpiresAt,
    ],
  );
}

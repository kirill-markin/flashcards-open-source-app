import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { transactionWithWorkspaceScope } from "../../database";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import { resolveDirectMediaBlobWriterAfterAccessRevocation, reserveDirectMediaBlobWriterWithOwner,
  reserveMediaBlobWriterInExecutor,
  type DirectMediaBlobWriterReservationInput,
  type DirectMediaBlobWriterResolutionInput,
  type MediaBlobWriterReservationInput } from "../blobLifecycle";
import { buildMediaBlobStorageKey } from "../storageKeys";
import { closeMediaAssetUploadSessionBlobWriter,
  reserveMediaAssetUploadSessionBlobWriterWithOwner,
  type MediaAssetUploadSessionWriterClosureInput } from "../uploadSessions";
import { passthroughMediaBlobNormalizationVersion } from "../types";
const migrationSql = readFileSync(resolve(__dirname, "../../../../../db/migrations/0094_direct_multipart_writer_abandonment.sql"), "utf8");
const signatures = {
  directReserve: "content.reserve_direct_media_blob_writer_with_owner(text,uuid,uuid,text,uuid,text,text,text,bigint,text)",
  multipartReserve: "content.reserve_media_upload_session_blob_writer_with_owner(text,uuid,uuid,text)",
  directClose: "content.resolve_direct_media_blob_writer_after_access_revocation(text,uuid,uuid,text,uuid,text,text,text,bigint,integer)",
  multipartClose: "content.close_media_upload_session_blob_writer(text,uuid,uuid,uuid,uuid,text,text,text,text,bigint,timestamp with time zone,integer)",
  internal: "content.reserve_owned_media_blob_writer_internal(text,uuid,text,text,text,bigint,text,text,uuid,uuid,text,text,timestamp with time zone,text,timestamp with time zone,timestamp with time zone)",
};
function digest(): string { return createHash("sha256").update(randomUUID()).digest("hex"); }
function writer(fixture: PostgresIntegrationFixture, kind: "direct_ingestion" | "multipart_completion",
  mediaAssetId: string, operationId: string): MediaBlobWriterReservationInput {
  const sha256 = digest();
  return { writerKind: kind, workspaceId: fixture.workspaceId, mediaAssetId, operationId,
    sha256, storageKey: buildMediaBlobStorageKey(sha256), mimeType: "application/octet-stream",
    sizeBytes: 42, normalizationVersion: passthroughMediaBlobNormalizationVersion };
}
function directOwned(fixture: PostgresIntegrationFixture, input: MediaBlobWriterReservationInput):
DirectMediaBlobWriterReservationInput {
  return { userId: fixture.userId, workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId, operationId: input.operationId,
    lastModifiedByReplicaId: fixture.replicaId, sha256: input.sha256,
    storageKey: input.storageKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
    normalizationVersion: input.normalizationVersion };
}
function directClose(input: DirectMediaBlobWriterReservationInput): DirectMediaBlobWriterResolutionInput {
  const { normalizationVersion: _normalizationVersion, ...resolution } = input;
  return resolution;
}
function sessionInput(fixture: PostgresIntegrationFixture, input: MediaBlobWriterReservationInput,
  sessionId: string, expiresAt: string): MediaAssetUploadSessionWriterClosureInput {
  return { userId: fixture.userId, workspaceId: fixture.workspaceId, sessionId,
    mediaAssetId: input.mediaAssetId, lastModifiedByReplicaId: fixture.replicaId,
    lastOperationId: input.operationId, sha256: input.sha256, storageKey: input.storageKey,
    mimeType: input.mimeType, sizeBytes: input.sizeBytes, expiresAt };
}
async function insertSession(fixture: PostgresIntegrationFixture, input: MediaAssetUploadSessionWriterClosureInput): Promise<void> {
  await fixture.ownerPool.query(
    `INSERT INTO content.media_upload_sessions
       (media_upload_session_id,workspace_id,media_asset_id,media_blob_sha256,
        staging_storage_key,blob_storage_key,s3_upload_id,mime_type,size_bytes,part_size_bytes,
        part_count,state,asset_created_at,client_updated_at,last_modified_by_replica_id,
        last_operation_id,expires_at)
     VALUES ($1,$2,$3,$4,'media/uploads/workspaces/'||lower($2::uuid::text)||
       '/assets/'||lower($3::uuid::text)||'/sessions/'||lower($1::uuid::text),
       $5,'upload-id',$6,$7,42,1,'completing',$8,$8,$9,$10,$11)`,
    [input.sessionId, input.workspaceId, input.mediaAssetId, input.sha256,
      input.storageKey, input.mimeType, input.sizeBytes, fixture.createdAt,
      input.lastModifiedByReplicaId, input.lastOperationId, input.expiresAt],
  );
}
async function legacyReserve(fixture: PostgresIntegrationFixture, input: MediaBlobWriterReservationInput): Promise<void> {
  await transactionWithWorkspaceScope({ userId: fixture.userId, workspaceId: fixture.workspaceId },
    (executor) => reserveMediaBlobWriterInExecutor(executor, input));
}
async function insertReference(fixture: PostgresIntegrationFixture, input: MediaBlobWriterReservationInput,
  replicaId: string, lastOperationId: string): Promise<string> {
  const blobId = randomUUID();
  await fixture.ownerPool.query(
    `INSERT INTO content.media_blobs (media_blob_id,sha256,mime_type,size_bytes,
       storage_key,normalization_version) VALUES ($1,$2,$3,$4,$5,$6)`,
    [blobId, input.sha256, input.mimeType, input.sizeBytes, input.storageKey,
      input.normalizationVersion],
  );
  await fixture.ownerPool.query(
    `INSERT INTO content.media_assets (media_asset_id,workspace_id,media_blob_id,
       source_url,created_at,client_updated_at,last_modified_by_replica_id,last_operation_id)
     VALUES ($1,$2,$3,NULL,$4,$4,$5,$6)`,
    [input.mediaAssetId, fixture.workspaceId, blobId, fixture.createdAt,
      replicaId, lastOperationId],
  );
  return blobId;
}
async function assertUpgradeAndAcl(fixture: PostgresIntegrationFixture): Promise<void> {
  const client = await fixture.ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      DROP TRIGGER media_blob_writers_before_workspace_delete ON org.workspaces;
      DROP FUNCTION ${signatures.directClose}; DROP FUNCTION ${signatures.multipartClose};
      DROP FUNCTION ${signatures.directReserve}; DROP FUNCTION ${signatures.multipartReserve};
      DROP FUNCTION ${signatures.internal};
      DROP FUNCTION content.terminalize_media_blob_writers_before_workspace_delete();
      DROP TABLE content.media_blob_writer_owner_snapshots;
      ALTER TABLE content.media_blob_writer_reservations
        DROP CONSTRAINT media_blob_writer_reservations_owner_reference_unique`);
    await client.query(migrationSql);
    const acl = (await client.query(
      `SELECT has_function_privilege('backend_app',$1,'EXECUTE') AS direct_reserve,
        has_function_privilege('backend_app',$2,'EXECUTE') AS multipart_reserve,
        has_function_privilege('backend_app',$3,'EXECUTE') AS direct_close,
        has_function_privilege('backend_app',$4,'EXECUTE') AS multipart_close,
        has_function_privilege('backend_app',$5,'EXECUTE') AS internal_access,
        has_function_privilege('auth_app',$1,'EXECUTE') AS auth_access,
        has_function_privilege('reporting_readonly',$4,'EXECUTE') AS reporting_access,
        has_table_privilege('backend_app','content.media_blob_writer_owner_snapshots','SELECT') AS owner_table,
        has_table_privilege('backend_app','content.media_blob_writer_reservations','SELECT') AS reservation_table`,
      [signatures.directReserve, signatures.multipartReserve, signatures.directClose,
        signatures.multipartClose, signatures.internal],
    )).rows[0];
    assert.deepEqual(acl, { direct_reserve: true, multipart_reserve: true,
      direct_close: true, multipart_close: true, internal_access: false,
      auth_access: false, reporting_access: false, owner_table: false,
      reservation_table: false });
    await client.query("ROLLBACK");
  } catch (error) { await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
}
async function waitForAdvisoryLock(fixture: PostgresIntegrationFixture, backendPid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const wait = await fixture.ownerPool.query(
      "SELECT wait_event FROM pg_stat_activity WHERE pid = $1", [backendPid]);
    if (wait.rows[0]?.wait_event === "advisory") return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Multipart closure did not wait for the access lock. backendPid=${backendPid}`);
}
test("owned writer abandonment binds history and closes writers during workspace deletion", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    await assertUpgradeAndAcl(fixture);
    const otherUserId = `writer-owner-${randomUUID()}`;
    const otherReplicaId = randomUUID();
    await fixture.ownerPool.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [otherUserId]);
    await fixture.ownerPool.query(
      "INSERT INTO org.workspace_memberships (workspace_id,user_id,role) VALUES ($1,$2,'member')",
      [fixture.workspaceId, otherUserId]);
    await fixture.ownerPool.query(
      `INSERT INTO sync.workspace_replicas (replica_id,workspace_id,user_id,
         actor_kind,actor_key,platform)
       VALUES ($1,$2,$3,'agent_connection',$4,'system')`,
      [otherReplicaId, fixture.workspaceId, otherUserId, `writer-owner-${otherReplicaId}`]);
    const ownedDirect = writer(fixture, "direct_ingestion", randomUUID(), randomUUID());
    const ownedDirectInput = directOwned(fixture, ownedDirect);
    const firstDirect = await reserveDirectMediaBlobWriterWithOwner(ownedDirectInput);
    assert.equal((await reserveDirectMediaBlobWriterWithOwner(ownedDirectInput)).reservationToken,
      firstDirect.reservationToken);
    await assert.rejects(reserveDirectMediaBlobWriterWithOwner({
      ...ownedDirectInput, lastModifiedByReplicaId: otherReplicaId }));
    await assert.rejects(reserveDirectMediaBlobWriterWithOwner({
      ...ownedDirectInput, userId: otherUserId, lastModifiedByReplicaId: otherReplicaId,
    }));
    assert.equal(await resolveDirectMediaBlobWriterAfterAccessRevocation(
      directClose(ownedDirectInput)), "access_active");
    const referencedDirect = writer(fixture, "direct_ingestion", randomUUID(), randomUUID());
    const referencedDirectInput = directOwned(fixture, referencedDirect);
    await reserveDirectMediaBlobWriterWithOwner(referencedDirectInput);
    const referencedDirectBlobId = await insertReference(fixture, referencedDirect, fixture.replicaId, referencedDirect.operationId);
    const legacyDirect = writer(fixture, "direct_ingestion", randomUUID(), randomUUID());
    await legacyReserve(fixture, legacyDirect);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const expired = new Date(Date.now() - 3_600_000).toISOString();
    const ownedMultipartWriter = writer(fixture, "multipart_completion", randomUUID(), randomUUID());
    const ownedSession = sessionInput(fixture, ownedMultipartWriter, randomUUID(), expired);
    await insertSession(fixture, ownedSession);
    await fixture.ownerPool.query("UPDATE sync.workspace_replicas SET user_id=$1 WHERE replica_id=$2",
      [otherUserId, fixture.replicaId]);
    await assert.rejects(reserveMediaAssetUploadSessionBlobWriterWithOwner(
      fixture.userId, fixture.workspaceId, ownedSession.sessionId));
    await fixture.ownerPool.query("UPDATE sync.workspace_replicas SET user_id=$1 WHERE replica_id=$2",
      [fixture.userId, fixture.replicaId]);
    await reserveMediaAssetUploadSessionBlobWriterWithOwner(fixture.userId,
      fixture.workspaceId, ownedSession.sessionId);
    const referencedMultipart = writer(fixture, "multipart_completion", randomUUID(), randomUUID());
    const referencedSession = sessionInput(fixture, referencedMultipart, randomUUID(), future);
    await insertSession(fixture, referencedSession);
    await reserveMediaAssetUploadSessionBlobWriterWithOwner(fixture.userId,
      fixture.workspaceId, referencedSession.sessionId);
    assert.equal(await closeMediaAssetUploadSessionBlobWriter(referencedSession), "access_active");
    const referencedMultipartBlobId = await insertReference(fixture, referencedMultipart, fixture.replicaId, referencedSession.lastOperationId);
    const legacyMultipartWriter = writer(fixture, "multipart_completion", randomUUID(), randomUUID());
    const legacySession = sessionInput(fixture, legacyMultipartWriter, randomUUID(), future);
    await insertSession(fixture, legacySession);
    await legacyReserve(fixture, { ...legacyMultipartWriter, operationId: legacySession.sessionId });
    const abortWriter = writer(fixture, "multipart_completion", randomUUID(), randomUUID());
    const abortSession = sessionInput(fixture, abortWriter, randomUUID(), future);
    await insertSession(fixture, abortSession);
    await reserveMediaAssetUploadSessionBlobWriterWithOwner(fixture.userId, fixture.workspaceId, abortSession.sessionId);
    await fixture.ownerPool.query("UPDATE content.media_upload_sessions SET state='aborting' WHERE media_upload_session_id=$1", [abortSession.sessionId]);
    assert.equal(await closeMediaAssetUploadSessionBlobWriter(abortSession), "unreferenced");
    assert.equal(await closeMediaAssetUploadSessionBlobWriter(abortSession), "already_closed");
    await fixture.ownerPool.query(
      "DELETE FROM org.workspace_memberships WHERE workspace_id=$1 AND user_id=$2",
      [fixture.workspaceId, fixture.userId]);
    await fixture.ownerPool.query("UPDATE sync.workspace_replicas SET user_id=$1 WHERE replica_id=$2",
      [otherUserId, fixture.replicaId]);
    assert.equal(await resolveDirectMediaBlobWriterAfterAccessRevocation({ ...directClose(ownedDirectInput),
      userId: otherUserId, lastModifiedByReplicaId: otherReplicaId }), "stale");
    assert.equal(await resolveDirectMediaBlobWriterAfterAccessRevocation(
      directClose(ownedDirectInput)), "unreferenced");
    assert.equal(await resolveDirectMediaBlobWriterAfterAccessRevocation(
      directClose(referencedDirectInput)), "referenced");
    assert.equal(await resolveDirectMediaBlobWriterAfterAccessRevocation(directClose(
      directOwned(fixture, legacyDirect))), "stale");
    assert.equal(await closeMediaAssetUploadSessionBlobWriter({ ...ownedSession,
      userId: otherUserId }), "stale");
    assert.equal(await closeMediaAssetUploadSessionBlobWriter({
      ...ownedSession, sizeBytes: ownedSession.sizeBytes + 1 }), "stale");
    assert.equal(await closeMediaAssetUploadSessionBlobWriter(ownedSession), "unreferenced");
    assert.equal(await closeMediaAssetUploadSessionBlobWriter(referencedSession), "referenced");
    assert.equal(await closeMediaAssetUploadSessionBlobWriter(legacySession), "stale");
    const absentWriter = writer(fixture, "direct_ingestion", randomUUID(), randomUUID());
    assert.equal(await resolveDirectMediaBlobWriterAfterAccessRevocation(directClose(
      directOwned(fixture, absentWriter))), "absent");
    assert.equal(await closeMediaAssetUploadSessionBlobWriter(sessionInput(
      fixture, absentWriter, randomUUID(), expired)), "absent");
    const deleteDirect = writer(fixture, "direct_ingestion", randomUUID(), randomUUID());
    const deleteDirectReservation = await reserveDirectMediaBlobWriterWithOwner({
      ...directOwned(fixture, deleteDirect), userId: otherUserId,
      lastModifiedByReplicaId: otherReplicaId });
    const deleteDirectBlobId = await insertReference(fixture, deleteDirect, otherReplicaId, deleteDirect.operationId);
    await fixture.ownerPool.query(
      "UPDATE content.media_blob_writer_reservations SET state='finalized' WHERE reservation_token=$1",
      [deleteDirectReservation.reservationToken]);
    const deleteMultipartWriter = writer(fixture, "multipart_completion", randomUUID(), randomUUID());
    const deleteSession = { ...sessionInput(fixture, deleteMultipartWriter, randomUUID(), future),
      userId: otherUserId, lastModifiedByReplicaId: otherReplicaId };
    await insertSession(fixture, deleteSession);
    await transactionWithWorkspaceScope({ userId: otherUserId, workspaceId: fixture.workspaceId },
      async (executor) => executor.query(
        "SELECT * FROM content.reserve_media_upload_session_blob_writer_with_owner($1,$2,$3,$4)",
        [otherUserId, fixture.workspaceId, deleteSession.sessionId,
          passthroughMediaBlobNormalizationVersion]));
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_reservations SET state='ambiguous', ambiguous_at=now()
       WHERE writer_kind='multipart_completion' AND operation_id=$1`,
      [deleteSession.sessionId]);
    const deletionClient = await fixture.ownerPool.connect();
    const closureClient = await fixture.runtimePool.connect();
    try {
      await deletionClient.query("BEGIN");
      await deletionClient.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0::bigint))",
        [otherUserId, fixture.workspaceId]);
      await closureClient.query("BEGIN");
      const backendPid = Number((await closureClient.query("SELECT pg_backend_pid() AS pid"))
        .rows[0]?.pid);
      const closurePromise = closureClient.query<{ status: string }>(
        `SELECT content.close_media_upload_session_blob_writer(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,3600000) AS status`,
        [otherUserId, fixture.workspaceId, deleteSession.sessionId,
          deleteSession.mediaAssetId, otherReplicaId, deleteSession.lastOperationId,
          deleteSession.sha256, deleteSession.storageKey, deleteSession.mimeType,
          deleteSession.sizeBytes, deleteSession.expiresAt]);
      await waitForAdvisoryLock(fixture, backendPid);
      await deletionClient.query("DELETE FROM org.workspaces WHERE workspace_id=$1", [fixture.workspaceId]);
      await deletionClient.query("COMMIT");
      assert.equal((await closurePromise).rows[0]?.status, "already_closed");
      await closureClient.query("COMMIT");
    } catch (error) {
      await Promise.allSettled([deletionClient.query("ROLLBACK"), closureClient.query("ROLLBACK")]);
      throw error;
    } finally {
      deletionClient.release();
      closureClient.release();
      await fixture.ownerPool.query(
        `DELETE FROM content.media_blobs AS blobs WHERE blobs.media_blob_id=ANY($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM content.media_assets AS assets WHERE assets.media_blob_id=blobs.media_blob_id)
         AND NOT EXISTS (SELECT 1 FROM catalog.package_media_assets AS assets WHERE assets.media_blob_id=blobs.media_blob_id)`,
        [[referencedDirectBlobId, referencedMultipartBlobId, deleteDirectBlobId]],
      );
    }
    const closed = await fixture.ownerPool.query(
      `SELECT reservations.state, lifecycles.cleanup_eligible_at IS NOT NULL AS cleanup
       FROM content.media_blob_writer_reservations AS reservations
       INNER JOIN content.media_blob_lifecycles AS lifecycles ON lifecycles.sha256=reservations.sha256
       WHERE reservations.sha256=ANY($1::text[]) ORDER BY reservations.sha256`,
      [[deleteDirect.sha256, deleteMultipartWriter.sha256]]);
    assert.deepEqual(closed.rows, [{ state: "unreferenced", cleanup: true },
      { state: "unreferenced", cleanup: true }]);
    assert.equal((await fixture.ownerPool.query(
      "SELECT count(*)::int AS count FROM content.media_blob_writer_owner_snapshots WHERE workspace_id=$1",
      [fixture.workspaceId])).rows[0]?.count >= 2, true);
    await fixture.ownerPool.query("DELETE FROM org.user_settings WHERE user_id=$1", [otherUserId]);
  });
});

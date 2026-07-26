import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../testSupport/postgresIntegration";
import { buildMediaBlobStorageKey } from "./storageKeys";
import { beginMediaAssetUploadSessionCompletionWithOwner, fenceMediaAssetUploadSessionCompletionApplyWithOwner,
  fenceMediaAssetUploadSessionCompletionApplyWithOwnerInExecutor, resolveMediaAssetUploadSessionCompletionAfterAccessRevocation,
  resolveMediaAssetUploadSessionCompletionAfterAccessRevocationInExecutor, resolveMediaAssetUploadSessionCompletionFailureWithOwner,
  type MediaAssetUploadSessionCompletionResolutionInput, type MediaAssetUploadSessionCompletionRevocationInput, type MediaAssetUploadSessionCompletionWithOwnerInput } from "./uploadSessions";
import { compareLwwMetadata } from "../sync/conflicts/lww";
import { imageJpegCardMediaBlobNormalizationVersion, passthroughMediaBlobNormalizationVersion } from "./types";
const migration0096 = readFileSync(resolve(__dirname, "../../../../db/migrations/0096_atomic_multipart_completion_resolution.sql"), "utf8");
const signatures = {
  apply: "content.fence_media_upload_session_completion_apply_with_owner(text,uuid,uuid,uuid,uuid,text,text,text,text,text,text,bigint,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,text,integer)",
  failure: "content.resolve_media_upload_session_completion_failure_with_owner(text,uuid,uuid,uuid,uuid,text,text,text,text,text,text,bigint,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,text,integer)",
  revocation: "content.resolve_media_upload_session_completion_after_access_revocation(text,uuid,uuid,uuid,uuid,text,text,text,text,text,text,bigint,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer)",
  helper: "content.classify_media_upload_session_completion_asset_internal(uuid,uuid,text,text,text,bigint,text,text,timestamp with time zone,timestamp with time zone,uuid,text)",
  begin: "content.begin_media_upload_session_completion_with_owner(text,uuid,uuid,uuid,uuid,text,text,text,text,text,text,bigint,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text)",
  close: "content.close_media_upload_session_blob_writer(text,uuid,uuid,uuid,uuid,text,text,text,text,bigint,timestamp with time zone,integer)",
  reference: "content.fence_media_blob_reference(uuid)",
  workspaceDelete: "content.terminalize_media_blob_writers_before_workspace_delete()",
} as const;
function digest(): string { return createHash("sha256").update(randomUUID()).digest("hex"); }
function session(fixture: PostgresIntegrationFixture): MediaAssetUploadSessionCompletionWithOwnerInput {
  const sessionId = randomUUID(), mediaAssetId = randomUUID(), sha256 = digest();
  return {
    userId: fixture.userId, workspaceId: fixture.workspaceId, sessionId, mediaAssetId,
    lastModifiedByReplicaId: fixture.replicaId, lastOperationId: randomUUID(), sha256,
    stagingStorageKey: `media/uploads/workspaces/${fixture.workspaceId}/assets/${mediaAssetId}/sessions/${sessionId}`,
    blobStorageKey: buildMediaBlobStorageKey(sha256), s3UploadId: `upload-${randomUUID()}`,
    mimeType: "application/octet-stream", sizeBytes: 42, partSizeBytes: 42, partCount: 1,
    sourceUrl: null, assetCreatedAt: fixture.createdAt, clientUpdatedAt: fixture.createdAt,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    normalizationVersion: passthroughMediaBlobNormalizationVersion,
  };
}
async function insertSession(
  fixture: PostgresIntegrationFixture, input: MediaAssetUploadSessionCompletionWithOwnerInput,
  state: "active" | "completing",
): Promise<void> {
  await fixture.ownerPool.query(
    `INSERT INTO content.media_upload_sessions (media_upload_session_id,workspace_id,media_asset_id,
       media_blob_sha256,staging_storage_key,blob_storage_key,s3_upload_id,mime_type,size_bytes,
       part_size_bytes,part_count,state,source_url,asset_created_at,client_updated_at,last_modified_by_replica_id,last_operation_id,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [input.sessionId, input.workspaceId, input.mediaAssetId, input.sha256,
      input.stagingStorageKey, input.blobStorageKey, input.s3UploadId, input.mimeType,
      input.sizeBytes, input.partSizeBytes, input.partCount, state, input.sourceUrl,
      input.assetCreatedAt, input.clientUpdatedAt, input.lastModifiedByReplicaId,
      input.lastOperationId, input.expiresAt]);
}
async function start(fixture: PostgresIntegrationFixture, input: MediaAssetUploadSessionCompletionWithOwnerInput,
): Promise<MediaAssetUploadSessionCompletionResolutionInput> {
  await insertSession(fixture, input, "active");
  const result = await beginMediaAssetUploadSessionCompletionWithOwner(input);
  assert.equal(result.status, "started");
  assert.ok("reservation" in result);
  return { ...input, reservationToken: result.reservation.reservationToken,
    normalizationVersion: result.reservation.normalizationVersion };
}
function toRevocationInput(input: MediaAssetUploadSessionCompletionRevocationInput & Readonly<{
  normalizationVersion: MediaAssetUploadSessionCompletionResolutionInput["normalizationVersion"];
  reservationToken?: string;
}>): MediaAssetUploadSessionCompletionRevocationInput {
  const { normalizationVersion: _normalizationVersion,
    reservationToken: _reservationToken, ...revocationInput } = input;
  return revocationInput;
}
async function insertAsset(fixture: PostgresIntegrationFixture,
  input: MediaAssetUploadSessionCompletionResolutionInput, exact: boolean,
): Promise<void> {
  const clientUpdatedAt = exact ? input.clientUpdatedAt
    : new Date(new Date(input.clientUpdatedAt).getTime() + 60_000).toISOString();
  await fixture.ownerPool.query(
    `WITH blob AS (INSERT INTO content.media_blobs
         (media_blob_id,sha256,mime_type,size_bytes,storage_key,normalization_version)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING media_blob_id
     ) INSERT INTO content.media_assets (media_asset_id,workspace_id,media_blob_id,source_url,
       created_at,client_updated_at,last_modified_by_replica_id,last_operation_id)
     SELECT $7,$8,media_blob_id,$9,$10,$11,$12,$13 FROM blob`,
    [randomUUID(), input.sha256, input.mimeType, input.sizeBytes, input.blobStorageKey,
      input.normalizationVersion, input.mediaAssetId, input.workspaceId, input.sourceUrl,
      input.assetCreatedAt, clientUpdatedAt, input.lastModifiedByReplicaId,
      exact ? input.lastOperationId : randomUUID()]);
}
async function setMembership(fixture: PostgresIntegrationFixture, present: boolean): Promise<void> {
  const client = await fixture.ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0::bigint))",
      [fixture.userId, fixture.workspaceId]);
    if (present) {
      await client.query(`INSERT INTO org.workspace_memberships(workspace_id,user_id,role)
        VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [fixture.workspaceId, fixture.userId]);
    } else {
      await client.query("DELETE FROM org.workspace_memberships WHERE workspace_id=$1 AND user_id=$2",
        [fixture.workspaceId, fixture.userId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
async function state(
  fixture: PostgresIntegrationFixture, sessionId: string,
): Promise<Readonly<{ session_state: string; writer_state: string | null }>> {
  return (await fixture.ownerPool.query(
    `SELECT sessions.state AS session_state, reservations.state AS writer_state
     FROM content.media_upload_sessions AS sessions LEFT JOIN content.media_blob_writer_reservations AS reservations
       ON reservations.operation_id=sessions.media_upload_session_id::text WHERE sessions.media_upload_session_id=$1`,
    [sessionId])).rows[0];
}
async function absentState(fixture: PostgresIntegrationFixture, input: MediaAssetUploadSessionCompletionWithOwnerInput
): Promise<Readonly<{ state: string; lifecycle: boolean; asset: boolean }>> {
  return (await fixture.ownerPool.query(
    `SELECT sessions.state, EXISTS(SELECT 1 FROM content.media_blob_lifecycles WHERE sha256=$2) AS lifecycle,
       EXISTS(SELECT 1 FROM content.media_assets WHERE media_asset_id=$3) AS asset FROM content.media_upload_sessions AS sessions
     WHERE media_upload_session_id=$1`,
    [input.sessionId, input.sha256, input.mediaAssetId])).rows[0];
}
type SqlExecutor = Readonly<{ query: PostgresIntegrationFixture["ownerPool"]["query"] }>;
async function waitForLock(observer: SqlExecutor, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = (await observer.query<{ waiting: boolean }>("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.waiting;
    if (waiting === true) return;
    await observer.query("SELECT pg_sleep(0.01)");
  }
  assert.fail(`backend ${pid} did not enter a lock wait`);
}
async function assertLifecycleRace(
  fixture: PostgresIntegrationFixture, input: MediaAssetUploadSessionCompletionResolutionInput,
  expected: "already_applied" | "peer_conflict",
  startConcurrent: (worker: SqlExecutor) => Promise<unknown>,
): Promise<void> {
  const holder = await fixture.ownerPool.connect(), worker = await fixture.ownerPool.connect();
  const workerPid = (await worker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  let work: Promise<unknown> | undefined;
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, fixture.workspaceId]);
    await holder.query("SELECT 1 FROM content.media_blob_lifecycles WHERE sha256=$1 FOR UPDATE", [input.sha256]);
    work = startConcurrent(worker);
    await waitForLock(holder, workerPid);
    assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwnerInExecutor(holder, input), expected);
    await holder.query("COMMIT");
    await work;
  } catch (error) { await holder.query("ROLLBACK");
    if (work !== undefined) await Promise.allSettled([work]);
    throw error; } finally { worker.release(); holder.release(); }
}
async function assertUpgradeSecurity(fixture: PostgresIntegrationFixture): Promise<void> {
  const client = await fixture.ownerPool.connect();
  try {
    const before = (await client.query(
      `SELECT to_regprocedure($1) IS NULL AS no_apply, to_regprocedure($2) IS NULL AS no_failure,
        to_regprocedure($3) IS NULL AS no_revocation, to_regprocedure($4) IS NULL AS no_helper,
        to_regprocedure($5) IS NOT NULL AS old_begin, to_regprocedure($6) IS NOT NULL AS old_close,
        to_regprocedure($7) IS NOT NULL AS old_reference, to_regprocedure($8) IS NOT NULL AS old_workspace_delete`,
      [signatures.apply, signatures.failure, signatures.revocation, signatures.helper,
        signatures.begin, signatures.close, signatures.reference, signatures.workspaceDelete])).rows[0];
    assert.deepEqual(before, {
      no_apply: true, no_failure: true, no_revocation: true, no_helper: true, old_begin: true,
      old_close: true, old_reference: true, old_workspace_delete: true,
    });
    await client.query("BEGIN");
    await client.query(migration0096);
    await client.query("COMMIT");
    const row = (await client.query(
      `SELECT bool_and(prosecdef AND proconfig=ARRAY['search_path=pg_catalog']) AS hardened,
        bool_and(has_function_privilege('backend_app',oid,'EXECUTE')) FILTER
          (WHERE oid=ANY(ARRAY[$1::regprocedure,$2::regprocedure,$3::regprocedure])) AS backend_execute,
        bool_or(has_function_privilege('backend_app',oid,'EXECUTE')) FILTER
          (WHERE oid=ANY(ARRAY[$4::regprocedure,$5::regprocedure,$6::regprocedure])) AS internal_execute,
        bool_or(has_function_privilege('auth_app',oid,'EXECUTE')) AS auth_execute,
        bool_or(has_function_privilege('reporting_readonly',oid,'EXECUTE')) AS reporting_execute
       FROM pg_proc WHERE oid=ANY(ARRAY[$1::regprocedure,$2::regprocedure,
         $3::regprocedure,$4::regprocedure,$5::regprocedure,$6::regprocedure])`,
      [signatures.apply, signatures.failure, signatures.revocation, signatures.helper,
        signatures.reference, signatures.workspaceDelete])).rows[0];
    assert.deepEqual(row, { hardened: true, backend_execute: true, internal_execute: false,
      auth_execute: false, reporting_execute: false });
    const compatibility = (await client.query(
      `SELECT to_regprocedure($1) IS NOT NULL AS old_begin, to_regprocedure($2) IS NOT NULL AS old_close,
        to_regprocedure($3) IS NOT NULL AS old_reference, to_regprocedure($4) IS NOT NULL AS old_workspace_delete,
        has_table_privilege('backend_app','content.media_blob_writer_reservations','SELECT') AS writer_table,
        has_table_privilege('backend_app','content.media_blob_writer_owner_snapshots','SELECT') AS owner_table`,
      [signatures.begin, signatures.close, signatures.reference, signatures.workspaceDelete])).rows[0];
    assert.deepEqual(compatibility, {
      old_begin: true, old_close: true, old_reference: true, old_workspace_delete: true,
      writer_table: false, owner_table: false });
  } catch (error) { await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
}
test("multipart completion resolution is atomic, replayable, revocation-safe, and deadlock-free", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    await assertUpgradeSecurity(fixture);
    for (const [storedOperationId, incomingOperationId] of
      [["lww-tie-", "lww-tie_"], [`lww-tie-\uE000`, "lww-tie-😀"]]) {
      const lww = await start(fixture, { ...session(fixture), lastOperationId: incomingOperationId });
      const metadata = (lastOperationId: string) => ({
        clientUpdatedAt: lww.clientUpdatedAt, lastModifiedByReplicaId: lww.lastModifiedByReplicaId,
        lastOperationId });
      assert.ok(compareLwwMetadata(metadata(incomingOperationId), metadata(storedOperationId)) > 0);
      await insertAsset(fixture, { ...lww, lastOperationId: storedOperationId }, true);
      assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(lww), "ready");
    }
    const failure = await start(fixture, session(fixture));
    assert.equal(await resolveMediaAssetUploadSessionCompletionFailureWithOwner(failure), "unreferenced_restored");
    assert.equal(await resolveMediaAssetUploadSessionCompletionFailureWithOwner(failure), "unreferenced_restored");
    assert.deepEqual(await state(fixture, failure.sessionId), { session_state: "active", writer_state: "unreferenced" });
    const exact = await start(fixture, session(fixture));
    await insertAsset(fixture, exact, true);
    assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(exact), "already_applied");
    assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(exact), "already_applied");
    assert.deepEqual(await state(fixture, exact.sessionId), { session_state: "completed", writer_state: "finalized" });
    const peer = await start(fixture, session(fixture));
    await insertAsset(fixture, peer, false);
    assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(peer), "peer_conflict");
    assert.deepEqual(await state(fixture, peer.sessionId), { session_state: "aborted", writer_state: "finalized" });
    const fenced = await start(fixture, session(fixture));
    assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(
      { ...fenced, reservationToken: randomUUID() }), "stale");
    assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(
      { ...fenced, normalizationVersion: imageJpegCardMediaBlobNormalizationVersion }), "stale");
    await fixture.ownerPool.query(`UPDATE content.media_blob_writer_owner_snapshots SET session_source_url=$1
      WHERE reservation_token=$2`, ["owner-mismatch", fenced.reservationToken]);
    assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(fenced), "stale");
    await fixture.ownerPool.query(`UPDATE content.media_blob_writer_owner_snapshots SET session_source_url=$1
      WHERE reservation_token=$2`, [fenced.sourceUrl, fenced.reservationToken]);
    await fixture.ownerPool.query(`UPDATE content.media_blob_lifecycles SET cleanup_eligible_at=now(),
      cleanup_lease_token=$1,cleanup_lease_expires_at=now()+interval '1 hour' WHERE sha256=$2`,
    [randomUUID(), fenced.sha256]);
    assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(fenced), "stale");
    await fixture.ownerPool.query(`UPDATE content.media_blob_lifecycles SET cleanup_eligible_at=NULL,
      cleanup_lease_token=NULL,cleanup_lease_expires_at=NULL WHERE sha256=$1`, [fenced.sha256]);
    const restored = await start(fixture, session(fixture));
    await setMembership(fixture, false);
    const reassignedUserId = `multipart-resolution-${randomUUID()}`;
    await fixture.ownerPool.query(
      `WITH inserted AS (INSERT INTO org.user_settings(user_id) VALUES ($1) RETURNING 1)
       UPDATE sync.workspace_replicas SET user_id=$1 WHERE replica_id=$2`,
      [reassignedUserId, fixture.replicaId]);
    assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(restored), "access_denied");
    assert.equal(await resolveMediaAssetUploadSessionCompletionFailureWithOwner(restored), "access_denied");
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation({ ...toRevocationInput(restored), userId: `wrong-${randomUUID()}` }), "stale");
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation({ ...toRevocationInput(restored), s3UploadId: `${restored.s3UploadId}-wrong` }), "stale");
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation({ ...toRevocationInput(restored), sessionId: randomUUID() }), "stale");
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation({ ...toRevocationInput(restored), lastModifiedByReplicaId: randomUUID() }), "stale");
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation({ ...toRevocationInput(restored), sizeBytes: restored.sizeBytes + 1 }), "stale");
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation(toRevocationInput(restored)),
      "unreferenced_closed");
    assert.deepEqual(await state(fixture, restored.sessionId), { session_state: "aborted", writer_state: "unreferenced" });
    const absent = session(fixture);
    await insertSession(fixture, absent, "completing");
    const absentBefore = await absentState(fixture, absent);
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation({ ...toRevocationInput(absent), userId: `wrong-${randomUUID()}` }), "stale");
    assert.deepEqual(await absentState(fixture, absent), absentBefore);
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation(toRevocationInput(absent)), "stale");
    assert.deepEqual(await absentState(fixture, absent), absentBefore);
    const holder = await fixture.ownerPool.connect(), worker = await fixture.ownerPool.connect();
    const workerPid = (await worker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    let recovery: Promise<string> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM sync.workspace_sync_metadata WHERE workspace_id=$1 FOR UPDATE", [fixture.workspaceId]);
      await holder.query(
        `WITH blob AS (INSERT INTO content.media_blobs (media_blob_id,sha256,mime_type,size_bytes,
           storage_key,normalization_version) VALUES ($1,$2,$3,$4,$5,$6) RETURNING media_blob_id)
         INSERT INTO content.media_assets (media_asset_id,workspace_id,media_blob_id,source_url,created_at,
           client_updated_at,last_modified_by_replica_id,last_operation_id)
         SELECT $7,$8,media_blob_id,NULL,$9,$9,$10,$11 FROM blob`,
        [randomUUID(), absent.sha256, absent.mimeType, absent.sizeBytes, absent.blobStorageKey,
          passthroughMediaBlobNormalizationVersion, randomUUID(), fixture.workspaceId,
          fixture.createdAt, fixture.replicaId, randomUUID()]);
      recovery = resolveMediaAssetUploadSessionCompletionAfterAccessRevocationInExecutor(worker, toRevocationInput(absent));
      await waitForLock(holder, workerPid);
      await holder.query("UPDATE sync.workspace_replicas SET user_id=$1 WHERE replica_id=$2", [fixture.userId, fixture.replicaId]);
      await holder.query("COMMIT");
      assert.equal(await recovery, "absent_closed");
      await fixture.ownerPool.query("DELETE FROM org.user_settings WHERE user_id=$1", [reassignedUserId]);
    } catch (error) { await holder.query("ROLLBACK");
      if (recovery !== undefined) await Promise.allSettled([recovery]);
      throw error; } finally { worker.release(); holder.release(); }
    await setMembership(fixture, true);
    const activeAgain = await start(fixture, session(fixture));
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation(toRevocationInput(activeAgain)),
      "access_active");
    assert.deepEqual(await state(fixture, activeAgain.sessionId), { session_state: "completing", writer_state: "active" });
    const referenced = await start(fixture, session(fixture));
    await insertAsset(fixture, referenced, true);
    await setMembership(fixture, false);
    assert.equal(await resolveMediaAssetUploadSessionCompletionAfterAccessRevocation(toRevocationInput(referenced)),
      "referenced");
    assert.deepEqual(await state(fixture, referenced.sessionId), { session_state: "completed", writer_state: "finalized" });
    await setMembership(fixture, true);
    const referenceRace = await start(fixture, session(fixture));
    await insertAsset(fixture, referenceRace, true);
    await assertLifecycleRace(fixture, referenceRace, "already_applied",
      (worker) => worker.query(
        `INSERT INTO content.media_assets (media_asset_id,workspace_id,media_blob_id,source_url,
           created_at,client_updated_at,last_modified_by_replica_id,last_operation_id)
         SELECT $2,$3,media_blob_id,NULL,$4,$4,$5,$6 FROM content.media_blobs WHERE sha256=$1`,
        [referenceRace.sha256, randomUUID(), fixture.workspaceId, fixture.createdAt,
          fixture.replicaId, randomUUID()]));
    const deleteRace = await start(fixture, session(fixture));
    const deletingReplicaId = randomUUID(), deletingOperationId = randomUUID(), deletingReservationToken = randomUUID();
    await fixture.ownerPool.query(
      `WITH workspace AS (
         INSERT INTO org.workspaces
           (workspace_id,name,fsrs_client_updated_at,fsrs_last_modified_by_replica_id,fsrs_last_operation_id)
         VALUES ($1,'Deletion race',$2,$3,$4) RETURNING workspace_id
       ), replica AS (
         INSERT INTO sync.workspace_replicas
           (replica_id,workspace_id,user_id,actor_kind,actor_key,platform,app_version)
         SELECT $3,workspace_id,$5,'ai_chat',$6,'system','postgres-integration'
         FROM workspace RETURNING workspace_id
       ) INSERT INTO org.workspace_memberships(workspace_id,user_id,role)
         SELECT workspace_id,$5,'owner' FROM replica`,
      [fixture.outOfScopeWorkspaceId, fixture.createdAt, deletingReplicaId,
        deletingOperationId, fixture.userId, `deletion-race-${deletingReplicaId}`],
    );
    await insertAsset(fixture, { ...deleteRace, workspaceId: fixture.outOfScopeWorkspaceId,
      lastModifiedByReplicaId: deletingReplicaId, lastOperationId: deletingOperationId }, true);
    await fixture.ownerPool.query(
      `WITH reservation AS (
         INSERT INTO content.media_blob_writer_reservations
           (reservation_token,sha256,writer_kind,workspace_id,media_asset_id,operation_id,state)
         VALUES ($1,$2,'direct_ingestion',$3,$4,$5,'finalized') RETURNING *
       ) INSERT INTO content.media_blob_writer_owner_snapshots
         (reservation_token,writer_kind,workspace_id,media_asset_id,operation_id,
          sha256,user_id,replica_id)
         SELECT reservation_token,writer_kind,workspace_id,media_asset_id,operation_id,
           sha256,$6,$7 FROM reservation`,
      [deletingReservationToken, deleteRace.sha256, fixture.outOfScopeWorkspaceId,
        deleteRace.mediaAssetId, deletingOperationId, fixture.userId, deletingReplicaId],
    );
    try {
      await assertLifecycleRace(fixture, deleteRace, "peer_conflict",
        (worker) => worker.query("DELETE FROM org.workspaces WHERE workspace_id=$1",
          [fixture.outOfScopeWorkspaceId]));
    } finally { await fixture.ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id=$1",
      [fixture.outOfScopeWorkspaceId]); }
    const concurrent = await start(fixture, session(fixture));
    assert.deepEqual((await Promise.all([fenceMediaAssetUploadSessionCompletionApplyWithOwner(concurrent),
      fenceMediaAssetUploadSessionCompletionApplyWithOwner(concurrent)])).sort(), ["ready", "ready"]);
    const blocker = await fixture.ownerPool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT 1 FROM content.media_upload_sessions WHERE media_upload_session_id=$1 FOR UPDATE",
        [concurrent.sessionId]);
      const completion = fenceMediaAssetUploadSessionCompletionApplyWithOwner(concurrent);
      await blocker.query("UPDATE content.media_upload_sessions SET state='aborting' WHERE media_upload_session_id=$1",
        [concurrent.sessionId]);
      await blocker.query("COMMIT");
      assert.equal(await completion, "aborting");
      assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(
        { ...concurrent, reservationToken: randomUUID() }), "stale");
      assert.equal(await fenceMediaAssetUploadSessionCompletionApplyWithOwner(concurrent), "aborting");
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });
});

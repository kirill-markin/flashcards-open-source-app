import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type pg from "pg";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../../../testSupport/postgresIntegration";
import { buildMediaBlobStorageKey } from "../../storageKeys";
type DirectPayload = Readonly<{
  userId: string; workspaceId: string; mediaAssetId: string; operationId: string;
  replicaId: string; sha256: string; storageKey: string; mimeType: string;
  sizeBytes: number; normalizationVersion: string; sourceUrl: string | null;
  assetCreatedAt: string; clientUpdatedAt: string;
}>;
type MultipartPayload = Readonly<{
  userId: string; workspaceId: string; sessionId: string; mediaAssetId: string;
  replicaId: string; lastOperationId: string; sha256: string;
  stagingStorageKey: string; blobStorageKey: string; s3UploadId: string;
  mimeType: string; sizeBytes: number; partSizeBytes: number; partCount: number;
  sourceUrl: string | null; assetCreatedAt: string; clientUpdatedAt: string;
  sessionExpiresAt: string; normalizationVersion: string; partsFingerprint: string;
}>;
type BeginRow = Readonly<{
  attempt_status: string; reservation_token: string | null;
  normalization_version: string | null; lease_expires_at: string | Date | null;
}>;
type StatusRow = Readonly<{ status: string }>;
type LegacyBeginRow = Readonly<{ completion_status: string; reservation_token: string; normalization_version: string }>;
type OwnedMedia = Readonly<{ blob_ids: ReadonlyArray<string>; sha256s: ReadonlyArray<string> }>;
type SqlValue = string | number | null;
type QueryExecutor = Pick<pg.PoolClient, "query">;
const cleanupDelayMs = 3_600_000;
const migration0097 = readFileSync(resolve(
  __dirname, "../../../../../../db/migrations/0097_direct_multipart_writer_attempt_fencing.sql",
), "utf8");
const directRow = `ROW($3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  ::content.direct_media_blob_writer_attempt_payload`;
const multipartRow = `ROW($3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
  ::content.multipart_media_blob_writer_attempt_payload`;
function digest(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}
function direct(fixture: PostgresIntegrationFixture, overrides: Partial<DirectPayload>): DirectPayload {
  const sha256 = overrides.sha256 ?? digest();
  return {
    userId: fixture.userId, workspaceId: fixture.workspaceId,
    mediaAssetId: randomUUID(), operationId: randomUUID(), replicaId: fixture.replicaId,
    sha256, storageKey: buildMediaBlobStorageKey(sha256), mimeType: "image/jpeg",
    sizeBytes: 42, normalizationVersion: "image-jpeg-card-v1", sourceUrl: null,
    assetCreatedAt: fixture.createdAt, clientUpdatedAt: fixture.createdAt, ...overrides,
  };
}
function multipart(
  fixture: PostgresIntegrationFixture,
  overrides: Partial<MultipartPayload>,
): MultipartPayload {
  const sessionId = overrides.sessionId ?? randomUUID();
  const mediaAssetId = overrides.mediaAssetId ?? randomUUID();
  const sha256 = overrides.sha256 ?? digest();
  return {
    userId: fixture.userId, workspaceId: fixture.workspaceId, sessionId, mediaAssetId,
    replicaId: fixture.replicaId, lastOperationId: randomUUID(), sha256,
    stagingStorageKey: `media/uploads/workspaces/${fixture.workspaceId}/assets/${mediaAssetId}/sessions/${sessionId}`,
    blobStorageKey: buildMediaBlobStorageKey(sha256), s3UploadId: `upload-${randomUUID()}`,
    mimeType: "application/octet-stream", sizeBytes: 42, partSizeBytes: 42,
    partCount: 1, sourceUrl: null, assetCreatedAt: fixture.createdAt,
    clientUpdatedAt: fixture.createdAt,
    sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    normalizationVersion: "passthrough-v1", partsFingerprint: digest(), ...overrides,
  };
}
function directValues(payload: DirectPayload): ReadonlyArray<SqlValue> {
  return [payload.userId, payload.workspaceId, payload.mediaAssetId, payload.operationId,
    payload.replicaId, payload.sha256, payload.storageKey, payload.mimeType,
    payload.sizeBytes, payload.normalizationVersion, payload.sourceUrl,
    payload.assetCreatedAt, payload.clientUpdatedAt];
}
function multipartValues(payload: MultipartPayload): ReadonlyArray<SqlValue> {
  return [payload.userId, payload.workspaceId, payload.sessionId, payload.mediaAssetId,
    payload.replicaId, payload.lastOperationId, payload.sha256,
    payload.stagingStorageKey, payload.blobStorageKey, payload.s3UploadId,
    payload.mimeType, payload.sizeBytes, payload.partSizeBytes, payload.partCount,
    payload.sourceUrl, payload.assetCreatedAt, payload.clientUpdatedAt,
    payload.sessionExpiresAt, payload.normalizationVersion, payload.partsFingerprint];
}
async function scoped<Result>(
  fixture: PostgresIntegrationFixture,
  callback: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await fixture.runtimePool.connect();
  try {
    await client.query("BEGIN");
    await client.query( "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, fixture.workspaceId],
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
async function beginDirect(
  fixture: PostgresIntegrationFixture, attemptToken: string,
  payload: DirectPayload, leaseMs: number,
): Promise<BeginRow> {
  return scoped(fixture, async (client) => (await client.query<BeginRow>(
    `SELECT * FROM content.begin_direct_media_blob_writer_attempt_with_owner($1,$2,${directRow})`,
    [attemptToken, leaseMs, ...directValues(payload)],
  )).rows[0]);
}
async function directStatus(
  fixture: PostgresIntegrationFixture, functionName: string, attemptToken: string,
  reservationToken: string, payload: DirectPayload,
): Promise<string> {
  return scoped(fixture, async (client) => (await client.query<StatusRow>(
    `SELECT content.${functionName}($1,$2,${directRow},$16) AS status`,
    [attemptToken, reservationToken, ...directValues(payload), cleanupDelayMs],
  )).rows[0].status);
}
async function insertSession(
  executor: QueryExecutor, payload: MultipartPayload, state: "active" | "completing",
): Promise<void> {
  await executor.query(
    `INSERT INTO content.media_upload_sessions (media_upload_session_id,workspace_id,media_asset_id,media_blob_sha256, staging_storage_key,blob_storage_key,s3_upload_id,mime_type,size_bytes, part_size_bytes,part_count,state,source_url,asset_created_at,client_updated_at, last_modified_by_replica_id,last_operation_id,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [payload.sessionId, payload.workspaceId, payload.mediaAssetId, payload.sha256, payload.stagingStorageKey, payload.blobStorageKey, payload.s3UploadId, payload.mimeType, payload.sizeBytes, payload.partSizeBytes, payload.partCount, state, payload.sourceUrl, payload.assetCreatedAt, payload.clientUpdatedAt, payload.replicaId, payload.lastOperationId, payload.sessionExpiresAt],
  );
}
async function beginMultipart(
  fixture: PostgresIntegrationFixture, attemptToken: string,
  payload: MultipartPayload, leaseMs: number,
): Promise<BeginRow> {
  return scoped(fixture, async (client) => (await client.query<BeginRow>(
    `SELECT * FROM content.begin_media_upload_session_completion_attempt_with_owner( $1,$2,${multipartRow})`,
    [attemptToken, leaseMs, ...multipartValues(payload)],
  )).rows[0]);
}
async function multipartStatus(
  fixture: PostgresIntegrationFixture, functionName: string, attemptToken: string,
  reservationToken: string, payload: MultipartPayload,
): Promise<string> {
  return scoped(fixture, async (client) => (await client.query<StatusRow>(
    `SELECT content.${functionName}($1,$2,${multipartRow},$23) AS status`,
    [attemptToken, reservationToken, ...multipartValues(payload), cleanupDelayMs],
  )).rows[0].status);
}
async function insertAsset(
  executor: QueryExecutor, payload: DirectPayload | MultipartPayload,
  operationId: string, clientUpdatedAt: string, deletedAt: string | null,
): Promise<string> {
  const storageKey = "storageKey" in payload ? payload.storageKey : payload.blobStorageKey;
  const normalizationVersion = payload.normalizationVersion;
  const mediaBlobId = randomUUID();
  await executor.query(
    `WITH blob AS ( INSERT INTO content.media_blobs (media_blob_id,sha256,mime_type,size_bytes,storage_key,normalization_version) VALUES ($1,$2,$3,$4,$5,$6) RETURNING media_blob_id
     )
     INSERT INTO content.media_assets (media_asset_id,workspace_id,media_blob_id,source_url,created_at, client_updated_at,last_modified_by_replica_id,last_operation_id,deleted_at)
     SELECT $7,$8,media_blob_id,$9,$10,$11,$12,$13,$14 FROM blob`,
    [mediaBlobId, payload.sha256, payload.mimeType, payload.sizeBytes, storageKey, normalizationVersion, payload.mediaAssetId, payload.workspaceId, payload.sourceUrl, payload.assetCreatedAt, clientUpdatedAt, payload.replicaId, operationId, deletedAt],
  );
  return mediaBlobId;
}
async function apply0097UpgradeAndAssertSecurity(fixture: PostgresIntegrationFixture): Promise<void> {
  const client = await fixture.ownerPool.connect();
  const legacyStates = ["active", "finalized", "unreferenced"] as const;
  const signatureSql = `SELECT array_agg(format('%I.%I(%s)',namespaces.nspname,functions.proname,pg_get_function_identity_arguments(functions.oid)) ORDER BY namespaces.nspname,functions.proname,pg_get_function_identity_arguments(functions.oid)) AS signatures FROM pg_proc AS functions INNER JOIN pg_namespace AS namespaces ON namespaces.oid=functions.pronamespace WHERE namespaces.nspname=ANY('{content,org,security,sync,catalog}'::text[])`;
  const legacyMultipart = multipart(fixture, {});
  try {
    const baseline = (await client.query(`SELECT current_setting('server_version_num')::int / 10000 AS major, count(*)::int AS migrations, max(filename) AS latest, to_regclass('content.media_blob_writer_attempts') IS NULL AS attempts_absent, to_regtype('content.direct_media_blob_writer_attempt_payload') IS NULL AS payload_absent, to_regprocedure('content.fence_media_upload_session_completion_apply_with_owner(text,uuid,uuid,uuid,uuid,text,text,text,text,text,text,bigint,bigint,integer,text,timestamptz,timestamptz,timestamptz,uuid,text,integer)') IS NOT NULL AS migration_0096_present FROM public.schema_migrations`)).rows[0];
    assert.deepEqual(baseline, { major: 18, migrations: 98, latest: "0096_atomic_multipart_completion_resolution.sql", attempts_absent: true, payload_absent: true, migration_0096_present: true });
    const signaturesBefore = (await client.query<{ signatures: string[] }>(signatureSql)).rows[0].signatures; assert.equal(signaturesBefore.length, 47);
    for (const state of legacyStates) { const sha256 = digest(); await client.query( `WITH lifecycle AS ( INSERT INTO content.media_blob_lifecycles (sha256,storage_key,mime_type,size_bytes,normalization_version) VALUES ($1,$2,'image/jpeg',42,'image-jpeg-card-v1') RETURNING sha256 ) INSERT INTO content.media_blob_writer_reservations (sha256,writer_kind,workspace_id,media_asset_id,operation_id,state) SELECT sha256,'direct_ingestion',$3,$4,$5,$6 FROM lifecycle`, [sha256, buildMediaBlobStorageKey(sha256), fixture.workspaceId, randomUUID(), randomUUID(), state], );
    }
    await insertSession(client, legacyMultipart, "active"); await client.query("BEGIN"); await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, fixture.workspaceId]); const legacyMultipartBegin = (await client.query<LegacyBeginRow>(`SELECT * FROM content.begin_media_upload_session_completion_with_owner(${Array.from({ length: 19 }, (_, index) => `$${index + 1}`).join(",")})`, multipartValues(legacyMultipart).slice(0, 19))).rows[0]; await client.query("COMMIT"); assert.equal(legacyMultipartBegin.completion_status, "started");
    await client.query("BEGIN"); await client.query(migration0097); await client.query("INSERT INTO public.schema_migrations(filename) VALUES ('0097_direct_multipart_writer_attempt_fencing.sql')"); await client.query("COMMIT");
    const signaturesAfter = (await client.query<{ signatures: string[] }>(signatureSql)).rows[0].signatures; assert.deepEqual(signaturesAfter.filter((signature) => signaturesBefore.includes(signature)), signaturesBefore);
    await client.query("BEGIN"); await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, fixture.workspaceId]); const releasedDirect = (await client.query<{ statuses: string[] }>(`SELECT array_agg(result.reservation_status ORDER BY reservations.state) AS statuses FROM content.media_blob_writer_reservations AS reservations INNER JOIN content.media_blob_lifecycles AS lifecycles USING (sha256) CROSS JOIN LATERAL content.reserve_direct_media_blob_writer_with_owner($1,reservations.workspace_id,reservations.media_asset_id,reservations.operation_id,$2,reservations.sha256,lifecycles.storage_key,lifecycles.mime_type,lifecycles.size_bytes,lifecycles.normalization_version) AS result WHERE reservations.workspace_id=$3 AND reservations.writer_kind='direct_ingestion'`, [fixture.userId, fixture.replicaId, fixture.workspaceId])).rows[0].statuses; const releasedMultipart = (await client.query<LegacyBeginRow>(`SELECT * FROM content.begin_media_upload_session_completion_with_owner(${Array.from({ length: 19 }, (_, index) => `$${index + 1}`).join(",")})`, multipartValues(legacyMultipart).slice(0, 19))).rows[0]; const releasedFence = (await client.query<StatusRow>(`SELECT content.fence_media_upload_session_completion_apply_with_owner(${Array.from({ length: 21 }, (_, index) => `$${index + 1}`).join(",")}) AS status`, [...multipartValues(legacyMultipart).slice(0, 18), legacyMultipartBegin.reservation_token, legacyMultipartBegin.normalization_version, cleanupDelayMs])).rows[0].status; await client.query("COMMIT"); assert.deepEqual(releasedDirect, ["ownership_unbound", "ownership_unbound", "ownership_unbound"]); assert.deepEqual([releasedMultipart.completion_status, releasedFence], ["replayed", "ready"]);
    const upgrade = (await client.query(
      `SELECT array_agg(state ORDER BY state) AS states,
        (SELECT count(*)::int FROM content.media_blob_writer_attempts) AS attempts,
        to_regprocedure('content.finalize_media_blob_writer(uuid,text,uuid,uuid)') IS NOT NULL AS old_signature,
        (SELECT count(*)::int FROM public.schema_migrations) AS migrations
       FROM content.media_blob_writer_reservations WHERE workspace_id=$1`,
      [fixture.workspaceId],
    )).rows[0];
    assert.deepEqual(upgrade, { states: ["active", "active", "finalized", "unreferenced"], attempts: 0, old_signature: true, migrations: 99,
    });
    const acl = (await client.query( `SELECT has_table_privilege('backend_app','content.media_blob_writer_attempts','SELECT') AS backend_table, has_table_privilege('auth_app','content.media_blob_writer_attempts','SELECT') AS auth_table, has_table_privilege('reporting_readonly','content.media_blob_writer_attempts','SELECT') AS reporting_table, has_function_privilege('backend_app', 'content.begin_direct_media_blob_writer_attempt_with_owner(uuid,integer,content.direct_media_blob_writer_attempt_payload)','EXECUTE') AS backend_begin, has_function_privilege('auth_app', 'content.begin_direct_media_blob_writer_attempt_with_owner(uuid,integer,content.direct_media_blob_writer_attempt_payload)','EXECUTE') AS auth_begin, has_function_privilege('reporting_readonly', 'content.begin_direct_media_blob_writer_attempt_with_owner(uuid,integer,content.direct_media_blob_writer_attempt_payload)','EXECUTE') AS reporting_begin, has_function_privilege('backend_app', 'content.terminalize_media_blob_writer_attempt_internal(uuid,uuid,integer)','EXECUTE') AS backend_internal, NOT EXISTS (SELECT 1 FROM pg_class AS classes CROSS JOIN LATERAL aclexplode(COALESCE(classes.relacl,acldefault('r',classes.relowner))) AS privileges WHERE classes.oid='content.media_blob_writer_attempts'::regclass AND privileges.grantee=0) AS no_public_table, NOT EXISTS (SELECT 1 FROM pg_proc AS functions CROSS JOIN LATERAL aclexplode(COALESCE(functions.proacl,acldefault('f',functions.proowner))) AS privileges WHERE functions.oid='content.begin_direct_media_blob_writer_attempt_with_owner(uuid,integer,content.direct_media_blob_writer_attempt_payload)'::regprocedure AND privileges.grantee=0) AS no_public_begin, bool_and(prosecdef AND proconfig=ARRAY['search_path=pg_catalog']) AS hardened FROM pg_proc WHERE pronamespace='content'::regnamespace AND proname LIKE '%attempt%'`,
    )).rows[0];
    assert.deepEqual(acl, { backend_table: false, auth_table: false, reporting_table: false, backend_begin: true, auth_begin: false, reporting_begin: false, backend_internal: false, no_public_table: true, no_public_begin: true, hardened: true,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function waitForLock(fixture: PostgresIntegrationFixture, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = (await fixture.ownerPool.query<{ waiting: boolean }>( "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [pid],
    )).rows[0]?.waiting;
    if (waiting === true) return;
    await fixture.ownerPool.query("SELECT pg_sleep(0.01)");
  }
  assert.fail(`PostgreSQL worker did not enter a bounded lock wait. pid=${pid}`);
}
async function raceBegins(
  fixture: PostgresIntegrationFixture, sql: string,
  firstValues: Array<SqlValue>, secondValues: Array<SqlValue>,
): Promise<ReadonlyArray<BeginRow>> {
  const holder = await fixture.ownerPool.connect();
  const workers = await Promise.all([fixture.runtimePool.connect(), fixture.runtimePool.connect()]);
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1||':'||$2::text,0))", [fixture.userId, fixture.workspaceId]);
    for (const worker of workers) { await worker.query("BEGIN"); await worker.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, fixture.workspaceId]); await worker.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='4s'"); }
    const pids = await Promise.all(workers.map(async (worker) => (await worker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid));
    const pending = workers.map((worker, index) => worker.query<BeginRow>(sql, index === 0 ? firstValues : secondValues).then(async (result) => { await worker.query("COMMIT"); return result.rows[0]; }));
    await Promise.all(pids.map(async (pid) => waitForLock(fixture, pid)));
    await holder.query("COMMIT");
    return await Promise.all(pending);
  } finally {
    await Promise.allSettled([holder.query("ROLLBACK"), ...workers.map((worker) => worker.query("ROLLBACK"))]);
    holder.release(); workers.forEach((worker) => worker.release());
  }
}
async function raceAfterAsset<Result extends pg.QueryResultRow>(
  fixture: PostgresIntegrationFixture, winnerPayload: MultipartPayload,
  deletedAt: string | null, sql: string, values: Array<SqlValue>,
): Promise<Result> {
  await fixture.ownerPool.query("INSERT INTO content.media_blob_lifecycles(sha256,storage_key,mime_type,size_bytes,normalization_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [winnerPayload.sha256, winnerPayload.blobStorageKey, winnerPayload.mimeType, winnerPayload.sizeBytes, winnerPayload.normalizationVersion]);
  const holder = await fixture.ownerPool.connect(); const winner = await fixture.ownerPool.connect(); const loser = await fixture.runtimePool.connect();
  try {
    await holder.query("BEGIN"); await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1||':'||$2::text,0))", [fixture.userId, fixture.workspaceId]); await holder.query("SELECT 1 FROM content.media_blob_lifecycles WHERE sha256=$1 FOR UPDATE", [winnerPayload.sha256]);
    await winner.query("BEGIN"); await winner.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='4s'"); const winnerPid = (await winner.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const pendingWinner = winner.query("SELECT pg_advisory_xact_lock(hashtextextended($1||':'||$2::text,0))", [fixture.userId, fixture.workspaceId]).then(async () => { await insertAsset(winner, winnerPayload, winnerPayload.lastOperationId, winnerPayload.clientUpdatedAt, deletedAt); await winner.query("COMMIT"); }); await waitForLock(fixture, winnerPid);
    await loser.query("BEGIN"); await loser.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, fixture.workspaceId]); await loser.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='4s'"); const loserPid = (await loser.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const pendingLoser = loser.query<Result>(sql, values); await waitForLock(fixture, loserPid); await holder.query("COMMIT"); await pendingWinner; const result = (await pendingLoser).rows[0]; await loser.query("COMMIT"); return result;
  } finally {
    await Promise.allSettled([holder.query("ROLLBACK"), winner.query("ROLLBACK"), loser.query("ROLLBACK")]); holder.release(); winner.release(); loser.release();
  }
}
async function takeoverAfterLockedExpiry(
  fixture: PostgresIntegrationFixture, expiredAttempt: string,
  sql: string, values: Array<SqlValue>, staleSql: readonly [string, string],
  staleValues: Array<SqlValue>,
): Promise<Readonly<{ takeover: BeginRow; stale: ReadonlyArray<string> }>> {
  const holder = await fixture.ownerPool.connect();
  const worker = await fixture.runtimePool.connect(); const stale = await fixture.runtimePool.connect();
  try {
    await holder.query("BEGIN"); await holder.query("SELECT 1 FROM content.media_blob_writer_attempts WHERE attempt_token=$1 FOR UPDATE", [expiredAttempt]);
    for (const client of [worker, stale]) { await client.query("BEGIN"); await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, fixture.workspaceId]); await client.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='4s'"); }
    const pid = (await worker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const pending = worker.query<BeginRow>(sql, values); await waitForLock(fixture, pid); const stalePid = (await stale.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const pendingStale = stale.query<StatusRow>(staleSql[0], staleValues); await waitForLock(fixture, stalePid);
    await holder.query("UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_token=$1", [expiredAttempt]); await holder.query("COMMIT");
    const takeover = (await pending).rows[0]; await worker.query("COMMIT"); const staleStatuses = [(await pendingStale).rows[0].status, (await stale.query<StatusRow>(staleSql[1], staleValues)).rows[0].status]; await stale.query("COMMIT"); return { takeover, stale: staleStatuses };
  } finally {
    await Promise.allSettled([holder.query("ROLLBACK"), worker.query("ROLLBACK"), stale.query("ROLLBACK")]);
    holder.release(); worker.release(); stale.release();
  }
}
async function writerState(fixture: PostgresIntegrationFixture, attemptToken: string, reservationToken: string, sha256: string): Promise<string> {
  return (await fixture.ownerPool.query<{ snapshot: string }>(`SELECT jsonb_build_object('attempt',(SELECT to_jsonb(attempts) FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token=$1),'reservation',(SELECT to_jsonb(reservations) FROM content.media_blob_writer_reservations AS reservations WHERE reservations.reservation_token=$2),'lifecycle',(SELECT to_jsonb(lifecycles) FROM content.media_blob_lifecycles AS lifecycles WHERE lifecycles.sha256=$3),'blobs',(SELECT COALESCE(jsonb_agg(to_jsonb(blobs) ORDER BY blobs.media_blob_id),'[]'::jsonb) FROM content.media_blobs AS blobs WHERE blobs.sha256=$3))::text AS snapshot`, [attemptToken, reservationToken, sha256])).rows[0].snapshot;
}
async function captureOwnedMedia(fixture: PostgresIntegrationFixture): Promise<OwnedMedia> {
  return (await fixture.ownerPool.query<OwnedMedia>(`WITH owned AS MATERIALIZED (SELECT sha256 FROM content.media_blob_writer_attempts WHERE workspace_id=ANY($1::uuid[]) UNION SELECT sha256 FROM content.media_blob_writer_reservations WHERE workspace_id=ANY($1::uuid[]) UNION SELECT blobs.sha256 FROM content.media_assets AS assets INNER JOIN content.media_blobs AS blobs ON blobs.media_blob_id=assets.media_blob_id WHERE assets.workspace_id=ANY($1::uuid[])) SELECT ARRAY(SELECT DISTINCT blobs.media_blob_id FROM content.media_blobs AS blobs WHERE blobs.sha256 IN (SELECT sha256 FROM owned)) AS blob_ids, ARRAY(SELECT sha256 FROM owned) AS sha256s`, [[fixture.workspaceId, fixture.outOfScopeWorkspaceId]])).rows[0];
}
async function removeOwnedMedia(fixture: PostgresIntegrationFixture, captured: OwnedMedia): Promise<void> {
  const current = await captureOwnedMedia(fixture); const owned = { blob_ids: [...new Set([...captured.blob_ids, ...current.blob_ids])], sha256s: [...new Set([...captured.sha256s, ...current.sha256s])] };
  const workspaceIds = [fixture.workspaceId, fixture.outOfScopeWorkspaceId]; await fixture.ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id=$1", [fixture.outOfScopeWorkspaceId]);
  await fixture.ownerPool.query("DELETE FROM content.media_assets WHERE workspace_id=ANY($1::uuid[])", [workspaceIds]);
  await fixture.ownerPool.query("DELETE FROM content.media_blob_writer_attempts WHERE workspace_id=ANY($1::uuid[])", [workspaceIds]);
  await fixture.ownerPool.query("DELETE FROM content.media_blob_writer_reservations WHERE workspace_id=ANY($1::uuid[])", [workspaceIds]);
  await fixture.ownerPool.query("DELETE FROM content.media_blobs AS blobs WHERE media_blob_id=ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM content.media_assets WHERE media_blob_id=blobs.media_blob_id) AND NOT EXISTS (SELECT 1 FROM catalog.package_media_assets WHERE media_blob_id=blobs.media_blob_id)", [owned.blob_ids]);
  await fixture.ownerPool.query("DELETE FROM content.media_blob_lifecycles AS lifecycles WHERE sha256=ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM content.media_blobs WHERE sha256=lifecycles.sha256) AND NOT EXISTS (SELECT 1 FROM content.media_blob_writer_reservations WHERE sha256=lifecycles.sha256)", [owned.sha256s]);
  const remaining = (await fixture.ownerPool.query("SELECT (SELECT count(*)::int FROM content.media_blob_writer_attempts WHERE workspace_id=ANY($1::uuid[])) AS attempts,(SELECT count(*)::int FROM content.media_blob_writer_reservations WHERE workspace_id=ANY($1::uuid[])) AS reservations,(SELECT count(*)::int FROM content.media_blobs WHERE media_blob_id=ANY($2::uuid[])) AS blobs,(SELECT count(*)::int FROM content.media_blob_lifecycles WHERE sha256=ANY($3::text[])) AS lifecycles", [workspaceIds, owned.blob_ids, owned.sha256s])).rows[0];
  assert.deepEqual(remaining, { attempts: 0, reservations: 0, blobs: 0, lifecycles: 0 });
}
test("writer attempts fence direct and multipart work with durable replay and canonical locks", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    await apply0097UpgradeAndAssertSecurity(fixture);
    let captured: OwnedMedia = { blob_ids: [], sha256s: [] };
    try {
    const directBeginSql = `SELECT * FROM content.begin_direct_media_blob_writer_attempt_with_owner($1,$2,${directRow})`;
    const sameDirectPayload = direct(fixture, {}); const sameDirectToken = randomUUID();
    const sameDirect = await raceBegins(fixture, directBeginSql, [sameDirectToken, 60_000, ...directValues(sameDirectPayload)], [sameDirectToken, 60_000, ...directValues(sameDirectPayload)]);
    assert.deepEqual(sameDirect.map((row) => row.attempt_status).sort(), ["acquired", "replayed"]);
    const competingDirectPayload = direct(fixture, {}); const competingDirectTokens = [randomUUID(), randomUUID()];
    const competingDirect = await raceBegins(fixture, directBeginSql, [competingDirectTokens[0], 60_000, ...directValues(competingDirectPayload)], [competingDirectTokens[1], 60_000, ...directValues(competingDirectPayload)]);
    assert.deepEqual(competingDirect.map((row) => row.attempt_status).sort(), ["acquired", "busy"]);
    const otherReplica = randomUUID(); await fixture.ownerPool.query(`WITH workspace AS (INSERT INTO org.workspaces(workspace_id,name,fsrs_client_updated_at,fsrs_last_modified_by_replica_id,fsrs_last_operation_id) VALUES($1,'Attempt token race',$2,$3,$4) RETURNING workspace_id),membership AS (INSERT INTO org.workspace_memberships(workspace_id,user_id,role) SELECT workspace_id,$5,'owner' FROM workspace) INSERT INTO sync.workspace_replicas(replica_id,workspace_id,user_id,actor_kind,actor_key,platform,app_version) VALUES($3,$1,$5,'ai_chat',$6,'system','postgres-integration')`, [fixture.outOfScopeWorkspaceId, fixture.createdAt, otherReplica, randomUUID(), fixture.userId, `postgres-integration-${otherReplica}`]);
    const globalToken = randomUUID(); const globalOwnerPayload = direct(fixture, {}); const globalPeerPayload = direct(fixture, { workspaceId: fixture.outOfScopeWorkspaceId, replicaId: otherReplica }); const globalOwner = await fixture.runtimePool.connect(); const globalPeer = await fixture.runtimePool.connect();
    try { for (const [client, workspaceId] of [[globalOwner, fixture.workspaceId], [globalPeer, fixture.outOfScopeWorkspaceId]] as const) { await client.query("BEGIN"); await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, workspaceId]); await client.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='4s'"); } await globalOwner.query("SELECT pg_advisory_xact_lock(hashtextextended('attempt:'||$1::text,3))", [globalToken]); const ownerPid = (await globalOwner.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid; const peerPid = (await globalPeer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid; const pendingPeer = globalPeer.query<BeginRow>(directBeginSql, [globalToken, 60_000, ...directValues(globalPeerPayload)]); await waitForLock(fixture, peerPid); assert.equal((await fixture.ownerPool.query<{ waiting: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_locks AS waiting INNER JOIN pg_locks AS granted USING(locktype,database,classid,objid,objsubid) WHERE waiting.pid=$1 AND granted.pid=$2 AND waiting.locktype='advisory' AND NOT waiting.granted AND granted.granted) AS waiting", [peerPid, ownerPid])).rows[0].waiting, true); const acquired = (await globalOwner.query<BeginRow>(directBeginSql, [globalToken, 60_000, ...directValues(globalOwnerPayload)])).rows[0]; await globalOwner.query("COMMIT"); const beforeDenial = (await fixture.ownerPool.query("SELECT state,lease_expires_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [globalToken])).rows[0]; const denied = (await pendingPeer).rows[0]; await globalPeer.query("COMMIT"); assert.deepEqual([acquired.attempt_status, denied.attempt_status, denied.reservation_token], ["acquired", "access_denied", null]); assert.deepEqual((await fixture.ownerPool.query("SELECT state,lease_expires_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [globalToken])).rows[0], beforeDenial);
    } finally { await Promise.allSettled([globalOwner.query("ROLLBACK"), globalPeer.query("ROLLBACK")]); globalOwner.release(); globalPeer.release(); }
    const guardedDirectPayload = direct(fixture, {}); const guardedDirectAttempt = randomUUID(); const guardedDirect = await beginDirect(fixture, guardedDirectAttempt, guardedDirectPayload, 60_000); assert.equal(guardedDirect.attempt_status, "acquired");
    const guardedDirectBefore = (await fixture.ownerPool.query("SELECT state,lease_expires_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [guardedDirectAttempt])).rows[0]; const wrongDirectPeer = await beginDirect(fixture, randomUUID(), { ...guardedDirectPayload, sourceUrl: "https://wrong.invalid/" }, 60_000);
    assert.deepEqual([wrongDirectPeer.attempt_status, wrongDirectPeer.lease_expires_at, (await fixture.ownerPool.query("SELECT state,lease_expires_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [guardedDirectAttempt])).rows[0]], ["stale_attempt", null, guardedDirectBefore]);
    const firstPayload = direct(fixture, {});
    const firstAttempt = randomUUID();
    const first = await beginDirect(fixture, firstAttempt, firstPayload, 60_000);
    assert.equal(first.attempt_status, "acquired");
    assert.equal((await beginDirect(fixture, firstAttempt, firstPayload, 60_000)).attempt_status, "replayed");
    const busyDirectAttempt = randomUUID();
    assert.equal((await beginDirect(fixture, busyDirectAttempt, firstPayload, 60_000)).attempt_status, "busy");
    assert.equal(await directStatus(fixture, "resolve_direct_media_blob_writer_attempt_failure_with_owner", busyDirectAttempt, first.reservation_token!, firstPayload), "stale_attempt");
    assert.equal(await directStatus(fixture, "resolve_direct_media_blob_writer_attempt_failure_with_owner", firstAttempt, first.reservation_token!, firstPayload), "unreferenced");
    assert.equal(await directStatus(fixture, "resolve_direct_media_blob_writer_attempt_failure_with_owner", firstAttempt, first.reservation_token!, firstPayload), "unreferenced");
    const rotated = await beginDirect(fixture, randomUUID(), firstPayload, 60_000);
    assert.equal(rotated.attempt_status, "acquired");
    assert.notEqual(rotated.reservation_token, first.reservation_token);
    assert.equal((await beginDirect(fixture, firstAttempt, firstPayload, 60_000)).attempt_status, "unreferenced");
    const expiringPayload = direct(fixture, {});
    const expiredAttempt = randomUUID();
    const expired = await beginDirect(fixture, expiredAttempt, expiringPayload, 10);
    await fixture.ownerPool.query("UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_token=$1", [expiredAttempt]); assert.equal((await beginDirect(fixture, randomUUID(), { ...expiringPayload, sourceUrl: "https://wrong.invalid/" }, 60_000)).attempt_status, "stale_attempt"); assert.equal((await fixture.ownerPool.query("SELECT state FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [expiredAttempt])).rows[0].state, "leased");
    const directTakeoverRace = await takeoverAfterLockedExpiry(fixture, expiredAttempt, `SELECT * FROM content.begin_direct_media_blob_writer_attempt_with_owner($1,$2,${directRow})`, [randomUUID(), 60_000, ...directValues(expiringPayload)], [`SELECT content.fence_direct_media_blob_writer_attempt_apply_with_owner($1,$2,${directRow},$16) AS status`, `SELECT content.resolve_direct_media_blob_writer_attempt_failure_with_owner($1,$2,${directRow},$16) AS status`], [expiredAttempt, expired.reservation_token!, ...directValues({ ...expiringPayload, normalizationVersion: expired.normalization_version! }), cleanupDelayMs]);
    const takeover = directTakeoverRace.takeover; assert.deepEqual(directTakeoverRace.stale, ["stale_attempt", "stale_attempt"]);
    assert.equal(takeover.attempt_status, "expired_takeover");
    const livePayload = direct(fixture, {});
    const liveAttempt = randomUUID();
    const live = await beginDirect(fixture, liveAttempt, livePayload, 60_000);
    const canonicalLive = { ...livePayload, normalizationVersion: live.normalization_version! };
    await scoped(fixture, async (client) => { assert.equal((await client.query<StatusRow>( `SELECT content.fence_direct_media_blob_writer_attempt_apply_with_owner( $1,$2,${directRow},$16) AS status`, [liveAttempt, live.reservation_token, ...directValues(canonicalLive), cleanupDelayMs], )).rows[0].status, "ready"); await insertAsset(client, canonicalLive, canonicalLive.operationId, canonicalLive.clientUpdatedAt, null); assert.equal((await client.query<StatusRow>( `SELECT content.finish_direct_media_blob_writer_attempt_apply_with_owner( $1,$2,${directRow},$16) AS status`, [liveAttempt, live.reservation_token, ...directValues(canonicalLive), cleanupDelayMs], )).rows[0].status, "live_applied");
    });
    assert.equal(await directStatus(fixture, "fence_direct_media_blob_writer_attempt_apply_with_owner", liveAttempt, live.reservation_token!, canonicalLive), "live_applied");
    const exactPayload = direct(fixture, {});
    await insertAsset(fixture.ownerPool, exactPayload, exactPayload.operationId, exactPayload.clientUpdatedAt, null);
    const exactAttempt = randomUUID();
    const exactRace = await raceBegins(fixture, directBeginSql, [exactAttempt, 60_000, ...directValues(exactPayload)], [exactAttempt, 60_000, ...directValues(exactPayload)]);
    assert.deepEqual(exactRace.map((row) => [row.attempt_status, row.reservation_token]), [["already_applied", null], ["already_applied", null]]);
    const peerPayload = direct(fixture, {});
    const peerAttempt = randomUUID();
    const peer = await beginDirect(fixture, peerAttempt, peerPayload, 60_000);
    const peerWinner = direct(fixture, { mediaAssetId: peerPayload.mediaAssetId, clientUpdatedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await insertAsset(fixture.ownerPool, peerWinner, peerWinner.operationId, peerWinner.clientUpdatedAt, null);
    assert.equal(await directStatus(fixture, "fence_direct_media_blob_writer_attempt_apply_with_owner", peerAttempt, peer.reservation_token!, { ...peerPayload, normalizationVersion: peer.normalization_version!, }), "peer_conflict");
    assert.equal(await directStatus(fixture, "fence_direct_media_blob_writer_attempt_apply_with_owner", peerAttempt, peer.reservation_token!, { ...peerPayload, normalizationVersion: peer.normalization_version!, }), "peer_conflict");
    const tombstonePayload = direct(fixture, {});
    const tombstoneWinner = { ...tombstonePayload, clientUpdatedAt: new Date(Date.now() + 60_000).toISOString() };
    await insertAsset(fixture.ownerPool, tombstoneWinner, tombstoneWinner.operationId, tombstoneWinner.clientUpdatedAt, tombstoneWinner.clientUpdatedAt);
    assert.equal((await beginDirect(fixture, randomUUID(), tombstonePayload, 60_000)).attempt_status, "peer_conflict");
    const statusPayload = direct(fixture, {});
    const statusAttempt = randomUUID();
    const statusBegin = await beginDirect(fixture, statusAttempt, statusPayload, 60_000);
    const canonicalStatus = { ...statusPayload, normalizationVersion: statusBegin.normalization_version!,
    };
    assert.equal(await directStatus(fixture, "fence_direct_media_blob_writer_attempt_apply_with_owner", statusAttempt, randomUUID(), canonicalStatus), "writer_conflict");
    assert.equal(await directStatus(fixture, "fence_direct_media_blob_writer_attempt_apply_with_owner", statusAttempt, statusBegin.reservation_token!, { ...canonicalStatus, replicaId: randomUUID() }), "replica_mismatch");
    await fixture.ownerPool.query("UPDATE content.media_blob_writer_owner_snapshots SET replica_id=$1 WHERE reservation_token=$2", [randomUUID(), statusBegin.reservation_token]);
    assert.equal(await directStatus(fixture, "fence_direct_media_blob_writer_attempt_apply_with_owner", statusAttempt, statusBegin.reservation_token!, canonicalStatus), "ownership_mismatch");
    await fixture.ownerPool.query("UPDATE content.media_blob_writer_owner_snapshots SET replica_id=$1 WHERE reservation_token=$2", [fixture.replicaId, statusBegin.reservation_token]);
    const scopeFenceBefore = (await fixture.ownerPool.query("SELECT state,lease_expires_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [statusAttempt])).rows[0]; assert.equal(await scoped(fixture, async (client) => { await client.query("SELECT set_config('app.workspace_id',$1,true)", [fixture.outOfScopeWorkspaceId]); return (await client.query<StatusRow>( `SELECT content.fence_direct_media_blob_writer_attempt_apply_with_owner( $1,$2,${directRow},$16) AS status`, [statusAttempt, statusBegin.reservation_token, ...directValues(canonicalStatus), cleanupDelayMs], )).rows[0].status;
    }), "access_denied");
    assert.deepEqual((await fixture.ownerPool.query("SELECT state,lease_expires_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [statusAttempt])).rows[0], scopeFenceBefore);
    assert.equal((await beginDirect(fixture, randomUUID(), direct(fixture, { replicaId: randomUUID() }), 60_000)).attempt_status, "replica_mismatch");
    await fixture.ownerPool.query( `UPDATE content.media_blob_lifecycles SET cleanup_eligible_at=now(), cleanup_lease_token=$1,cleanup_lease_expires_at=now()+interval '1 minute' WHERE sha256=$2`, [randomUUID(), statusPayload.sha256]);
    assert.equal(await directStatus(fixture, "fence_direct_media_blob_writer_attempt_apply_with_owner", statusAttempt, statusBegin.reservation_token!, canonicalStatus), "cleanup_claimed");
    await fixture.ownerPool.query( `UPDATE content.media_blob_lifecycles SET cleanup_eligible_at=NULL, cleanup_lease_token=NULL,cleanup_lease_expires_at=NULL WHERE sha256=$1`, [statusPayload.sha256]);
    const directRevocationPayload = direct(fixture, {});
    const directRevocationAttempt = randomUUID();
    const directRevocationBegin = await beginDirect(fixture, directRevocationAttempt, directRevocationPayload, 60_000);
    const canonicalDirectRevocation = { ...directRevocationPayload, normalizationVersion: directRevocationBegin.normalization_version!,
    };
    const directRevocationSql = `SELECT content.resolve_direct_media_blob_writer_attempt_after_access_revocation( $1,$2,${directRow},$16) AS status`;
    assert.equal(await scoped(fixture, async (client) => (await client.query<StatusRow>(directRevocationSql, [directRevocationAttempt, directRevocationBegin.reservation_token, ...directValues(canonicalDirectRevocation), cleanupDelayMs])).rows[0].status), "access_active");
    await fixture.ownerPool.query( "DELETE FROM org.workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [fixture.workspaceId, fixture.userId]);
    const directRevokedState = await writerState(fixture, directRevocationAttempt, directRevocationBegin.reservation_token!, directRevocationPayload.sha256); assert.equal(await scoped(fixture, async (client) => (await client.query<StatusRow>(directRevocationSql, [directRevocationAttempt, directRevocationBegin.reservation_token, ...directValues(canonicalDirectRevocation), cleanupDelayMs])).rows[0].status), "busy"); assert.equal(await writerState(fixture, directRevocationAttempt, directRevocationBegin.reservation_token!, directRevocationPayload.sha256), directRevokedState);
    await fixture.ownerPool.query("UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_token=$1", [directRevocationAttempt]);
    assert.equal(await directStatus(fixture, "fence_direct_media_blob_writer_attempt_apply_with_owner", directRevocationAttempt, directRevocationBegin.reservation_token!, { ...canonicalDirectRevocation, operationId: randomUUID() }), "access_denied");
    assert.equal(await scoped(fixture, async (client) => (await client.query<StatusRow>(directRevocationSql, [directRevocationAttempt, directRevocationBegin.reservation_token, ...directValues(canonicalDirectRevocation), cleanupDelayMs])).rows[0].status), "unreferenced");
    assert.equal(await scoped(fixture, async (client) => (await client.query<StatusRow>(directRevocationSql, [directRevocationAttempt, directRevocationBegin.reservation_token, ...directValues(canonicalDirectRevocation), cleanupDelayMs])).rows[0].status), "unreferenced");
    await fixture.ownerPool.query( "INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')", [fixture.workspaceId, fixture.userId]);
    const utf8Payload = direct(fixture, { operationId: "lww-tie-😀" });
    const utf8Begin = await beginDirect(fixture, randomUUID(), utf8Payload, 60_000);
    await insertAsset(fixture.ownerPool, utf8Payload, "lww-tie-\uE000", utf8Payload.clientUpdatedAt, null);
    assert.equal(await directStatus(fixture, "fence_direct_media_blob_writer_attempt_apply_with_owner", (await fixture.ownerPool.query<{ attempt_token: string }>( "SELECT attempt_token FROM content.media_blob_writer_attempts WHERE workspace_id=$1 AND operation_id=$2", [fixture.workspaceId, utf8Payload.operationId], )).rows[0].attempt_token, utf8Begin.reservation_token!, { ...utf8Payload, normalizationVersion: utf8Begin.normalization_version!, }), "ready");
    const multipartBeginSql = `SELECT * FROM content.begin_media_upload_session_completion_attempt_with_owner($1,$2,${multipartRow})`;
    const sameMultipartPayload = multipart(fixture, {}); await insertSession(fixture.ownerPool, sameMultipartPayload, "active"); const sameMultipartToken = randomUUID();
    const sameMultipart = await raceBegins(fixture, multipartBeginSql, [sameMultipartToken, 60_000, ...multipartValues(sameMultipartPayload)], [sameMultipartToken, 60_000, ...multipartValues(sameMultipartPayload)]);
    assert.deepEqual(sameMultipart.map((row) => row.attempt_status).sort(), ["acquired", "replayed"]);
    const competingMultipartPayload = multipart(fixture, {}); await insertSession(fixture.ownerPool, competingMultipartPayload, "active"); const competingMultipartTokens = [randomUUID(), randomUUID()];
    const competingMultipart = await raceBegins(fixture, multipartBeginSql, [competingMultipartTokens[0], 60_000, ...multipartValues(competingMultipartPayload)], [competingMultipartTokens[1], 60_000, ...multipartValues(competingMultipartPayload)]);
    assert.deepEqual(competingMultipart.map((row) => row.attempt_status).sort(), ["acquired", "busy"]);
    const guardedMultipartPayload = multipart(fixture, {}); await insertSession(fixture.ownerPool, guardedMultipartPayload, "active"); const guardedMultipartAttempt = randomUUID(); const guardedMultipart = await beginMultipart(fixture, guardedMultipartAttempt, guardedMultipartPayload, 60_000); assert.equal(guardedMultipart.attempt_status, "acquired");
    const guardedMultipartBefore = (await fixture.ownerPool.query("SELECT state,lease_expires_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [guardedMultipartAttempt])).rows[0]; const wrongMultipartPeer = await beginMultipart(fixture, randomUUID(), { ...guardedMultipartPayload, partsFingerprint: digest() }, 60_000);
    assert.deepEqual([wrongMultipartPeer.attempt_status, wrongMultipartPeer.lease_expires_at, (await fixture.ownerPool.query("SELECT state,lease_expires_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [guardedMultipartAttempt])).rows[0]], ["stale_attempt", null, guardedMultipartBefore]);
    const multipartPayload = multipart(fixture, {});
    await insertSession(fixture.ownerPool, multipartPayload, "active");
    const multipartAttempt = randomUUID();
    const multipartBegin = await beginMultipart(fixture, multipartAttempt, multipartPayload, 60_000);
    assert.equal(multipartBegin.attempt_status, "acquired");
    assert.equal((await beginMultipart( fixture, multipartAttempt, multipartPayload, 60_000)).attempt_status, "replayed");
    const busyMultipartAttempt = randomUUID();
    assert.equal((await beginMultipart( fixture, busyMultipartAttempt, multipartPayload, 60_000)).attempt_status, "busy");
    assert.equal(await multipartStatus(fixture, "resolve_media_upload_session_completion_attempt_failure_with_owner", busyMultipartAttempt, multipartBegin.reservation_token!, { ...multipartPayload, normalizationVersion: multipartBegin.normalization_version!,
    }), "stale_attempt");
    assert.equal((await beginMultipart(fixture, multipartAttempt, { ...multipartPayload, partsFingerprint: digest(),
    }, 60_000)).attempt_status, "stale_attempt");
    assert.equal((await beginMultipart(fixture, multipartAttempt, { ...multipartPayload, lastOperationId: randomUUID() }, 60_000)).attempt_status, "stale_attempt");
    const differentSessionId = randomUUID();
    assert.equal((await beginMultipart(fixture, multipartAttempt, { ...multipartPayload, sessionId: differentSessionId, stagingStorageKey: `media/uploads/workspaces/${fixture.workspaceId}/assets/${multipartPayload.mediaAssetId}/sessions/${differentSessionId}`,
    }, 60_000)).attempt_status, "stale_attempt");
    const differentHash = digest();
    assert.equal((await beginMultipart(fixture, multipartAttempt, { ...multipartPayload, sha256: differentHash, blobStorageKey: buildMediaBlobStorageKey(differentHash),
    }, 60_000)).attempt_status, "stale_attempt");
    assert.equal((await beginMultipart(fixture, multipartAttempt, { ...multipartPayload, normalizationVersion: "image-jpeg-card-v1",
    }, 60_000)).attempt_status, "stale_attempt");
    assert.equal((await beginMultipart(fixture, multipartAttempt, { ...multipartPayload, partCount: 2,
    }, 60_000)).attempt_status, "stale_attempt");
    const canonicalMultipart = { ...multipartPayload, normalizationVersion: multipartBegin.normalization_version!,
    };
    await fixture.ownerPool.query( "UPDATE content.media_upload_sessions SET s3_upload_id='changed-upload' WHERE media_upload_session_id=$1", [multipartPayload.sessionId]);
    assert.equal(await multipartStatus(fixture, "fence_media_upload_session_completion_attempt_apply_with_owner", multipartAttempt, multipartBegin.reservation_token!, canonicalMultipart), "stale");
    await fixture.ownerPool.query( "UPDATE content.media_upload_sessions SET s3_upload_id=$2 WHERE media_upload_session_id=$1", [multipartPayload.sessionId, multipartPayload.s3UploadId]);
    await scoped(fixture, async (client) => { assert.equal((await client.query<StatusRow>( `SELECT content.fence_media_upload_session_completion_attempt_apply_with_owner( $1,$2,${multipartRow},$23) AS status`, [multipartAttempt, multipartBegin.reservation_token, ...multipartValues(canonicalMultipart), cleanupDelayMs], )).rows[0].status, "ready"); await insertAsset(client, canonicalMultipart, canonicalMultipart.lastOperationId, canonicalMultipart.clientUpdatedAt, null); assert.equal((await client.query<StatusRow>( `SELECT content.finish_media_upload_session_completion_attempt_apply_with_owner( $1,$2,${multipartRow},$23) AS status`, [multipartAttempt, multipartBegin.reservation_token, ...multipartValues(canonicalMultipart), cleanupDelayMs], )).rows[0].status, "live_applied");
    });
    assert.equal(await multipartStatus(fixture, "finish_media_upload_session_completion_attempt_apply_with_owner", multipartAttempt, multipartBegin.reservation_token!, canonicalMultipart), "live_applied");
    const multipartPeerPayload = multipart(fixture, {}); await insertSession(fixture.ownerPool, multipartPeerPayload, "active");
    const multipartPeerAttempt = randomUUID(); const multipartPeer = await beginMultipart(fixture, multipartPeerAttempt, multipartPeerPayload, 60_000);
    const multipartPeerWinner = { ...multipartPeerPayload, lastOperationId: randomUUID(), clientUpdatedAt: new Date(Date.now() + 60_000).toISOString() };
    const multipartPeerRace = await raceAfterAsset<StatusRow>(fixture, multipartPeerWinner, null, `SELECT content.fence_media_upload_session_completion_attempt_apply_with_owner($1,$2,${multipartRow},$23) AS status`, [multipartPeerAttempt, multipartPeer.reservation_token!, ...multipartValues({ ...multipartPeerPayload, normalizationVersion: multipartPeer.normalization_version! }), cleanupDelayMs]);
    assert.equal(multipartPeerRace.status, "peer_conflict");
    const multipartPeerState = (await fixture.ownerPool.query("SELECT state,outcome,terminal_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [multipartPeerAttempt])).rows[0]; assert.equal(await multipartStatus(fixture, "fence_media_upload_session_completion_attempt_apply_with_owner", multipartPeerAttempt, multipartPeer.reservation_token!, { ...multipartPeerPayload, normalizationVersion: multipartPeer.normalization_version! }), "peer_conflict"); assert.deepEqual((await fixture.ownerPool.query("SELECT state,outcome,terminal_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [multipartPeerAttempt])).rows[0], multipartPeerState);
    const multipartTombstone = multipart(fixture, {}); await insertSession(fixture.ownerPool, multipartTombstone, "active");
    const multipartTombstoneWinner = { ...multipartTombstone, clientUpdatedAt: new Date(Date.now() + 60_000).toISOString() };
    const multipartTombstoneAttempt = randomUUID(); const multipartTombstoneRace = await raceAfterAsset<BeginRow>(fixture, multipartTombstoneWinner, multipartTombstoneWinner.clientUpdatedAt, `SELECT * FROM content.begin_media_upload_session_completion_attempt_with_owner($1,$2,${multipartRow})`, [multipartTombstoneAttempt, 60_000, ...multipartValues(multipartTombstone)]);
    assert.equal(multipartTombstoneRace.attempt_status, "peer_conflict");
    const multipartTombstoneState = (await fixture.ownerPool.query("SELECT state,outcome,terminal_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [multipartTombstoneAttempt])).rows[0]; assert.equal((await beginMultipart(fixture, multipartTombstoneAttempt, multipartTombstone, 60_000)).attempt_status, "peer_conflict"); assert.deepEqual((await fixture.ownerPool.query("SELECT state,outcome,terminal_at FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [multipartTombstoneAttempt])).rows[0], multipartTombstoneState);
    const expiringMultipartPayload = multipart(fixture, {});
    await insertSession(fixture.ownerPool, expiringMultipartPayload, "active");
    const expiredMultipartAttempt = randomUUID();
    const expiredMultipart = await beginMultipart(fixture, expiredMultipartAttempt, expiringMultipartPayload, 10);
    await fixture.ownerPool.query("UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_token=$1", [expiredMultipartAttempt]); assert.equal((await beginMultipart(fixture, randomUUID(), { ...expiringMultipartPayload, partsFingerprint: digest() }, 60_000)).attempt_status, "stale_attempt"); assert.equal((await fixture.ownerPool.query("SELECT state FROM content.media_blob_writer_attempts WHERE attempt_token=$1", [expiredMultipartAttempt])).rows[0].state, "leased");
    const multipartTakeoverAttempt = randomUUID();
    const multipartTakeoverRace = await takeoverAfterLockedExpiry(fixture, expiredMultipartAttempt, `SELECT * FROM content.begin_media_upload_session_completion_attempt_with_owner($1,$2,${multipartRow})`, [multipartTakeoverAttempt, 60_000, ...multipartValues(expiringMultipartPayload)], [`SELECT content.fence_media_upload_session_completion_attempt_apply_with_owner($1,$2,${multipartRow},$23) AS status`, `SELECT content.resolve_media_upload_session_completion_attempt_failure_with_owner($1,$2,${multipartRow},$23) AS status`], [expiredMultipartAttempt, expiredMultipart.reservation_token!, ...multipartValues({ ...expiringMultipartPayload, normalizationVersion: expiredMultipart.normalization_version! }), cleanupDelayMs]);
    const multipartTakeover = multipartTakeoverRace.takeover; assert.deepEqual(multipartTakeoverRace.stale, ["stale_attempt", "stale_attempt"]);
    assert.equal(multipartTakeover.attempt_status, "expired_takeover");
    const canonicalTakeover = { ...expiringMultipartPayload, normalizationVersion: multipartTakeover.normalization_version!,
    };
    assert.equal(await multipartStatus(fixture, "resolve_media_upload_session_completion_attempt_failure_with_owner", multipartTakeoverAttempt, multipartTakeover.reservation_token!, canonicalTakeover), "unreferenced_restored");
    assert.equal(await multipartStatus(fixture, "resolve_media_upload_session_completion_attempt_failure_with_owner", multipartTakeoverAttempt, multipartTakeover.reservation_token!, canonicalTakeover), "unreferenced_restored");
    const abortPayload = multipart(fixture, {});
    await insertSession(fixture.ownerPool, abortPayload, "active");
    const abortAttempt = randomUUID();
    const abortBegin = await beginMultipart(fixture, abortAttempt, abortPayload, 60_000);
    const canonicalAbort = { ...abortPayload, normalizationVersion: abortBegin.normalization_version!,
    };
    const completing = await fixture.runtimePool.connect(); const aborting = await fixture.runtimePool.connect();
    try {
      for (const client of [completing, aborting]) { await client.query("BEGIN"); await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, fixture.workspaceId]); await client.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='4s'"); }
      assert.equal((await completing.query<StatusRow>(`SELECT content.fence_media_upload_session_completion_attempt_apply_with_owner($1,$2,${multipartRow},$23) AS status`, [abortAttempt, abortBegin.reservation_token!, ...multipartValues(canonicalAbort), cleanupDelayMs])).rows[0].status, "ready"); await insertAsset(completing, canonicalAbort, canonicalAbort.lastOperationId, canonicalAbort.clientUpdatedAt, null);
      const abortPid = (await aborting.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid; const pendingAbort = aborting.query("UPDATE content.media_upload_sessions SET state='aborting',completed_at=NULL,aborted_at=NULL WHERE media_upload_session_id=$1", [abortPayload.sessionId]).then(async () => (await aborting.query<StatusRow>(`SELECT content.close_media_upload_session_blob_writer_attempts($1,$2,${multipartRow},$23) AS status`, [abortAttempt, abortBegin.reservation_token!, ...multipartValues(canonicalAbort), cleanupDelayMs])).rows[0].status); await waitForLock(fixture, abortPid);
      assert.equal((await completing.query<StatusRow>(`SELECT content.finish_media_upload_session_completion_attempt_apply_with_owner($1,$2,${multipartRow},$23) AS status`, [abortAttempt, abortBegin.reservation_token!, ...multipartValues(canonicalAbort), cleanupDelayMs])).rows[0].status, "live_applied"); await completing.query("COMMIT"); assert.equal(await pendingAbort, "live_applied"); await aborting.query("ROLLBACK");
    } finally { await Promise.allSettled([completing.query("ROLLBACK"), aborting.query("ROLLBACK")]); completing.release(); aborting.release(); }
    const expiredClosePayload = multipart(fixture, {}); await insertSession(fixture.ownerPool, expiredClosePayload, "active"); const expiredCloseAttempt = randomUUID(); const expiredCloseBegin = await beginMultipart(fixture, expiredCloseAttempt, expiredClosePayload, 60_000); const canonicalExpiredClose = { ...expiredClosePayload, normalizationVersion: expiredCloseBegin.normalization_version! };
    await fixture.ownerPool.query("UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_token=$1", [expiredCloseAttempt]); await fixture.ownerPool.query("UPDATE content.media_upload_sessions SET state='aborting' WHERE media_upload_session_id=$1", [expiredClosePayload.sessionId]); assert.equal(await multipartStatus(fixture, "close_media_upload_session_blob_writer_attempts", expiredCloseAttempt, expiredCloseBegin.reservation_token!, canonicalExpiredClose), "aborted");
    const revokedPayload = multipart(fixture, {});
    await insertSession(fixture.ownerPool, revokedPayload, "active");
    const revokedAttempt = randomUUID();
    const revokedBegin = await beginMultipart(fixture, revokedAttempt, revokedPayload, 60_000);
    const canonicalRevoked = { ...revokedPayload, normalizationVersion: revokedBegin.normalization_version!,
    };
    const revocationSql = `SELECT content.resolve_media_upload_session_completion_attempt_after_access_revocation( $1,$2,${multipartRow},$23) AS status`;
    assert.equal(await scoped(fixture, async (client) => (await client.query<StatusRow>(revocationSql, [revokedAttempt, revokedBegin.reservation_token, ...multipartValues(canonicalRevoked), cleanupDelayMs])).rows[0].status), "access_active");
    await fixture.ownerPool.query( "DELETE FROM org.workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [fixture.workspaceId, fixture.userId]);
    const multipartRevokedState = await writerState(fixture, revokedAttempt, revokedBegin.reservation_token!, revokedPayload.sha256); assert.equal(await scoped(fixture, async (client) => (await client.query<StatusRow>(revocationSql, [revokedAttempt, revokedBegin.reservation_token, ...multipartValues(canonicalRevoked), cleanupDelayMs])).rows[0].status), "busy"); assert.equal(await writerState(fixture, revokedAttempt, revokedBegin.reservation_token!, revokedPayload.sha256), multipartRevokedState);
    await fixture.ownerPool.query("UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_token=$1", [revokedAttempt]);
    assert.equal(await multipartStatus(fixture, "fence_media_upload_session_completion_attempt_apply_with_owner", revokedAttempt, revokedBegin.reservation_token!, { ...canonicalRevoked, lastOperationId: randomUUID() }), "access_denied");
    assert.equal(await scoped(fixture, async (client) => (await client.query<StatusRow>(revocationSql, [revokedAttempt, revokedBegin.reservation_token, ...multipartValues(canonicalRevoked), cleanupDelayMs])).rows[0].status), "unreferenced");
    assert.equal(await scoped(fixture, async (client) => (await client.query<StatusRow>(revocationSql, [revokedAttempt, revokedBegin.reservation_token, ...multipartValues(canonicalRevoked), cleanupDelayMs])).rows[0].status), "unreferenced");
    await fixture.ownerPool.query( "INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')", [fixture.workspaceId, fixture.userId]);
    const sessionExpiryPayload = multipart(fixture, { sessionExpiresAt: new Date(Date.now() + 250).toISOString() }); await insertSession(fixture.ownerPool, sessionExpiryPayload, "active"); const sessionExpiryAttempt = randomUUID(); const sessionExpiryBegin = await beginMultipart(fixture, sessionExpiryAttempt, sessionExpiryPayload, 60_000); const canonicalSessionExpiry = { ...sessionExpiryPayload, normalizationVersion: sessionExpiryBegin.normalization_version! };
    await fixture.ownerPool.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-pg_catalog.clock_timestamp()))+0.05))", [sessionExpiryPayload.sessionExpiresAt]); const sessionExpiredState = await writerState(fixture, sessionExpiryAttempt, sessionExpiryBegin.reservation_token!, sessionExpiryPayload.sha256);
    assert.equal(await multipartStatus(fixture, "close_media_upload_session_blob_writer_attempts", sessionExpiryAttempt, sessionExpiryBegin.reservation_token!, canonicalSessionExpiry), "busy"); assert.equal(await writerState(fixture, sessionExpiryAttempt, sessionExpiryBegin.reservation_token!, sessionExpiryPayload.sha256), sessionExpiredState);
    await fixture.ownerPool.query("UPDATE content.media_blob_writer_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_token=$1", [sessionExpiryAttempt]); assert.equal(await multipartStatus(fixture, "close_media_upload_session_blob_writer_attempts", sessionExpiryAttempt, sessionExpiryBegin.reservation_token!, canonicalSessionExpiry), "aborted"); assert.equal(await multipartStatus(fixture, "close_media_upload_session_blob_writer_attempts", sessionExpiryAttempt, sessionExpiryBegin.reservation_token!, canonicalSessionExpiry), "aborted");
    const racePayload = multipart(fixture, {});
    await insertSession(fixture.ownerPool, racePayload, "active");
    const raceAttempt = randomUUID();
    const raceBegin = await beginMultipart(fixture, raceAttempt, racePayload, 60_000);
    const canonicalRace = { ...racePayload, normalizationVersion: raceBegin.normalization_version! };
    captured = await captureOwnedMedia(fixture);
    const worker = await fixture.runtimePool.connect(); const deleter = await fixture.ownerPool.connect();
    try {
      await worker.query("BEGIN"); await worker.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, fixture.workspaceId]); await worker.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='4s'");
      assert.equal((await worker.query<StatusRow>(`SELECT content.fence_media_upload_session_completion_attempt_apply_with_owner($1,$2,${multipartRow},$23) AS status`, [raceAttempt, raceBegin.reservation_token, ...multipartValues(canonicalRace), cleanupDelayMs])).rows[0].status, "ready");
      await worker.query("UPDATE content.media_upload_sessions SET state='aborting' WHERE media_upload_session_id=$1", [racePayload.sessionId]);
      assert.equal((await worker.query<StatusRow>(`SELECT content.close_media_upload_session_blob_writer_attempts($1,$2,${multipartRow},$23) AS status`, [raceAttempt, raceBegin.reservation_token, ...multipartValues(canonicalRace), cleanupDelayMs])).rows[0].status, "aborted");
      await deleter.query("BEGIN"); await deleter.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='4s'"); const deletePid = (await deleter.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const pendingDelete = deleter.query("DELETE FROM org.workspaces WHERE workspace_id=$1", [fixture.workspaceId]); await waitForLock(fixture, deletePid);
      await worker.query("COMMIT"); await pendingDelete; await deleter.query("COMMIT");
    } finally { await Promise.allSettled([worker.query("ROLLBACK"), deleter.query("ROLLBACK")]); worker.release(); deleter.release();
    }
    const deletion = (await fixture.ownerPool.query( `SELECT count(*) FILTER (WHERE state='leased')::int AS live, count(*) FILTER (WHERE outcome='aborted')::int AS aborted, bool_and(lifecycles.cleanup_eligible_at IS NOT NULL) AS cleanup FROM content.media_blob_writer_attempts AS attempts INNER JOIN content.media_blob_lifecycles AS lifecycles ON lifecycles.sha256=attempts.sha256 WHERE attempts.workspace_id=$1`, [fixture.workspaceId],
    )).rows[0];
    assert.equal(deletion.live, 0);
    assert.equal(deletion.aborted > 0, true);
    assert.equal(deletion.cleanup, true);
    assert.equal(await multipartStatus(fixture, "close_media_upload_session_blob_writer_attempts", raceAttempt, raceBegin.reservation_token!, canonicalRace), "aborted");
    const replayedDirect = await beginDirect(fixture, liveAttempt, livePayload, 60_000); assert.deepEqual([replayedDirect.attempt_status, replayedDirect.reservation_token], ["live_applied", null]);
    const replayedMultipart = await beginMultipart(fixture, multipartAttempt, multipartPayload, 60_000); assert.deepEqual([replayedMultipart.attempt_status, replayedMultipart.reservation_token], ["live_applied", null]);
    assert.equal((await beginMultipart(fixture, multipartAttempt, { ...multipartPayload, lastOperationId: randomUUID() }, 60_000)).attempt_status, "stale_attempt");
    assert.equal(await directStatus(fixture, "finish_direct_media_blob_writer_attempt_apply_with_owner", randomUUID(), live.reservation_token!, canonicalLive), "access_denied");
    assert.equal(await directStatus(fixture, "finish_direct_media_blob_writer_attempt_apply_with_owner", liveAttempt, live.reservation_token!, { ...canonicalLive, operationId: randomUUID() }), "stale_attempt");
    assert.equal(await multipartStatus(fixture, "finish_media_upload_session_completion_attempt_apply_with_owner", multipartAttempt, multipartBegin.reservation_token!, canonicalMultipart), "live_applied");
    const deniedReplay = await scoped(fixture, async (client) => { await client.query("SELECT set_config('app.workspace_id',$1,true)", [fixture.outOfScopeWorkspaceId]); return (await client.query<BeginRow>(directBeginSql, [liveAttempt, 60_000, ...directValues(livePayload)])).rows[0]; }); assert.deepEqual([deniedReplay.attempt_status, deniedReplay.reservation_token], ["access_denied", null]);
    const deniedTerminal = await scoped(fixture, async (client) => { await client.query("SELECT set_config('app.workspace_id',$1,true)", [fixture.outOfScopeWorkspaceId]); const directResult = (await client.query<StatusRow>(`SELECT content.finish_direct_media_blob_writer_attempt_apply_with_owner($1,$2,${directRow},$16) AS status`, [liveAttempt, live.reservation_token!, ...directValues(canonicalLive), cleanupDelayMs])).rows[0].status; const multipartResult = (await client.query<StatusRow>(`SELECT content.finish_media_upload_session_completion_attempt_apply_with_owner($1,$2,${multipartRow},$23) AS status`, [multipartAttempt, multipartBegin.reservation_token!, ...multipartValues(canonicalMultipart), cleanupDelayMs])).rows[0].status; return [directResult, multipartResult]; }); assert.deepEqual(deniedTerminal, ["access_denied", "access_denied"]);
    assert.equal((await fixture.ownerPool.query<{ count: number }>("SELECT count(*)::int AS count FROM sync.workspace_sync_metadata WHERE workspace_id=$1", [fixture.workspaceId])).rows[0].count, 0);
    await assert.rejects( fixture.runtimePool.query("SELECT attempt_token FROM content.media_blob_writer_attempts"), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501",
    );
    } finally { await removeOwnedMedia(fixture, captured); }
  });
});
test("direct apply serializes with workspace deletion and replays after deletion", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    try {
    const payload = direct(fixture, {}); const attempt = randomUUID(); const begun = await beginDirect(fixture, attempt, payload, 60_000);
    const canonical = { ...payload, normalizationVersion: begun.normalization_version! };
    const worker = await fixture.runtimePool.connect(); const deleter = await fixture.ownerPool.connect();
    try {
      await worker.query("BEGIN"); await worker.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [fixture.userId, fixture.workspaceId]); await worker.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='4s'");
      assert.equal((await worker.query<StatusRow>(`SELECT content.fence_direct_media_blob_writer_attempt_apply_with_owner($1,$2,${directRow},$16) AS status`, [attempt, begun.reservation_token, ...directValues(canonical), cleanupDelayMs])).rows[0].status, "ready");
      await insertAsset(worker, canonical, canonical.operationId, canonical.clientUpdatedAt, null);
      await deleter.query("BEGIN"); await deleter.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='4s'"); const pid = (await deleter.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const pendingDelete = deleter.query("DELETE FROM org.workspaces WHERE workspace_id=$1", [fixture.workspaceId]); await waitForLock(fixture, pid);
      assert.equal((await worker.query<StatusRow>(`SELECT content.finish_direct_media_blob_writer_attempt_apply_with_owner($1,$2,${directRow},$16) AS status`, [attempt, begun.reservation_token, ...directValues(canonical), cleanupDelayMs])).rows[0].status, "live_applied");
      await worker.query("COMMIT"); await pendingDelete; await deleter.query("COMMIT");
    } finally { await Promise.allSettled([worker.query("ROLLBACK"), deleter.query("ROLLBACK")]); worker.release(); deleter.release(); }
    const replay = await beginDirect(fixture, attempt, payload, 60_000); assert.deepEqual([replay.attempt_status, replay.reservation_token, replay.lease_expires_at], ["live_applied", null, null]);
    assert.equal((await beginDirect(fixture, attempt, { ...payload, sourceUrl: "https://wrong.invalid/" }, 60_000)).attempt_status, "stale_attempt");
    } finally { await removeOwnedMedia(fixture, { blob_ids: [], sha256s: [] }); }
  });
});

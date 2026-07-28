import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type pg from "pg";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../testSupport/postgresIntegration";
import { buildMediaBlobStorageKey } from "./storageKeys";

type MultipartPayload = Readonly<{
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

type BeginRow = Readonly<{
  attempt_status: string;
  reservation_token: string | null;
  normalization_version: string | null;
  lease_expires_at: string | Date | null;
}>;

type StatusRow = Readonly<{ status: string }>;
type StateRow = Readonly<{
  session_state: string;
  attempt_state: string;
  attempt_outcome: string;
  reservation_state: string;
}>;
type OwnedMedia = Readonly<{
  blobIds: ReadonlyArray<string>;
  sha256s: ReadonlyArray<string>;
}>;
type UpgradeHistory = Readonly<{
  original: MultipartPayload;
  conflicting: MultipartPayload;
}>;
type SqlValue = string | number | null;
type QueryExecutor = Pick<pg.PoolClient | pg.Pool, "query">;

const cleanupDelayMs = 3_600_000;
const migration0098 = readFileSync(resolve(
  __dirname,
  "../../../../db/migrations/0098_multipart_writer_abort_and_terminal_replay.sql",
), "utf8");
const multipartRow = `ROW(
  $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
)::content.multipart_media_blob_writer_attempt_payload`;
const beginSignature =
  "content.begin_media_upload_session_completion_attempt_with_owner(uuid,integer,content.multipart_media_blob_writer_attempt_payload)";
const closeSignature =
  "content.close_media_upload_session_current_blob_writer_with_owner(text,uuid,uuid,uuid,uuid,text,text,text,text,bigint,timestamp with time zone,integer)";
const helperSignature =
  "content.multipart_media_blob_writer_terminal_replay_status_internal(content.media_blob_writer_attempts,content.multipart_media_blob_writer_attempt_payload)";
const oldCloseSignature =
  "content.close_media_upload_session_blob_writer(text,uuid,uuid,uuid,uuid,text,text,text,text,bigint,timestamp with time zone,integer)";
const oldAttemptCloseSignature =
  "content.close_media_upload_session_blob_writer_attempts(uuid,uuid,content.multipart_media_blob_writer_attempt_payload,integer)";

function digest(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function multipart(
  fixture: PostgresIntegrationFixture,
  overrides: Partial<MultipartPayload>,
): MultipartPayload {
  const sessionId = overrides.sessionId ?? randomUUID();
  const mediaAssetId = overrides.mediaAssetId ?? randomUUID();
  const sha256 = overrides.sha256 ?? digest();
  return {
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
    sessionId,
    mediaAssetId,
    replicaId: fixture.replicaId,
    lastOperationId: randomUUID(),
    sha256,
    stagingStorageKey:
      `media/uploads/workspaces/${fixture.workspaceId}/assets/${mediaAssetId}/sessions/${sessionId}`,
    blobStorageKey: buildMediaBlobStorageKey(sha256),
    s3UploadId: `upload-${randomUUID()}`,
    mimeType: "application/octet-stream",
    sizeBytes: 42,
    partSizeBytes: 42,
    partCount: 1,
    sourceUrl: null,
    assetCreatedAt: fixture.createdAt,
    clientUpdatedAt: fixture.createdAt,
    sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    normalizationVersion: "passthrough-v1",
    partsFingerprint: digest(),
    ...overrides,
  };
}

function multipartValues(payload: MultipartPayload): Array<SqlValue> {
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

function closeValues(payload: MultipartPayload): Array<SqlValue> {
  return [
    payload.userId,
    payload.workspaceId,
    payload.sessionId,
    payload.mediaAssetId,
    payload.replicaId,
    payload.lastOperationId,
    payload.sha256,
    payload.blobStorageKey,
    payload.mimeType,
    payload.sizeBytes,
    payload.sessionExpiresAt,
    cleanupDelayMs,
  ];
}

async function scoped<Result>(
  fixture: PostgresIntegrationFixture,
  userId: string,
  workspaceId: string,
  callback: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await fixture.runtimePool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
      [userId, workspaceId],
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

async function insertSession(
  executor: QueryExecutor,
  payload: MultipartPayload,
  state: "active" | "completing" | "aborting",
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

async function beginMultipart(
  fixture: PostgresIntegrationFixture,
  attemptToken: string,
  payload: MultipartPayload,
  leaseDurationMs: number,
): Promise<BeginRow> {
  return scoped(
    fixture,
    fixture.userId,
    fixture.workspaceId,
    async (client) => (await client.query<BeginRow>(
      `SELECT *
       FROM content.begin_media_upload_session_completion_attempt_with_owner(
         $1,$2,${multipartRow}
       )`,
      [attemptToken, leaseDurationMs, ...multipartValues(payload)],
    )).rows[0],
  );
}

async function multipartStatus(
  fixture: PostgresIntegrationFixture,
  functionName: string,
  attemptToken: string,
  reservationToken: string,
  payload: MultipartPayload,
): Promise<string> {
  return scoped(
    fixture,
    fixture.userId,
    fixture.workspaceId,
    async (client) => (await client.query<StatusRow>(
      `SELECT content.${functionName}(
         $1,$2,${multipartRow},$23
       ) AS status`,
      [
        attemptToken,
        reservationToken,
        ...multipartValues(payload),
        cleanupDelayMs,
      ],
    )).rows[0].status,
  );
}

async function closeCurrentWriter(
  fixture: PostgresIntegrationFixture,
  payload: MultipartPayload,
): Promise<string> {
  return scoped(
    fixture,
    fixture.userId,
    fixture.workspaceId,
    async (client) => closeCurrentWriterInExecutor(client, payload),
  );
}

async function closeCurrentWriterInExecutor(
  executor: QueryExecutor,
  payload: MultipartPayload,
): Promise<string> {
  return (await executor.query<StatusRow>(
    `SELECT content.close_media_upload_session_current_blob_writer_with_owner(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
     ) AS status`,
    closeValues(payload),
  )).rows[0].status;
}

async function insertAsset(
  executor: QueryExecutor,
  payload: MultipartPayload,
): Promise<string> {
  const mediaBlobId = randomUUID();
  await executor.query(
    `WITH blob AS (
       INSERT INTO content.media_blobs (
         media_blob_id,sha256,mime_type,size_bytes,storage_key,normalization_version
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING media_blob_id
     )
     INSERT INTO content.media_assets (
       media_asset_id,workspace_id,media_blob_id,source_url,created_at,
       client_updated_at,last_modified_by_replica_id,last_operation_id
     )
     SELECT $7,$8,media_blob_id,$9,$10,$11,$12,$13
     FROM blob`,
    [
      mediaBlobId,
      payload.sha256,
      payload.mimeType,
      payload.sizeBytes,
      payload.blobStorageKey,
      payload.normalizationVersion,
      payload.mediaAssetId,
      payload.workspaceId,
      payload.sourceUrl,
      payload.assetCreatedAt,
      payload.clientUpdatedAt,
      payload.replicaId,
      payload.lastOperationId,
    ],
  );
  return mediaBlobId;
}

async function seed0097ConflictingTerminalHistory(
  fixture: PostgresIntegrationFixture,
): Promise<UpgradeHistory> {
  const original = multipart(fixture, {});
  await insertSession(fixture.ownerPool, original, "active");
  const originalAttempt = randomUUID();
  const originalBegin = await beginMultipart(
    fixture,
    originalAttempt,
    original,
    60_000,
  );
  assert.equal(originalBegin.attempt_status, "acquired");
  assert.ok(originalBegin.reservation_token !== null);
  assert.ok(originalBegin.normalization_version !== null);
  const canonicalOriginal = {
    ...original,
    normalizationVersion: originalBegin.normalization_version,
  };
  assert.equal(
    await multipartStatus(
      fixture,
      "fence_media_upload_session_completion_attempt_apply_with_owner",
      originalAttempt,
      originalBegin.reservation_token,
      canonicalOriginal,
    ),
    "ready",
  );
  await insertAsset(fixture.ownerPool, canonicalOriginal);
  assert.equal(
    await multipartStatus(
      fixture,
      "finish_media_upload_session_completion_attempt_apply_with_owner",
      originalAttempt,
      originalBegin.reservation_token,
      canonicalOriginal,
    ),
    "live_applied",
  );

  const conflicting = { ...original, partsFingerprint: digest() };
  const conflictingBegin = await beginMultipart(
    fixture,
    randomUUID(),
    conflicting,
    60_000,
  );
  assert.equal(conflictingBegin.attempt_status, "already_applied");
  const history = (await fixture.ownerPool.query<Readonly<{
    completed_parts_fingerprint: string;
    outcome: string;
  }>>(
    `SELECT attempts.completed_parts_fingerprint, attempts.outcome
     FROM content.media_blob_writer_attempts AS attempts
     WHERE attempts.media_upload_session_id = $1
       AND attempts.state IN ('applied', 'referenced')
     ORDER BY attempts.created_at, attempts.terminal_at, attempts.attempt_token`,
    [original.sessionId],
  )).rows;
  assert.deepEqual(history, [
    {
      completed_parts_fingerprint: original.partsFingerprint,
      outcome: "live_applied",
    },
    {
      completed_parts_fingerprint: conflicting.partsFingerprint,
      outcome: "already_applied",
    },
  ]);
  return { original, conflicting };
}

async function writerState(
  fixture: PostgresIntegrationFixture,
  payload: MultipartPayload,
): Promise<StateRow> {
  const row = (await fixture.ownerPool.query<StateRow>(
    `SELECT
       sessions.state AS session_state,
       attempts.state AS attempt_state,
       attempts.outcome AS attempt_outcome,
       reservations.state AS reservation_state
     FROM content.media_upload_sessions AS sessions
     INNER JOIN content.media_blob_writer_attempts AS attempts
       ON attempts.media_upload_session_id = sessions.media_upload_session_id
     INNER JOIN content.media_blob_writer_reservations AS reservations
       ON reservations.reservation_token = attempts.reservation_token
     WHERE sessions.media_upload_session_id = $1
     ORDER BY attempts.created_at DESC, attempts.attempt_token DESC
     LIMIT 1`,
    [payload.sessionId],
  )).rows[0];
  if (row === undefined) {
    throw new Error(
      `Multipart writer state is missing. sessionId=${payload.sessionId}`,
    );
  }
  return row;
}

async function mutationSnapshot(
  fixture: PostgresIntegrationFixture,
  payload: MultipartPayload,
): Promise<string> {
  const row = (await fixture.ownerPool.query<Readonly<{ snapshot: string }>>(
    `SELECT jsonb_build_object(
       'session', (
         SELECT to_jsonb(sessions)
         FROM content.media_upload_sessions AS sessions
         WHERE sessions.media_upload_session_id = $1
       ),
       'attempts', (
         SELECT COALESCE(
           jsonb_agg(to_jsonb(attempts) ORDER BY attempts.created_at, attempts.attempt_token),
           '[]'::jsonb
         )
         FROM content.media_blob_writer_attempts AS attempts
         WHERE attempts.media_upload_session_id = $1
       ),
       'reservation', (
         SELECT to_jsonb(reservations)
         FROM content.media_blob_writer_reservations AS reservations
         WHERE reservations.writer_kind = 'multipart_completion'
           AND reservations.operation_id = $1::text
       ),
       'lifecycle', (
         SELECT to_jsonb(lifecycles)
         FROM content.media_blob_lifecycles AS lifecycles
         WHERE lifecycles.sha256 = $2
       ),
       'asset', (
         SELECT to_jsonb(assets)
         FROM content.media_assets AS assets
         WHERE assets.media_asset_id = $3
       )
     )::text AS snapshot`,
    [payload.sessionId, payload.sha256, payload.mediaAssetId],
  )).rows[0];
  if (row === undefined) {
    throw new Error(
      `Multipart mutation snapshot is missing. sessionId=${payload.sessionId}`,
    );
  }
  return row.snapshot;
}

async function waitForLock(
  fixture: PostgresIntegrationFixture,
  processId: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = (await fixture.ownerPool.query<Readonly<{ waiting: boolean }>>(
      "SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1",
      [processId],
    )).rows[0]?.waiting;
    if (waiting === true) return;
    await fixture.ownerPool.query("SELECT pg_sleep(0.01)");
  }
  assert.fail(
    `PostgreSQL worker did not enter the expected lock wait. pid=${processId}`,
  );
}

async function apply0098UpgradeAndAssertSecurity(
  fixture: PostgresIntegrationFixture,
): Promise<UpgradeHistory | null> {
  const client = await fixture.ownerPool.connect();
  let upgradeHistory: UpgradeHistory | null = null;
  try {
    const baseline = (await client.query<Readonly<{
      major: number;
      migrations: number;
      latest: string;
      close_present: boolean;
      history_index_present: boolean;
    }>>(
      `SELECT
         current_setting('server_version_num')::int / 10000 AS major,
         count(*)::int AS migrations,
         max(filename) AS latest,
         to_regprocedure($1) IS NOT NULL AS close_present,
         to_regclass(
           'content.media_blob_writer_attempts_multipart_session_history'
         ) IS NOT NULL AS history_index_present
       FROM public.schema_migrations`,
      [closeSignature],
    )).rows[0];
    if (baseline === undefined) {
      throw new Error("PostgreSQL migration baseline query returned no row.");
    }
    assert.equal(baseline.major, 18);

    if (!baseline.close_present) {
      assert.deepEqual(
        { migrations: baseline.migrations, latest: baseline.latest },
        {
          migrations: 99,
          latest: "0097_direct_multipart_writer_attempt_fencing.sql",
        },
      );
      assert.equal(baseline.history_index_present, false);
      upgradeHistory = await seed0097ConflictingTerminalHistory(fixture);
      await client.query("BEGIN");
      await client.query(migration0098);
      await client.query(
        "INSERT INTO public.schema_migrations(filename) VALUES ($1)",
        ["0098_multipart_writer_abort_and_terminal_replay.sql"],
      );
      await client.query("COMMIT");
    } else {
      assert.deepEqual(
        { migrations: baseline.migrations, latest: baseline.latest },
        {
          migrations: 100,
          latest: "0098_multipart_writer_abort_and_terminal_replay.sql",
        },
      );
      assert.equal(baseline.history_index_present, true);
    }

    const security = (await client.query<Readonly<{
      backend_begin: boolean;
      backend_close: boolean;
      backend_helper: boolean;
      auth_begin: boolean;
      auth_close: boolean;
      reporting_begin: boolean;
      reporting_close: boolean;
      no_public_begin: boolean;
      no_public_close: boolean;
      no_public_helper: boolean;
      hardened: boolean;
      old_close: boolean;
      old_attempt_close: boolean;
      backend_attempt_table: boolean;
      history_index_present: boolean;
    }>>(
      `SELECT
         has_function_privilege('backend_app',$1,'EXECUTE') AS backend_begin,
         has_function_privilege('backend_app',$2,'EXECUTE') AS backend_close,
         has_function_privilege('backend_app',$3,'EXECUTE') AS backend_helper,
         has_function_privilege('auth_app',$1,'EXECUTE') AS auth_begin,
         has_function_privilege('auth_app',$2,'EXECUTE') AS auth_close,
         has_function_privilege('reporting_readonly',$1,'EXECUTE') AS reporting_begin,
         has_function_privilege('reporting_readonly',$2,'EXECUTE') AS reporting_close,
         NOT EXISTS (
           SELECT 1
           FROM pg_proc AS functions
           CROSS JOIN LATERAL aclexplode(
             COALESCE(functions.proacl,acldefault('f',functions.proowner))
           ) AS privileges
           WHERE functions.oid = $1::regprocedure
             AND privileges.grantee = 0
         ) AS no_public_begin,
         NOT EXISTS (
           SELECT 1
           FROM pg_proc AS functions
           CROSS JOIN LATERAL aclexplode(
             COALESCE(functions.proacl,acldefault('f',functions.proowner))
           ) AS privileges
           WHERE functions.oid = $2::regprocedure
             AND privileges.grantee = 0
         ) AS no_public_close,
         NOT EXISTS (
           SELECT 1
           FROM pg_proc AS functions
           CROSS JOIN LATERAL aclexplode(
             COALESCE(functions.proacl,acldefault('f',functions.proowner))
           ) AS privileges
           WHERE functions.oid = $3::regprocedure
             AND privileges.grantee = 0
         ) AS no_public_helper,
         (
           SELECT bool_and(
             functions.prosecdef
             AND functions.proconfig = ARRAY['search_path=pg_catalog']
           )
           FROM pg_proc AS functions
           WHERE functions.oid = ANY(ARRAY[
             $1::regprocedure,$2::regprocedure,$3::regprocedure
           ])
         ) AS hardened,
         to_regprocedure($4) IS NOT NULL AS old_close,
         to_regprocedure($5) IS NOT NULL AS old_attempt_close,
         has_table_privilege(
           'backend_app','content.media_blob_writer_attempts','SELECT'
         ) AS backend_attempt_table,
         to_regclass(
           'content.media_blob_writer_attempts_multipart_session_history'
         ) IS NOT NULL AS history_index_present`,
      [
        beginSignature,
        closeSignature,
        helperSignature,
        oldCloseSignature,
        oldAttemptCloseSignature,
      ],
    )).rows[0];
    assert.deepEqual(security, {
      backend_begin: true,
      backend_close: true,
      backend_helper: false,
      auth_begin: false,
      auth_close: false,
      reporting_begin: false,
      reporting_close: false,
      no_public_begin: true,
      no_public_close: true,
      no_public_helper: true,
      hardened: true,
      old_close: true,
      old_attempt_close: true,
      backend_attempt_table: false,
      history_index_present: true,
    });
    return upgradeHistory;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function captureOwnedMedia(
  fixture: PostgresIntegrationFixture,
): Promise<OwnedMedia> {
  const row = (await fixture.ownerPool.query<Readonly<{
    blob_ids: ReadonlyArray<string>;
    sha256s: ReadonlyArray<string>;
  }>>(
    `WITH owned_sha256s AS (
       SELECT attempts.sha256
       FROM content.media_blob_writer_attempts AS attempts
       WHERE attempts.workspace_id = $1
       UNION
       SELECT reservations.sha256
       FROM content.media_blob_writer_reservations AS reservations
       WHERE reservations.workspace_id = $1
       UNION
       SELECT blobs.sha256
       FROM content.media_assets AS assets
       INNER JOIN content.media_blobs AS blobs
         ON blobs.media_blob_id = assets.media_blob_id
       WHERE assets.workspace_id = $1
     )
     SELECT
       ARRAY(
         SELECT blobs.media_blob_id
         FROM content.media_blobs AS blobs
         WHERE blobs.sha256 IN (SELECT sha256 FROM owned_sha256s)
       ) AS blob_ids,
       ARRAY(SELECT sha256 FROM owned_sha256s) AS sha256s`,
    [fixture.workspaceId],
  )).rows[0];
  if (row === undefined) {
    throw new Error("PostgreSQL owned-media capture returned no row.");
  }
  return { blobIds: row.blob_ids, sha256s: row.sha256s };
}

async function removeOwnedMedia(
  fixture: PostgresIntegrationFixture,
): Promise<void> {
  const owned = await captureOwnedMedia(fixture);
  await fixture.ownerPool.query(
    "DELETE FROM content.media_upload_sessions WHERE workspace_id = $1",
    [fixture.workspaceId],
  );
  await fixture.ownerPool.query(
    "DELETE FROM content.media_assets WHERE workspace_id = $1",
    [fixture.workspaceId],
  );
  await fixture.ownerPool.query(
    "DELETE FROM content.media_blob_writer_attempts WHERE workspace_id = $1",
    [fixture.workspaceId],
  );
  await fixture.ownerPool.query(
    "DELETE FROM content.media_blob_writer_reservations WHERE workspace_id = $1",
    [fixture.workspaceId],
  );
  await fixture.ownerPool.query(
    `DELETE FROM content.media_blobs AS blobs
     WHERE blobs.media_blob_id = ANY($1::uuid[])
       AND NOT EXISTS (
         SELECT 1
         FROM content.media_assets AS assets
         WHERE assets.media_blob_id = blobs.media_blob_id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM catalog.package_media_assets AS assets
         WHERE assets.media_blob_id = blobs.media_blob_id
       )`,
    [owned.blobIds],
  );
  await fixture.ownerPool.query(
    `DELETE FROM content.media_blob_lifecycles AS lifecycles
     WHERE lifecycles.sha256 = ANY($1::text[])
       AND NOT EXISTS (
         SELECT 1
         FROM content.media_blobs AS blobs
         WHERE blobs.sha256 = lifecycles.sha256
       )
       AND NOT EXISTS (
         SELECT 1
         FROM content.media_blob_writer_reservations AS reservations
         WHERE reservations.sha256 = lifecycles.sha256
       )`,
    [owned.sha256s],
  );
  const remaining = (await fixture.ownerPool.query<Readonly<{
    sessions: number;
    assets: number;
    attempts: number;
    reservations: number;
    blobs: number;
    lifecycles: number;
  }>>(
    `SELECT
       (SELECT count(*)::int FROM content.media_upload_sessions WHERE workspace_id = $1) AS sessions,
       (SELECT count(*)::int FROM content.media_assets WHERE workspace_id = $1) AS assets,
       (SELECT count(*)::int FROM content.media_blob_writer_attempts WHERE workspace_id = $1) AS attempts,
       (SELECT count(*)::int FROM content.media_blob_writer_reservations WHERE workspace_id = $1) AS reservations,
       (SELECT count(*)::int FROM content.media_blobs WHERE media_blob_id = ANY($2::uuid[])) AS blobs,
       (SELECT count(*)::int FROM content.media_blob_lifecycles WHERE sha256 = ANY($3::text[])) AS lifecycles`,
    [fixture.workspaceId, owned.blobIds, owned.sha256s],
  )).rows[0];
  assert.deepEqual(remaining, {
    sessions: 0,
    assets: 0,
    attempts: 0,
    reservations: 0,
    blobs: 0,
    lifecycles: 0,
  });
}

test(
  "multipart abort closes the stored writer and terminal replay uses durable parts",
  async () => {
    await withPostgresIntegrationFixture(async (fixture) => {
      try {
        const upgradeHistory = await apply0098UpgradeAndAssertSecurity(fixture);
        if (upgradeHistory !== null) {
          const originalReplay = await beginMultipart(
            fixture,
            randomUUID(),
            upgradeHistory.original,
            60_000,
          );
          assert.deepEqual(
            [originalReplay.attempt_status, originalReplay.reservation_token],
            ["live_applied", null],
          );
          const originalSnapshot = await mutationSnapshot(
            fixture,
            upgradeHistory.original,
          );
          const conflictingReplay = await beginMultipart(
            fixture,
            randomUUID(),
            upgradeHistory.conflicting,
            60_000,
          );
          assert.equal(conflictingReplay.attempt_status, "stale_attempt");
          assert.equal(
            await mutationSnapshot(fixture, upgradeHistory.original),
            originalSnapshot,
          );
        }

        const legacy = multipart(fixture, {});
        await insertSession(fixture.ownerPool, legacy, "aborting");
        assert.equal(await closeCurrentWriter(fixture, legacy), "no_writer_closed");
        assert.equal(await closeCurrentWriter(fixture, legacy), "already_closed");

        const live = multipart(fixture, {});
        await insertSession(fixture.ownerPool, live, "active");
        const liveAttempt = randomUUID();
        const liveBegin = await beginMultipart(fixture, liveAttempt, live, 60_000);
        assert.equal(liveBegin.attempt_status, "acquired");
        assert.ok(liveBegin.reservation_token !== null);
        const liveBefore = await mutationSnapshot(fixture, live);
        assert.equal(await closeCurrentWriter(fixture, live), "access_active");
        assert.equal(await mutationSnapshot(fixture, live), liveBefore);
        await fixture.ownerPool.query(
          `UPDATE content.media_upload_sessions
           SET state = 'aborting'
           WHERE media_upload_session_id = $1`,
          [live.sessionId],
        );
        assert.equal(await closeCurrentWriter(fixture, live), "aborted");
        assert.deepEqual(await writerState(fixture, live), {
          session_state: "aborted",
          attempt_state: "cancelled",
          attempt_outcome: "aborted",
          reservation_state: "unreferenced",
        });
        assert.equal(await closeCurrentWriter(fixture, live), "aborted");

        const crashed = multipart(fixture, {});
        await insertSession(fixture.ownerPool, crashed, "active");
        const crashedAttempt = randomUUID();
        const crashedBegin = await beginMultipart(
          fixture,
          crashedAttempt,
          crashed,
          60_000,
        );
        assert.equal(crashedBegin.attempt_status, "acquired");
        await fixture.ownerPool.query(
          `UPDATE content.media_blob_writer_attempts
           SET lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
           WHERE attempt_token = $1`,
          [crashedAttempt],
        );
        await fixture.ownerPool.query(
          `UPDATE content.media_upload_sessions
           SET state = 'aborting'
           WHERE media_upload_session_id = $1`,
          [crashed.sessionId],
        );
        assert.equal(await closeCurrentWriter(fixture, crashed), "aborted");

        const recoveredReference = multipart(fixture, {});
        await insertSession(
          fixture.ownerPool,
          recoveredReference,
          "active",
        );
        const recoveredReferenceAttempt = randomUUID();
        const recoveredReferenceBegin = await beginMultipart(
          fixture,
          recoveredReferenceAttempt,
          recoveredReference,
          60_000,
        );
        assert.equal(recoveredReferenceBegin.attempt_status, "acquired");
        assert.ok(recoveredReferenceBegin.reservation_token !== null);
        assert.ok(recoveredReferenceBegin.normalization_version !== null);
        const canonicalRecoveredReference = {
          ...recoveredReference,
          normalizationVersion:
            recoveredReferenceBegin.normalization_version,
        };
        assert.equal(
          await multipartStatus(
            fixture,
            "resolve_media_upload_session_completion_attempt_failure_with_owner",
            recoveredReferenceAttempt,
            recoveredReferenceBegin.reservation_token,
            canonicalRecoveredReference,
          ),
          "unreferenced_restored",
        );
        assert.deepEqual(await writerState(fixture, recoveredReference), {
          session_state: "active",
          attempt_state: "unreferenced",
          attempt_outcome: "unreferenced_restored",
          reservation_state: "unreferenced",
        });
        await insertAsset(fixture.ownerPool, canonicalRecoveredReference);
        await fixture.ownerPool.query(
          `UPDATE content.media_upload_sessions
           SET state = 'aborting'
           WHERE media_upload_session_id = $1`,
          [recoveredReference.sessionId],
        );
        assert.equal(
          await closeCurrentWriter(fixture, recoveredReference),
          "referenced",
        );
        assert.deepEqual(await writerState(fixture, recoveredReference), {
          session_state: "completed",
          attempt_state: "referenced",
          attempt_outcome: "referenced",
          reservation_state: "finalized",
        });

        const expiring = multipart(fixture, {
          sessionExpiresAt: new Date(Date.now() + 250).toISOString(),
        });
        await insertSession(fixture.ownerPool, expiring, "active");
        const expiringAttempt = randomUUID();
        const expiringBegin = await beginMultipart(
          fixture,
          expiringAttempt,
          expiring,
          100,
        );
        assert.equal(expiringBegin.attempt_status, "acquired");
        await fixture.ownerPool.query(
          `SELECT pg_sleep(
             GREATEST(
               0,
               EXTRACT(
                 EPOCH FROM ($1::timestamptz - pg_catalog.clock_timestamp())
               ) + 0.05
             )
           )`,
          [expiring.sessionExpiresAt],
        );
        assert.equal(await closeCurrentWriter(fixture, expiring), "aborted");

        const completed = multipart(fixture, {});
        await insertSession(fixture.ownerPool, completed, "active");
        const completedAttempt = randomUUID();
        const completedBegin = await beginMultipart(
          fixture,
          completedAttempt,
          completed,
          60_000,
        );
        assert.equal(completedBegin.attempt_status, "acquired");
        assert.ok(completedBegin.reservation_token !== null);
        assert.ok(completedBegin.normalization_version !== null);
        const canonicalCompleted = {
          ...completed,
          normalizationVersion: completedBegin.normalization_version,
        };
        assert.equal(
          await multipartStatus(
            fixture,
            "fence_media_upload_session_completion_attempt_apply_with_owner",
            completedAttempt,
            completedBegin.reservation_token,
            canonicalCompleted,
          ),
          "ready",
        );
        await insertAsset(fixture.ownerPool, canonicalCompleted);
        assert.equal(
          await multipartStatus(
            fixture,
            "finish_media_upload_session_completion_attempt_apply_with_owner",
            completedAttempt,
            completedBegin.reservation_token,
            canonicalCompleted,
          ),
          "live_applied",
        );
        await fixture.ownerPool.query(
          `UPDATE content.media_assets
           SET
             source_url = $1,
             client_updated_at = client_updated_at + interval '1 minute',
             last_operation_id = $2
           WHERE media_asset_id = $3`,
          [
            "https://example.invalid/later-edit",
            randomUUID(),
            completed.mediaAssetId,
          ],
        );
        const completedBefore = await mutationSnapshot(fixture, completed);
        const freshReplay = await beginMultipart(
          fixture,
          randomUUID(),
          {
            ...completed,
            lastOperationId: randomUUID(),
            sourceUrl: "https://example.invalid/retry-metadata",
            assetCreatedAt: new Date(Date.now() - 60_000).toISOString(),
            clientUpdatedAt: new Date(Date.now() + 60_000).toISOString(),
          },
          60_000,
        );
        assert.deepEqual(
          [freshReplay.attempt_status, freshReplay.reservation_token],
          ["live_applied", null],
        );
        assert.equal(await mutationSnapshot(fixture, completed), completedBefore);

        const fingerprintBefore = await mutationSnapshot(fixture, completed);
        const mismatchedFingerprint = await beginMultipart(
          fixture,
          randomUUID(),
          { ...completed, partsFingerprint: digest() },
          60_000,
        );
        assert.equal(mismatchedFingerprint.attempt_status, "stale_attempt");
        assert.equal(
          await mutationSnapshot(fixture, completed),
          fingerprintBefore,
        );

        const identityBefore = await mutationSnapshot(fixture, completed);
        const mismatchedIdentity = await beginMultipart(
          fixture,
          randomUUID(),
          { ...completed, sizeBytes: completed.sizeBytes + 1 },
          60_000,
        );
        assert.equal(mismatchedIdentity.attempt_status, "stale");
        assert.equal(await mutationSnapshot(fixture, completed), identityBefore);

        const deniedBefore = await mutationSnapshot(fixture, completed);
        const denied = await scoped(
          fixture,
          `non-owner-${randomUUID()}`,
          fixture.workspaceId,
          async (client) => closeCurrentWriterInExecutor(client, completed),
        );
        assert.equal(denied, "access_denied");
        assert.equal(await mutationSnapshot(fixture, completed), deniedBefore);
        assert.equal(await closeCurrentWriter(fixture, completed), "live_applied");
        assert.deepEqual(await writerState(fixture, completed), {
          session_state: "completed",
          attempt_state: "applied",
          attempt_outcome: "live_applied",
          reservation_state: "finalized",
        });

        const referenced = multipart(fixture, {});
        await insertSession(fixture.ownerPool, referenced, "active");
        const referencedAttempt = randomUUID();
        const referencedBegin = await beginMultipart(
          fixture,
          referencedAttempt,
          referenced,
          60_000,
        );
        assert.equal(referencedBegin.attempt_status, "acquired");
        assert.ok(referencedBegin.reservation_token !== null);
        assert.ok(referencedBegin.normalization_version !== null);
        const canonicalReferenced = {
          ...referenced,
          normalizationVersion: referencedBegin.normalization_version,
        };
        await insertAsset(fixture.ownerPool, canonicalReferenced);
        assert.equal(
          await multipartStatus(
            fixture,
            "resolve_media_upload_session_completion_attempt_failure_with_owner",
            referencedAttempt,
            referencedBegin.reservation_token,
            canonicalReferenced,
          ),
          "referenced",
        );
        assert.equal(await closeCurrentWriter(fixture, referenced), "referenced");
        assert.deepEqual(await writerState(fixture, referenced), {
          session_state: "completed",
          attempt_state: "referenced",
          attempt_outcome: "referenced",
          reservation_state: "finalized",
        });

        const race = multipart(fixture, {});
        await insertSession(fixture.ownerPool, race, "active");
        const raceAttempt = randomUUID();
        const raceBegin = await beginMultipart(
          fixture,
          raceAttempt,
          race,
          60_000,
        );
        assert.equal(raceBegin.attempt_status, "acquired");
        assert.ok(raceBegin.reservation_token !== null);
        assert.ok(raceBegin.normalization_version !== null);
        const canonicalRace = {
          ...race,
          normalizationVersion: raceBegin.normalization_version,
        };
        const completing = await fixture.runtimePool.connect();
        const aborting = await fixture.runtimePool.connect();
        try {
          for (const client of [completing, aborting]) {
            await client.query("BEGIN");
            await client.query(
              "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
              [fixture.userId, fixture.workspaceId],
            );
            await client.query(
              "SET LOCAL statement_timeout = '4s'; SET LOCAL lock_timeout = '4s'",
            );
          }
          const fence = (await completing.query<StatusRow>(
            `SELECT content.fence_media_upload_session_completion_attempt_apply_with_owner(
               $1,$2,${multipartRow},$23
             ) AS status`,
            [
              raceAttempt,
              raceBegin.reservation_token,
              ...multipartValues(canonicalRace),
              cleanupDelayMs,
            ],
          )).rows[0].status;
          assert.equal(fence, "ready");
          await insertAsset(completing, canonicalRace);

          const abortProcessId = (await aborting.query<Readonly<{ pid: number }>>(
            "SELECT pg_backend_pid() AS pid",
          )).rows[0].pid;
          const pendingAbort = aborting.query(
            `UPDATE content.media_upload_sessions
             SET state = 'aborting', completed_at = NULL, aborted_at = NULL
             WHERE media_upload_session_id = $1
               AND state IN ('active', 'completing')`,
            [race.sessionId],
          ).then(async () => closeCurrentWriterInExecutor(aborting, race));
          await waitForLock(fixture, abortProcessId);

          const finish = (await completing.query<StatusRow>(
            `SELECT content.finish_media_upload_session_completion_attempt_apply_with_owner(
               $1,$2,${multipartRow},$23
             ) AS status`,
            [
              raceAttempt,
              raceBegin.reservation_token,
              ...multipartValues(canonicalRace),
              cleanupDelayMs,
            ],
          )).rows[0].status;
          assert.equal(finish, "live_applied");
          await completing.query("COMMIT");
          assert.equal(await pendingAbort, "live_applied");
          await aborting.query("COMMIT");
        } finally {
          await Promise.allSettled([
            completing.query("ROLLBACK"),
            aborting.query("ROLLBACK"),
          ]);
          completing.release();
          aborting.release();
        }
        assert.deepEqual(await writerState(fixture, race), {
          session_state: "completed",
          attempt_state: "applied",
          attempt_outcome: "live_applied",
          reservation_state: "finalized",
        });
      } finally {
        await removeOwnedMedia(fixture);
      }
    });
  },
);

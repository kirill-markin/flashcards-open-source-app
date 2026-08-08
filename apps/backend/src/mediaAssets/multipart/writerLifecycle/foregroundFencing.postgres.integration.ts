import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import type pg from "pg";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../../../testSupport/postgresIntegration";
import { buildMediaBlobStorageKey } from "../../storageKeys";

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
type PidRow = Readonly<{ pid: number }>;
type ClaimedRow = Readonly<{
  attempt_token: string;
  reconciliation_lease_token: string;
}>;
type BoundaryState = Readonly<{
  session_state: string;
  session_last_operation_id: string;
  attempt_state: string;
  attempt_outcome: string | null;
  lease_expires_at: Date;
  terminal_at: Date | null;
  reconciliation_state: string | null;
  reconciliation_lease_token: string | null;
  reconciliation_handed_off_at: Date | null;
  reservation_state: string;
}>;
type QueryExecutor = Pick<pg.Pool | pg.PoolClient, "query">;
type SqlValue = string | number | null;

const multipartRow = `ROW(
  $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
)::content.multipart_media_blob_writer_attempt_payload`;
const abortSignature =
  "content.begin_media_upload_session_abort_with_owner(text,uuid,uuid,uuid)";
const revokedHandoffSignature =
  "content.handoff_media_upload_session_completion_attempt_after_access_revocation(uuid,uuid,content.multipart_media_blob_writer_attempt_payload)";

function digest(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function createPayload(
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
): MultipartPayload {
  const sessionId = randomUUID();
  const sha256 = digest();
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
  };
}

function payloadValues(payload: MultipartPayload): ReadonlyArray<SqlValue> {
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

async function beginScopedTransaction(
  client: pg.PoolClient,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await client.query("BEGIN");
  await client.query(
    `SELECT
       set_config('app.user_id',$1,true),
       set_config('app.workspace_id',$2,true)`,
    [userId, workspaceId],
  );
}

async function scoped<Result>(
  fixture: PostgresIntegrationFixture,
  callback: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await fixture.runtimePool.connect();
  try {
    await beginScopedTransaction(
      client,
      fixture.userId,
      fixture.workspaceId,
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
): Promise<void> {
  await executor.query(
    `INSERT INTO content.media_upload_sessions (
       media_upload_session_id,workspace_id,media_asset_id,media_blob_sha256,
       staging_storage_key,blob_storage_key,s3_upload_id,mime_type,size_bytes,
       part_size_bytes,part_count,state,source_url,asset_created_at,
       client_updated_at,last_modified_by_replica_id,last_operation_id,
       expires_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$13,$14,$15,$16,$17
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
      payload.sourceUrl,
      payload.assetCreatedAt,
      payload.clientUpdatedAt,
      payload.replicaId,
      payload.lastOperationId,
      payload.sessionExpiresAt,
    ],
  );
}

async function insertExactReference(
  executor: QueryExecutor,
  payload: MultipartPayload,
): Promise<void> {
  await executor.query(
    `WITH blob AS (
       INSERT INTO content.media_blobs (
         media_blob_id,sha256,mime_type,size_bytes,storage_key,
         normalization_version
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
      randomUUID(),
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
}

async function beginAttempt(
  executor: QueryExecutor,
  attemptToken: string,
  payload: MultipartPayload,
): Promise<BeginRow> {
  return (await executor.query<BeginRow>(
    `SELECT *
     FROM content.begin_media_upload_session_completion_attempt_with_owner(
       $1,$2,${multipartRow}
     )`,
    [attemptToken, 60_000, ...payloadValues(payload)],
  )).rows[0];
}

async function createAttempt(
  fixture: PostgresIntegrationFixture,
  payload: MultipartPayload,
): Promise<Readonly<{
  attemptToken: string;
  reservationToken: string;
}>> {
  await insertSession(fixture.ownerPool, payload);
  const attemptToken = randomUUID();
  const begun = await scoped(
    fixture,
    (client) => beginAttempt(client, attemptToken, payload),
  );
  assert.equal(begun.attempt_status, "acquired");
  assert.notEqual(begun.reservation_token, null);
  assert.equal(begun.normalization_version, payload.normalizationVersion);
  return {
    attemptToken,
    reservationToken: begun.reservation_token as string,
  };
}

async function beginAbort(
  executor: QueryExecutor,
  fixture: PostgresIntegrationFixture,
  payload: MultipartPayload,
): Promise<string> {
  return beginAbortForUser(executor, fixture.userId, payload);
}

async function beginAbortForUser(
  executor: QueryExecutor,
  userId: string,
  payload: MultipartPayload,
): Promise<string> {
  return (await executor.query<StatusRow>(
    `SELECT content.begin_media_upload_session_abort_with_owner(
       $1,$2,$3,$4
     ) AS status`,
    [
      userId,
      payload.workspaceId,
      payload.sessionId,
      payload.mediaAssetId,
    ],
  )).rows[0].status;
}

async function handoffWithOwner(
  executor: QueryExecutor,
  attemptToken: string,
  reservationToken: string,
  payload: MultipartPayload,
): Promise<string> {
  return (await executor.query<StatusRow>(
    `SELECT content.handoff_media_upload_session_completion_attempt(
       $1,$2,${multipartRow}
     ) AS status`,
    [attemptToken, reservationToken, ...payloadValues(payload)],
  )).rows[0].status;
}

async function handoffAfterAccessRevocation(
  executor: QueryExecutor,
  attemptToken: string,
  reservationToken: string,
  payload: MultipartPayload,
): Promise<string> {
  return (await executor.query<StatusRow>(
    `SELECT
       content.handoff_media_upload_session_completion_attempt_after_access_revocation(
         $1,$2,${multipartRow}
       ) AS status`,
    [attemptToken, reservationToken, ...payloadValues(payload)],
  )).rows[0].status;
}

async function claimAttempt(
  fixture: PostgresIntegrationFixture,
  attemptToken: string,
): Promise<ClaimedRow> {
  const claimed = (await fixture.runtimePool.query<ClaimedRow>(
    `SELECT attempt_token,reconciliation_lease_token
     FROM content.claim_media_upload_session_completion_reconciliations(
       $1,$2,$3
     )`,
    [`migration-0101-${randomUUID()}`, 60_000, 100],
  )).rows.find((row) => row.attempt_token === attemptToken);
  assert.notEqual(claimed, undefined);
  return claimed as ClaimedRow;
}

async function applyReconciliationScope(
  executor: QueryExecutor,
  claimed: ClaimedRow,
): Promise<string> {
  return (await executor.query<StatusRow>(
    `SELECT
       content.apply_media_upload_session_completion_reconciliation_scope(
         $1,$2
       ) AS status`,
    [claimed.attempt_token, claimed.reconciliation_lease_token],
  )).rows[0].status;
}

async function finishReconciliation(
  executor: QueryExecutor,
  claimed: ClaimedRow,
): Promise<string> {
  return (await executor.query<StatusRow>(
    `SELECT content.finish_media_upload_session_completion_reconciliation(
       $1,$2,$3
     ) AS status`,
    [claimed.attempt_token, claimed.reconciliation_lease_token, 3_600_000],
  )).rows[0].status;
}

async function failReconciliation(
  executor: QueryExecutor,
  claimed: ClaimedRow,
): Promise<string> {
  return (await executor.query<StatusRow>(
    `SELECT content.fail_media_upload_session_completion_reconciliation(
       $1,$2,$3,$4,$5
     ) AS status`,
    [
      claimed.attempt_token,
      claimed.reconciliation_lease_token,
      "TEST_FAILURE",
      "Deterministic migration 0101 reconciliation failure.",
      3_600_000,
    ],
  )).rows[0].status;
}

async function readBoundaryState(
  fixture: PostgresIntegrationFixture,
  attemptToken: string,
): Promise<BoundaryState> {
  return (await fixture.ownerPool.query<BoundaryState>(
    `SELECT
       sessions.state AS session_state,
       sessions.last_operation_id AS session_last_operation_id,
       attempts.state AS attempt_state,
       attempts.outcome AS attempt_outcome,
       attempts.lease_expires_at,
       attempts.terminal_at,
       attempts.reconciliation_state,
       attempts.reconciliation_lease_token,
       attempts.reconciliation_handed_off_at,
       reservations.state AS reservation_state
     FROM content.media_blob_writer_attempts AS attempts
     INNER JOIN content.media_upload_sessions AS sessions
       ON sessions.media_upload_session_id=attempts.media_upload_session_id
     INNER JOIN content.media_blob_writer_reservations AS reservations
       ON reservations.reservation_token=attempts.reservation_token
     WHERE attempts.attempt_token=$1`,
    [attemptToken],
  )).rows[0];
}

async function changeCurrentAccess(
  fixture: PostgresIntegrationFixture,
  otherUserId: string,
  accessPresent: boolean,
): Promise<void> {
  const client = await fixture.ownerPool.connect();
  try {
    await client.query("BEGIN");
    if (accessPresent) {
      await client.query(
        "UPDATE sync.workspace_replicas SET user_id=$1 WHERE replica_id=$2",
        [fixture.userId, fixture.replicaId],
      );
      await client.query(
        `INSERT INTO org.workspace_memberships (workspace_id,user_id,role)
         VALUES ($1,$2,'owner')`,
        [fixture.workspaceId, fixture.userId],
      );
      await client.query(
        "DELETE FROM org.user_settings WHERE user_id=$1",
        [otherUserId],
      );
    } else {
      await client.query(
        "INSERT INTO org.user_settings (user_id) VALUES ($1)",
        [otherUserId],
      );
      await client.query(
        "UPDATE sync.workspace_replicas SET user_id=$1 WHERE replica_id=$2",
        [otherUserId, fixture.replicaId],
      );
      await client.query(
        `DELETE FROM org.workspace_memberships
         WHERE workspace_id=$1 AND user_id=$2`,
        [fixture.workspaceId, fixture.userId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function backendPid(client: pg.PoolClient): Promise<number> {
  return (await client.query<PidRow>(
    "SELECT pg_catalog.pg_backend_pid() AS pid",
  )).rows[0].pid;
}

async function waitUntilBlockedBy(
  observer: QueryExecutor,
  waitingPid: number,
  blockingPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const blocked = (await observer.query<Readonly<{ blocked: boolean }>>(
      `SELECT $2::INTEGER = ANY(
         pg_catalog.pg_blocking_pids($1::INTEGER)
       ) AS blocked`,
      [waitingPid, blockingPid],
    )).rows[0]?.blocked;
    if (blocked === true) return;
    await delay(10);
  }
  throw new Error(
    `PostgreSQL transaction did not reach the expected lock wait. waitingPid=${waitingPid} blockingPid=${blockingPid}`,
  );
}

async function waitUntilAdvisoryBlockedBy(
  observer: QueryExecutor,
  waitingPid: number,
  blockingPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const blocked = (await observer.query<Readonly<{ blocked: boolean }>>(
      `SELECT
         activity.wait_event = 'advisory'
         AND $2::INTEGER = ANY(
           pg_catalog.pg_blocking_pids($1::INTEGER)
         ) AS blocked
       FROM pg_catalog.pg_stat_activity AS activity
       WHERE activity.pid=$1`,
      [waitingPid, blockingPid],
    )).rows[0]?.blocked;
    if (blocked === true) return;
    await delay(10);
  }
  throw new Error(
    `PostgreSQL transaction did not wait on the canonical advisory fence. waitingPid=${waitingPid} blockingPid=${blockingPid}`,
  );
}

async function lockMediaAsset(
  client: pg.PoolClient,
  payload: MultipartPayload,
): Promise<void> {
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtextextended(
         'multipart-asset:' || $1::TEXT || ':' || $2::TEXT,
         4::BIGINT
       )
     )`,
    [payload.workspaceId, payload.mediaAssetId],
  );
}

async function insertWorkspaceMember(
  fixture: PostgresIntegrationFixture,
  userId: string,
): Promise<void> {
  await fixture.ownerPool.query(
    "INSERT INTO org.user_settings (user_id) VALUES ($1)",
    [userId],
  );
  await fixture.ownerPool.query(
    `INSERT INTO org.workspace_memberships (workspace_id,user_id,role)
     VALUES ($1,$2,'member')`,
    [fixture.workspaceId, userId],
  );
}

async function releaseClients(
  clients: ReadonlyArray<pg.PoolClient>,
  testError: Error | null,
): Promise<void> {
  const rollbackResults = await Promise.allSettled(
    clients.map((client) => client.query("ROLLBACK")),
  );
  for (const client of clients) client.release();
  const rollbackErrors = rollbackResults.flatMap((result) => (
    result.status === "rejected" ? [result.reason as unknown] : []
  ));
  if (rollbackErrors.length > 0) {
    throw new AggregateError(
      testError === null
        ? rollbackErrors
        : [testError, ...rollbackErrors],
      "PostgreSQL race transaction cleanup failed.",
    );
  }
}

test("migration 0101 exposes only the two hardened backend boundaries", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const contract = (await fixture.ownerPool.query<Readonly<{
      major: number;
      migrations: number;
      latest: string;
      abort_backend: boolean;
      handoff_backend: boolean;
      public_execute: boolean;
      abort_auth: boolean;
      handoff_reporting: boolean;
      direct_attempt_table: boolean;
      abort_result: string;
      handoff_result: string;
      hardened: boolean;
    }>>(
      `SELECT
         current_setting('server_version_num')::INTEGER / 10000 AS major,
         count(*)::INTEGER AS migrations,
         max(filename) AS latest,
         has_function_privilege('backend_app',$1,'EXECUTE') AS abort_backend,
         has_function_privilege('backend_app',$2,'EXECUTE') AS handoff_backend,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_proc AS functions
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(
               functions.proacl,
               pg_catalog.acldefault('f',functions.proowner)
             )
           ) AS privileges
           WHERE functions.oid = ANY(
             ARRAY[$1::regprocedure,$2::regprocedure]
           )
             AND privileges.grantee = 0
             AND privileges.privilege_type = 'EXECUTE'
         ) AS public_execute,
         has_function_privilege('auth_app',$1,'EXECUTE') AS abort_auth,
         has_function_privilege(
           'reporting_readonly',$2,'EXECUTE'
         ) AS handoff_reporting,
         has_table_privilege(
           'backend_app',
           'content.media_blob_writer_attempts',
           'SELECT,INSERT,UPDATE,DELETE'
         ) AS direct_attempt_table,
         pg_catalog.pg_get_function_result($1::regprocedure) AS abort_result,
         pg_catalog.pg_get_function_result($2::regprocedure) AS handoff_result,
         (
           SELECT pg_catalog.bool_and(
             functions.prosecdef
             AND functions.proconfig = ARRAY['search_path=pg_catalog']
           )
           FROM pg_catalog.pg_proc AS functions
           WHERE functions.oid = ANY(
             ARRAY[$1::regprocedure,$2::regprocedure]
           )
         ) AS hardened
       FROM public.schema_migrations`,
      [abortSignature, revokedHandoffSignature],
    )).rows[0];
    assert.deepEqual(contract, {
      major: 18,
      migrations: 103,
      latest: "0101_multipart_foreground_completion_fencing.sql",
      abort_backend: true,
      handoff_backend: true,
      public_execute: false,
      abort_auth: false,
      handoff_reporting: false,
      direct_attempt_table: false,
      abort_result: "text",
      handoff_result: "text",
      hardened: true,
    });
  });
});

test("migration 0101 admits abort only after foreground completion is fenced", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const active = createPayload(fixture, randomUUID());
    await insertSession(fixture.ownerPool, active);
    assert.equal(
      await scoped(fixture, (client) => beginAbort(client, fixture, active)),
      "abort_required",
    );
    assert.equal(
      await scoped(fixture, (client) => beginAbort(client, fixture, active)),
      "abort_required",
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET state='aborted',aborted_at=pg_catalog.clock_timestamp()
       WHERE media_upload_session_id=$1`,
      [active.sessionId],
    );
    assert.equal(
      await scoped(fixture, (client) => beginAbort(client, fixture, active)),
      "already_aborted",
    );

    const missing = createPayload(fixture, randomUUID());
    assert.equal(
      await scoped(fixture, (client) => beginAbort(client, fixture, missing)),
      "not_found",
    );
    const stale = createPayload(fixture, randomUUID());
    await insertSession(fixture.ownerPool, stale);
    assert.equal(
      await scoped(
        fixture,
        (client) => beginAbort(
          client,
          fixture,
          { ...stale, mediaAssetId: randomUUID() },
        ),
      ),
      "stale",
    );
    assert.equal(
      (await fixture.ownerPool.query<StatusRow>(
        `SELECT state AS status
         FROM content.media_upload_sessions
         WHERE media_upload_session_id=$1`,
        [stale.sessionId],
      )).rows[0].status,
      "active",
    );
    const deniedClient = await fixture.runtimePool.connect();
    try {
      await beginScopedTransaction(
        deniedClient,
        fixture.userId,
        fixture.outOfScopeWorkspaceId,
      );
      assert.equal(
        await beginAbort(deniedClient, fixture, stale),
        "access_denied",
      );
      await deniedClient.query("COMMIT");
    } finally {
      await deniedClient.query("ROLLBACK");
      deniedClient.release();
    }

    const live = createPayload(fixture, randomUUID());
    const liveAttempt = await createAttempt(fixture, live);
    const liveBefore = await readBoundaryState(
      fixture,
      liveAttempt.attemptToken,
    );
    assert.equal(
      await scoped(fixture, (client) => beginAbort(client, fixture, live)),
      "completion_in_progress",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, liveAttempt.attemptToken),
      liveBefore,
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET state='aborting'
       WHERE media_upload_session_id=$1`,
      [live.sessionId],
    );
    const abortingLiveBefore = await readBoundaryState(
      fixture,
      liveAttempt.attemptToken,
    );
    assert.equal(
      await scoped(fixture, (client) => beginAbort(client, fixture, live)),
      "completion_in_progress",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, liveAttempt.attemptToken),
      abortingLiveBefore,
    );

    const expired = createPayload(fixture, randomUUID());
    const expiredAttempt = await createAttempt(fixture, expired);
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET lease_expires_at=pg_catalog.clock_timestamp() - interval '1 second'
       WHERE attempt_token=$1`,
      [expiredAttempt.attemptToken],
    );
    assert.equal(
      await scoped(fixture, (client) => beginAbort(client, fixture, expired)),
      "abort_required",
    );
    const expiredAfter = await readBoundaryState(
      fixture,
      expiredAttempt.attemptToken,
    );
    assert.equal(expiredAfter.session_state, "aborting");
    assert.equal(expiredAfter.attempt_state, "expired");
    assert.equal(expiredAfter.attempt_outcome, "stale_attempt");
    assert.notEqual(expiredAfter.terminal_at, null);
    assert.equal(expiredAfter.reconciliation_state, null);

    const abortingExpired = createPayload(fixture, randomUUID());
    const abortingExpiredAttempt = await createAttempt(
      fixture,
      abortingExpired,
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET lease_expires_at=pg_catalog.clock_timestamp() - interval '1 second'
       WHERE attempt_token=$1`,
      [abortingExpiredAttempt.attemptToken],
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET state='aborting'
       WHERE media_upload_session_id=$1`,
      [abortingExpired.sessionId],
    );
    assert.equal(
      await scoped(
        fixture,
        (client) => beginAbort(client, fixture, abortingExpired),
      ),
      "abort_required",
    );
    const abortingExpiredAfter = await readBoundaryState(
      fixture,
      abortingExpiredAttempt.attemptToken,
    );
    assert.equal(abortingExpiredAfter.session_state, "aborting");
    assert.equal(abortingExpiredAfter.attempt_state, "expired");
    assert.equal(abortingExpiredAfter.attempt_outcome, "stale_attempt");
    assert.notEqual(abortingExpiredAfter.terminal_at, null);
    assert.equal(abortingExpiredAfter.reconciliation_state, null);

    const pending = createPayload(fixture, randomUUID());
    const pendingAttempt = await createAttempt(fixture, pending);
    assert.equal(
      await scoped(
        fixture,
        (client) => handoffWithOwner(
          client,
          pendingAttempt.attemptToken,
          pendingAttempt.reservationToken,
          pending,
        ),
      ),
      "handed_off",
    );
    const pendingBefore = await readBoundaryState(
      fixture,
      pendingAttempt.attemptToken,
    );
    assert.equal(
      await scoped(fixture, (client) => beginAbort(client, fixture, pending)),
      "completion_pending",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, pendingAttempt.attemptToken),
      pendingBefore,
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET state='aborting'
       WHERE media_upload_session_id=$1`,
      [pending.sessionId],
    );
    const abortingPendingBefore = await readBoundaryState(
      fixture,
      pendingAttempt.attemptToken,
    );
    assert.equal(
      await scoped(fixture, (client) => beginAbort(client, fixture, pending)),
      "completion_pending",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, pendingAttempt.attemptToken),
      abortingPendingBefore,
    );

    const claimed = (await fixture.runtimePool.query<ClaimedRow>(
      `SELECT attempt_token,reconciliation_lease_token
       FROM content.claim_media_upload_session_completion_reconciliations(
         $1,$2,$3
       )`,
      [`migration-0101-${randomUUID()}`, 60_000, 1],
    )).rows[0];
    assert.equal(claimed.attempt_token, pendingAttempt.attemptToken);
    const leasedBefore = await readBoundaryState(
      fixture,
      pendingAttempt.attemptToken,
    );
    assert.equal(leasedBefore.reconciliation_state, "leased");
    assert.equal(
      await scoped(fixture, (client) => beginAbort(client, fixture, pending)),
      "completion_pending",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, pendingAttempt.attemptToken),
      leasedBefore,
    );
  });
});

test("migration 0101 service handoff uses exact durable ownership after access loss", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const payload = createPayload(fixture, randomUUID());
    const attempt = await createAttempt(fixture, payload);
    const initialState = await readBoundaryState(fixture, attempt.attemptToken);

    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        attempt.attemptToken,
        randomUUID(),
        payload,
      ),
      "writer_conflict",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, attempt.attemptToken),
      initialState,
    );
    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        attempt.attemptToken,
        attempt.reservationToken,
        { ...payload, partsFingerprint: digest() },
      ),
      "stale_attempt",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, attempt.attemptToken),
      initialState,
    );
    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        attempt.attemptToken,
        attempt.reservationToken,
        { ...payload, replicaId: randomUUID() },
      ),
      "ownership_mismatch",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, attempt.attemptToken),
      initialState,
    );
    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        attempt.attemptToken,
        attempt.reservationToken,
        { ...payload, userId: `wrong-${randomUUID()}` },
      ),
      "ownership_mismatch",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, attempt.attemptToken),
      initialState,
    );

    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_owner_snapshots
       SET session_last_operation_id=$1
       WHERE reservation_token=$2`,
      [randomUUID(), attempt.reservationToken],
    );
    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        attempt.attemptToken,
        attempt.reservationToken,
        payload,
      ),
      "ownership_mismatch",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, attempt.attemptToken),
      initialState,
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_owner_snapshots
       SET session_last_operation_id=$1
       WHERE reservation_token=$2`,
      [payload.lastOperationId, attempt.reservationToken],
    );

    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET last_operation_id=$1
       WHERE media_upload_session_id=$2`,
      [randomUUID(), payload.sessionId],
    );
    const sessionMismatchBefore = await readBoundaryState(
      fixture,
      attempt.attemptToken,
    );
    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        attempt.attemptToken,
        attempt.reservationToken,
        payload,
      ),
      "stale_attempt",
    );
    assert.deepEqual(
      await readBoundaryState(fixture, attempt.attemptToken),
      sessionMismatchBefore,
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET last_operation_id=$1
       WHERE media_upload_session_id=$2`,
      [payload.lastOperationId, payload.sessionId],
    );
    assert.deepEqual(
      await readBoundaryState(fixture, attempt.attemptToken),
      initialState,
    );

    const otherUserId = `migration-0101-revoked-${randomUUID()}`;
    await changeCurrentAccess(fixture, otherUserId, false);
    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        attempt.attemptToken,
        attempt.reservationToken,
        payload,
      ),
      "handed_off",
    );
    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        attempt.attemptToken,
        attempt.reservationToken,
        payload,
      ),
      "already_pending",
    );
    await changeCurrentAccess(fixture, otherUserId, true);

    const duplicatePayload = createPayload(fixture, randomUUID());
    const duplicateAttempt = await createAttempt(fixture, duplicatePayload);
    const duplicateResults = await Promise.all([
      handoffAfterAccessRevocation(
        fixture.runtimePool,
        duplicateAttempt.attemptToken,
        duplicateAttempt.reservationToken,
        duplicatePayload,
      ),
      handoffAfterAccessRevocation(
        fixture.runtimePool,
        duplicateAttempt.attemptToken,
        duplicateAttempt.reservationToken,
        duplicatePayload,
      ),
    ]);
    assert.deepEqual(
      duplicateResults.sort(),
      ["already_pending", "handed_off"],
    );
    const claimedAttempts = (await fixture.runtimePool.query<ClaimedRow>(
      `SELECT attempt_token,reconciliation_lease_token
       FROM content.claim_media_upload_session_completion_reconciliations(
         $1,$2,$3
       )`,
      [`migration-0101-terminal-${randomUUID()}`, 60_000, 100],
    )).rows;
    const claimedDuplicate = claimedAttempts.find(
      (claimed) => claimed.attempt_token === duplicateAttempt.attemptToken,
    );
    assert.notEqual(claimedDuplicate, undefined);
    assert.equal(
      (await fixture.runtimePool.query<StatusRow>(
        `SELECT
           content.fail_media_upload_session_completion_reconciliation(
             $1,$2,$3,$4,$5
           ) AS status`,
        [
          duplicateAttempt.attemptToken,
          (claimedDuplicate as ClaimedRow).reconciliation_lease_token,
          "TEST_FAILURE",
          "Deterministic migration 0101 terminal replay failure.",
          3_600_000,
        ],
      )).rows[0].status,
      "failed",
    );
    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        duplicateAttempt.attemptToken,
        duplicateAttempt.reservationToken,
        duplicatePayload,
      ),
      "failed",
    );

    const terminalPayload = createPayload(fixture, randomUUID());
    await insertSession(fixture.ownerPool, terminalPayload);
    await insertExactReference(fixture.ownerPool, terminalPayload);
    const terminalAttemptToken = randomUUID();
    const terminal = await scoped(
      fixture,
      (client) => beginAttempt(
        client,
        terminalAttemptToken,
        terminalPayload,
      ),
    );
    assert.equal(terminal.attempt_status, "already_applied");
    const terminalReservation = (await fixture.ownerPool.query<Readonly<{
      reservation_token: string;
    }>>(
      `SELECT reservation_token
       FROM content.media_blob_writer_attempts
       WHERE attempt_token=$1`,
      [terminalAttemptToken],
    )).rows[0].reservation_token;
    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        terminalAttemptToken,
        terminalReservation,
        terminalPayload,
      ),
      "already_applied",
    );
  });
});

test("migration 0101 derives revoked handoff fences from durable identity", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const payload = createPayload(fixture, randomUUID());
    const attempt = await createAttempt(fixture, payload);
    assert.equal(
      await scoped(
        fixture,
        (client) => handoffWithOwner(
          client,
          attempt.attemptToken,
          attempt.reservationToken,
          payload,
        ),
      ),
      "handed_off",
    );
    const claimed = await claimAttempt(fixture, attempt.attemptToken);
    const initialState = await readBoundaryState(
      fixture,
      attempt.attemptToken,
    );

    const mismatchedWorkspaceId = randomUUID();
    const workspaceMismatch = {
      ...payload,
      workspaceId: mismatchedWorkspaceId,
      stagingStorageKey:
        `media/uploads/workspaces/${mismatchedWorkspaceId}/assets/${payload.mediaAssetId}/sessions/${payload.sessionId}`,
    };
    const scopeClient = await fixture.runtimePool.connect();
    const workspaceHandoffClient = await fixture.runtimePool.connect();
    const workspaceClients = [scopeClient, workspaceHandoffClient];
    let workspaceError: Error | null = null;
    try {
      await scopeClient.query("BEGIN");
      assert.equal(
        await applyReconciliationScope(scopeClient, claimed),
        "scoped",
      );
      await workspaceHandoffClient.query("BEGIN");
      const scopePid = await backendPid(scopeClient);
      const handoffPid = await backendPid(workspaceHandoffClient);
      const handoffPromise = handoffAfterAccessRevocation(
        workspaceHandoffClient,
        attempt.attemptToken,
        attempt.reservationToken,
        workspaceMismatch,
      );
      await waitUntilAdvisoryBlockedBy(
        fixture.ownerPool,
        handoffPid,
        scopePid,
      );
      await scopeClient.query("ROLLBACK");
      assert.equal(await handoffPromise, "stale_attempt");
      await workspaceHandoffClient.query("COMMIT");
    } catch (error) {
      workspaceError =
        error instanceof Error ? error : new Error(String(error));
      throw workspaceError;
    } finally {
      await releaseClients(workspaceClients, workspaceError);
    }
    assert.deepEqual(
      await readBoundaryState(fixture, attempt.attemptToken),
      initialState,
    );

    await insertExactReference(fixture.ownerPool, payload);
    const mismatchedMediaAssetId = randomUUID();
    const assetMismatch = {
      ...payload,
      mediaAssetId: mismatchedMediaAssetId,
      stagingStorageKey:
        `media/uploads/workspaces/${payload.workspaceId}/assets/${mismatchedMediaAssetId}/sessions/${payload.sessionId}`,
    };
    const finishClient = await fixture.runtimePool.connect();
    const assetHandoffClient = await fixture.runtimePool.connect();
    const assetClients = [finishClient, assetHandoffClient];
    let assetError: Error | null = null;
    try {
      await beginScopedTransaction(
        finishClient,
        fixture.userId,
        fixture.workspaceId,
      );
      assert.equal(
        await finishReconciliation(finishClient, claimed),
        "applied",
      );
      await assetHandoffClient.query("BEGIN");
      const finishPid = await backendPid(finishClient);
      const handoffPid = await backendPid(assetHandoffClient);
      const handoffPromise = handoffAfterAccessRevocation(
        assetHandoffClient,
        attempt.attemptToken,
        attempt.reservationToken,
        assetMismatch,
      );
      await waitUntilAdvisoryBlockedBy(
        fixture.ownerPool,
        handoffPid,
        finishPid,
      );
      await finishClient.query("ROLLBACK");
      assert.equal(await handoffPromise, "stale_attempt");
      await assetHandoffClient.query("COMMIT");
    } catch (error) {
      assetError = error instanceof Error ? error : new Error(String(error));
      throw assetError;
    } finally {
      await releaseClients(assetClients, assetError);
    }
    assert.deepEqual(
      await readBoundaryState(fixture, attempt.attemptToken),
      initialState,
    );
  });
});

test("migration 0101 serializes abort, heartbeat, handoff, and access removal", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const heartbeatPayload = createPayload(fixture, randomUUID());
    const heartbeatAttempt = await createAttempt(fixture, heartbeatPayload);
    const heartbeatBlocker = await fixture.ownerPool.connect();
    const heartbeatClient = await fixture.runtimePool.connect();
    const heartbeatAbortClient = await fixture.runtimePool.connect();
    const heartbeatClients = [
      heartbeatBlocker,
      heartbeatClient,
      heartbeatAbortClient,
    ];
    let heartbeatError: Error | null = null;
    try {
      await heartbeatBlocker.query("BEGIN");
      await lockMediaAsset(heartbeatBlocker, heartbeatPayload);
      await beginScopedTransaction(
        heartbeatClient,
        fixture.userId,
        fixture.workspaceId,
      );
      await beginScopedTransaction(
        heartbeatAbortClient,
        fixture.userId,
        fixture.workspaceId,
      );
      const blockerPid = await backendPid(heartbeatBlocker);
      const heartbeatPid = await backendPid(heartbeatClient);
      const abortPid = await backendPid(heartbeatAbortClient);
      const heartbeatPromise = beginAttempt(
        heartbeatClient,
        heartbeatAttempt.attemptToken,
        heartbeatPayload,
      );
      await waitUntilBlockedBy(
        heartbeatBlocker,
        heartbeatPid,
        blockerPid,
      );
      const abortPromise = beginAbort(
        heartbeatAbortClient,
        fixture,
        heartbeatPayload,
      );
      await waitUntilBlockedBy(
        heartbeatBlocker,
        abortPid,
        heartbeatPid,
      );
      await heartbeatBlocker.query("COMMIT");
      assert.equal((await heartbeatPromise).attempt_status, "replayed");
      await heartbeatClient.query("COMMIT");
      assert.equal(await abortPromise, "completion_in_progress");
      await heartbeatAbortClient.query("COMMIT");
    } catch (error) {
      heartbeatError =
        error instanceof Error ? error : new Error(String(error));
      throw heartbeatError;
    } finally {
      await releaseClients(heartbeatClients, heartbeatError);
    }

    const handoffPayload = createPayload(fixture, randomUUID());
    const handoffAttempt = await createAttempt(fixture, handoffPayload);
    const handoffBlocker = await fixture.ownerPool.connect();
    const handoffClient = await fixture.runtimePool.connect();
    const handoffAbortClient = await fixture.runtimePool.connect();
    const handoffClients = [
      handoffBlocker,
      handoffClient,
      handoffAbortClient,
    ];
    let handoffError: Error | null = null;
    try {
      await handoffBlocker.query("BEGIN");
      await lockMediaAsset(handoffBlocker, handoffPayload);
      await handoffClient.query("BEGIN");
      await beginScopedTransaction(
        handoffAbortClient,
        fixture.userId,
        fixture.workspaceId,
      );
      const blockerPid = await backendPid(handoffBlocker);
      const handoffPid = await backendPid(handoffClient);
      const abortPid = await backendPid(handoffAbortClient);
      const handoffPromise = handoffAfterAccessRevocation(
        handoffClient,
        handoffAttempt.attemptToken,
        handoffAttempt.reservationToken,
        handoffPayload,
      );
      await waitUntilBlockedBy(
        handoffBlocker,
        handoffPid,
        blockerPid,
      );
      const abortPromise = beginAbort(
        handoffAbortClient,
        fixture,
        handoffPayload,
      );
      await waitUntilBlockedBy(handoffBlocker, abortPid, handoffPid);
      await handoffBlocker.query("COMMIT");
      assert.equal(await handoffPromise, "handed_off");
      await handoffClient.query("COMMIT");
      assert.equal(await abortPromise, "completion_pending");
      await handoffAbortClient.query("COMMIT");
    } catch (error) {
      handoffError =
        error instanceof Error ? error : new Error(String(error));
      throw handoffError;
    } finally {
      await releaseClients(handoffClients, handoffError);
    }

    const abortPayload = createPayload(fixture, randomUUID());
    const abortAttempt = await createAttempt(fixture, abortPayload);
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET lease_expires_at=pg_catalog.clock_timestamp() - interval '1 second'
       WHERE attempt_token=$1`,
      [abortAttempt.attemptToken],
    );
    const abortBlocker = await fixture.ownerPool.connect();
    const abortClient = await fixture.runtimePool.connect();
    const staleHandoffClient = await fixture.runtimePool.connect();
    const abortClients = [abortBlocker, abortClient, staleHandoffClient];
    let abortError: Error | null = null;
    try {
      await abortBlocker.query("BEGIN");
      await lockMediaAsset(abortBlocker, abortPayload);
      await beginScopedTransaction(
        abortClient,
        fixture.userId,
        fixture.workspaceId,
      );
      await staleHandoffClient.query("BEGIN");
      const blockerPid = await backendPid(abortBlocker);
      const abortPid = await backendPid(abortClient);
      const handoffPid = await backendPid(staleHandoffClient);
      const abortPromise = beginAbort(abortClient, fixture, abortPayload);
      await waitUntilBlockedBy(abortBlocker, abortPid, blockerPid);
      const handoffPromise = handoffAfterAccessRevocation(
        staleHandoffClient,
        abortAttempt.attemptToken,
        abortAttempt.reservationToken,
        abortPayload,
      );
      await waitUntilBlockedBy(abortBlocker, handoffPid, abortPid);
      await abortBlocker.query("COMMIT");
      assert.equal(await abortPromise, "abort_required");
      await abortClient.query("COMMIT");
      assert.equal(await handoffPromise, "stale_attempt");
      await staleHandoffClient.query("COMMIT");
    } catch (error) {
      abortError = error instanceof Error ? error : new Error(String(error));
      throw abortError;
    } finally {
      await releaseClients(abortClients, abortError);
    }

    const revokedPayload = createPayload(fixture, randomUUID());
    const revokedAttempt = await createAttempt(fixture, revokedPayload);
    const sessionBlocker = await fixture.ownerPool.connect();
    const revokedClient = await fixture.runtimePool.connect();
    const revokedClients = [sessionBlocker, revokedClient];
    const otherUserId = `migration-0101-during-${randomUUID()}`;
    let revokedError: Error | null = null;
    let accessRemoved = false;
    try {
      await sessionBlocker.query("BEGIN");
      await sessionBlocker.query(
        `SELECT 1
         FROM content.media_upload_sessions
         WHERE media_upload_session_id=$1
         FOR UPDATE`,
        [revokedPayload.sessionId],
      );
      await revokedClient.query("BEGIN");
      const blockerPid = await backendPid(sessionBlocker);
      const revokedPid = await backendPid(revokedClient);
      const revokedPromise = handoffAfterAccessRevocation(
        revokedClient,
        revokedAttempt.attemptToken,
        revokedAttempt.reservationToken,
        revokedPayload,
      );
      await waitUntilBlockedBy(sessionBlocker, revokedPid, blockerPid);
      await changeCurrentAccess(fixture, otherUserId, false);
      accessRemoved = true;
      await sessionBlocker.query("COMMIT");
      assert.equal(await revokedPromise, "handed_off");
      await revokedClient.query("COMMIT");
    } catch (error) {
      revokedError =
        error instanceof Error ? error : new Error(String(error));
      throw revokedError;
    } finally {
      await releaseClients(revokedClients, revokedError);
      if (accessRemoved) {
        await changeCurrentAccess(fixture, otherUserId, true);
      }
    }
  });
});

test("migration 0101 exposes a handoff that wins the foreground renewal race as already pending", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const payload = createPayload(fixture, randomUUID());
    const attempt = await createAttempt(fixture, payload);
    const blocker = await fixture.ownerPool.connect();
    const handoffClient = await fixture.runtimePool.connect();
    const renewalClient = await fixture.runtimePool.connect();
    const clients = [blocker, handoffClient, renewalClient];
    let raceError: Error | null = null;
    try {
      await blocker.query("BEGIN");
      await lockMediaAsset(blocker, payload);
      await handoffClient.query("BEGIN");
      await beginScopedTransaction(
        renewalClient,
        fixture.userId,
        fixture.workspaceId,
      );
      const blockerPid = await backendPid(blocker);
      const handoffPid = await backendPid(handoffClient);
      const renewalPid = await backendPid(renewalClient);
      const handoffPromise = handoffAfterAccessRevocation(
        handoffClient,
        attempt.attemptToken,
        attempt.reservationToken,
        payload,
      );
      await waitUntilBlockedBy(blocker, handoffPid, blockerPid);
      const renewalPromise = beginAttempt(
        renewalClient,
        attempt.attemptToken,
        payload,
      );
      await waitUntilBlockedBy(blocker, renewalPid, handoffPid);

      await blocker.query("COMMIT");
      assert.equal(await handoffPromise, "handed_off");
      await handoffClient.query("COMMIT");
      assert.equal((await renewalPromise).attempt_status, "stale_attempt");
      await renewalClient.query("COMMIT");
    } catch (error) {
      raceError = error instanceof Error ? error : new Error(String(error));
      throw raceError;
    } finally {
      await releaseClients(clients, raceError);
    }

    assert.equal(
      await handoffAfterAccessRevocation(
        fixture.runtimePool,
        attempt.attemptToken,
        attempt.reservationToken,
        payload,
      ),
      "already_pending",
    );
    const state = await readBoundaryState(fixture, attempt.attemptToken);
    assert.equal(state.attempt_state, "expired");
    assert.equal(state.attempt_outcome, "stale_attempt");
    assert.equal(state.reconciliation_state, "pending");
  });
});

test("migration 0101 uses one asset fence for cross-member abort and reconciliation", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const payload = createPayload(fixture, randomUUID());
    const attempt = await createAttempt(fixture, payload);
    assert.equal(
      await scoped(
        fixture,
        (client) => handoffWithOwner(
          client,
          attempt.attemptToken,
          attempt.reservationToken,
          payload,
        ),
      ),
      "handed_off",
    );
    const claimed = await claimAttempt(fixture, attempt.attemptToken);
    const initialState = await readBoundaryState(
      fixture,
      attempt.attemptToken,
    );
    const otherUserId = `migration-0101-member-${randomUUID()}`;
    await insertWorkspaceMember(fixture, otherUserId);

    const sessionBlocker = await fixture.ownerPool.connect();
    const abortClient = await fixture.runtimePool.connect();
    const reconciliationClient = await fixture.runtimePool.connect();
    const clients = [sessionBlocker, abortClient, reconciliationClient];
    let raceError: Error | null = null;
    try {
      await sessionBlocker.query("BEGIN");
      await sessionBlocker.query(
        `SELECT 1
         FROM content.media_upload_sessions
         WHERE media_upload_session_id=$1
         FOR UPDATE`,
        [payload.sessionId],
      );
      await beginScopedTransaction(
        abortClient,
        otherUserId,
        fixture.workspaceId,
      );
      await reconciliationClient.query("BEGIN");

      const blockerPid = await backendPid(sessionBlocker);
      const abortPid = await backendPid(abortClient);
      const reconciliationPid = await backendPid(reconciliationClient);
      const abortPromise = beginAbortForUser(
        abortClient,
        otherUserId,
        payload,
      );
      await waitUntilBlockedBy(sessionBlocker, abortPid, blockerPid);

      const reconciliationPromise = applyReconciliationScope(
        reconciliationClient,
        claimed,
      );
      await waitUntilBlockedBy(
        sessionBlocker,
        reconciliationPid,
        abortPid,
      );

      await sessionBlocker.query("COMMIT");
      assert.equal(await abortPromise, "completion_pending");
      await abortClient.query("COMMIT");
      assert.equal(await reconciliationPromise, "scoped");
      await reconciliationClient.query("ROLLBACK");
    } catch (error) {
      raceError = error instanceof Error ? error : new Error(String(error));
      throw raceError;
    } finally {
      await releaseClients(clients, raceError);
    }

    assert.deepEqual(
      await readBoundaryState(fixture, attempt.attemptToken),
      initialState,
    );

    const finishPayload = createPayload(fixture, randomUUID());
    const finishAttempt = await createAttempt(fixture, finishPayload);
    assert.equal(
      await scoped(
        fixture,
        (client) => handoffWithOwner(
          client,
          finishAttempt.attemptToken,
          finishAttempt.reservationToken,
          finishPayload,
        ),
      ),
      "handed_off",
    );
    const finishClaim = await claimAttempt(
      fixture,
      finishAttempt.attemptToken,
    );
    await insertExactReference(fixture.ownerPool, finishPayload);
    const finishBefore = await readBoundaryState(
      fixture,
      finishAttempt.attemptToken,
    );
    const finishBlocker = await fixture.ownerPool.connect();
    const finishClient = await fixture.runtimePool.connect();
    const finishClients = [finishBlocker, finishClient];
    let finishError: Error | null = null;
    try {
      await finishBlocker.query("BEGIN");
      await lockMediaAsset(finishBlocker, finishPayload);
      await beginScopedTransaction(
        finishClient,
        fixture.userId,
        fixture.workspaceId,
      );
      const blockerPid = await backendPid(finishBlocker);
      const finishPid = await backendPid(finishClient);
      const finishPromise = finishReconciliation(
        finishClient,
        finishClaim,
      );
      await waitUntilBlockedBy(finishBlocker, finishPid, blockerPid);
      await fixture.ownerPool.query(
        `SELECT 1
         FROM content.media_blob_writer_attempts
         WHERE attempt_token=$1
         FOR UPDATE NOWAIT`,
        [finishAttempt.attemptToken],
      );
      await finishBlocker.query("COMMIT");
      assert.equal(await finishPromise, "applied");
      await finishClient.query("ROLLBACK");
    } catch (error) {
      finishError =
        error instanceof Error ? error : new Error(String(error));
      throw finishError;
    } finally {
      await releaseClients(finishClients, finishError);
    }
    assert.deepEqual(
      await readBoundaryState(fixture, finishAttempt.attemptToken),
      finishBefore,
    );

    const failPayload = createPayload(fixture, randomUUID());
    const failAttempt = await createAttempt(fixture, failPayload);
    assert.equal(
      await scoped(
        fixture,
        (client) => handoffWithOwner(
          client,
          failAttempt.attemptToken,
          failAttempt.reservationToken,
          failPayload,
        ),
      ),
      "handed_off",
    );
    const failClaim = await claimAttempt(fixture, failAttempt.attemptToken);
    const failBefore = await readBoundaryState(
      fixture,
      failAttempt.attemptToken,
    );
    const failBlocker = await fixture.ownerPool.connect();
    const failClient = await fixture.runtimePool.connect();
    const failClients = [failBlocker, failClient];
    let failError: Error | null = null;
    try {
      await failBlocker.query("BEGIN");
      await lockMediaAsset(failBlocker, failPayload);
      await failClient.query("BEGIN");
      const blockerPid = await backendPid(failBlocker);
      const failPid = await backendPid(failClient);
      const failPromise = failReconciliation(failClient, failClaim);
      await waitUntilBlockedBy(failBlocker, failPid, blockerPid);
      await fixture.ownerPool.query(
        `SELECT 1
         FROM content.media_blob_writer_attempts
         WHERE attempt_token=$1
         FOR UPDATE NOWAIT`,
        [failAttempt.attemptToken],
      );
      await failBlocker.query("COMMIT");
      assert.equal(await failPromise, "failed");
      await failClient.query("ROLLBACK");
    } catch (error) {
      failError = error instanceof Error ? error : new Error(String(error));
      throw failError;
    } finally {
      await releaseClients(failClients, failError);
    }
    assert.deepEqual(
      await readBoundaryState(fixture, failAttempt.attemptToken),
      failBefore,
    );

    const invalidPayload = createPayload(fixture, randomUUID());
    const invalidAttempt = await createAttempt(fixture, invalidPayload);
    assert.equal(
      await scoped(
        fixture,
        (client) => handoffWithOwner(
          client,
          invalidAttempt.attemptToken,
          invalidAttempt.reservationToken,
          invalidPayload,
        ),
      ),
      "handed_off",
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET
         last_operation_id=$2,
         reconciliation_state='leased',
         reconciliation_lease_token=$3,
         reconciliation_lease_owner='legacy-pre-contract-worker',
         reconciliation_lease_expires_at =
           reconciliation_handed_off_at + interval '1 microsecond',
         reconciliation_last_error_code='INVALID_RECONCILIATION_PAYLOAD',
         reconciliation_last_error_message =
           'Durable multipart completion payload is invalid.',
         reconciliation_updated_at=reconciliation_handed_off_at
       WHERE attempt_token=$1`,
      [
        invalidAttempt.attemptToken,
        "legacy\u00a0operation",
        randomUUID(),
      ],
    );
    const invalidBefore = await readBoundaryState(
      fixture,
      invalidAttempt.attemptToken,
    );
    const claimBlocker = await fixture.ownerPool.connect();
    const claimClient = await fixture.runtimePool.connect();
    const claimClients = [claimBlocker, claimClient];
    let claimError: Error | null = null;
    try {
      await claimBlocker.query("BEGIN");
      await lockMediaAsset(claimBlocker, invalidPayload);
      await claimClient.query("BEGIN");
      const blockerPid = await backendPid(claimBlocker);
      const claimPid = await backendPid(claimClient);
      const claimPromise = claimClient.query(
        `SELECT attempt_token
         FROM content.claim_media_upload_session_completion_reconciliations(
           $1,$2,$3
         )`,
        [`migration-0101-invalid-${randomUUID()}`, 60_000, 1],
      );
      await waitUntilBlockedBy(claimBlocker, claimPid, blockerPid);
      await fixture.ownerPool.query(
        `SELECT 1
         FROM content.media_blob_writer_attempts
         WHERE attempt_token=$1
         FOR UPDATE NOWAIT`,
        [invalidAttempt.attemptToken],
      );
      await claimBlocker.query("COMMIT");
      assert.equal((await claimPromise).rowCount, 0);
      await claimClient.query("ROLLBACK");
    } catch (error) {
      claimError = error instanceof Error ? error : new Error(String(error));
      throw claimError;
    } finally {
      await releaseClients(claimClients, claimError);
    }
    assert.deepEqual(
      await readBoundaryState(fixture, invalidAttempt.attemptToken),
      invalidBefore,
    );
  });
});

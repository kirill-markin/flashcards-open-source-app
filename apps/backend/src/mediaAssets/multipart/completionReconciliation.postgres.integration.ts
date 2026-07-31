import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../../testSupport/postgresIntegration";
import { HttpError } from "../../shared/errors";
import {
  applyMultipartCompletionReconciliation,
  claimMultipartCompletionFailureReports,
  claimMultipartCompletionReconciliations,
  deliverMultipartCompletionFailureReport,
  failMultipartCompletionReconciliation,
  finishMultipartCompletionFailureReport,
  MultipartCompletionFailureReportLeaseLostError,
  MultipartCompletionReconciliationLeaseLostError,
  readMultipartCompletionReconciliationOutcome,
  renewMultipartCompletionReconciliationLease,
  rescheduleMultipartCompletionReconciliation,
  type ClaimedMultipartCompletionFailureReport,
  type ClaimedMultipartCompletionReconciliation,
} from "./completionReconciliation";
import { isValidMediaAssetLastOperationId } from "../lastOperationId";
import {
  beginMediaAssetUploadSessionCompletionAttemptWithOwner,
  beginMediaAssetUploadSessionCompletionForWorkspace,
  completeMediaAssetUploadSessionForWorkspace,
  createMediaAssetUploadSessionCompletedPartsFingerprint,
  markMediaAssetUploadSessionAbortedForWorkspace,
  recordMediaAssetUploadSessionForWorkspace,
  type MultipartMediaBlobWriterAttemptInput,
} from "../uploadSessions";
import { passthroughMediaBlobNormalizationVersion } from "../types";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../storageKeys";

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
}>;
type StatusRow = Readonly<{ status: string }>;
type StateRow = Readonly<{
  session_state: string;
  attempt_state: string;
  attempt_outcome: string;
  reconciliation_state: string;
  reservation_state: string;
}>;
type CountRow = Readonly<{ count: number }>;
type SqlValue = string | number | null;
type QueryExecutor = Pick<pg.PoolClient | pg.Pool, "query">;

const multipartRow = `ROW(
  $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
)::content.multipart_media_blob_writer_attempt_payload`;

function digest(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function createPayload(
  fixture: PostgresIntegrationFixture,
): MultipartPayload {
  const sessionId = randomUUID();
  const mediaAssetId = randomUUID();
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

const migration0099LegacyUserId =
  "migration-0099-legacy-invalid-media-asset";
const migration0099LegacyWorkspaceId =
  "09900000-0000-4000-8000-000000000001";
const migration0099LegacyReplicaId =
  "09900000-0000-4000-8000-000000000002";
const migration0099LegacyTimestamp = "2026-07-29T00:00:00.000Z";
const migration0099LegacySessionExpiresAt =
  "2099-07-29T00:00:00.000Z";
const migration0099LegacyActiveSessionId =
  "09940000-0000-4000-8000-000000000001";
const migration0099LegacyActiveMediaAssetId =
  "09940000-0000-4000-8000-000000000002";
const migration0099LegacyActiveSha256 = "d".repeat(64);

function createMigration0099LegacyPayload(
  input: Readonly<{
    sessionId: string;
    mediaAssetId: string;
    sha256: string;
    lastOperationId: string;
    uploadId: string;
    partsFingerprint: string;
  }>,
): MultipartPayload {
  return {
    userId: migration0099LegacyUserId,
    workspaceId: migration0099LegacyWorkspaceId,
    sessionId: input.sessionId,
    mediaAssetId: input.mediaAssetId,
    replicaId: migration0099LegacyReplicaId,
    lastOperationId: input.lastOperationId,
    sha256: input.sha256,
    stagingStorageKey:
      `media/uploads/workspaces/${migration0099LegacyWorkspaceId}/assets/${input.mediaAssetId}/sessions/${input.sessionId}`,
    blobStorageKey: buildMediaBlobStorageKey(input.sha256),
    s3UploadId: input.uploadId,
    mimeType: "application/octet-stream",
    sizeBytes: 1,
    partSizeBytes: 1,
    partCount: 1,
    sourceUrl: null,
    assetCreatedAt: migration0099LegacyTimestamp,
    clientUpdatedAt: migration0099LegacyTimestamp,
    sessionExpiresAt: migration0099LegacySessionExpiresAt,
    normalizationVersion: "passthrough-v1",
    partsFingerprint: input.partsFingerprint,
  };
}

function payloadValues(payload: MultipartPayload): Array<SqlValue> {
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

async function scoped<Result>(
  fixture: PostgresIntegrationFixture,
  callback: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  return scopedAs(
    fixture,
    fixture.userId,
    fixture.workspaceId,
    callback,
  );
}

async function scopedAs<Result>(
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
): Promise<void> {
  await executor.query(
    `INSERT INTO content.media_upload_sessions (
       media_upload_session_id,workspace_id,media_asset_id,media_blob_sha256,
       staging_storage_key,blob_storage_key,s3_upload_id,mime_type,size_bytes,
       part_size_bytes,part_count,state,source_url,asset_created_at,client_updated_at,
       last_modified_by_replica_id,last_operation_id,expires_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completing',$12,$13,$14,$15,$16,$17
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

async function beginAttempt(
  fixture: PostgresIntegrationFixture,
  attemptToken: string,
  payload: MultipartPayload,
): Promise<BeginRow> {
  return beginAttemptAs(
    fixture,
    fixture.userId,
    fixture.workspaceId,
    attemptToken,
    payload,
  );
}

async function beginAttemptAs(
  fixture: PostgresIntegrationFixture,
  userId: string,
  workspaceId: string,
  attemptToken: string,
  payload: MultipartPayload,
): Promise<BeginRow> {
  return scopedAs(
    fixture,
    userId,
    workspaceId,
    async (client) => (await client.query<BeginRow>(
      `SELECT *
       FROM content.begin_media_upload_session_completion_attempt_with_owner(
         $1,$2,${multipartRow}
       )`,
      [attemptToken, 60_000, ...payloadValues(payload)],
    )).rows[0],
  );
}

async function handoffAttempt(
  fixture: PostgresIntegrationFixture,
  attemptToken: string,
  reservationToken: string,
  payload: MultipartPayload,
): Promise<string> {
  return handoffAttemptAs(
    fixture,
    fixture.userId,
    fixture.workspaceId,
    attemptToken,
    reservationToken,
    payload,
  );
}

async function handoffAttemptAs(
  fixture: PostgresIntegrationFixture,
  userId: string,
  workspaceId: string,
  attemptToken: string,
  reservationToken: string,
  payload: MultipartPayload,
): Promise<string> {
  return scopedAs(
    fixture,
    userId,
    workspaceId,
    async (client) => (await client.query<StatusRow>(
      `SELECT content.handoff_media_upload_session_completion_attempt(
         $1,$2,${multipartRow}
       ) AS status`,
      [attemptToken, reservationToken, ...payloadValues(payload)],
    )).rows[0].status,
  );
}

async function createHandedOffAttempt(
  fixture: PostgresIntegrationFixture,
): Promise<Readonly<{
  payload: MultipartPayload;
  attemptToken: string;
  reservationToken: string;
}>> {
  const payload = createPayload(fixture);
  const attemptToken = randomUUID();
  await insertSession(fixture.ownerPool, payload);
  const begun = await beginAttempt(fixture, attemptToken, payload);
  assert.equal(begun.attempt_status, "acquired");
  assert.equal(begun.normalization_version, payload.normalizationVersion);
  assert.notEqual(begun.reservation_token, null);
  const reservationToken = begun.reservation_token as string;
  assert.equal(
    await handoffAttempt(
      fixture,
      attemptToken,
      reservationToken,
      payload,
    ),
    "handed_off",
  );
  assert.equal(
    await handoffAttempt(
      fixture,
      attemptToken,
      reservationToken,
      payload,
    ),
    "already_pending",
  );
  return { payload, attemptToken, reservationToken };
}

async function insertExactReference(
  fixture: PostgresIntegrationFixture,
  payload: MultipartPayload,
): Promise<void> {
  await fixture.ownerPool.query(
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

async function closeCurrentWriter(
  fixture: PostgresIntegrationFixture,
  payload: MultipartPayload,
): Promise<string> {
  return closeCurrentWriterAs(
    fixture,
    fixture.userId,
    fixture.workspaceId,
    payload,
  );
}

async function closeCurrentWriterAs(
  fixture: PostgresIntegrationFixture,
  userId: string,
  workspaceId: string,
  payload: MultipartPayload,
): Promise<string> {
  return scopedAs(
    fixture,
    userId,
    workspaceId,
    async (client) => (await client.query<StatusRow>(
      `SELECT content.close_media_upload_session_current_blob_writer_with_owner(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
       ) AS status`,
      [
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
        3_600_000,
      ],
    )).rows[0].status,
  );
}

async function claimOne(
  leaseOwner: string,
): Promise<ClaimedMultipartCompletionReconciliation> {
  const jobs = await claimMultipartCompletionReconciliations({
    leaseOwner,
    leaseDurationMs: 60_000,
    limit: 1,
    deadlineAtMs: Date.now() + 30_000,
  });
  assert.equal(jobs.length, 1);
  return jobs[0] as ClaimedMultipartCompletionReconciliation;
}

async function claimFailureReportOne(
  leaseOwner: string,
  attemptToken: string,
): Promise<ClaimedMultipartCompletionFailureReport> {
  const reports = await claimMultipartCompletionFailureReports({
    leaseOwner,
    leaseDurationMs: 60_000,
    limit: 100,
    deadlineAtMs: Date.now() + 30_000,
  });
  const report = reports.find(
    (candidate) => candidate.attemptToken === attemptToken,
  );
  assert.notEqual(report, undefined);
  return report as ClaimedMultipartCompletionFailureReport;
}

async function createFailedAttempt(
  fixture: PostgresIntegrationFixture,
  leaseOwner: string,
): Promise<Awaited<ReturnType<typeof createHandedOffAttempt>>> {
  const handedOff = await createHandedOffAttempt(fixture);
  const reconciliationLease = await claimOne(leaseOwner);
  assert.equal(
    await failMultipartCompletionReconciliation(
      reconciliationLease,
      Date.now() + 30_000,
      {
        code: "RETRY_EXHAUSTED",
        message:
          "Multipart completion reconciliation exhausted its transient retry budget.",
      },
    ),
    "failed",
  );
  return handedOff;
}

async function state(
  fixture: PostgresIntegrationFixture,
  attemptToken: string,
): Promise<StateRow> {
  return (await fixture.ownerPool.query<StateRow>(
    `SELECT
       sessions.state AS session_state,
       attempts.state AS attempt_state,
       attempts.outcome AS attempt_outcome,
       attempts.reconciliation_state,
       reservations.state AS reservation_state
     FROM content.media_blob_writer_attempts AS attempts
     INNER JOIN content.media_upload_sessions AS sessions
       ON sessions.media_upload_session_id = attempts.media_upload_session_id
     INNER JOIN content.media_blob_writer_reservations AS reservations
       ON reservations.reservation_token = attempts.reservation_token
     WHERE attempts.attempt_token = $1`,
    [attemptToken],
  )).rows[0];
}

test("migration 0099 fences durable handoff, replay, retry, revocation, and apply", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const baseline = (await fixture.ownerPool.query<Readonly<{
      major: number;
      migrations: number;
      latest: string;
    }>>(
      `SELECT
         current_setting('server_version_num')::int / 10000 AS major,
         count(*)::int AS migrations,
         max(filename) AS latest
       FROM public.schema_migrations`,
    )).rows[0];
    assert.deepEqual(baseline, {
      major: 18,
      migrations: 101,
      latest: "0099_durable_multipart_completion_reconciliation.sql",
    });
    const security = (await fixture.ownerPool.query<Readonly<{
      backend_claim: boolean;
      auth_claim: boolean;
      reporting_claim: boolean;
      public_claim: boolean;
      backend_internal: boolean;
      backend_job_internal: boolean;
      backend_last_operation_internal: boolean;
      backend_canonical_payload_internal: boolean;
      backend_table: boolean;
      backend_report_claim: boolean;
      auth_report_claim: boolean;
      public_report_claim: boolean;
      backend_report_delivery_lock: boolean;
      auth_report_delivery_lock: boolean;
      public_report_delivery_lock: boolean;
      backend_report_finish: boolean;
      backend_outcome: boolean;
    }>>(
      `SELECT
         has_function_privilege(
           'backend_app',
           'content.claim_media_upload_session_completion_reconciliations(text,integer,integer)',
           'EXECUTE'
         ) AS backend_claim,
         has_function_privilege(
           'auth_app',
           'content.claim_media_upload_session_completion_reconciliations(text,integer,integer)',
           'EXECUTE'
         ) AS auth_claim,
         has_function_privilege(
           'reporting_readonly',
           'content.claim_media_upload_session_completion_reconciliations(text,integer,integer)',
           'EXECUTE'
         ) AS reporting_claim,
         has_function_privilege(
           'public',
           'content.claim_media_upload_session_completion_reconciliations(text,integer,integer)',
           'EXECUTE'
         ) AS public_claim,
         has_function_privilege(
           'backend_app',
           'content.multipart_completion_reconciliation_error_valid_internal(text,text)',
           'EXECUTE'
         ) AS backend_internal,
         has_function_privilege(
           'backend_app',
           'content.multipart_completion_reconciliation_job_valid_internal(content.media_blob_writer_attempts)',
           'EXECUTE'
         ) AS backend_job_internal,
         has_function_privilege(
           'backend_app',
           'content.media_asset_last_operation_id_valid_internal(text)',
           'EXECUTE'
         ) AS backend_last_operation_internal,
         has_function_privilege(
           'backend_app',
           'content.multipart_media_blob_writer_attempt_payload_canonical_valid_internal(content.multipart_media_blob_writer_attempt_payload)',
           'EXECUTE'
         ) AS backend_canonical_payload_internal,
         has_table_privilege(
           'backend_app',
           'content.media_blob_writer_attempts',
           'SELECT'
         ) AS backend_table,
         has_function_privilege(
           'backend_app',
           'content.claim_media_upload_session_completion_failure_reports(text,integer,integer)',
           'EXECUTE'
         ) AS backend_report_claim,
         has_function_privilege(
           'auth_app',
           'content.claim_media_upload_session_completion_failure_reports(text,integer,integer)',
           'EXECUTE'
         ) AS auth_report_claim,
         has_function_privilege(
           'public',
           'content.claim_media_upload_session_completion_failure_reports(text,integer,integer)',
           'EXECUTE'
         ) AS public_report_claim,
         has_function_privilege(
           'backend_app',
           'content.lock_media_upload_session_completion_failure_report_delivery(uuid,uuid,uuid)',
           'EXECUTE'
         ) AS backend_report_delivery_lock,
         has_function_privilege(
           'auth_app',
           'content.lock_media_upload_session_completion_failure_report_delivery(uuid,uuid,uuid)',
           'EXECUTE'
         ) AS auth_report_delivery_lock,
         has_function_privilege(
           'public',
           'content.lock_media_upload_session_completion_failure_report_delivery(uuid,uuid,uuid)',
           'EXECUTE'
         ) AS public_report_delivery_lock,
         has_function_privilege(
           'backend_app',
           'content.finish_media_upload_session_completion_failure_report(uuid,uuid,uuid)',
           'EXECUTE'
         ) AS backend_report_finish,
         has_function_privilege(
           'backend_app',
           'content.get_media_upload_session_completion_reconciliation_outcome(uuid)',
           'EXECUTE'
         ) AS backend_outcome`,
    )).rows[0];
    assert.deepEqual(security, {
      backend_claim: true,
      auth_claim: false,
      reporting_claim: false,
      public_claim: false,
      backend_internal: false,
      backend_job_internal: false,
      backend_last_operation_internal: false,
      backend_canonical_payload_internal: false,
      backend_table: false,
      backend_report_claim: true,
      auth_report_claim: false,
      public_report_claim: false,
      backend_report_delivery_lock: true,
      auth_report_delivery_lock: false,
      public_report_delivery_lock: false,
      backend_report_finish: true,
      backend_outcome: true,
    });

    const successful = await createHandedOffAttempt(fixture);
    assert.equal(
      await scoped(
        fixture,
        async (client) => (await client.query<StatusRow>(
          `SELECT content.check_media_upload_session_completion_pending_with_owner(
             $1,$2,$3,$4
           ) AS status`,
          [
            fixture.userId,
            fixture.workspaceId,
            successful.payload.sessionId,
            successful.payload.mediaAssetId,
          ],
        )).rows[0].status,
      ),
      "pending",
    );
    assert.equal(
      await scoped(
        fixture,
        async (client) => (await client.query<StatusRow>(
          `SELECT content.check_media_asset_completion_pending_with_owner(
             $1,$2,$3
           ) AS status`,
          [
            fixture.userId,
            fixture.workspaceId,
            successful.payload.mediaAssetId,
          ],
        )).rows[0].status,
      ),
      "pending",
    );

    const successfulJob = await claimOne("worker-success");
    assert.equal(successfulJob.attemptToken, successful.attemptToken);
    assert.deepEqual(
      await claimMultipartCompletionReconciliations({
        leaseOwner: "duplicate-worker",
        leaseDurationMs: 60_000,
        limit: 1,
        deadlineAtMs: Date.now() + 30_000,
      }),
      [],
    );
    assert.equal(
      await applyMultipartCompletionReconciliation(
        successfulJob,
        Date.now() + 30_000,
      ),
      "applied",
    );
    assert.deepEqual(await state(fixture, successful.attemptToken), {
      session_state: "completed",
      attempt_state: "applied",
      attempt_outcome: "live_applied",
      reconciliation_state: "applied",
      reservation_state: "finalized",
    });
    const uploadCount = (await fixture.ownerPool.query<CountRow>(
      `SELECT count(*)::int AS count
       FROM content.media_upload_sessions
       WHERE workspace_id=$1 AND media_asset_id=$2`,
      [fixture.workspaceId, successful.payload.mediaAssetId],
    )).rows[0].count;
    assert.equal(uploadCount, 1);
    const replayStatus = (await fixture.runtimePool.query<StatusRow>(
      `SELECT content.finish_media_upload_session_completion_reconciliation(
         $1,$2,$3
       ) AS status`,
      [
        successfulJob.attemptToken,
        successfulJob.leaseToken,
        3_600_000,
      ],
    )).rows[0].status;
    assert.equal(replayStatus, "already_applied");

    const retried = await createHandedOffAttempt(fixture);
    const firstLease = await claimOne("worker-retry-one");
    const retryAt = new Date(Date.now() + 60_000);
    await rescheduleMultipartCompletionReconciliation(
      firstLease,
      Date.now() + 30_000,
      retryAt,
      {
        code: "MULTIPART_STORAGE_TRANSIENT",
        message: "Multipart completion storage is temporarily unavailable.",
      },
    );
    assert.deepEqual(
      await claimMultipartCompletionReconciliations({
        leaseOwner: "worker-too-early",
        leaseDurationMs: 60_000,
        limit: 1,
        deadlineAtMs: Date.now() + 30_000,
      }),
      [],
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET reconciliation_next_attempt_at = reconciliation_handed_off_at
       WHERE attempt_token = $1`,
      [retried.attemptToken],
    );
    const secondLease = await claimOne("worker-retry-two");
    await assert.rejects(
      renewMultipartCompletionReconciliationLease(
        firstLease,
        60_000,
        Date.now() + 30_000,
      ),
      MultipartCompletionReconciliationLeaseLostError,
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET
         reconciliation_updated_at = reconciliation_handed_off_at,
         reconciliation_lease_expires_at =
           reconciliation_handed_off_at + interval '1 microsecond'
       WHERE attempt_token = $1`,
      [retried.attemptToken],
    );
    const reclaimedLease = await claimOne("worker-retry-three");
    assert.notEqual(reclaimedLease.leaseToken, secondLease.leaseToken);
    await assert.rejects(
      renewMultipartCompletionReconciliationLease(
        secondLease,
        60_000,
        Date.now() + 30_000,
      ),
      MultipartCompletionReconciliationLeaseLostError,
    );
    assert.equal(
      await failMultipartCompletionReconciliation(
        reclaimedLease,
        Date.now() + 30_000,
        {
          code: "RETRY_EXHAUSTED",
          message:
            "Multipart completion reconciliation exhausted its transient retry budget.",
        },
      ),
      "failed",
    );
    assert.deepEqual(await state(fixture, retried.attemptToken), {
      session_state: "aborted",
      attempt_state: "unreferenced",
      attempt_outcome: "unreferenced",
      reconciliation_state: "failed",
      reservation_state: "unreferenced",
    });
    const failureReplay = (await fixture.runtimePool.query<StatusRow>(
      `SELECT content.fail_media_upload_session_completion_reconciliation(
         $1,$2,$3,$4,$5
       ) AS status`,
      [
        reclaimedLease.attemptToken,
        reclaimedLease.leaseToken,
        "RETRY_EXHAUSTED",
        "Multipart completion reconciliation exhausted its transient retry budget.",
        3_600_000,
      ],
    )).rows[0].status;
    assert.equal(failureReplay, "failed");

    const revoked = await createHandedOffAttempt(fixture);
    const revokedLease = await claimOne("worker-revoked");
    await fixture.ownerPool.query(
      "DELETE FROM org.workspace_memberships WHERE workspace_id=$1 AND user_id=$2",
      [fixture.workspaceId, fixture.userId],
    );
    const revokedStatus = (await fixture.runtimePool.query<StatusRow>(
      `SELECT content.apply_media_upload_session_completion_reconciliation_scope(
         $1,$2
       ) AS status`,
      [revokedLease.attemptToken, revokedLease.leaseToken],
    )).rows[0].status;
    assert.equal(revokedStatus, "access_revoked");
    assert.equal(
      await failMultipartCompletionReconciliation(
        revokedLease,
        Date.now() + 30_000,
        {
          code: "WORKSPACE_ACCESS_REVOKED",
          message:
            "Workspace or replica access was revoked before multipart completion finished.",
        },
      ),
      "failed",
    );
    assert.equal(
      (await state(fixture, revoked.attemptToken)).reconciliation_state,
      "failed",
    );
    await fixture.ownerPool.query(
      `INSERT INTO org.workspace_memberships (workspace_id,user_id,role)
       VALUES ($1,$2,'owner')`,
      [fixture.workspaceId, fixture.userId],
    );

    const abortRacePayload = createPayload(fixture);
    const abortRaceAttemptToken = randomUUID();
    await insertSession(fixture.ownerPool, abortRacePayload);
    const abortRaceBegin = await beginAttempt(
      fixture,
      abortRaceAttemptToken,
      abortRacePayload,
    );
    assert.notEqual(abortRaceBegin.reservation_token, null);
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET state='aborting'
       WHERE media_upload_session_id=$1`,
      [abortRacePayload.sessionId],
    );
    assert.equal(
      await handoffAttempt(
        fixture,
        abortRaceAttemptToken,
        abortRaceBegin.reservation_token as string,
        abortRacePayload,
      ),
      "aborting",
    );
    assert.equal(
      (await fixture.ownerPool.query<CountRow>(
        `SELECT count(*)::int AS count
         FROM content.media_blob_writer_attempts
         WHERE attempt_token=$1 AND reconciliation_state IS NOT NULL`,
        [abortRaceAttemptToken],
      )).rows[0].count,
      0,
    );

    const deletionPending = await createHandedOffAttempt(fixture);
    await fixture.ownerPool.query(
      "DELETE FROM org.workspaces WHERE workspace_id=$1",
      [fixture.workspaceId],
    );
    const deletedState = (await fixture.ownerPool.query<Readonly<{
      state: string;
      outcome: string;
      reconciliation_state: string;
      error_code: string;
      failure_event_id: string;
      failure_report_state: string;
      sessions: number;
    }>>(
      `SELECT
         attempts.state,
         attempts.outcome,
         attempts.reconciliation_state,
         attempts.reconciliation_last_error_code AS error_code,
         attempts.reconciliation_failure_event_id AS failure_event_id,
         attempts.reconciliation_failure_report_state AS failure_report_state,
         (
           SELECT count(*)::int
           FROM content.media_upload_sessions
           WHERE workspace_id=$2
         ) AS sessions
       FROM content.media_blob_writer_attempts AS attempts
       WHERE attempts.attempt_token=$1`,
      [deletionPending.attemptToken, fixture.workspaceId],
    )).rows[0];
    assert.match(
      deletedState.failure_event_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    assert.notEqual(
      deletedState.failure_event_id,
      deletionPending.attemptToken,
    );
    assert.deepEqual({
      ...deletedState,
      failure_event_id: "<stable-event-id>",
    }, {
      state: "cancelled",
      outcome: "aborted",
      reconciliation_state: "failed",
      error_code: "WORKSPACE_DELETED",
      failure_event_id: "<stable-event-id>",
      failure_report_state: "pending",
      sessions: 0,
    });
  });
});

test("migration 0099 durably reports every terminal reconciliation failure", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const handedOff = await createHandedOffAttempt(fixture);
    const reconciliationLease = await claimOne("worker-terminal-report");
    assert.equal(
      await failMultipartCompletionReconciliation(
        reconciliationLease,
        Date.now() + 30_000,
        {
          code: "RETRY_EXHAUSTED",
          message:
            "Multipart completion reconciliation exhausted its transient retry budget.",
        },
      ),
      "failed",
    );
    assert.deepEqual(
      await readMultipartCompletionReconciliationOutcome(
        handedOff.attemptToken,
        Date.now() + 30_000,
      ),
      {
        status: "failed",
        errorCode: "RETRY_EXHAUSTED",
      },
    );

    const pending = (await fixture.ownerPool.query<Readonly<{
      event_id: string;
      report_state: string;
      delivery_count: number;
    }>>(
      `SELECT
         reconciliation_failure_event_id AS event_id,
         reconciliation_failure_report_state AS report_state,
         reconciliation_failure_report_delivery_count AS delivery_count
       FROM content.media_blob_writer_attempts
       WHERE attempt_token=$1`,
      [handedOff.attemptToken],
    )).rows[0];
    assert.notEqual(pending.event_id, handedOff.attemptToken);
    assert.equal(pending.report_state, "pending");
    assert.equal(pending.delivery_count, 0);

    const firstReport = await claimFailureReportOne(
      "failure-reporter-one",
      handedOff.attemptToken,
    );
    assert.equal(firstReport.failureEventId, pending.event_id);
    assert.equal(firstReport.attemptToken, handedOff.attemptToken);
    assert.equal(firstReport.deliveryAttempt, 1);
    assert.equal(firstReport.errorCode, "RETRY_EXHAUSTED");
    assert.equal(
      (
        await claimMultipartCompletionFailureReports({
          leaseOwner: "failure-reporter-duplicate",
          leaseDurationMs: 60_000,
          limit: 100,
          deadlineAtMs: Date.now() + 30_000,
        })
      ).some((report) => report.attemptToken === handedOff.attemptToken),
      false,
    );

    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET
         reconciliation_failure_report_updated_at =
           reconciliation_handed_off_at,
         reconciliation_failure_report_lease_expires_at =
           reconciliation_handed_off_at + interval '1 microsecond'
       WHERE attempt_token=$1`,
      [handedOff.attemptToken],
    );
    const secondReport = await claimFailureReportOne(
      "failure-reporter-two",
      handedOff.attemptToken,
    );
    assert.equal(secondReport.failureEventId, firstReport.failureEventId);
    assert.equal(secondReport.deliveryAttempt, 2);
    assert.notEqual(secondReport.leaseToken, firstReport.leaseToken);
    await assert.rejects(
      finishMultipartCompletionFailureReport(
        firstReport,
        Date.now() + 30_000,
      ),
      MultipartCompletionFailureReportLeaseLostError,
    );
    await finishMultipartCompletionFailureReport(
      secondReport,
      Date.now() + 30_000,
    );
    await finishMultipartCompletionFailureReport(
      secondReport,
      Date.now() + 30_000,
    );

    const reported = (await fixture.ownerPool.query<Readonly<{
      report_state: string;
      delivery_count: number;
      lease_cleared: boolean;
      reported_at_present: boolean;
    }>>(
      `SELECT
         reconciliation_failure_report_state AS report_state,
         reconciliation_failure_report_delivery_count AS delivery_count,
         (
           reconciliation_failure_report_lease_token IS NULL
           AND reconciliation_failure_report_lease_owner IS NULL
           AND reconciliation_failure_report_lease_expires_at IS NULL
         ) AS lease_cleared,
         reconciliation_failure_reported_at IS NOT NULL AS reported_at_present
       FROM content.media_blob_writer_attempts
       WHERE attempt_token=$1`,
      [handedOff.attemptToken],
    )).rows[0];
    assert.deepEqual(reported, {
      report_state: "reported",
      delivery_count: 2,
      lease_cleared: true,
      reported_at_present: true,
    });
    assert.equal(
      (
        await claimMultipartCompletionFailureReports({
          leaseOwner: "failure-reporter-after-finish",
          leaseDurationMs: 60_000,
          limit: 100,
          deadlineAtMs: Date.now() + 30_000,
        })
      ).some((report) => report.attemptToken === handedOff.attemptToken),
      false,
    );
    assert.equal(
      await failMultipartCompletionReconciliation(
        reconciliationLease,
        Date.now() + 30_000,
        {
          code: "RETRY_EXHAUSTED",
          message:
            "Multipart completion reconciliation exhausted its transient retry budget.",
        },
      ),
      "failed",
    );
    assert.equal(
      (await fixture.ownerPool.query<Readonly<{ report_state: string }>>(
        `SELECT reconciliation_failure_report_state AS report_state
         FROM content.media_blob_writer_attempts
         WHERE attempt_token=$1`,
        [handedOff.attemptToken],
      )).rows[0].report_state,
      "reported",
    );
  });
});

test("migration 0099 closes pending and leased exact references as applied reconciliation", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    for (const reconciliationState of ["pending", "leased"] as const) {
      const handedOff = await createHandedOffAttempt(fixture);
      const claimed = reconciliationState === "leased"
        ? await claimOne(`worker-exact-${reconciliationState}`)
        : null;
      await insertExactReference(fixture, handedOff.payload);

      assert.equal(
        await closeCurrentWriter(fixture, handedOff.payload),
        "referenced",
      );
      assert.deepEqual(await state(fixture, handedOff.attemptToken), {
        session_state: "completed",
        attempt_state: "referenced",
        attempt_outcome: "referenced",
        reconciliation_state: "applied",
        reservation_state: "finalized",
      });
      const closure = (await fixture.ownerPool.query<Readonly<{
        retry_count: number;
        next_attempt_cleared: boolean;
        lease_cleared: boolean;
        error_cleared: boolean;
        applied_at_present: boolean;
      }>>(
        `SELECT
           reconciliation_retry_count AS retry_count,
           reconciliation_next_attempt_at IS NULL AS next_attempt_cleared,
           (
             reconciliation_lease_token IS NULL
             AND reconciliation_lease_owner IS NULL
             AND reconciliation_lease_expires_at IS NULL
           ) AS lease_cleared,
           (
             reconciliation_last_error_code IS NULL
             AND reconciliation_last_error_message IS NULL
           ) AS error_cleared,
           reconciliation_applied_at IS NOT NULL AS applied_at_present
         FROM content.media_blob_writer_attempts
         WHERE attempt_token=$1`,
        [handedOff.attemptToken],
      )).rows[0];
      assert.deepEqual(closure, {
        retry_count: 0,
        next_attempt_cleared: true,
        lease_cleared: true,
        error_cleared: true,
        applied_at_present: true,
      });

      if (claimed !== null) {
        const replay = (await fixture.runtimePool.query<StatusRow>(
          `SELECT content.finish_media_upload_session_completion_reconciliation(
             $1,$2,$3
           ) AS status`,
          [claimed.attemptToken, claimed.leaseToken, 3_600_000],
        )).rows[0].status;
        assert.equal(replay, "already_applied");
      }
    }
  });
});

test("migration 0099 blocks successor attempts while reconciliation is pending or leased", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    for (const reconciliationState of ["pending", "leased"] as const) {
      const handedOff = await createHandedOffAttempt(fixture);
      const claimed = reconciliationState === "leased"
        ? await claimOne(`worker-successor-${reconciliationState}`)
        : null;
      const successorAttemptToken = randomUUID();

      const blockedSuccessor = await beginAttempt(
        fixture,
        successorAttemptToken,
        handedOff.payload,
      );
      assert.equal(blockedSuccessor.attempt_status, "busy");
      assert.equal(blockedSuccessor.reservation_token, null);
      assert.equal(blockedSuccessor.normalization_version, null);
      assert.equal(
        (await fixture.ownerPool.query<CountRow>(
          `SELECT count(*)::int AS count
           FROM content.media_blob_writer_attempts
           WHERE media_upload_session_id=$1`,
          [handedOff.payload.sessionId],
        )).rows[0].count,
        1,
      );

      const failureLease = claimed
        ?? await claimOne(`worker-successor-${reconciliationState}-failure`);
      assert.equal(
        await failMultipartCompletionReconciliation(
          failureLease,
          Date.now() + 30_000,
          {
            code: "RETRY_EXHAUSTED",
            message:
              "Multipart completion reconciliation exhausted its transient retry budget.",
          },
        ),
        "failed",
      );
      assert.deepEqual(await state(fixture, handedOff.attemptToken), {
        session_state: "aborted",
        attempt_state: "unreferenced",
        attempt_outcome: "unreferenced",
        reconciliation_state: "failed",
        reservation_state: "unreferenced",
      });
      assert.equal(
        (
          await beginAttempt(
            fixture,
            successorAttemptToken,
            handedOff.payload,
          )
        ).attempt_status,
        "aborted",
      );
      assert.equal(
        (await fixture.ownerPool.query<CountRow>(
          `SELECT count(*)::int AS count
           FROM content.media_blob_writer_attempts
           WHERE media_upload_session_id=$1`,
          [handedOff.payload.sessionId],
        )).rows[0].count,
        1,
      );
    }
  });
});

test("migration 0099 shares the TypeScript last operation identifier contract", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const values = [
      "550e8400-e29b-41d4-a716-446655440000",
      "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "550e8400-e29b-41d4-a716-446655440000:media:99",
      "operation with internal spaces",
      "a".repeat(1_024),
      "",
      " leading-space",
      "trailing-space ",
      "operation\tcontrol",
      "operation\ncontrol",
      "operation\u00a0nbsp",
      "operation-😀",
      "😀".repeat(512),
      "\ud800",
      "\udc00",
      "a".repeat(1_025),
    ];

    for (const value of values) {
      const sqlValid = (await fixture.ownerPool.query<Readonly<{
        valid: boolean;
      }>>(
        `SELECT content.media_asset_last_operation_id_valid_internal($1)
           AS valid`,
        [value],
      )).rows[0].valid;
      assert.equal(sqlValid, isValidMediaAssetLastOperationId(value), value);
    }
  });
});

test("migration 0099 enforces canonical media asset identifiers without backfilling legacy rows", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const constraint = (await fixture.ownerPool.query<Readonly<{
      validated: boolean;
    }>>(
      `SELECT constraints.convalidated AS validated
       FROM pg_catalog.pg_constraint AS constraints
       INNER JOIN pg_catalog.pg_class AS tables
         ON tables.oid = constraints.conrelid
       INNER JOIN pg_catalog.pg_namespace AS schemas
         ON schemas.oid = tables.relnamespace
       WHERE schemas.nspname = 'content'
         AND tables.relname = 'media_assets'
         AND constraints.conname =
           'media_assets_last_operation_id_canonical'`,
    )).rows[0];
    assert.deepEqual(constraint, { validated: false });

    const legacyMediaAssetId = "09900000-0000-4000-8000-000000000004";
    const legacy = (await fixture.ownerPool.query<Readonly<{
      last_operation_id: string;
    }>>(
      `SELECT last_operation_id
       FROM content.media_assets
       WHERE media_asset_id=$1`,
      [legacyMediaAssetId],
    )).rows[0];
    assert.deepEqual(legacy, {
      last_operation_id: "migration-0099-legacy-\u00a0operation",
    });
    await fixture.ownerPool.query(
      `UPDATE content.media_assets
       SET last_operation_id='migration-0099-legacy-recovered'
       WHERE media_asset_id=$1`,
      [legacyMediaAssetId],
    );

    const sha256 = digest();
    const mediaBlobId = randomUUID();
    const mediaAssetId = randomUUID();
    await fixture.ownerPool.query(
      `INSERT INTO content.media_blobs (
         media_blob_id, sha256, mime_type, size_bytes, storage_key,
         normalization_version
       ) VALUES ($1, $2, 'image/png', 1, $3, 'passthrough-v1')`,
      [mediaBlobId, sha256, buildMediaBlobStorageKey(sha256)],
    );
    await assert.rejects(
      fixture.ownerPool.query(
        `INSERT INTO content.media_assets (
           media_asset_id, workspace_id, media_blob_id, source_url, created_at,
           client_updated_at, last_modified_by_replica_id, last_operation_id
         ) VALUES ($1, $2, $3, NULL, $4, $4, $5, $6)`,
        [
          mediaAssetId,
          fixture.workspaceId,
          mediaBlobId,
          fixture.createdAt,
          fixture.replicaId,
          "new\u00a0invalid-operation",
        ],
      ),
      (error: unknown): boolean => {
        assert.equal((error as Readonly<{ code?: string }>).code, "23514");
        assert.match(
          String((error as Readonly<{ constraint?: string }>).constraint),
          /media_assets_last_operation_id_canonical/,
        );
        return true;
      },
    );
    await fixture.ownerPool.query(
      `INSERT INTO content.media_assets (
         media_asset_id, workspace_id, media_blob_id, source_url, created_at,
         client_updated_at, last_modified_by_replica_id, last_operation_id
       ) VALUES ($1, $2, $3, NULL, $4, $4, $5, $6)`,
      [
        mediaAssetId,
        fixture.workspaceId,
        mediaBlobId,
        fixture.createdAt,
        fixture.replicaId,
        "new-valid-operation",
      ],
    );
    await assert.rejects(
      fixture.ownerPool.query(
        `UPDATE content.media_assets
         SET last_operation_id=$2
         WHERE media_asset_id=$1`,
        [mediaAssetId, "updated\ninvalid-operation"],
      ),
      (error: unknown): boolean => {
        assert.equal((error as Readonly<{ code?: string }>).code, "23514");
        return true;
      },
    );
  });
});

test("migration 0099 rejects a legacy active session before storage and allows canonical replacement", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    await assert.rejects(
      beginMediaAssetUploadSessionCompletionForWorkspace(
        migration0099LegacyUserId,
        migration0099LegacyWorkspaceId,
        migration0099LegacyActiveSessionId,
        [{ partNumber: 1 }],
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 409);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_RESTART_REQUIRED",
        );
        assert.match(error.message, /Abort this upload session/);
        assert.match(error.message, /create a new upload session/);
        return true;
      },
    );

    const preAbortState = (await fixture.ownerPool.query<Readonly<{
      session_state: string;
      attempts: number;
      reservations: number;
    }>>(
      `SELECT
         sessions.state AS session_state,
         (
           SELECT count(*)::int
           FROM content.media_blob_writer_attempts AS attempts
           WHERE attempts.media_upload_session_id =
             sessions.media_upload_session_id
         ) AS attempts,
         (
           SELECT count(*)::int
           FROM content.media_blob_writer_reservations AS reservations
           WHERE reservations.writer_kind = 'multipart_completion'
             AND reservations.workspace_id = sessions.workspace_id
             AND reservations.media_asset_id = sessions.media_asset_id
             AND reservations.operation_id =
               sessions.media_upload_session_id::text
         ) AS reservations
       FROM content.media_upload_sessions AS sessions
       WHERE sessions.media_upload_session_id=$1`,
      [migration0099LegacyActiveSessionId],
    )).rows[0];
    assert.deepEqual(preAbortState, {
      session_state: "active",
      attempts: 0,
      reservations: 0,
    });

    const abortTransition = await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET state='aborting'
       WHERE media_upload_session_id=$1`,
      [migration0099LegacyActiveSessionId],
    );
    assert.equal(abortTransition.rowCount, 1);
    const aborted = await markMediaAssetUploadSessionAbortedForWorkspace(
      migration0099LegacyUserId,
      migration0099LegacyWorkspaceId,
      migration0099LegacyActiveSessionId,
    );
    assert.equal(aborted.state, "aborted");

    const replacementSessionId = randomUUID();
    const replacementOperationId =
      `migration-0099-replacement-${randomUUID()}`;
    const replacement = await recordMediaAssetUploadSessionForWorkspace(
      migration0099LegacyUserId,
      migration0099LegacyWorkspaceId,
      replacementSessionId,
      {
        mediaAssetId: migration0099LegacyActiveMediaAssetId,
        mimeType: "application/octet-stream",
        sizeBytes: 1,
        sha256: migration0099LegacyActiveSha256,
        partSizeBytes: 1,
        partCount: 1,
        sourceUrl: null,
        createdAt: migration0099LegacyTimestamp,
        clientUpdatedAt: migration0099LegacyTimestamp,
        lastModifiedByReplicaId: migration0099LegacyReplicaId,
        lastOperationId: replacementOperationId,
      },
      buildMediaMultipartUploadStagingStorageKey(
        migration0099LegacyWorkspaceId,
        migration0099LegacyActiveMediaAssetId,
        replacementSessionId,
      ),
      buildMediaBlobStorageKey(migration0099LegacyActiveSha256),
      `replacement-upload-${replacementSessionId}`,
      migration0099LegacySessionExpiresAt,
    );
    assert.equal(replacement.status, "upload_required");

    const replacementStart =
      await beginMediaAssetUploadSessionCompletionForWorkspace(
        migration0099LegacyUserId,
        migration0099LegacyWorkspaceId,
        replacementSessionId,
        [{ partNumber: 1 }],
      );
    assert.equal(replacementStart.status, "complete_required");
    const replacementParts = [{
      partNumber: 1,
      eTag: "\"migration-0099-replacement\"",
      sha256: digest(),
    }];
    const replacementSession = replacementStart.uploadSession;
    const replacementAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      userId: migration0099LegacyUserId,
      workspaceId: replacementSession.workspaceId,
      sessionId: replacementSession.sessionId,
      mediaAssetId: replacementSession.mediaAssetId,
      lastModifiedByReplicaId: replacementSession.lastModifiedByReplicaId,
      lastOperationId: replacementSession.lastOperationId,
      sha256: replacementSession.mediaBlobSha256,
      stagingStorageKey: replacementSession.stagingStorageKey,
      blobStorageKey: replacementSession.blobStorageKey,
      s3UploadId: replacementSession.s3UploadId,
      mimeType: replacementSession.mimeType,
      sizeBytes: replacementSession.sizeBytes,
      partSizeBytes: replacementSession.partSizeBytes,
      partCount: replacementSession.partCount,
      sourceUrl: replacementSession.sourceUrl,
      assetCreatedAt: replacementSession.assetCreatedAt,
      clientUpdatedAt: replacementSession.clientUpdatedAt,
      expiresAt: replacementSession.expiresAt,
      attemptToken: randomUUID(),
      normalizationVersion: passthroughMediaBlobNormalizationVersion,
      completedPartsFingerprint:
        createMediaAssetUploadSessionCompletedPartsFingerprint(
          replacementParts,
        ),
    };
    const replacementAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        replacementAttemptInput,
        60_000,
      );
    assert.equal(replacementAttempt.status, "acquired");
    assert.ok("reservationToken" in replacementAttempt);
    const mediaAssetBeforeReplacementCompletion =
      await fixture.ownerPool.query<Readonly<{ media_asset_id: string }>>(
        `SELECT media_asset_id
         FROM content.media_assets
         WHERE workspace_id=$1
           AND media_asset_id=$2`,
        [
          migration0099LegacyWorkspaceId,
          migration0099LegacyActiveMediaAssetId,
        ],
      );
    assert.equal(mediaAssetBeforeReplacementCompletion.rowCount, 0);
    const completed = await completeMediaAssetUploadSessionForWorkspace(
      migration0099LegacyUserId,
      migration0099LegacyWorkspaceId,
      replacementSessionId,
      {
        ...replacementAttemptInput,
        reservationToken: replacementAttempt.reservationToken,
        normalizationVersion: replacementAttempt.normalizationVersion,
      },
    );
    assert.equal(
      completed.mediaAsset.lastOperationId,
      replacementOperationId,
    );

    const converged = (await fixture.ownerPool.query<Readonly<{
      legacy_state: string;
      replacement_state: string;
      completing_sessions: number;
      attempts: number;
      reservations: number;
    }>>(
      `SELECT
         (
           SELECT state
           FROM content.media_upload_sessions
           WHERE media_upload_session_id=$1
         ) AS legacy_state,
         (
           SELECT state
           FROM content.media_upload_sessions
           WHERE media_upload_session_id=$2
         ) AS replacement_state,
         (
           SELECT count(*)::int
           FROM content.media_upload_sessions
           WHERE workspace_id=$3
             AND media_asset_id=$4
             AND state='completing'
         ) AS completing_sessions,
         (
           SELECT count(*)::int
           FROM content.media_blob_writer_attempts
           WHERE media_upload_session_id IN ($1, $2)
         ) AS attempts,
         (
           SELECT count(*)::int
           FROM content.media_blob_writer_reservations
           WHERE writer_kind='multipart_completion'
             AND workspace_id=$3
             AND media_asset_id=$4
         ) AS reservations`,
      [
        migration0099LegacyActiveSessionId,
        replacementSessionId,
        migration0099LegacyWorkspaceId,
        migration0099LegacyActiveMediaAssetId,
      ],
    )).rows[0];
    assert.deepEqual(converged, {
      legacy_state: "aborted",
      replacement_state: "completed",
      completing_sessions: 0,
      attempts: 1,
      reservations: 1,
    });
  });
});

test("migration 0099 safely replays and closes multipart attempts seeded under 0098 legacy identity rules", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const replayPayload = createMigration0099LegacyPayload({
      sessionId: "09910000-0000-4000-8000-000000000001",
      mediaAssetId: "09910000-0000-4000-8000-000000000002",
      sha256: "a".repeat(64),
      lastOperationId: "migration-0099-legacy-\u00a0replay",
      uploadId: "migration-0099-replay-upload",
      partsFingerprint: "1".repeat(64),
    });
    const replayAttemptToken = "09910000-0000-4000-8000-000000000003";
    assert.equal(
      (
        await beginAttemptAs(
          fixture,
          migration0099LegacyUserId,
          migration0099LegacyWorkspaceId,
          replayAttemptToken,
          replayPayload,
        )
      ).attempt_status,
      "aborted",
    );
    assert.equal(
      (
        await beginAttemptAs(
          fixture,
          migration0099LegacyUserId,
          migration0099LegacyWorkspaceId,
          replayAttemptToken,
          {
            ...replayPayload,
            lastOperationId:
              "migration-0099-legacy-\u00a0replay-changed",
          },
        )
      ).attempt_status,
      "aborted",
    );
    assert.equal(
      (await fixture.ownerPool.query<Readonly<{
        last_operation_id: string;
      }>>(
        `SELECT last_operation_id
         FROM content.media_blob_writer_attempts
         WHERE attempt_token=$1`,
        [replayAttemptToken],
      )).rows[0].last_operation_id,
      replayPayload.lastOperationId,
    );

    const cleanupPayload = createMigration0099LegacyPayload({
      sessionId: "09920000-0000-4000-8000-000000000001",
      mediaAssetId: "09920000-0000-4000-8000-000000000002",
      sha256: "b".repeat(64),
      lastOperationId: "migration-0099-legacy-\u00a0cleanup",
      uploadId: "migration-0099-cleanup-upload",
      partsFingerprint: "2".repeat(64),
    });
    const cleanupAttemptToken = "09920000-0000-4000-8000-000000000003";
    assert.equal(
      await closeCurrentWriterAs(
        fixture,
        migration0099LegacyUserId,
        migration0099LegacyWorkspaceId,
        cleanupPayload,
      ),
      "aborted",
    );
    const cleanupState = (await fixture.ownerPool.query<Readonly<{
      attempt_state: string;
      attempt_outcome: string;
      reconciliation_state: string | null;
      reservation_state: string;
      session_state: string;
    }>>(
      `SELECT
         attempts.state AS attempt_state,
         attempts.outcome AS attempt_outcome,
         attempts.reconciliation_state,
         reservations.state AS reservation_state,
         sessions.state AS session_state
       FROM content.media_blob_writer_attempts AS attempts
       INNER JOIN content.media_blob_writer_reservations AS reservations
         ON reservations.reservation_token = attempts.reservation_token
       INNER JOIN content.media_upload_sessions AS sessions
         ON sessions.media_upload_session_id =
           attempts.media_upload_session_id
       WHERE attempts.attempt_token=$1`,
      [cleanupAttemptToken],
    )).rows[0];
    assert.deepEqual(cleanupState, {
      attempt_state: "cancelled",
      attempt_outcome: "aborted",
      reconciliation_state: null,
      reservation_state: "unreferenced",
      session_state: "aborted",
    });

    const handoffPayload = createMigration0099LegacyPayload({
      sessionId: "09930000-0000-4000-8000-000000000001",
      mediaAssetId: "09930000-0000-4000-8000-000000000002",
      sha256: "c".repeat(64),
      lastOperationId: "migration-0099-legacy-\u00a0handoff",
      uploadId: "migration-0099-handoff-upload",
      partsFingerprint: "3".repeat(64),
    });
    const handoffAttemptToken = "09930000-0000-4000-8000-000000000003";
    const replayed = await beginAttemptAs(
      fixture,
      migration0099LegacyUserId,
      migration0099LegacyWorkspaceId,
      handoffAttemptToken,
      handoffPayload,
    );
    assert.equal(replayed.attempt_status, "replayed");
    assert.notEqual(replayed.reservation_token, null);
    assert.equal(
      await handoffAttemptAs(
        fixture,
        migration0099LegacyUserId,
        migration0099LegacyWorkspaceId,
        handoffAttemptToken,
        replayed.reservation_token as string,
        handoffPayload,
      ),
      "handed_off",
    );
    const quarantined = (await fixture.ownerPool.query<Readonly<{
      attempt_state: string;
      attempt_outcome: string;
      reconciliation_state: string;
      error_code: string;
    }>>(
      `SELECT
         state AS attempt_state,
         outcome AS attempt_outcome,
         reconciliation_state,
         reconciliation_last_error_code AS error_code
       FROM content.media_blob_writer_attempts
       WHERE attempt_token=$1`,
      [handoffAttemptToken],
    )).rows[0];
    assert.deepEqual(quarantined, {
      attempt_state: "expired",
      attempt_outcome: "stale_attempt",
      reconciliation_state: "leased",
      error_code: "INVALID_RECONCILIATION_PAYLOAD",
    });

    const legacySuccessorToken = randomUUID();
    assert.equal(
      (
        await beginAttemptAs(
          fixture,
          migration0099LegacyUserId,
          migration0099LegacyWorkspaceId,
          legacySuccessorToken,
          handoffPayload,
        )
      ).attempt_status,
      "stale",
    );
    const changedIdentitySuccessorToken = randomUUID();
    assert.equal(
      (
        await beginAttemptAs(
          fixture,
          migration0099LegacyUserId,
          migration0099LegacyWorkspaceId,
          changedIdentitySuccessorToken,
          {
            ...handoffPayload,
            lastOperationId: "migration-0099-canonical-successor",
          },
        )
      ).attempt_status,
      "stale",
    );
    assert.equal(
      (await fixture.ownerPool.query<CountRow>(
        `SELECT count(*)::int AS count
         FROM content.media_blob_writer_attempts
         WHERE media_upload_session_id=$1`,
        [handoffPayload.sessionId],
      )).rows[0].count,
      1,
    );

    assert.deepEqual(
      await claimMultipartCompletionReconciliations({
        leaseOwner: "worker-legacy-0098-attempt",
        leaseDurationMs: 60_000,
        limit: 1,
        deadlineAtMs: Date.now() + 30_000,
      }),
      [],
    );
    const terminal = (await fixture.ownerPool.query<Readonly<{
      attempt_state: string;
      attempt_outcome: string;
      reconciliation_state: string;
      failure_report_state: string;
      active_reconciliations: number;
      session_attempts: number;
    }>>(
      `SELECT
         attempts.state AS attempt_state,
         attempts.outcome AS attempt_outcome,
         attempts.reconciliation_state,
         attempts.reconciliation_failure_report_state AS failure_report_state,
         (
           SELECT count(*)::int
           FROM content.media_blob_writer_attempts AS active
           WHERE active.media_upload_session_id =
             attempts.media_upload_session_id
             AND active.reconciliation_state IN ('pending', 'leased')
         ) AS active_reconciliations,
         (
           SELECT count(*)::int
           FROM content.media_blob_writer_attempts AS session_attempts
           WHERE session_attempts.media_upload_session_id =
             attempts.media_upload_session_id
         ) AS session_attempts
       FROM content.media_blob_writer_attempts AS attempts
       WHERE attempts.attempt_token=$1`,
      [handoffAttemptToken],
    )).rows[0];
    assert.deepEqual(terminal, {
      attempt_state: "unreferenced",
      attempt_outcome: "unreferenced",
      reconciliation_state: "failed",
      failure_report_state: "pending",
      active_reconciliations: 0,
      session_attempts: 1,
    });
  });
});

test("migration 0099 rejects unsafe operation identifiers before durable handoff", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const payload: MultipartPayload = {
      ...createPayload(fixture),
      lastOperationId: "unsafe\u00a0operation",
    };
    await insertSession(fixture.ownerPool, payload);
    const attemptToken = randomUUID();

    assert.deepEqual(await beginAttempt(fixture, attemptToken, payload), {
      attempt_status: "stale",
      reservation_token: null,
      normalization_version: null,
      lease_expires_at: null,
    });
    assert.equal(
      (await fixture.ownerPool.query<CountRow>(
        `SELECT count(*)::int AS count
         FROM content.media_blob_writer_attempts
         WHERE attempt_token=$1`,
        [attemptToken],
      )).rows[0].count,
      0,
    );
  });
});

test("migration 0099 terminalizes a legacy invalid durable job without leasing it to the worker", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const handedOff = await createHandedOffAttempt(fixture);
    const invalidLastOperationId = "legacy\u00a0operation";

    await assert.rejects(
      fixture.ownerPool.query(
        `UPDATE content.media_blob_writer_attempts
         SET last_operation_id=$2
         WHERE attempt_token=$1`,
        [handedOff.attemptToken, invalidLastOperationId],
      ),
      (error: unknown): boolean => {
        assert.equal((error as Readonly<{ code?: string }>).code, "23514");
        return true;
      },
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
      [handedOff.attemptToken, invalidLastOperationId, randomUUID()],
    );

    assert.deepEqual(
      await claimMultipartCompletionReconciliations({
        leaseOwner: "worker-invalid-legacy",
        leaseDurationMs: 60_000,
        limit: 1,
        deadlineAtMs: Date.now() + 30_000,
      }),
      [],
    );
    assert.deepEqual(await state(fixture, handedOff.attemptToken), {
      session_state: "aborted",
      attempt_state: "unreferenced",
      attempt_outcome: "unreferenced",
      reconciliation_state: "failed",
      reservation_state: "unreferenced",
    });
    const terminal = (await fixture.ownerPool.query<Readonly<{
      error_code: string;
      report_state: string;
      reconciliation_lease_cleared: boolean;
    }>>(
      `SELECT
         reconciliation_last_error_code AS error_code,
         reconciliation_failure_report_state AS report_state,
         (
           reconciliation_lease_token IS NULL
           AND reconciliation_lease_owner IS NULL
           AND reconciliation_lease_expires_at IS NULL
         ) AS reconciliation_lease_cleared
       FROM content.media_blob_writer_attempts
       WHERE attempt_token=$1`,
      [handedOff.attemptToken],
    )).rows[0];
    assert.deepEqual(terminal, {
      error_code: "INVALID_RECONCILIATION_PAYLOAD",
      report_state: "pending",
      reconciliation_lease_cleared: true,
    });
    const report = await claimFailureReportOne(
      "failure-reporter-invalid-legacy",
      handedOff.attemptToken,
    );
    assert.equal(report.errorCode, "INVALID_RECONCILIATION_PAYLOAD");

    const successorAttemptToken = randomUUID();
    assert.equal(
      (
        await beginAttempt(
          fixture,
          successorAttemptToken,
          handedOff.payload,
        )
      ).attempt_status,
      "aborted",
    );
    assert.equal(
      (await fixture.ownerPool.query<CountRow>(
        `SELECT count(*)::int AS count
         FROM content.media_blob_writer_attempts
         WHERE media_upload_session_id=$1`,
        [handedOff.payload.sessionId],
      )).rows[0].count,
      1,
    );
  });
});

test("migration 0099 exact-reference recovery cancels only unclaimed or expired failure reports", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const pending = await createFailedAttempt(
      fixture,
      "worker-failed-exact-pending",
    );
    await insertExactReference(fixture, pending.payload);
    assert.equal(await closeCurrentWriter(fixture, pending.payload), "referenced");

    const expired = await createFailedAttempt(
      fixture,
      "worker-failed-exact-expired",
    );
    const staleReport = await claimFailureReportOne(
      "failure-reporter-expired-before-exact",
      expired.attemptToken,
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET
         reconciliation_failure_report_updated_at =
           reconciliation_handed_off_at,
         reconciliation_failure_report_lease_expires_at =
           reconciliation_handed_off_at + interval '1 microsecond'
       WHERE attempt_token=$1`,
      [expired.attemptToken],
    );
    await insertExactReference(fixture, expired.payload);
    assert.equal(await closeCurrentWriter(fixture, expired.payload), "referenced");

    for (const handedOff of [pending, expired]) {
      assert.deepEqual(await state(fixture, handedOff.attemptToken), {
        session_state: "completed",
        attempt_state: "referenced",
        attempt_outcome: "referenced",
        reconciliation_state: "applied",
        reservation_state: "finalized",
      });
      const recovered = (await fixture.ownerPool.query<Readonly<{
        event_cleared: boolean;
        report_state_cleared: boolean;
        delivery_count: number;
        report_lease_cleared: boolean;
        report_timestamps_cleared: boolean;
      }>>(
        `SELECT
           reconciliation_failure_event_id IS NULL AS event_cleared,
           reconciliation_failure_report_state IS NULL AS report_state_cleared,
           reconciliation_failure_report_delivery_count AS delivery_count,
           (
             reconciliation_failure_report_lease_token IS NULL
             AND reconciliation_failure_report_lease_owner IS NULL
             AND reconciliation_failure_report_lease_expires_at IS NULL
           ) AS report_lease_cleared,
           (
             reconciliation_failure_report_updated_at IS NULL
             AND reconciliation_failure_reported_at IS NULL
           ) AS report_timestamps_cleared
         FROM content.media_blob_writer_attempts
         WHERE attempt_token=$1`,
        [handedOff.attemptToken],
      )).rows[0];
      assert.deepEqual(recovered, {
        event_cleared: true,
        report_state_cleared: true,
        delivery_count: 0,
        report_lease_cleared: true,
        report_timestamps_cleared: true,
      });
    }

    const emittedEventIds: Array<string> = [];
    await assert.rejects(
      deliverMultipartCompletionFailureReport(
        staleReport,
        Date.now() + 30_000,
        (details) => emittedEventIds.push(details.failureEventId),
      ),
      MultipartCompletionFailureReportLeaseLostError,
    );
    assert.deepEqual(emittedEventIds, []);
  });
});

test("migration 0099 serializes active failure reporting with exact-reference recovery", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const handedOff = await createFailedAttempt(
      fixture,
      "worker-failed-exact-active",
    );
    const report = await claimFailureReportOne(
      "failure-reporter-active-before-exact",
      handedOff.attemptToken,
    );
    await insertExactReference(fixture, handedOff.payload);

    assert.equal(
      await closeCurrentWriter(fixture, handedOff.payload),
      "cleanup_claimed",
    );
    assert.equal(
      (await state(fixture, handedOff.attemptToken)).reconciliation_state,
      "failed",
    );

    const emittedEventIds: Array<string> = [];
    let concurrentRecovery: Promise<string> | null = null;
    await deliverMultipartCompletionFailureReport(
      report,
      Date.now() + 30_000,
      (details) => {
        emittedEventIds.push(details.failureEventId);
        concurrentRecovery = closeCurrentWriter(fixture, handedOff.payload);
      },
    );
    if (concurrentRecovery === null) {
      throw new Error("Concurrent exact-reference recovery was not started.");
    }
    assert.equal(await concurrentRecovery, "referenced");
    assert.deepEqual(emittedEventIds, [report.failureEventId]);
    assert.deepEqual(await state(fixture, handedOff.attemptToken), {
      session_state: "completed",
      attempt_state: "referenced",
      attempt_outcome: "referenced",
      reconciliation_state: "applied",
      reservation_state: "finalized",
    });

    const audit = (await fixture.ownerPool.query<Readonly<{
      event_id: string;
      report_state: string;
      delivery_count: number;
      lease_cleared: boolean;
      reported_at_present: boolean;
    }>>(
      `SELECT
         reconciliation_failure_event_id AS event_id,
         reconciliation_failure_report_state AS report_state,
         reconciliation_failure_report_delivery_count AS delivery_count,
         (
           reconciliation_failure_report_lease_token IS NULL
           AND reconciliation_failure_report_lease_owner IS NULL
           AND reconciliation_failure_report_lease_expires_at IS NULL
         ) AS lease_cleared,
         reconciliation_failure_reported_at IS NOT NULL AS reported_at_present
       FROM content.media_blob_writer_attempts
       WHERE attempt_token=$1`,
      [handedOff.attemptToken],
    )).rows[0];
    assert.deepEqual(audit, {
      event_id: report.failureEventId,
      report_state: "reported",
      delivery_count: 1,
      lease_cleared: true,
      reported_at_present: true,
    });

    await deliverMultipartCompletionFailureReport(
      report,
      Date.now() + 30_000,
      (details) => emittedEventIds.push(details.failureEventId),
    );
    assert.deepEqual(emittedEventIds, [report.failureEventId]);
  });
});

test("migration 0099 fences stale reporters before and after durable recovery", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const handedOff = await createFailedAttempt(
      fixture,
      "worker-failed-exact-stale",
    );
    const staleReport = await claimFailureReportOne(
      "failure-reporter-stale",
      handedOff.attemptToken,
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET
         reconciliation_failure_report_updated_at =
           reconciliation_handed_off_at,
         reconciliation_failure_report_lease_expires_at =
           reconciliation_handed_off_at + interval '1 microsecond'
       WHERE attempt_token=$1`,
      [handedOff.attemptToken],
    );
    const currentReport = await claimFailureReportOne(
      "failure-reporter-current",
      handedOff.attemptToken,
    );
    const emittedEventIds: Array<string> = [];

    await assert.rejects(
      deliverMultipartCompletionFailureReport(
        staleReport,
        Date.now() + 30_000,
        (details) => emittedEventIds.push(details.failureEventId),
      ),
      MultipartCompletionFailureReportLeaseLostError,
    );
    await deliverMultipartCompletionFailureReport(
      currentReport,
      Date.now() + 30_000,
      (details) => emittedEventIds.push(details.failureEventId),
    );
    assert.deepEqual(emittedEventIds, [currentReport.failureEventId]);

    await insertExactReference(fixture, handedOff.payload);
    assert.equal(await closeCurrentWriter(fixture, handedOff.payload), "referenced");
    await deliverMultipartCompletionFailureReport(
      staleReport,
      Date.now() + 30_000,
      (details) => emittedEventIds.push(details.failureEventId),
    );
    assert.deepEqual(emittedEventIds, [currentReport.failureEventId]);
  });
});

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { transactionWithWorkspaceScope, type DatabaseExecutor } from "../../database";
import {
  reserveMediaBlobWriterInExecutor,
  type MediaBlobWriterReservation,
} from "../../mediaAssets/blobLifecycle";
import { testObservationScope } from "../../mediaAssets/storage/testHelpers";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../mediaAssets/storageKeys";
import { imageJpegCardMediaBlobNormalizationVersion } from "../../mediaAssets/types";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import { InactiveChatRunClaimError } from "../runs/claimFence";
import {
  claimGeneratedMediaPromotionJobs,
  enqueueGeneratedMediaPromotionJob,
  failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor,
  failGeneratedMediaPromotionJobWithExecutor,
  failGeneratedMediaPromotionJobWithBlobWriterInExecutor,
  GeneratedMediaPromotionJobConflictError,
  GeneratedMediaPromotionJobLeaseLostError,
  isGeneratedMediaPromotionOperationAppliedWithExecutor,
  markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor,
  markGeneratedMediaPromotionJobAppliedWithExecutor,
  rescheduleGeneratedMediaPromotionJobWithExecutor,
  type ClaimedGeneratedMediaPromotionJob,
  type EnqueueGeneratedMediaPromotionJobInput,
} from "./promotionJobs";
import {
  applyGeneratedMediaPromotionJob, failGeneratedMediaPromotionJob,
  processClaimedGeneratedMediaPromotionJobWithDependencies,
  rescheduleGeneratedMediaPromotionJob,
} from "./promotionProcessor";
type RunFixture = Readonly<{ sessionId: string; runId: string; claimToken: string }>;
type ClaimTokenRow = Readonly<{ claim_token: string }>;
type JobStateRow = Readonly<{ state: string; retry_count: number;
  last_error_code: string | null }>;
type SecurityRow = Readonly<{ rls_enabled: boolean; policy_count: string;
  backend_can_update: boolean; backend_can_delete: boolean; auth_can_select: boolean }>;
type RevocationStateRow = Readonly<{
  job_state: string; job_error_code: string | null; reservation_state: string | null;
  cleanup_scheduled: boolean | null;
}>;
type AccessNoOpStateRow = Readonly<{
  job_state: string; job_error_code: string | null; reservation_state: string;
}>;
type RevocationUpgradeRow = Readonly<{
  function_exists: boolean; security_definer: boolean; exact_search_path: boolean;
  backend_execute: boolean; auth_execute: boolean; reporting_execute: boolean;
  backend_reservation_select: boolean; backend_job_update: boolean;
  writer_support_function_exists: boolean;
}>;
const revocationMigrationSql = readFileSync(resolve(
  __dirname, "../../../../../db/migrations/0093_generated_media_writer_revocation.sql",
), "utf8");
async function createRun(fixture: PostgresIntegrationFixture): Promise<RunFixture> {
  const sessionId = randomUUID();
  const runId = randomUUID();
  const assistantItemId = randomUUID();
  const result = await fixture.ownerPool.query<ClaimTokenRow>(
    `WITH inserted_session AS (
       INSERT INTO ai.chat_sessions (
         session_id, user_id, workspace_id, status, active_run_id
       ) VALUES ($1, $2, $3, 'running', $4)
     ), inserted_item AS (
       INSERT INTO ai.chat_items (item_id, session_id, item_kind, state, payload)
       VALUES ($5, $1, 'message', 'in_progress', '{"role":"assistant","content":[]}'::jsonb)
     )
     INSERT INTO ai.chat_runs (
       run_id, session_id, assistant_item_id, status, request_id, model_id,
       reasoning_effort, timezone, turn_input, worker_claimed_at,
       worker_heartbeat_at, started_at
     ) VALUES (
       $4, $1, $5, 'running', $6, 'gpt-5.4', 'medium', 'Europe/Madrid',
       '[]'::jsonb, statement_timestamp(), statement_timestamp(), statement_timestamp()
     )
     RETURNING worker_claimed_at::text AS claim_token`,
    [
      sessionId, fixture.userId, fixture.workspaceId, runId,
      assistantItemId, `promotion-job-${runId}`,
    ],
  );
  const claimToken = result.rows[0]?.claim_token;
  if (claimToken === undefined) throw new Error(`Run fixture has no claim token. runId=${runId}`);
  return { sessionId, runId, claimToken };
}
function createInput(fixture: PostgresIntegrationFixture, run: RunFixture):
EnqueueGeneratedMediaPromotionJobInput {
  const jobId = randomUUID();
  const operationId = randomUUID();
  const mediaAssetId = randomUUID();
  const sha256 = "e4514fb8fbc32fb38d301d03c556edbf81e27aebbe7039b9eb40e3352ac2147f";
  return {
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
    sessionId: run.sessionId,
    runId: run.runId,
    claimToken: run.claimToken,
    deadlineAtMs: Date.now() + 10_000,
    jobId,
    operationId,
    cardId: fixture.cardId,
    targetSide: "back",
    altText: "Generated integration image",
    mediaAssetId,
    replicaId: fixture.replicaId,
    stagingStorageKey: buildMediaUploadStagingStorageKey(fixture.workspaceId, mediaAssetId, operationId),
    blobStorageKey: buildMediaBlobStorageKey(sha256),
    sha256,
    mimeType: "image/jpeg",
    sizeBytes: 4096,
  };
}
async function transition<Result>(fixture: PostgresIntegrationFixture,
  callback: (executor: DatabaseExecutor) => Promise<Result>): Promise<Result> {
  return transactionWithWorkspaceScope(
    { userId: fixture.userId, workspaceId: fixture.workspaceId },
    callback,
  );
}
function byJobId(jobs: ReadonlyArray<ClaimedGeneratedMediaPromotionJob>,
  jobId: string): ClaimedGeneratedMediaPromotionJob {
  const job = jobs.find((candidate) => candidate.jobId === jobId);
  if (job === undefined) throw new Error(`Claimed job was not found. jobId=${jobId}`);
  return job;
}
function claim(leaseOwner: string, limit: number):
Promise<ReadonlyArray<ClaimedGeneratedMediaPromotionJob>> {
  return claimGeneratedMediaPromotionJobs({
    leaseOwner, leaseDurationMs: 60_000, limit, deadlineAtMs: Date.now() + 10_000,
  });
}
function hasPostgresCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function uniqueSha256(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}
function withSha256(
  input: EnqueueGeneratedMediaPromotionJobInput,
  sha256: string,
): EnqueueGeneratedMediaPromotionJobInput {
  return { ...input, sha256, blobStorageKey: buildMediaBlobStorageKey(sha256) };
}
async function reserveGeneratedWriter(
  fixture: PostgresIntegrationFixture,
  job: ClaimedGeneratedMediaPromotionJob,
  sha256: string,
): Promise<MediaBlobWriterReservation> {
  return transition(fixture, (executor) => reserveMediaBlobWriterInExecutor(executor, {
    writerKind: "generated_promotion",
    workspaceId: job.workspaceId,
    mediaAssetId: job.mediaAssetId,
    operationId: job.operationId,
    sha256,
    storageKey: buildMediaBlobStorageKey(sha256),
    mimeType: job.mimeType,
    sizeBytes: job.sizeBytes,
    normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
  }));
}
function revocationParams(job: ClaimedGeneratedMediaPromotionJob): Array<string | number> {
  return [
    job.jobId, job.leaseToken, job.operationId, job.userId, job.workspaceId,
    job.cardId, job.targetSide, job.altText, job.mediaAssetId, job.replicaId,
    job.stagingStorageKey, job.blobStorageKey, job.sha256, job.mimeType,
    job.sizeBytes, 3_600_000,
  ];
}
async function rawRevocationStatus(
  fixture: PostgresIntegrationFixture,
  params: ReadonlyArray<string | number>,
): Promise<string> {
  const result = await fixture.runtimePool.query<{ revocation_status: string }>(
    `SELECT content.fail_generated_media_promotion_job_after_access_revocation(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
     ) AS revocation_status`,
    [...params],
  );
  const status = result.rows[0]?.revocation_status;
  if (status === undefined) throw new Error("PostgreSQL returned no revocation status.");
  return status;
}
async function loadAccessNoOpState(
  fixture: PostgresIntegrationFixture,
  jobId: string,
  reservationToken: string,
): Promise<AccessNoOpStateRow | undefined> {
  const result = await fixture.ownerPool.query<AccessNoOpStateRow>(
    `SELECT
       jobs.state AS job_state,
       jobs.last_error_code AS job_error_code,
       reservations.state AS reservation_state
     FROM content.generated_media_promotion_jobs AS jobs
     INNER JOIN content.media_blob_writer_reservations AS reservations
       ON reservations.reservation_token = $2
     WHERE jobs.job_id = $1`,
    [jobId, reservationToken],
  );
  return result.rows[0];
}
async function assertRevocationMigrationUpgrade(
  fixture: PostgresIntegrationFixture,
): Promise<void> {
  const client = await fixture.ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      DROP FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
        UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
        TEXT, TEXT, BIGINT, INTEGER
      )
    `);
    await client.query(revocationMigrationSql);
    const upgrade = await client.query<RevocationUpgradeRow>(
      `SELECT
         to_regprocedure(
           'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,integer)'
         ) IS NOT NULL AS function_exists,
         procedures.prosecdef AS security_definer,
         procedures.proconfig = ARRAY['search_path=pg_catalog'] AS exact_search_path,
         has_function_privilege(
           'backend_app',
           'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,integer)',
           'EXECUTE'
         ) AS backend_execute,
         has_function_privilege(
           'auth_app',
           'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,integer)',
           'EXECUTE'
         ) AS auth_execute,
         has_function_privilege(
           'reporting_readonly',
           'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,integer)',
           'EXECUTE'
         ) AS reporting_execute,
         has_table_privilege(
           'backend_app', 'content.media_blob_writer_reservations', 'SELECT'
         ) AS backend_reservation_select,
         has_table_privilege(
           'backend_app', 'content.generated_media_promotion_jobs', 'UPDATE'
         ) AS backend_job_update,
         to_regprocedure(
           'content.fail_generated_media_promotion_job_with_blob_writer(uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,text,text,text,integer)'
         ) IS NOT NULL AS writer_support_function_exists
       FROM pg_proc AS procedures
       WHERE procedures.oid = to_regprocedure(
         'content.fail_generated_media_promotion_job_after_access_revocation(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text,text,text,bigint,integer)'
       )`,
    );
    assert.deepEqual(upgrade.rows[0], {
      function_exists: true,
      security_definer: true,
      exact_search_path: true,
      backend_execute: true,
      auth_execute: false,
      reporting_execute: false,
      backend_reservation_select: false,
      backend_job_update: false,
      writer_support_function_exists: true,
    });
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
test("promotion jobs enforce enqueue identity, global leasing, fencing, and RLS", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createRun(fixture);
    const concurrentInput = { ...createInput(fixture, run), targetSide: "front" as const };
    await assert.rejects(
      enqueueGeneratedMediaPromotionJob({ ...concurrentInput, claimToken: new Date(0).toISOString() }),
      InactiveChatRunClaimError,
    );
    await fixture.ownerPool.query(
      "UPDATE ai.chat_runs SET cancel_requested_at = now() WHERE run_id = $1",
      [run.runId],
    );
    await assert.rejects(
      enqueueGeneratedMediaPromotionJob(concurrentInput),
      InactiveChatRunClaimError,
    );
    await fixture.ownerPool.query(
      "UPDATE ai.chat_runs SET cancel_requested_at = NULL WHERE run_id = $1",
      [run.runId],
    );
    await fixture.ownerPool.query(
      "UPDATE sync.workspace_replicas SET user_id = 'unowned-replica-user' WHERE replica_id = $1", [fixture.replicaId]);
    await assert.rejects(
      enqueueGeneratedMediaPromotionJob(concurrentInput), (error: unknown) =>
        hasPostgresCode(error, "MEDIA_ASSET_REPLICA_INVALID"),
    );
    await fixture.ownerPool.query(
      "UPDATE sync.workspace_replicas SET user_id = $1 WHERE replica_id = $2", [fixture.userId, fixture.replicaId]);
    const concurrentEnqueue = await Promise.all([
      enqueueGeneratedMediaPromotionJob(concurrentInput),
      enqueueGeneratedMediaPromotionJob(concurrentInput),
    ]);
    assert.deepEqual(concurrentEnqueue.map((result) => result.outcome).sort(), [
      "created", "existing",
    ]);
    assert.deepEqual(
      await enqueueGeneratedMediaPromotionJob(concurrentInput),
      { outcome: "existing", jobId: concurrentInput.jobId },
    );
    await assert.rejects(
      enqueueGeneratedMediaPromotionJob({
        ...concurrentInput,
        altText: "Different immutable alt text",
      }),
      GeneratedMediaPromotionJobConflictError,
    );
    const inputs = [
      concurrentInput,
      createInput(fixture, run),
      createInput(fixture, run),
      createInput(fixture, run),
    ];
    for (const input of inputs.slice(1)) {
      assert.equal((await enqueueGeneratedMediaPromotionJob(input)).outcome, "created");
    }
    const wrongScopeCount = await transactionWithWorkspaceScope(
      { userId: fixture.userId, workspaceId: randomUUID() },
      async (executor) => executor.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM content.generated_media_promotion_jobs",
        [],
      ),
    );
    assert.equal(wrongScopeCount.rows[0]?.count, "0");
    const claims = await Promise.all([
      claim("integration-worker-a", 2),
      claim("integration-worker-b", 2),
    ]);
    const claimed = claims.flat();
    assert.equal(claimed.length, 4);
    assert.equal(new Set(claimed.map((job) => job.jobId)).size, 4);
    assert.equal(new Set(claimed.map((job) => job.leaseToken)).size, 4);
    const applied = byJobId(claimed, inputs[0]?.jobId ?? "");
    assert.equal(applied.userId, fixture.userId);
    await fixture.ownerPool.query(
      "UPDATE sync.workspace_replicas SET user_id = 'reassigned-user' WHERE replica_id = $1",
      [fixture.replicaId],
    );
    await assert.rejects(
      transition(fixture, async (executor) =>
        markGeneratedMediaPromotionJobAppliedWithExecutor(executor, {
          jobId: applied.jobId,
          leaseToken: randomUUID(),
        })),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    await applyGeneratedMediaPromotionJob(applied, Date.now() + 10_000);
    await transition(fixture, async (executor) => {
      assert.equal(await isGeneratedMediaPromotionOperationAppliedWithExecutor(
        executor, applied.jobId, applied.operationId,
      ), true);
      assert.equal(await isGeneratedMediaPromotionOperationAppliedWithExecutor(
        executor, applied.jobId, randomUUID(),
      ), false);
    });
    const appliedCard = await fixture.ownerPool.query<{ front_text: string; back_text: string }>(
      "SELECT front_text, back_text FROM content.cards WHERE workspace_id = $1 AND card_id = $2",
      [fixture.workspaceId, fixture.cardId],
    );
    assert.equal(appliedCard.rows[0]?.back_text, "Original answer");
    assert.equal(
      appliedCard.rows[0]?.front_text.match(new RegExp(`fcasset:${applied.mediaAssetId}`, "gu"))?.length,
      1,
    );
    assert.ok(appliedCard.rows[0]?.front_text.startsWith("Original question\n\n![Generated integration image]"));
    assert.equal(
      (await fixture.ownerPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM content.media_assets WHERE media_asset_id = $1",
        [applied.mediaAssetId],
      )).rows[0]?.count,
      "1",
    );
    const rescheduled = byJobId(claimed, inputs[1]?.jobId ?? "");
    const nextAttemptAt = new Date(Date.now() + 60_000);
    const retryError = { code: "S3_TRANSIENT", message: "Temporary object-store failure." };
    await assert.rejects(
      transition(fixture, async (executor) =>
        rescheduleGeneratedMediaPromotionJobWithExecutor(executor, {
          ...rescheduled, leaseToken: randomUUID(), nextAttemptAt, error: retryError,
        })),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    await assert.rejects(
      fixture.ownerPool.query(
        `SELECT content.reschedule_generated_media_promotion_job(
           $1, $2, statement_timestamp(), 'S3_TRANSIENT', NULL)`,
        [rescheduled.jobId, rescheduled.leaseToken],
      ),
      (error: unknown) => hasPostgresCode(error, "23514"),
    );
    await transition(fixture, async (executor) =>
      rescheduleGeneratedMediaPromotionJobWithExecutor(executor, {
        ...rescheduled, nextAttemptAt, error: retryError,
      }));
    const reclaimedInput = inputs[2];
    if (reclaimedInput === undefined) throw new Error("Missing reclaim input.");
    const expired = byJobId(claimed, reclaimedInput.jobId);
    const writer = await transition(fixture, async (executor) =>
      reserveMediaBlobWriterInExecutor(executor, {
        writerKind: "generated_promotion", workspaceId: expired.workspaceId,
        mediaAssetId: expired.mediaAssetId, operationId: expired.operationId,
        sha256: expired.sha256, storageKey: expired.blobStorageKey,
        mimeType: expired.mimeType, sizeBytes: expired.sizeBytes,
        normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
      }));
    const writerInput = {
      ...expired, reservationToken: writer.reservationToken,
      normalizationVersion: writer.normalizationVersion,
    };
    await assert.rejects(
      transition(fixture, (executor) =>
        markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor(executor, {
          ...writerInput, leaseToken: randomUUID(),
        })),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    await transition(fixture, (executor) =>
      markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor(executor, writerInput));
    await fixture.ownerPool.query(
      `UPDATE content.generated_media_promotion_jobs
       SET updated_at = created_at,
           lease_expires_at = created_at + interval '1 millisecond'
       WHERE job_id = $1`,
      [expired.jobId],
    );
    const reclaimed = byJobId(
      await claim("integration-reclaimer", 1),
      expired.jobId,
    );
    assert.notEqual(reclaimed.leaseToken, expired.leaseToken);
    await assert.rejects(
      transition(fixture, (executor) =>
        markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor(executor, writerInput)),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    const rescheduledState = await fixture.ownerPool.query<JobStateRow>(
      `SELECT state, retry_count, last_error_code
       FROM content.generated_media_promotion_jobs WHERE job_id = $1`,
      [rescheduled.jobId],
    );
    assert.deepEqual(rescheduledState.rows[0], {
      state: "pending",
      retry_count: 1,
      last_error_code: "S3_TRANSIENT",
    });
    await assert.rejects(
      transition(fixture, async (executor) =>
        failGeneratedMediaPromotionJobWithBlobWriterInExecutor(executor, {
          ...writerInput,
          error: { code: "STALE_WORKER", message: "Stale worker must be fenced." },
        })),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    await transition(fixture, async (executor) =>
      failGeneratedMediaPromotionJobWithBlobWriterInExecutor(executor, {
        ...reclaimed, reservationToken: writer.reservationToken,
        normalizationVersion: writer.normalizationVersion,
        error: { code: "CORRUPT_STAGING", message: "Staged object proof is invalid." },
      }));
    assert.deepEqual((await fixture.ownerPool.query<{
      job_state: string; reservation_state: string;
    }>(
      `SELECT jobs.state AS job_state, reservations.state AS reservation_state
       FROM content.generated_media_promotion_jobs AS jobs
       INNER JOIN content.media_blob_writer_reservations AS reservations
         ON reservations.reservation_token = $2
       WHERE jobs.job_id = $1`,
      [reclaimed.jobId, writer.reservationToken],
    )).rows[0], { job_state: "failed", reservation_state: "unreferenced" });
    const terminalInput = inputs[3];
    if (terminalInput === undefined) throw new Error("Missing terminal input.");
    const terminal = byJobId(claimed, terminalInput.jobId);
    await fixture.ownerPool.query(
      "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
      [fixture.workspaceId, fixture.userId],
    );
    const revokedResult = await processClaimedGeneratedMediaPromotionJobWithDependencies(
      terminal,
      {
        leaseOwner: "integration-revoked", leaseDurationMs: 60_000,
        maximumJobs: 1, deadlineAtMs: Date.now() + 10_000,
        observationScope: testObservationScope, signal: new AbortController().signal,
      },
      {
        claimJobsFn: claimGeneratedMediaPromotionJobs,
        promoteObjectFn: async () => {},
        applyJobFn: applyGeneratedMediaPromotionJob,
        rescheduleJobFn: rescheduleGeneratedMediaPromotionJob,
        failJobFn: failGeneratedMediaPromotionJob,
        nowFn: Date.now,
      },
    );
    assert.equal(revokedResult.outcome, "failed");
    assert.equal(revokedResult.errorCode, "WORKSPACE_ACCESS_REVOKED");
    await assert.rejects(
      transition(fixture, async (executor) =>
        failGeneratedMediaPromotionJobWithExecutor(executor, {
          ...terminal,
          error: { code: "UNSAFE\nCODE", message: "Unsafe error." },
        })),
      TypeError,
    );
    const security = await fixture.ownerPool.query<SecurityRow>(
      `SELECT
         relrowsecurity AS rls_enabled,
         (SELECT count(*)::text FROM pg_policies
          WHERE schemaname = 'content'
            AND tablename = 'generated_media_promotion_jobs') AS policy_count,
         has_table_privilege('backend_app', 'content.generated_media_promotion_jobs', 'UPDATE')
           AS backend_can_update,
         has_table_privilege('backend_app', 'content.generated_media_promotion_jobs', 'DELETE')
           AS backend_can_delete,
         has_table_privilege('auth_app', 'content.generated_media_promotion_jobs', 'SELECT')
           AS auth_can_select
       FROM pg_class
       WHERE oid = 'content.generated_media_promotion_jobs'::regclass`,
    );
    assert.deepEqual(security.rows[0], {
      rls_enabled: true,
      policy_count: "2",
      backend_can_update: false,
      backend_can_delete: false,
      auth_can_select: false,
    });
    await assert.rejects(
      fixture.ownerPool.query(
        "UPDATE content.generated_media_promotion_jobs SET alt_text = 'Changed' WHERE job_id = $1",
        [applied.jobId],
      ),
      (error: unknown) => hasPostgresCode(error, "23514"),
    );
  });
});
test("access revocation resolves an exact generated writer and fences stale leases", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    await assertRevocationMigrationUpgrade(fixture);
    const run = await createRun(fixture);
    const inputs = Array.from(
      { length: 6 },
      () => withSha256(createInput(fixture, run), uniqueSha256()),
    );
    for (const input of inputs) {
      assert.equal((await enqueueGeneratedMediaPromotionJob(input)).outcome, "created");
    }
    const initiallyClaimed = await claim("revocation-integration-initial", inputs.length);
    const rescheduled = byJobId(initiallyClaimed, inputs[0]?.jobId ?? "");
    const ambiguous = byJobId(initiallyClaimed, inputs[1]?.jobId ?? "");
    const absent = byJobId(initiallyClaimed, inputs[2]?.jobId ?? "");
    const expired = byJobId(initiallyClaimed, inputs[3]?.jobId ?? "");
    const applied = byJobId(initiallyClaimed, inputs[4]?.jobId ?? "");
    const metadataConflict = byJobId(initiallyClaimed, inputs[5]?.jobId ?? "");
    const rescheduledWriter = await reserveGeneratedWriter(
      fixture, rescheduled, rescheduled.sha256,
    );
    const ambiguousWriter = await reserveGeneratedWriter(
      fixture, ambiguous, ambiguous.sha256,
    );
    const expiredWriter = await reserveGeneratedWriter(
      fixture, expired, expired.sha256,
    );
    const conflictingSha256 = uniqueSha256();
    const metadataConflictWriter = await reserveGeneratedWriter(
      fixture, metadataConflict, conflictingSha256,
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, rescheduled,
      ),
      "access_active",
    );
    assert.deepEqual(
      await loadAccessNoOpState(
        fixture, rescheduled.jobId, rescheduledWriter.reservationToken,
      ),
      {
        job_state: "leased",
        job_error_code: null,
        reservation_state: "active",
      },
    );
    await transition(fixture, (executor) =>
      markGeneratedMediaPromotionBlobWriterAmbiguousWithExecutor(executor, {
        ...ambiguous,
        reservationToken: ambiguousWriter.reservationToken,
        normalizationVersion: ambiguousWriter.normalizationVersion,
      }));
    await transition(fixture, (executor) =>
      markGeneratedMediaPromotionJobAppliedWithExecutor(executor, applied));
    await transition(fixture, (executor) =>
      rescheduleGeneratedMediaPromotionJobWithExecutor(executor, {
        ...rescheduled,
        nextAttemptAt: new Date(),
        error: {
          code: "DATABASE_TRANSIENT",
          message: "Reservation commit outcome requires deterministic replay.",
        },
      }));
    await fixture.ownerPool.query(
      `UPDATE content.generated_media_promotion_jobs
       SET updated_at = created_at,
           lease_expires_at = created_at + interval '1 millisecond'
       WHERE job_id = $1`,
      [expired.jobId],
    );
    await fixture.ownerPool.query(
      "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
      [fixture.workspaceId, fixture.userId],
    );
    await fixture.ownerPool.query(
      "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [fixture.workspaceId, fixture.userId],
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, ambiguous,
      ),
      "access_active",
    );
    assert.deepEqual(
      await loadAccessNoOpState(
        fixture, ambiguous.jobId, ambiguousWriter.reservationToken,
      ),
      {
        job_state: "leased",
        job_error_code: "DATABASE_COMMIT_OUTCOME_UNKNOWN",
        reservation_state: "ambiguous",
      },
    );
    await fixture.ownerPool.query(
      "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
      [fixture.workspaceId, fixture.userId],
    );
    await assert.rejects(
      failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, expired,
      ),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    const reclaimed = await claim("revocation-integration-reclaimer", 2);
    const reclaimedRescheduled = byJobId(reclaimed, rescheduled.jobId);
    const replacement = byJobId(reclaimed, expired.jobId);
    assert.notEqual(replacement.leaseToken, expired.leaseToken);
    await assert.rejects(
      failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, expired,
      ),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    const mismatchedPayloadParams = revocationParams(reclaimedRescheduled);
    mismatchedPayloadParams[6] = reclaimedRescheduled.targetSide === "front" ? "back" : "front";
    assert.equal(
      await rawRevocationStatus(fixture, mismatchedPayloadParams),
      "stale",
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, reclaimedRescheduled,
      ),
      "failed",
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, ambiguous,
      ),
      "failed",
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, absent,
      ),
      "failed",
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, replacement,
      ),
      "failed",
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, applied,
      ),
      "applied",
    );
    const wrongIdentityParams = revocationParams(metadataConflict);
    const wrongMediaAssetId = randomUUID();
    wrongIdentityParams[8] = wrongMediaAssetId;
    wrongIdentityParams[10] = buildMediaUploadStagingStorageKey(
      metadataConflict.workspaceId,
      wrongMediaAssetId,
      metadataConflict.operationId,
    );
    assert.equal(await rawRevocationStatus(fixture, wrongIdentityParams), "stale");
    await assert.rejects(
      failGeneratedMediaPromotionJobAfterAccessRevocationWithExecutor(
        fixture.runtimePool, metadataConflict,
      ),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    for (const [job, reservation] of [
      [reclaimedRescheduled, rescheduledWriter],
      [ambiguous, ambiguousWriter],
      [replacement, expiredWriter],
    ] as const) {
      const state = await fixture.ownerPool.query<RevocationStateRow>(
        `SELECT
           jobs.state AS job_state,
           jobs.last_error_code AS job_error_code,
           reservations.state AS reservation_state,
           lifecycles.cleanup_eligible_at IS NOT NULL AS cleanup_scheduled
         FROM content.generated_media_promotion_jobs AS jobs
         INNER JOIN content.media_blob_writer_reservations AS reservations
           ON reservations.reservation_token = $2
         INNER JOIN content.media_blob_lifecycles AS lifecycles
           ON lifecycles.sha256 = reservations.sha256
         WHERE jobs.job_id = $1`,
        [job.jobId, reservation.reservationToken],
      );
      assert.deepEqual(state.rows[0], {
        job_state: "failed",
        job_error_code: "WORKSPACE_ACCESS_REVOKED",
        reservation_state: "unreferenced",
        cleanup_scheduled: true,
      });
    }
    assert.deepEqual((await fixture.ownerPool.query<RevocationStateRow>(
      `SELECT
         jobs.state AS job_state,
         jobs.last_error_code AS job_error_code,
         NULL::TEXT AS reservation_state,
         NULL::BOOLEAN AS cleanup_scheduled
       FROM content.generated_media_promotion_jobs AS jobs
       WHERE jobs.job_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM content.media_blob_writer_reservations AS reservations
           WHERE reservations.writer_kind = 'generated_promotion'
             AND reservations.workspace_id = jobs.workspace_id
             AND reservations.media_asset_id = jobs.media_asset_id
             AND reservations.operation_id = jobs.operation_id::TEXT
         )`,
      [absent.jobId],
    )).rows[0], {
      job_state: "failed",
      job_error_code: "WORKSPACE_ACCESS_REVOKED",
      reservation_state: null,
      cleanup_scheduled: null,
    });
    assert.deepEqual((await fixture.ownerPool.query<{
      state: string; last_error_code: string | null;
    }>(
      `SELECT state, last_error_code
       FROM content.generated_media_promotion_jobs
       WHERE job_id = $1`,
      [applied.jobId],
    )).rows[0], { state: "applied", last_error_code: null });
    assert.deepEqual((await fixture.ownerPool.query<{
      job_state: string; reservation_state: string; reservation_sha256: string;
    }>(
      `SELECT
         jobs.state AS job_state,
         reservations.state AS reservation_state,
         reservations.sha256 AS reservation_sha256
       FROM content.generated_media_promotion_jobs AS jobs
       INNER JOIN content.media_blob_writer_reservations AS reservations
         ON reservations.reservation_token = $2
       WHERE jobs.job_id = $1`,
      [metadataConflict.jobId, metadataConflictWriter.reservationToken],
    )).rows[0], {
      job_state: "leased",
      reservation_state: "active",
      reservation_sha256: conflictingSha256,
    });
    await assert.rejects(
      fixture.runtimePool.query(
        "SELECT reservation_token FROM content.media_blob_writer_reservations LIMIT 1",
      ),
      (error: unknown) => hasPostgresCode(error, "42501"),
    );
    await assert.rejects(
      fixture.runtimePool.query(
        "UPDATE content.generated_media_promotion_jobs SET retry_count = retry_count WHERE job_id = $1",
        [metadataConflict.jobId],
      ),
      (error: unknown) => hasPostgresCode(error, "42501"),
    );
  });
});

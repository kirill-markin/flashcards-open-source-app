import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { transactionWithWorkspaceScope, type DatabaseExecutor } from "../../database";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../mediaAssets/storageKeys";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import { InactiveChatRunClaimError } from "../runs/claimFence";
import {
  claimGeneratedMediaPromotionJobs,
  enqueueGeneratedMediaPromotionJob,
  failGeneratedMediaPromotionJobWithExecutor,
  GeneratedMediaPromotionJobConflictError,
  GeneratedMediaPromotionJobLeaseLostError,
  markGeneratedMediaPromotionJobAppliedWithExecutor,
  rescheduleGeneratedMediaPromotionJobWithExecutor,
  type ClaimedGeneratedMediaPromotionJob,
  type EnqueueGeneratedMediaPromotionJobInput,
} from "./promotionJobs";
type RunFixture = Readonly<{ sessionId: string; runId: string; claimToken: string }>;
type ClaimTokenRow = Readonly<{ claim_token: string }>;
type JobStateRow = Readonly<{ state: string; retry_count: number;
  last_error_code: string | null }>;
type SecurityRow = Readonly<{ rls_enabled: boolean; policy_count: string;
  backend_can_update: boolean; backend_can_delete: boolean; auth_can_select: boolean }>;
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
  const sha256 = "8349792a6784cfdc5061b34e1184c85bcdb13719e86ac4be576e52e5e8c5f603";
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
async function transition(fixture: PostgresIntegrationFixture,
  callback: (executor: DatabaseExecutor) => Promise<void>): Promise<void> {
  await transactionWithWorkspaceScope(
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
test("promotion jobs enforce enqueue identity, global leasing, fencing, and RLS", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createRun(fixture);
    const concurrentInput = createInput(fixture, run);
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
    await assert.rejects(
      transition(fixture, async (executor) =>
        markGeneratedMediaPromotionJobAppliedWithExecutor(executor, {
          jobId: applied.jobId,
          leaseToken: randomUUID(),
        })),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    await transition(fixture, async (executor) =>
      markGeneratedMediaPromotionJobAppliedWithExecutor(executor, applied));
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
        failGeneratedMediaPromotionJobWithExecutor(executor, {
          ...expired,
          error: { code: "STALE_WORKER", message: "Stale worker must be fenced." },
        })),
      GeneratedMediaPromotionJobLeaseLostError,
    );
    await transition(fixture, async (executor) =>
      failGeneratedMediaPromotionJobWithExecutor(executor, {
        ...reclaimed,
        error: { code: "CORRUPT_STAGING", message: "Staged object proof is invalid." },
      }));
    const terminalInput = inputs[3];
    if (terminalInput === undefined) throw new Error("Missing terminal input.");
    const terminal = byJobId(claimed, terminalInput.jobId);
    await transition(fixture, async (executor) =>
      failGeneratedMediaPromotionJobWithExecutor(executor, {
        ...terminal,
        error: { code: "IMMUTABLE_CONFLICT", message: "Immutable payload conflict." },
      }));
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

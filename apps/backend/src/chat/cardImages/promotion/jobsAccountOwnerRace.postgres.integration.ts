import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { testObservationScope } from "../../../mediaAssets/storage/testHelpers";
import {
  claimGeneratedMediaPromotionJobs,
  failGeneratedMediaPromotionJobAfterAccessRevocation,
  markGeneratedMediaBlobWriterAmbiguous,
  reserveGeneratedMediaBlobWriter,
} from "./jobs";
import {
  exactJobParams,
  lockStatus,
  originalJobIdentity,
  retireGeneratedOwner,
  waitForBlocker,
  withGeneratedOwnerFixture,
} from "./jobsAccountOwnerPostgresTestSupport";
import {
  applyGeneratedMediaPromotionJob,
  failGeneratedMediaPromotionJob,
  processClaimedGeneratedMediaPromotionJobWithDependencies,
  rescheduleGeneratedMediaPromotionJob,
} from "./processor";

test("generated job scope refuses stale account snapshots and competing retirement fences", async () => {
  await withGeneratedOwnerFixture(async ({ fixture, targetUserId, laterUserId, jobs }) => {
    const job = jobs[0];
    assert.ok(job);
    const identity = await originalJobIdentity(fixture, job);
    const runtime = await fixture.runtimePool.connect();
    const owner = await fixture.ownerPool.connect();
    try {
      await runtime.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await runtime.query("SELECT user_id FROM org.user_settings WHERE user_id = $1", [fixture.userId]);
      await retireGeneratedOwner(fixture, targetUserId);
      await assert.rejects(runtime.query(
        "SELECT content.apply_generated_media_promotion_job_scope($1,$2)", [job.jobId, job.leaseToken],
      ), { code: "P0A01" });
      await runtime.query("ROLLBACK");

      await owner.query("BEGIN");
      await owner.query("SELECT auth.lock_account_retirement($1,$2)", [targetUserId, laterUserId]);
      assert.equal(await lockStatus(runtime, { ...job, userId: targetUserId }), "stale");
      assert.equal(await lockStatus(runtime, { ...job, leaseToken: randomUUID() }), "stale");
      await assert.rejects(lockStatus(runtime, job), { code: "P0A01" });
      await assert.rejects(runtime.query(
        "SELECT content.apply_generated_media_promotion_job_scope($1,$2)", [job.jobId, job.leaseToken],
      ), { code: "P0A01" });
      await assert.rejects(reserveGeneratedMediaBlobWriter(job, Date.now() + 10_000), {
        code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409,
      });
      const beforeProcessing = await fixture.ownerPool.query<{ state: string; retry_count: number }>(
        "SELECT * FROM content.generated_media_promotion_jobs WHERE job_id = $1", [job.jobId],
      );
      assert.equal(beforeProcessing.rows[0]?.state, "leased");
      assert.equal(beforeProcessing.rows[0]?.retry_count, job.retryCount);
      const calls = { failure: 0, reschedule: 0, accessRevocation: 0 };
      await assert.rejects(processClaimedGeneratedMediaPromotionJobWithDependencies(
        job,
        {
          leaseOwner: job.leaseOwner, leaseDurationMs: 60_000,
          maximumJobs: 1, deadlineAtMs: Date.now() + 10_000,
          observationScope: testObservationScope, signal: new AbortController().signal,
        },
        {
          claimJobsFn: claimGeneratedMediaPromotionJobs,
          reserveWriterFn: reserveGeneratedMediaBlobWriter,
          promoteObjectFn: async () => {
            assert.fail("An account-scope refusal must not reach object storage.");
          },
          applyJobFn: applyGeneratedMediaPromotionJob,
          rescheduleJobFn: (...args) => {
            calls.reschedule += 1;
            return rescheduleGeneratedMediaPromotionJob(...args);
          },
          failJobFn: (...args) => {
            calls.failure += 1;
            return failGeneratedMediaPromotionJob(...args);
          },
          failAfterAccessRevocationFn: (...args) => {
            calls.accessRevocation += 1;
            return failGeneratedMediaPromotionJobAfterAccessRevocation(...args);
          },
          markWriterAmbiguousFn: markGeneratedMediaBlobWriterAmbiguous,
          nowFn: Date.now,
        },
      ), { code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409 });
      assert.deepEqual(calls, { failure: 0, reschedule: 0, accessRevocation: 0 });
      assert.deepEqual((await fixture.ownerPool.query(
        "SELECT * FROM content.generated_media_promotion_jobs WHERE job_id = $1", [job.jobId],
      )).rows, beforeProcessing.rows);
      await owner.query("ROLLBACK");

      await runtime.query("BEGIN");
      assert.equal((await runtime.query<{ status: string }>(
        "SELECT content.apply_generated_media_promotion_job_scope($1,$2) AS status",
        [job.jobId, job.leaseToken],
      )).rows[0]?.status, "scoped");
      await assert.rejects(owner.query(
        "SELECT auth.record_account_retirement($1,$2,$3)", [targetUserId, laterUserId, randomUUID()],
      ), { code: "P0A01" });
      await runtime.query("ROLLBACK");
      assert.deepEqual(await originalJobIdentity(fixture, job), identity);
    } finally {
      await Promise.all([runtime.query("ROLLBACK"), owner.query("ROLLBACK")]);
      runtime.release();
      owner.release();
    }
  });
});

test("generated contenders use canonical access locks and revalidate leases and access after waiting", async () => {
  await withGeneratedOwnerFixture(async ({ fixture, targetUserId, jobs }) => {
    const [expired, revoked] = jobs;
    assert.ok(expired && revoked);
    await retireGeneratedOwner(fixture, targetUserId);
    const identity = await originalJobIdentity(fixture, revoked);
    const runtime = await fixture.runtimePool.connect();
    const blocker = await fixture.ownerPool.connect();
    try {
      await runtime.query("SET statement_timeout = '5s'");
      const pid = (await runtime.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
      assert.ok(pid);
      const lockSql = "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0::bigint))";
      await blocker.query("BEGIN");
      await blocker.query(lockSql, [targetUserId, expired.workspaceId]);
      const pendingScope = Promise.allSettled([runtime.query<{ status: string }>(
        "SELECT content.apply_generated_media_promotion_job_scope($1,$2) AS status",
        [expired.jobId, expired.leaseToken],
      )]);
      try {
        await waitForBlocker(fixture, blocker, pid);
        await blocker.query(
          `UPDATE content.generated_media_promotion_jobs
           SET updated_at = created_at, lease_expires_at = created_at + interval '1 millisecond'
           WHERE job_id = $1`,
          [expired.jobId],
        );
        await blocker.query("COMMIT");
      } finally {
        await blocker.query("ROLLBACK");
      }
      const [scopeResult] = await pendingScope;
      assert.ok(scopeResult);
      if (scopeResult.status === "rejected") throw scopeResult.reason;
      assert.equal(scopeResult.value.rows[0]?.status, "lease_lost");

      await blocker.query("BEGIN");
      await blocker.query(lockSql, [targetUserId, revoked.workspaceId]);
      const pendingLock = Promise.allSettled([runtime.query<{ revocation_status: string }>(
        `SELECT revocation_status
         FROM content.lock_generated_media_promotion_job_after_access_revocation(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
         )`,
        exactJobParams(revoked),
      )]);
      try {
        await waitForBlocker(fixture, blocker, pid);
        await blocker.query(
          "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
          [revoked.workspaceId, targetUserId],
        );
        await blocker.query("COMMIT");
      } finally {
        await blocker.query("ROLLBACK");
      }
      const [lockResult] = await pendingLock;
      assert.ok(lockResult);
      if (lockResult.status === "rejected") throw lockResult.reason;
      assert.equal(lockResult.value.rows[0]?.revocation_status, "access_revoked");
      assert.deepEqual(await originalJobIdentity(fixture, revoked), identity);
    } finally {
      await Promise.all([runtime.query("ROLLBACK"), blocker.query("ROLLBACK")]);
      await runtime.query("RESET statement_timeout");
      runtime.release();
      blocker.release();
    }
  });
});

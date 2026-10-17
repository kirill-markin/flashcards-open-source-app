import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildMediaUploadStagingStorageKey } from "../../../mediaAssets/storageKeys";
import {
  applyGeneratedMediaPromotionJobScopeWithExecutor,
  failGeneratedMediaPromotionJobAfterAccessRevocation,
  GeneratedMediaPromotionJobLeaseLostError,
  reserveGeneratedMediaBlobWriter,
} from "./jobs";
import {
  executorFor,
  lockStatus,
  originalJobIdentity,
  retireGeneratedOwner,
  withGeneratedOwnerFixture,
} from "./jobsAccountOwnerPostgresTestSupport";
import { applyGeneratedMediaPromotionJob } from "./processor";

test("generated promotion retains its original payload and writer after the owner retires", async () => {
  await withGeneratedOwnerFixture(async ({ fixture, targetUserId, jobs }) => {
    const [job, freshJob] = jobs;
    assert.ok(job && freshJob);
    const identity = await originalJobIdentity(fixture, job);
    const writer = await reserveGeneratedMediaBlobWriter(job, Date.now() + 10_000);
    await retireGeneratedOwner(fixture, targetUserId);
    assert.equal((await fixture.ownerPool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
      [fixture.workspaceId, fixture.userId],
    )).rows[0]?.count, 0);

    const client = await fixture.runtimePool.connect();
    try {
      await client.query("BEGIN");
      await applyGeneratedMediaPromotionJobScopeWithExecutor(executorFor(client), job);
      assert.deepEqual((await client.query<{ user_id: string; workspace_id: string }>(
        "SELECT security.current_user_id() AS user_id, current_setting('app.workspace_id') AS workspace_id",
      )).rows[0], { user_id: targetUserId, workspace_id: job.workspaceId });
      assert.equal(await lockStatus(client, job), "access_active");
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    const replayed = await reserveGeneratedMediaBlobWriter(job, Date.now() + 10_000);
    assert.equal(replayed.reservationToken, writer.reservationToken);
    assert.deepEqual(replayed.writer, writer.writer);
    const freshWriter = await reserveGeneratedMediaBlobWriter(freshJob, Date.now() + 10_000);
    assert.equal(freshWriter.writer.userId, fixture.userId);
    assert.equal(freshWriter.writer.leaseToken, freshJob.leaseToken);
    assert.equal(freshWriter.writer.stagingStorageKey, freshJob.stagingStorageKey);
    await applyGeneratedMediaPromotionJob(replayed, Date.now() + 10_000);
    await applyGeneratedMediaPromotionJob(replayed, Date.now() + 10_000);
    assert.deepEqual(await originalJobIdentity(fixture, job), identity);
    assert.deepEqual((await fixture.ownerPool.query<{
      media_asset_id: string; replica_id: string; operation_id: string; storage_key: string;
    }>(
      `SELECT assets.media_asset_id::text, assets.last_modified_by_replica_id::text AS replica_id,
         assets.last_operation_id AS operation_id, blobs.storage_key
       FROM content.media_assets AS assets JOIN content.media_blobs AS blobs USING (media_blob_id)
       WHERE assets.workspace_id = $1 AND assets.media_asset_id = $2`,
      [job.workspaceId, job.mediaAssetId],
    )).rows[0], {
      media_asset_id: job.mediaAssetId, replica_id: job.replicaId,
      operation_id: job.operationId, storage_key: job.blobStorageKey,
    });
    const terminal = await fixture.runtimePool.connect();
    try {
      assert.equal(await lockStatus(terminal, { ...job, leaseToken: randomUUID() }), "applied");
      assert.equal(await lockStatus(terminal, { ...job, userId: targetUserId }), "stale");
    } finally {
      terminal.release();
    }
  });
});

test("canonical generated access still refuses foreign payloads, stale leases and revoked membership", async () => {
  await withGeneratedOwnerFixture(async ({ fixture, targetUserId, jobs }) => {
    const [job, expired, revoked] = jobs;
    assert.ok(job && expired && revoked);
    const identity = await originalJobIdentity(fixture, job);
    await retireGeneratedOwner(fixture, targetUserId);
    const client = await fixture.runtimePool.connect();
    try {
      const operationId = randomUUID();
      for (const mismatch of [
        { ...job, userId: targetUserId },
        { ...job, userId: `foreign-${randomUUID()}` },
        { ...job, leaseToken: randomUUID() },
        {
          ...job,
          operationId,
          stagingStorageKey: buildMediaUploadStagingStorageKey(
            job.workspaceId, job.mediaAssetId, operationId,
          ),
        },
      ]) {
        assert.equal(await lockStatus(client, mismatch), "stale");
        await assert.rejects(
          reserveGeneratedMediaBlobWriter(mismatch, Date.now() + 10_000),
          GeneratedMediaPromotionJobLeaseLostError,
        );
      }
      const malformedKey = { ...job, stagingStorageKey: job.stagingStorageKey + "-foreign" };
      assert.equal(await lockStatus(client, malformedKey), "stale");
      await assert.rejects(reserveGeneratedMediaBlobWriter(malformedKey, Date.now() + 10_000), {
        name: "TypeError",
        message: "stagingStorageKey does not match the deterministic promotion payload.",
      });
      await fixture.ownerPool.query(
        `UPDATE content.generated_media_promotion_jobs
         SET updated_at = created_at, lease_expires_at = created_at + interval '1 millisecond'
         WHERE job_id = $1`,
        [expired.jobId],
      );
      assert.equal(await lockStatus(client, expired), "stale");
      assert.equal((await client.query<{ status: string }>(
        "SELECT content.apply_generated_media_promotion_job_scope($1,$2) AS status",
        [expired.jobId, expired.leaseToken],
      )).rows[0]?.status, "lease_lost");
      await fixture.ownerPool.query(
        "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
        [job.workspaceId, targetUserId],
      );
      assert.equal((await client.query<{ status: string }>(
        "SELECT content.apply_generated_media_promotion_job_scope($1,$2) AS status",
        [job.jobId, job.leaseToken],
      )).rows[0]?.status, "access_revoked");
      assert.equal(await lockStatus(client, revoked), "access_revoked");
      assert.equal(await failGeneratedMediaPromotionJobAfterAccessRevocation(
        revoked, Date.now() + 10_000,
      ), "failed");
      assert.equal(await lockStatus(client, revoked), "stale");
      assert.deepEqual(await originalJobIdentity(fixture, job), identity);
      assert.equal((await fixture.ownerPool.query<{ state: string }>(
        "SELECT state FROM content.generated_media_promotion_jobs WHERE job_id = $1", [job.jobId],
      )).rows[0]?.state, "leased");
    } finally {
      client.release();
    }
  });
});

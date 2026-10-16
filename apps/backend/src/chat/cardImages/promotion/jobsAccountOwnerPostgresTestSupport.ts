import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";
import type { DatabaseExecutor } from "../../../database";
import {
  withPostgresIntegrationFixture,
  type PostgresIntegrationFixture,
} from "../../../testSupport/postgresIntegration";
import {
  enqueueGeneratedMediaPromotionJob,
  type ClaimedGeneratedMediaPromotionJob,
} from "./jobs";
import { byJobId, claim, createInput, createRun, uniqueSha256, withSha256 } from "./jobsPostgresTestSupport";

export type GeneratedOwnerFixture = Readonly<{
  fixture: PostgresIntegrationFixture;
  targetUserId: string;
  laterUserId: string;
  jobs: ReadonlyArray<ClaimedGeneratedMediaPromotionJob>;
}>;

export function executorFor(client: pg.PoolClient): DatabaseExecutor {
  return { query: (text, params) => client.query(text, [...params]) };
}

export function exactJobParams(job: ClaimedGeneratedMediaPromotionJob): Array<string | number> {
  return [
    job.jobId, job.leaseToken, job.operationId, job.userId, job.workspaceId,
    job.cardId, job.targetSide, job.altText, job.mediaAssetId, job.replicaId,
    job.stagingStorageKey, job.blobStorageKey, job.sha256, job.mimeType, job.sizeBytes,
  ];
}

export async function lockStatus(
  client: pg.PoolClient,
  job: ClaimedGeneratedMediaPromotionJob,
): Promise<string> {
  const result = await client.query<{ revocation_status: string }>(
    `SELECT revocation_status
     FROM content.lock_generated_media_promotion_job_after_access_revocation(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
     )`,
    exactJobParams(job),
  );
  const status = result.rows[0]?.revocation_status;
  if (status === undefined) throw new Error("Generated job lock returned no status.");
  return status;
}

export async function waitForBlocker(
  fixture: PostgresIntegrationFixture,
  blocker: pg.PoolClient,
  contenderPid: number,
): Promise<void> {
  const blockerPid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
  assert.ok(blockerPid);
  for (let poll = 0; poll < 100; poll += 1) {
    const result = await fixture.ownerPool.query<{ blocked: boolean }>(
      "SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked",
      [blockerPid, contenderPid],
    );
    if (result.rows[0]?.blocked === true) return;
    await delay(10);
  }
  assert.fail("Generated job contender did not wait on the canonical access lock.");
}

export async function originalJobIdentity(
  fixture: PostgresIntegrationFixture,
  job: ClaimedGeneratedMediaPromotionJob,
): Promise<Record<string, string>> {
  const result = await fixture.ownerPool.query<Record<string, string>>(
    `SELECT job_id::text, operation_id::text, user_id, workspace_id::text,
       card_id::text, target_side, alt_text, media_asset_id::text, replica_id::text,
       staging_storage_key, blob_storage_key, sha256, mime_type, size_bytes::text,
       created_at::text
     FROM content.generated_media_promotion_jobs WHERE job_id = $1`,
    [job.jobId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Stored generated job disappeared.");
  return row;
}

export async function retireGeneratedOwner(
  fixture: PostgresIntegrationFixture,
  targetUserId: string,
): Promise<void> {
  const client = await fixture.ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT auth.record_account_retirement($1,$2,$3)", [
      fixture.userId, targetUserId, randomUUID(),
    ]);
    await client.query(
      "UPDATE org.workspace_memberships SET user_id = $2 WHERE workspace_id = $1 AND user_id = $3",
      [fixture.workspaceId, targetUserId, fixture.userId],
    );
    await client.query(
      "UPDATE sync.workspace_replicas SET user_id = $2 WHERE workspace_id = $1 AND user_id = $3",
      [fixture.workspaceId, targetUserId, fixture.userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withGeneratedOwnerFixture(
  callback: (context: GeneratedOwnerFixture) => Promise<void>,
): Promise<void> {
  await withPostgresIntegrationFixture(async (fixture) => {
    const targetUserId = `generated-owner-${randomUUID()}`;
    const laterUserId = `generated-later-${randomUUID()}`;
    try {
      await fixture.ownerPool.query(
        "INSERT INTO org.user_settings(user_id) VALUES ($1),($2)",
        [targetUserId, laterUserId],
      );
      const run = await createRun(fixture);
      const inputs = Array.from({ length: 3 }, () => withSha256(createInput(fixture, run), uniqueSha256()));
      for (const input of inputs) await enqueueGeneratedMediaPromotionJob(input);
      const claims = await claim(`canonical-generated-${randomUUID()}`, inputs.length);
      const jobs = inputs.map((input) => byJobId(claims, input.jobId));
      await callback({ fixture, targetUserId, laterUserId, jobs });
    } finally {
      await fixture.ownerPool.query(
        "DELETE FROM auth.account_retirements WHERE retired_user_id = ANY($1::text[])",
        [[fixture.userId, targetUserId]],
      );
      await fixture.ownerPool.query(
        "DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])",
        [[targetUserId, laterUserId]],
      );
    }
  });
}

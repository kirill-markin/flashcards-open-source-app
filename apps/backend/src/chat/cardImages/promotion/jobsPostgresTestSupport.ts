import { createHash, randomUUID } from "node:crypto";
import { transactionWithWorkspaceScope, type DatabaseExecutor } from "../../../database";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../../mediaAssets/storageKeys";
import { type PostgresIntegrationFixture } from "../../../testSupport/postgresIntegration";
import {
  claimGeneratedMediaPromotionJobs,
  type ClaimedGeneratedMediaPromotionJob,
  type EnqueueGeneratedMediaPromotionJobInput,
} from "./jobs";

type RunFixture = Readonly<{
  sessionId: string;
  runId: string;
  claimToken: string;
}>;

type ClaimTokenRow = Readonly<{ claim_token: string }>;

type PlaceholderConflictStateRow = Readonly<{
  job_id: string;
  job_state: string;
  job_error_code: string | null;
  reservation_state: string;
  cleanup_scheduled: boolean;
  media_asset_count: string;
}>;

export async function createRun(
  fixture: PostgresIntegrationFixture,
): Promise<RunFixture> {
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
       $4, $1, $5, 'running', $6, 'gpt-5.6-terra', 'xhigh', 'Europe/Madrid',
       '[]'::jsonb, statement_timestamp(), statement_timestamp(), statement_timestamp()
     )
     RETURNING worker_claimed_at::text AS claim_token`,
    [
      sessionId,
      fixture.userId,
      fixture.workspaceId,
      runId,
      assistantItemId,
      `promotion-job-${runId}`,
    ],
  );
  const claimToken = result.rows[0]?.claim_token;
  if (claimToken === undefined) {
    throw new Error(`Run fixture has no claim token. runId=${runId}`);
  }
  return { sessionId, runId, claimToken };
}

export function createInput(
  fixture: PostgresIntegrationFixture,
  run: RunFixture,
): EnqueueGeneratedMediaPromotionJobInput {
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
    stagingStorageKey: buildMediaUploadStagingStorageKey(
      fixture.workspaceId,
      mediaAssetId,
      operationId,
    ),
    blobStorageKey: buildMediaBlobStorageKey(sha256),
    sha256,
    mimeType: "image/jpeg",
    sizeBytes: 4096,
  };
}

export async function transition<Result>(
  fixture: PostgresIntegrationFixture,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return transactionWithWorkspaceScope(
    { userId: fixture.userId, workspaceId: fixture.workspaceId },
    callback,
  );
}

export function byJobId(
  jobs: ReadonlyArray<ClaimedGeneratedMediaPromotionJob>,
  jobId: string,
): ClaimedGeneratedMediaPromotionJob {
  const job = jobs.find((candidate) => candidate.jobId === jobId);
  if (job === undefined) {
    throw new Error(`Claimed job was not found. jobId=${jobId}`);
  }
  return job;
}

export function claim(
  leaseOwner: string,
  limit: number,
): Promise<ReadonlyArray<ClaimedGeneratedMediaPromotionJob>> {
  return claimGeneratedMediaPromotionJobs({
    leaseOwner,
    leaseDurationMs: 60_000,
    limit,
    deadlineAtMs: Date.now() + 10_000,
  });
}

export function hasPostgresCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

export function uniqueSha256(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

export function withSha256(
  input: EnqueueGeneratedMediaPromotionJobInput,
  sha256: string,
): EnqueueGeneratedMediaPromotionJobInput {
  return {
    ...input,
    sha256,
    blobStorageKey: buildMediaBlobStorageKey(sha256),
  };
}

export async function loadPlaceholderConflictStates(
  fixture: PostgresIntegrationFixture,
  inputs: ReadonlyArray<EnqueueGeneratedMediaPromotionJobInput>,
): Promise<ReadonlyArray<PlaceholderConflictStateRow>> {
  const result = await fixture.ownerPool.query<PlaceholderConflictStateRow>(
    `SELECT
       jobs.job_id::text AS job_id,
       jobs.state AS job_state,
       jobs.last_error_code AS job_error_code,
       reservations.state AS reservation_state,
       lifecycles.cleanup_eligible_at IS NOT NULL AS cleanup_scheduled,
       (
         SELECT count(*)::text
         FROM content.media_assets AS media_assets
         WHERE media_assets.workspace_id = jobs.workspace_id
           AND media_assets.media_asset_id = jobs.media_asset_id
       ) AS media_asset_count
     FROM content.generated_media_promotion_jobs AS jobs
     INNER JOIN content.media_blob_writer_reservations AS reservations
       ON reservations.writer_kind = 'generated_promotion'
      AND reservations.workspace_id = jobs.workspace_id
      AND reservations.media_asset_id = jobs.media_asset_id
      AND reservations.operation_id = jobs.operation_id::text
     INNER JOIN content.media_blob_lifecycles AS lifecycles
       ON lifecycles.sha256 = jobs.sha256
     WHERE jobs.job_id = ANY($1::uuid[])
     ORDER BY jobs.job_id`,
    [inputs.map((input) => input.jobId)],
  );
  return result.rows;
}

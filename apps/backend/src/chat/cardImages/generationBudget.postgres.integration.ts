import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import { transactionWithWorkspaceScopeDeadline } from "../../database";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../mediaAssets/storageKeys";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import {
  loadGeneratedCardImageGenerationUsageInExecutor,
  type GeneratedCardImageGenerationUsage,
} from "./generationBudget";

type DatabaseClockRow = Readonly<{ now_ms: string }>;

type BudgetFixtureIds = Readonly<{
  memberUserId: string;
  memberReplicaId: string;
  otherReplicaId: string;
  otherCardId: string;
}>;

type GenerationJobFixture = Readonly<{
  userId: string;
  workspaceId: string;
  cardId: string;
  replicaId: string;
  createdAtMs: number;
}>;

async function insertGenerationJob(client: pg.PoolClient, job: GenerationJobFixture): Promise<void> {
  const operationId = randomUUID();
  const mediaAssetId = randomUUID();
  const sha256 = createHash("sha256").update(operationId).digest("hex");
  await client.query(
    `INSERT INTO content.generated_media_promotion_jobs (
       job_id, operation_id, user_id, workspace_id, card_id, target_side, alt_text,
       media_asset_id, replica_id, staging_storage_key, blob_storage_key,
       sha256, mime_type, size_bytes, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'back', 'Generated budget image',
       $6, $7, $8, $9, $10, 'image/jpeg', 4096, $11
     )`,
    [
      randomUUID(), operationId, job.userId, job.workspaceId, job.cardId,
      mediaAssetId, job.replicaId,
      buildMediaUploadStagingStorageKey(job.workspaceId, mediaAssetId, operationId),
      buildMediaBlobStorageKey(sha256), sha256, new Date(job.createdAtMs).toISOString(),
    ],
  );
}

/**
 * Adds a second member with its own replica to the fixture workspace, and a second workspace of the
 * fixture user, so the counts are checked across members, replicas and workspaces.
 */
async function createBudgetFixtureRows(
  fixture: PostgresIntegrationFixture,
  ids: BudgetFixtureIds,
  jobs: ReadonlyArray<GenerationJobFixture>,
): Promise<void> {
  const ownerClient = await fixture.ownerPool.connect();
  try {
    await ownerClient.query("BEGIN");
    await ownerClient.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [ids.memberUserId]);
    await ownerClient.query(
      "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
      [fixture.workspaceId, ids.memberUserId],
    );
    await ownerClient.query(
      `INSERT INTO sync.workspace_replicas (
         replica_id, workspace_id, user_id, actor_kind, installation_id, actor_key, platform, app_version
       ) VALUES ($1, $2, $3, 'agent_connection', NULL, $4, 'system', 'postgres-integration')`,
      [ids.memberReplicaId, fixture.workspaceId, ids.memberUserId, `postgres-integration-${ids.memberReplicaId}`],
    );
    await ownerClient.query(
      `INSERT INTO org.workspaces (
         workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id
       ) VALUES ($1, 'Generated image budget other workspace', $2, $3, $4)`,
      [
        fixture.outOfScopeWorkspaceId, fixture.createdAt, ids.otherReplicaId,
        `postgres-integration-workspace-${fixture.outOfScopeWorkspaceId}`,
      ],
    );
    await ownerClient.query(
      "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [fixture.outOfScopeWorkspaceId, fixture.userId],
    );
    await ownerClient.query(
      `INSERT INTO sync.workspace_replicas (
         replica_id, workspace_id, user_id, actor_kind, installation_id, actor_key, platform, app_version
       ) VALUES ($1, $2, $3, 'ai_chat', NULL, $4, 'system', 'postgres-integration')`,
      [ids.otherReplicaId, fixture.outOfScopeWorkspaceId, fixture.userId, `postgres-integration-${ids.otherReplicaId}`],
    );
    await ownerClient.query(
      [
        "INSERT INTO content.cards (",
        "card_id, workspace_id, front_text, back_text, card_type, metadata, tags, effort_level, due_at, created_at,",
        "reps, lapses, fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
        "client_updated_at, last_modified_by_replica_id, last_operation_id",
        ") VALUES ($1, $2, $3, $4, 'basic', $5::jsonb, '{}', 'fast', NULL, $6, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, $7, $8, $9)",
      ].join(" "),
      [
        ids.otherCardId, fixture.outOfScopeWorkspaceId, "Other question", "Other answer",
        JSON.stringify({ version: 1, source: null }), fixture.createdAt, fixture.createdAt,
        ids.otherReplicaId, `postgres-integration-card-${ids.otherCardId}`,
      ],
    );
    for (const job of jobs) {
      await insertGenerationJob(ownerClient, job);
    }
    await ownerClient.query("COMMIT");
  } catch (error) {
    await ownerClient.query("ROLLBACK");
    throw error;
  } finally {
    ownerClient.release();
  }
}

async function deleteBudgetFixtureRows(
  fixture: PostgresIntegrationFixture,
  ids: BudgetFixtureIds,
): Promise<void> {
  await fixture.ownerPool.query(
    "DELETE FROM content.generated_media_promotion_jobs WHERE workspace_id = ANY($1::uuid[])",
    [[fixture.workspaceId, fixture.outOfScopeWorkspaceId]],
  );
  await fixture.ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [fixture.outOfScopeWorkspaceId]);
  await fixture.ownerPool.query("DELETE FROM org.user_settings WHERE user_id = $1", [ids.memberUserId]);
}

async function loadUsageAsMember(
  userId: string,
  workspaceId: string,
  replicaId: string,
): Promise<GeneratedCardImageGenerationUsage> {
  return transactionWithWorkspaceScopeDeadline({ userId, workspaceId }, Date.now() + 30_000, async (executor) => {
    // UTC+14 moves every local midnight to 10:00Z, so a window built on the session zone would show.
    await executor.query("SET LOCAL TIME ZONE 'Pacific/Kiritimati'", []);
    return loadGeneratedCardImageGenerationUsageInExecutor(executor, workspaceId, replicaId);
  });
}

test("generated card image usage counts UTC windows per replica and per workspace as backend_app", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const ids: BudgetFixtureIds = {
      memberUserId: `postgres-integration-member-${randomUUID()}`,
      memberReplicaId: randomUUID(),
      otherReplicaId: randomUUID(),
      otherCardId: randomUUID(),
    };
    try {
      const clock = await fixture.ownerPool.query<DatabaseClockRow>(
        "SELECT floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint::text AS now_ms",
      );
      const nowMs = Number.parseInt(clock.rows[0]?.now_ms ?? "", 10);
      assert.equal(Number.isSafeInteger(nowMs), true);
      const now = new Date(nowMs);
      const dayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
      const inWorkspace = { workspaceId: fixture.workspaceId, cardId: fixture.cardId };
      await createBudgetFixtureRows(fixture, ids, [
        { ...inWorkspace, userId: fixture.userId, replicaId: fixture.replicaId, createdAtMs: nowMs },
        { ...inWorkspace, userId: ids.memberUserId, replicaId: fixture.replicaId, createdAtMs: dayStartMs },
        { ...inWorkspace, userId: ids.memberUserId, replicaId: ids.memberReplicaId, createdAtMs: nowMs },
        { ...inWorkspace, userId: fixture.userId, replicaId: fixture.replicaId, createdAtMs: dayStartMs - 1 },
        { ...inWorkspace, userId: ids.memberUserId, replicaId: ids.memberReplicaId, createdAtMs: monthStartMs - 1 },
        {
          workspaceId: fixture.outOfScopeWorkspaceId, cardId: ids.otherCardId,
          userId: fixture.userId, replicaId: ids.otherReplicaId, createdAtMs: nowMs,
        },
      ]);

      const dailyResetsAt = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      ).toISOString();
      const monthlyResetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
      // On the first UTC day of a month, the job one millisecond before the day start is also
      // before the month start.
      const monthlyCount = dayStartMs > monthStartMs ? 4 : 3;
      assert.deepEqual(await loadUsageAsMember(fixture.userId, fixture.workspaceId, fixture.replicaId), {
        daily: { count: 2, resetsAt: dailyResetsAt },
        monthly: { count: monthlyCount, resetsAt: monthlyResetsAt },
      });
      assert.deepEqual(await loadUsageAsMember(ids.memberUserId, fixture.workspaceId, ids.memberReplicaId), {
        daily: { count: 1, resetsAt: dailyResetsAt },
        monthly: { count: monthlyCount, resetsAt: monthlyResetsAt },
      });
    } finally {
      await deleteBudgetFixtureRows(fixture, ids);
    }
  });
});

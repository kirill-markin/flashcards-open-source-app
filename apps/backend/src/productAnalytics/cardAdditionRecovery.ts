import { withReportingReadOnlyTransaction } from "../admin/reportingDb";
import { lockAccountLifecyclesInExecutor } from "../auth/userIdentities";
import { applyUserDatabaseScopeInExecutor, applyWorkspaceDatabaseScopeInExecutor } from "../database";
import { unsafeTransaction } from "../database/unsafe";
import type { BackendObservationScope } from "../observability/sentry";

export type CardAdditionRecoveryRequest = Readonly<{ batchSize: number; maxBatches: number }>;

export type CardAdditionRecoverySummary = Readonly<{
  scannedCount: number;
  recoveredCount: number;
  batchCount: number;
  finished: boolean;
}>;

type RecoveryCandidate = Readonly<{
  event_id: string;
  source_event_id: string;
  user_id: string;
  actor_id: string;
  workspace_id: string;
}>;

// The same proof revision names every retry; per-card event ids name the individual facts.
const insertRecoveredAdditionSql = `
  INSERT INTO analytics.product_events (
    event_id, schema_version, event_name, origin, trust_level, backfill_id,
    user_id, subject_user_id, workspace_id, platform, occurred_at, server_received_at,
    event_properties, details
  )
  SELECT proof.event_id, 1, 'card_addition_recovered', 'backfill', 'backfill_derived',
    analytics.derive_server_event_id('card_addition_recovered', ARRAY['same_replica_marked_demo_v1']),
    proof.user_id, proof.subject_user_id, proof.workspace_id, proof.platform,
    proof.occurred_at, proof.server_received_at, '{}'::jsonb,
    '{"proof":"original_card_and_same_replica_demo","version":1}'::jsonb
  FROM analytics.card_addition_recovery_candidates($1::uuid) AS proof
  WHERE proof.event_id = $2::uuid AND proof.source_event_id = $3::uuid
    AND proof.user_id = $4::uuid AND proof.actor_id = $5::uuid
  ON CONFLICT (event_id) DO NOTHING
`;

async function persistRecoveredAddition(candidate: RecoveryCandidate): Promise<number> {
  return unsafeTransaction(async (executor) => {
    // The proof accepts only the writer and at most one direct erasing owner.
    await lockAccountLifecyclesInExecutor(executor, [candidate.user_id, candidate.actor_id]);
    const liveScope = await executor.query<Readonly<{ live: boolean }>>(
      "SELECT auth.canonical_account_id($1) = $1 AND auth.canonical_account_id($2) = $2 AS live",
      [candidate.user_id, candidate.actor_id],
    );
    if (liveScope.rows[0]?.live !== true) return 0;
    await applyUserDatabaseScopeInExecutor(executor, { userId: candidate.user_id });
    const workspaceAccess = await executor.query<Readonly<{ live: boolean }>>(`
      SELECT EXISTS (
        SELECT 1 FROM org.user_settings AS writer
        JOIN org.workspace_memberships AS membership ON membership.user_id = writer.user_id
        JOIN org.workspaces AS workspace ON workspace.workspace_id = membership.workspace_id
        WHERE writer.user_id = $1 AND workspace.workspace_id = $2::uuid
      ) AS live
    `, [candidate.user_id, candidate.workspace_id]);
    if (workspaceAccess.rows[0]?.live !== true) return 0;
    await applyWorkspaceDatabaseScopeInExecutor(executor, {
      userId: candidate.user_id,
      workspaceId: candidate.workspace_id,
    });
    const result = await executor.query(insertRecoveredAdditionSql, [
      candidate.workspace_id, candidate.event_id, candidate.source_event_id,
      candidate.user_id, candidate.actor_id,
    ]);
    return result.rowCount ?? 0;
  });
}

export async function reconcileCardAdditions(
  request: CardAdditionRecoveryRequest,
  _observationScope: BackendObservationScope,
): Promise<CardAdditionRecoverySummary> {
  if (!Number.isSafeInteger(request.batchSize) || request.batchSize < 1 || request.batchSize > 500) {
    throw new RangeError("Card addition recovery batchSize must be an integer from 1 to 500.");
  }
  if (!Number.isSafeInteger(request.maxBatches) || request.maxBatches < 1 || request.maxBatches > 1_000) {
    throw new RangeError("Card addition recovery maxBatches must be an integer from 1 to 1000.");
  }

  let scannedCount = 0;
  let recoveredCount = 0;
  for (let batchCount = 1; batchCount <= request.maxBatches; batchCount += 1) {
    const candidates = await withReportingReadOnlyTransaction(async (client) => {
      const result = await client.query<RecoveryCandidate>(`
        SELECT event_id, source_event_id, user_id, actor_id, workspace_id
        FROM analytics.card_addition_recovery_candidates(NULL::uuid)
        ORDER BY occurred_at, event_id
        LIMIT $1::integer
      `, [request.batchSize]);
      return result.rows;
    });
    scannedCount += candidates.length;
    for (const candidate of candidates) recoveredCount += await persistRecoveredAddition(candidate);
    if (candidates.length < request.batchSize) {
      return { scannedCount, recoveredCount, batchCount, finished: true };
    }
  }
  return { scannedCount, recoveredCount, batchCount: request.maxBatches, finished: false };
}

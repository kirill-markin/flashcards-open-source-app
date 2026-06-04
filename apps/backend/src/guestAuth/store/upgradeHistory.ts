import type { DatabaseExecutor } from "../../database";
import { hashGuestToken } from "../shared";
import type {
  GuestUpgradeDroppedEntities,
  GuestUpgradeHistoryWrite,
} from "../types";

type GuestUpgradeHistoryReplayRow = Readonly<{
  source_guest_session_id: string;
  target_subject_user_id: string;
  target_user_id: string;
  target_workspace_id: string;
  dropped_entities: GuestUpgradeDroppedEntities | null;
}>;

export type GuestUpgradeReplayRecord = Readonly<{
  sourceGuestSessionId: string;
  targetSubjectUserId: string;
  targetUserId: string;
  targetWorkspaceId: string;
  droppedEntities?: GuestUpgradeDroppedEntities;
}>;

function mapGuestUpgradeReplayRecord(row: GuestUpgradeHistoryReplayRow): GuestUpgradeReplayRecord {
  return {
    sourceGuestSessionId: row.source_guest_session_id,
    targetSubjectUserId: row.target_subject_user_id,
    targetUserId: row.target_user_id,
    targetWorkspaceId: row.target_workspace_id,
    ...(row.dropped_entities === null
      ? {}
      : { droppedEntities: row.dropped_entities }),
  };
}

export async function loadGuestUpgradeReplayInExecutor(
  executor: DatabaseExecutor,
  guestSessionId: string,
): Promise<GuestUpgradeReplayRecord | null> {
  // Compatibility read path for released clients that retry
  // `/guest-auth/upgrade/complete` after the merge committed and the original
  // guest session was already revoked.
  const result = await executor.query<GuestUpgradeHistoryReplayRow>(
    [
      "SELECT source_guest_session_id, target_subject_user_id, target_user_id, target_workspace_id, dropped_entities",
      "FROM auth.guest_upgrade_history",
      "WHERE source_guest_session_id = $1",
      "LIMIT 1",
    ].join(" "),
    [guestSessionId],
  );

  const row = result.rows[0];
  return row === undefined ? null : mapGuestUpgradeReplayRecord(row);
}

export async function loadGuestUpgradeReplayByGuestTokenInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
): Promise<GuestUpgradeReplayRecord | null> {
  const result = await executor.query<GuestUpgradeHistoryReplayRow>(
    [
      "SELECT source_guest_session_id, target_subject_user_id, target_user_id, target_workspace_id, dropped_entities",
      "FROM auth.guest_upgrade_history",
      "WHERE source_guest_session_secret_hash = $1",
      "LIMIT 1",
    ].join(" "),
    [hashGuestToken(guestToken)],
  );

  const row = result.rows[0];
  return row === undefined ? null : mapGuestUpgradeReplayRecord(row);
}

export async function recordGuestUpgradeHistoryInExecutor(
  executor: DatabaseExecutor,
  history: GuestUpgradeHistoryWrite,
): Promise<void> {
  // Legacy/idempotency-only audit record. Keep it while old clients can retry
  // completion after session revocation; it is not a local-outbox replay layer.
  await executor.query(
    [
      "INSERT INTO auth.guest_upgrade_history",
      "(",
      "upgrade_id, source_guest_user_id, source_guest_workspace_id, source_guest_session_id,",
      "source_guest_session_secret_hash, target_subject_user_id, target_user_id, target_workspace_id,",
      "selection_type, dropped_entities",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)",
    ].join(" "),
    [
      history.upgradeId,
      history.sourceGuestUserId,
      history.sourceGuestWorkspaceId,
      history.sourceGuestSessionId,
      history.sourceGuestSessionSecretHash,
      history.targetSubjectUserId,
      history.targetUserId,
      history.targetWorkspaceId,
      history.selectionType,
      history.droppedEntities === undefined
        ? null
        : JSON.stringify(history.droppedEntities),
    ],
  );

  for (const [sourceGuestReplicaId, targetReplicaId] of history.replicaIdMap) {
    // Replica aliases are the last durable routing bridge for stale shipped
    // clients that still reference pre-merge guest replica ids. They do not
    // alias card/deck/review ids. Remove them only together with the rest of
    // the guest-upgrade compatibility layer.
    await executor.query(
      [
        "INSERT INTO auth.guest_replica_aliases",
        "(",
        "source_guest_replica_id, upgrade_id, target_replica_id",
        ")",
        "VALUES ($1, $2, $3)",
      ].join(" "),
      [
        sourceGuestReplicaId,
        history.upgradeId,
        targetReplicaId,
      ],
    );
  }
}

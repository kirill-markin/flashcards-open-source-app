import type pg from "pg";
import {
  type GuestUpgradeExecutorParam,
  type GuestUpgradeHandlerContext,
  type WorkspaceReplicaState,
} from "../models";
import { createQueryResult } from "../queryResult";
import { findSyncConflictWorkspaceId } from "../stateOperations";

export function handleSyncExecutorQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  const { scope, state } = context;

  if (text.startsWith("SELECT") && text.includes("FROM sync.workspace_replicas")) {
    const workspaceId = params[0];
    const rows = typeof workspaceId !== "string"
      ? []
      : state.workspaceReplicas
        .filter((replica) => replica.workspace_id === workspaceId)
        .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.replica_id.localeCompare(right.replica_id))
        .map((replica) => ({ ...replica } as unknown as Row));
    return createQueryResult<Row>(rows);
  }

  if (
    text === "SELECT workspace_id FROM sync.find_conflicting_workspace_id($1, $2) LIMIT 1"
  ) {
    const entityType = String(params[0]);
    const entityId = String(params[1]);
    const conflictingWorkspaceId = findSyncConflictWorkspaceId(state, entityType, entityId);
    const rows = conflictingWorkspaceId === null
      ? []
      : [{ workspace_id: conflictingWorkspaceId } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (text.includes("FROM sync.claim_installation")) {
    const installationId = params[0];
    const expectedPlatform = params[1];
    const targetUserId = params[2];
    const nextAppVersion = params[3];

    if (
      typeof installationId !== "string"
      || typeof expectedPlatform !== "string"
      || typeof targetUserId !== "string"
    ) {
      throw new Error("Invalid sync.claim_installation arguments");
    }

    const installation = state.installations.get(installationId);
    if (installation === undefined) {
      throw new Error("Expected installation row to exist for guest merge test");
    }

    if (installation.platform !== expectedPlatform) {
      return createQueryResult<Row>([{
        claim_status: "platform_mismatch",
        installation_id: installation.installation_id,
        platform: installation.platform,
        previous_user_id: installation.user_id,
        current_user_id: installation.user_id,
      } as unknown as Row]);
    }

    const claimStatus = installation.user_id === targetUserId ? "refreshed" : "reassigned";
    state.installations.set(installationId, {
      installation_id: installation.installation_id,
      user_id: targetUserId,
      platform: installation.platform,
      app_version: typeof nextAppVersion === "string" ? nextAppVersion : null,
    });

    return createQueryResult<Row>([{
      claim_status: claimStatus,
      installation_id: installation.installation_id,
      platform: installation.platform,
      previous_user_id: installation.user_id,
      current_user_id: targetUserId,
    } as unknown as Row]);
  }

  if (text.includes("INSERT INTO sync.workspace_replicas")) {
    const replicaWorkspaceId = String(params[1]);
    const replicaUserId = String(params[2]);
    scope.requireCurrentWorkspaceScope(replicaUserId, replicaWorkspaceId);
    const existingReplica = state.workspaceReplicas.find((replica) => replica.replica_id === params[0]);
    if (existingReplica !== undefined) {
      return createQueryResult<Row>([]);
    }

    const nextReplica: WorkspaceReplicaState = {
      replica_id: String(params[0]),
      workspace_id: String(params[1]),
      user_id: String(params[2]),
      actor_kind: String(params[3]) as WorkspaceReplicaState["actor_kind"],
      installation_id: params[4] === null ? null : String(params[4]),
      actor_key: params[5] === null ? null : String(params[5]),
      platform: String(params[6]) as WorkspaceReplicaState["platform"],
      app_version: params[7] === null ? null : String(params[7]),
      created_at: "2026-04-02T14:01:15.000Z",
      last_seen_at: "2026-04-02T14:01:15.000Z",
    };
    state.workspaceReplicas.push(nextReplica);
    return createQueryResult<Row>([{
      replica_id: nextReplica.replica_id,
      platform: nextReplica.platform,
    } as unknown as Row]);
  }

  if (text.includes("UPDATE sync.workspace_replicas")) {
    const replicaId = String(params[0]);
    const workspaceId = String(params[1]);
    const userId = String(params[2]);
    scope.requireCurrentWorkspaceScope(userId, workspaceId);
    const actorKind = String(params[3]);
    const installationId = params[4] === null ? null : String(params[4]);
    const actorKey = params[5] === null ? null : String(params[5]);
    const platform = String(params[6]);
    const appVersion = params[7] === null ? null : String(params[7]);
    const index = state.workspaceReplicas.findIndex((replica) => (
      replica.replica_id === replicaId
      && replica.workspace_id === workspaceId
      && replica.actor_kind === actorKind
      && replica.installation_id === installationId
      && replica.actor_key === actorKey
      && replica.platform === platform
    ));
    if (index === -1) {
      return createQueryResult<Row>([]);
    }

    const current = state.workspaceReplicas[index];
    if (current === undefined) {
      return createQueryResult<Row>([]);
    }

    state.workspaceReplicas[index] = {
      ...current,
      user_id: userId,
      app_version: appVersion,
      last_seen_at: "2026-04-02T14:01:16.000Z",
    };
    return createQueryResult<Row>([{
      replica_id: replicaId,
      platform,
    } as unknown as Row]);
  }

  if (
    text
      === "INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at) VALUES ($1, 0, now()) ON CONFLICT (workspace_id) DO NOTHING"
  ) {
    return createQueryResult<Row>([]);
  }

  if (
    text
      === "INSERT INTO sync.hot_changes ( workspace_id, entity_type, entity_id, action, replica_id, operation_id, client_updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING change_id"
  ) {
    const changeId = state.nextHotChangeId;
    state.nextHotChangeId += 1;
    state.hotChanges.push({
      change_id: changeId,
      workspace_id: String(params[0]),
      entity_type: String(params[1]),
      entity_id: String(params[2]),
    });
    return createQueryResult<Row>([{ change_id: changeId } as unknown as Row]);
  }

  if (
    text.includes("FROM sync.hot_changes")
    && text.includes("ORDER BY change_id DESC")
  ) {
    const workspaceId = String(params[0]);
    const entityType = String(params[1]);
    const entityId = String(params[2]);
    const latestChange = state.hotChanges
      .filter((change) => (
        change.workspace_id === workspaceId
        && change.entity_type === entityType
        && change.entity_id === entityId
      ))
      .sort((left, right) => right.change_id - left.change_id)[0];
    const rows = latestChange === undefined ? [] : [{ change_id: latestChange.change_id } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  return null;
}

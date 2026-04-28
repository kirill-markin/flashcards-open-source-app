import type pg from "pg";
import {
  addWorkspaceMembership,
  membershipKey,
  type GuestUpgradeExecutorParam,
  type GuestUpgradeHandlerContext,
} from "../models";
import { createQueryResult } from "../queryResult";
import {
  countWorkspaceMembers,
  deleteWorkspaceFromState,
} from "../stateOperations";

export function handleWorkspaceExecutorQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  const { scope, state } = context;

  if (text.startsWith("SELECT") && text.includes("FROM org.workspaces AS workspaces")) {
    const userId = params[0];
    const workspaceId = params[1];
    if (typeof userId !== "string" || typeof workspaceId !== "string") {
      return createQueryResult<Row>([]);
    }

    if (!state.workspaceMemberships.has(membershipKey(userId, workspaceId))) {
      return createQueryResult<Row>([]);
    }

    const workspace = state.workspaces.get(workspaceId);
    const rows = workspace === undefined ? [] : [{
      workspace_id: workspace.workspace_id,
      name: workspace.name,
      created_at: workspace.created_at,
    } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (
    text.includes("FROM org.workspace_memberships memberships")
    && text.includes("memberships.role")
    && text.includes("AS member_count")
  ) {
    const userId = params[0];
    const workspaceId = params[1];
    if (typeof userId !== "string" || typeof workspaceId !== "string") {
      return createQueryResult<Row>([]);
    }

    if (state.currentUserId !== userId) {
      return createQueryResult<Row>([]);
    }

    const membershipRole = state.workspaceMembershipRoles.get(membershipKey(userId, workspaceId));
    if (membershipRole === undefined) {
      return createQueryResult<Row>([]);
    }

    const workspace = state.workspaces.get(workspaceId);
    const memberCount = [...state.workspaceMemberships]
      .filter((membership) => membership.endsWith(`:${workspaceId}`))
      .length;
    const rows = workspace === undefined ? [] : [{
      workspace_id: workspace.workspace_id,
      name: workspace.name,
      created_at: workspace.created_at,
      role: membershipRole,
      member_count: memberCount,
    } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (text.startsWith("SELECT") && text.includes("FROM org.workspaces") && text.includes("fsrs_algorithm")) {
    const workspaceId = params[0];
    const workspace = typeof workspaceId === "string" ? state.workspaces.get(workspaceId) : undefined;
    const rows = workspace === undefined ? [] : [{
      fsrs_algorithm: workspace.fsrs_algorithm,
      fsrs_desired_retention: workspace.fsrs_desired_retention,
      fsrs_learning_steps_minutes: workspace.fsrs_learning_steps_minutes,
      fsrs_relearning_steps_minutes: workspace.fsrs_relearning_steps_minutes,
      fsrs_maximum_interval_days: workspace.fsrs_maximum_interval_days,
      fsrs_enable_fuzz: workspace.fsrs_enable_fuzz,
      fsrs_client_updated_at: workspace.fsrs_client_updated_at,
      fsrs_last_modified_by_replica_id: workspace.fsrs_last_modified_by_replica_id,
      fsrs_last_operation_id: workspace.fsrs_last_operation_id,
      fsrs_updated_at: workspace.fsrs_updated_at,
    } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (text.startsWith("DELETE FROM org.workspaces AS workspaces")) {
    const workspaceId = String(params[0]);
    const userId = String(params[1]);
    scope.requireCurrentUserScope(userId);
    const membershipRole = state.workspaceMembershipRoles.get(membershipKey(userId, workspaceId));
    const isOwner = membershipRole === "owner";
    if (!isOwner || countWorkspaceMembers(state, workspaceId) !== 1 || !state.workspaces.has(workspaceId)) {
      return createQueryResult<Row>([]);
    }

    deleteWorkspaceFromState(state, workspaceId);
    return createQueryResult<Row>([{ workspace_id: workspaceId } as unknown as Row]);
  }

  if (text === "DELETE FROM org.workspaces WHERE workspace_id = $1") {
    const workspaceId = String(params[0]);
    deleteWorkspaceFromState(state, workspaceId);
    return createQueryResult<Row>([]);
  }

  if (
    text
      === "INSERT INTO org.workspaces ( workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id ) VALUES ($1, $2, $3, $4, $5)"
  ) {
    const workspaceId = String(params[0]);
    const name = String(params[1]);
    const bootstrapTimestamp = String(params[2]);
    const bootstrapReplicaId = String(params[3]);
    const bootstrapOperationId = String(params[4]);
    state.workspaces.set(workspaceId, {
      workspace_id: workspaceId,
      name,
      created_at: bootstrapTimestamp,
      fsrs_algorithm: "fsrs-6",
      fsrs_desired_retention: 0.9,
      fsrs_learning_steps_minutes: [1, 10],
      fsrs_relearning_steps_minutes: [10],
      fsrs_maximum_interval_days: 36500,
      fsrs_enable_fuzz: true,
      fsrs_client_updated_at: bootstrapTimestamp,
      fsrs_last_modified_by_replica_id: bootstrapReplicaId,
      fsrs_last_operation_id: bootstrapOperationId,
      fsrs_updated_at: bootstrapTimestamp,
    });
    return createQueryResult<Row>([]);
  }

  if (text === "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')") {
    const workspaceId = String(params[0]);
    const userId = String(params[1]);
    addWorkspaceMembership(state, userId, workspaceId, "owner");
    return createQueryResult<Row>([]);
  }

  if (text.startsWith("UPDATE org.workspaces SET")) {
    const workspaceId = String(params[10]);
    const current = state.workspaces.get(workspaceId);
    if (current === undefined) {
      throw new Error(`Missing workspace ${workspaceId}`);
    }

    state.workspaces.set(workspaceId, {
      ...current,
      fsrs_algorithm: String(params[0]),
      fsrs_desired_retention: Number(params[1]),
      fsrs_learning_steps_minutes: JSON.parse(String(params[2])) as ReadonlyArray<number>,
      fsrs_relearning_steps_minutes: JSON.parse(String(params[3])) as ReadonlyArray<number>,
      fsrs_maximum_interval_days: Number(params[4]),
      fsrs_enable_fuzz: Boolean(params[5]),
      fsrs_client_updated_at: String(params[6]),
      fsrs_last_modified_by_replica_id: String(params[7]),
      fsrs_last_operation_id: String(params[8]),
      fsrs_updated_at: String(params[9]),
    });
    return createQueryResult<Row>([]);
  }

  return null;
}

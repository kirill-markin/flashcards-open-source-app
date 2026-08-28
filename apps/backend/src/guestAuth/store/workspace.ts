import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import { HttpError } from "../../shared/errors";
import { lockUserSettingsForWorkspaceLifecycleInExecutor } from "../../workspaces/state";
import { toIsoString } from "../shared";
import type { GuestUpgradeCompletion } from "../types";

type GuestWorkspaceRow = Readonly<{
  workspace_id: string | null;
}>;

type WorkspaceSummaryRow = Readonly<{
  workspace_id: string;
  name: string;
  created_at: Date | string;
}>;

/**
 * Locks the guest's `org.user_settings` row and returns its selected workspace, or `null` when the
 * guest has none. `workspace_id` is `ON DELETE SET NULL` from `org.workspaces` (migration `0001`),
 * so a guest without one is reachable and is not automatically an error: a caller that has to
 * survive it, such as the web guest reaper, treats it as its own outcome instead of throwing.
 */
export async function loadGuestWorkspaceIdOrNullInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
): Promise<string | null> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  const result = await executor.query<GuestWorkspaceRow>(
    "SELECT workspace_id FROM org.user_settings WHERE user_id = $1 FOR UPDATE",
    [guestUserId],
  );

  return result.rows[0]?.workspace_id ?? null;
}

export async function loadGuestWorkspaceIdInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
): Promise<string> {
  const workspaceId = await loadGuestWorkspaceIdOrNullInExecutor(executor, guestUserId);
  if (workspaceId === null) {
    throw new Error("Guest user is missing selected workspace");
  }

  return workspaceId;
}

export async function loadWorkspaceSummaryInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<GuestUpgradeCompletion["workspace"]> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const result = await executor.query<WorkspaceSummaryRow>(
    [
      "SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at",
      "FROM org.workspaces AS workspaces",
      "INNER JOIN org.workspace_memberships AS memberships",
      "ON memberships.workspace_id = workspaces.workspace_id",
      "WHERE memberships.user_id = $1 AND memberships.workspace_id = $2",
      "LIMIT 1",
    ].join(" "),
    [userId, workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return {
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: toIsoString(row.created_at),
    isSelected: true,
  };
}

export async function loadWorkspaceNameInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<string> {
  const workspace = await loadWorkspaceSummaryInExecutor(executor, userId, workspaceId);
  return workspace.name;
}

export async function assertTargetWorkspaceAccessInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const workspace = await loadWorkspaceSummaryInExecutor(executor, userId, workspaceId);
  if (workspace.workspaceId !== workspaceId) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }
}

export async function selectWorkspaceForUserInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await lockUserSettingsForWorkspaceLifecycleInExecutor(executor, userId);
  await executor.query(
    "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
    [workspaceId, userId],
  );
}

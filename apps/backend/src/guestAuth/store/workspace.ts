import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
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

type GuestContentProbeRow = Readonly<{
  has_content: boolean;
}>;

export async function loadGuestWorkspaceIdInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
): Promise<string> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  const result = await executor.query<GuestWorkspaceRow>(
    "SELECT workspace_id FROM org.user_settings WHERE user_id = $1 FOR UPDATE",
    [guestUserId],
  );
  const workspaceId = result.rows[0]?.workspace_id ?? null;
  if (workspaceId === null) {
    throw new Error("Guest user is missing selected workspace");
  }

  return workspaceId;
}

/**
 * Reports whether a guest owns anything `/guest-auth/upgrade/complete` would have to carry.
 *
 * The probe covers every table that upgrade transfers, not only the workspace-scoped ones, because
 * the caller uses this to decide whether revoking a guest session would strand data and the revoke
 * strands a row wherever it sits. Four tables are workspace-scoped and follow the merge:
 * `content.cards`, `content.decks`, `content.review_events` and `content.media_assets`. Three carry
 * no `workspace_id` at all and follow the guest user id through `support.transfer_guest_feedback`
 * and `community.transfer_guest_public_profile`: `support.feedback_prompt_events`,
 * `support.feedback_submissions` and `community.public_profiles`. A web guest cannot reach the
 * feedback or community surfaces, but an `ios`/`android` analytics-only guest can, and it would
 * otherwise pass a workspace-only guard with an empty workspace and lose those rows.
 *
 * Tombstoned rows count. A deleted card is still a row `/guest-auth/upgrade/complete` moves into the
 * destination workspace, so the safe answer for a row that exists is that it exists.
 *
 * The workspace scope applied below also fixes `security.current_user_id()` to the guest, which is
 * what the user-scoped row-level security policies on the `support` and `community` tables read, so
 * one scope serves both halves of the probe.
 */
export async function guestOwnsUpgradeTransferableDataInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<boolean> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<GuestContentProbeRow>(
    [
      "SELECT",
      "EXISTS (SELECT 1 FROM content.cards WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM content.decks WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM content.review_events WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM content.media_assets WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM support.feedback_prompt_events WHERE user_id = $2)",
      "OR EXISTS (SELECT 1 FROM support.feedback_submissions WHERE user_id = $2)",
      "OR EXISTS (SELECT 1 FROM community.public_profiles WHERE user_id = $2)",
      "AS has_content",
    ].join(" "),
    [guestWorkspaceId, guestUserId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Guest content probe returned no row for workspace ${guestWorkspaceId}`);
  }

  return row.has_content;
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

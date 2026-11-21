import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import { HttpError } from "../../shared/errors";
import { lockWorkspaceMembershipLifecyclesInExecutor } from "../../workspaces/accessLocks";
import { loadWorkspaceChatInstructionsWithExecutor } from "../../workspaces/chatInstructions";
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

export async function tryLockGuestAccountWriterFenceInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
): Promise<boolean> {
  const result = await executor.query<Readonly<{ locked: boolean }>>(
    "SELECT pg_try_advisory_xact_lock(hashtextextended('auth.account_writer:' || $1::text, 2::bigint)) AS locked",
    [guestUserId],
  );
  return result.rows[0]?.locked === true;
}

export async function loadGuestOwnedWorkspaceIdsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
): Promise<ReadonlyArray<string>> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  const result = await executor.query<Readonly<{ workspace_id: string }>>(
    "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1 AND role = 'owner' ORDER BY workspace_id",
    [guestUserId],
  );
  return result.rows.map((row) => row.workspace_id);
}

// The caller holds the guest writer fence so a scoped save cannot pass the probe before retirement.
export async function guestOwnsWorkspaceChatInstructionsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
): Promise<boolean> {
  const workspaceIds = await loadGuestOwnedWorkspaceIdsInExecutor(executor, guestUserId);
  await lockWorkspaceMembershipLifecyclesInExecutor(executor, workspaceIds);
  for (const workspaceId of workspaceIds) {
    await applyWorkspaceDatabaseScopeInExecutor(executor, { userId: guestUserId, workspaceId });
    if (await loadWorkspaceChatInstructionsWithExecutor(executor, workspaceId) !== null) {
      return true;
    }
  }
  return false;
}

export async function transferGuestOwnedWorkspacesInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  upgradeId: string,
  guestSessionSecretHash: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  await executor.query(
    "SELECT auth.transfer_guest_owned_workspaces($1, $2)",
    [upgradeId, guestSessionSecretHash],
  );
}

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
      "OR EXISTS (SELECT 1 FROM ai.consent_identities WHERE user_id = $2)",
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

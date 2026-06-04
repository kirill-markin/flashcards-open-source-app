import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import { lockWorkspaceAccessLifecycleInExecutor } from "../../workspaces/accessLocks";

type DeletedGuestWorkspaceRow = Readonly<{
  workspace_id: string;
}>;

export async function deleteGuestWorkspaceContentInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });
  await lockWorkspaceAccessLifecycleInExecutor(executor, guestUserId, guestWorkspaceId);

  await executor.query(
    "DELETE FROM content.review_events WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
  await executor.query(
    "DELETE FROM content.decks WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
  await executor.query(
    "DELETE FROM content.cards WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
}

export async function deleteWorkspaceInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });
  await lockWorkspaceAccessLifecycleInExecutor(executor, guestUserId, guestWorkspaceId);
  await executor.query(
    "DELETE FROM org.workspaces WHERE workspace_id = $1",
    [guestWorkspaceId],
  );
}

export async function deleteGuestWorkspaceIfOwnedBySoleMemberInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<boolean> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });
  await lockWorkspaceAccessLifecycleInExecutor(executor, guestUserId, guestWorkspaceId);
  const result = await executor.query<DeletedGuestWorkspaceRow>(
    [
      "DELETE FROM org.workspaces AS workspaces",
      "WHERE workspaces.workspace_id = $1",
      "AND EXISTS (",
      "SELECT 1",
      "FROM org.workspace_memberships memberships",
      "WHERE memberships.workspace_id = workspaces.workspace_id",
      "AND memberships.user_id = $2",
      "AND memberships.role = 'owner'",
      ")",
      "AND 1 = (",
      "SELECT COUNT(*)::int",
      "FROM org.workspace_memberships all_memberships",
      "WHERE all_memberships.workspace_id = workspaces.workspace_id",
      ")",
      "RETURNING workspaces.workspace_id",
    ].join(" "),
    [guestWorkspaceId, guestUserId],
  );

  return result.rows[0] !== undefined;
}

export async function deleteUserSettingsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  await executor.query(
    "DELETE FROM org.user_settings WHERE user_id = $1",
    [guestUserId],
  );
}

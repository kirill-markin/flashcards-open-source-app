import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";

export async function transferGuestFeedbackInExecutor(
  executor: DatabaseExecutor,
  sourceGuestUserId: string,
  sourceGuestWorkspaceId: string,
  targetUserId: string,
  targetWorkspaceId: string,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: targetUserId,
    workspaceId: targetWorkspaceId,
  });
  await executor.query(
    "SELECT support.transfer_guest_feedback($1, $2, $3, $4)",
    [
      sourceGuestUserId,
      sourceGuestWorkspaceId,
      targetUserId,
      targetWorkspaceId,
    ],
  );
}

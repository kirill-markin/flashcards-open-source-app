import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";

export async function transferGuestPublicProfileInExecutor(
  executor: DatabaseExecutor,
  sourceGuestUserId: string,
  targetUserId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: targetUserId });
  await executor.query(
    "SELECT community.transfer_guest_public_profile($1, $2)",
    [
      sourceGuestUserId,
      targetUserId,
    ],
  );
}

import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../database";
import { resolveCanonicalAccountIdInExecutor } from "../auth/userIdentities";

export async function anonymizeAiUsageForDeletedPersonInExecutor(
  executor: DatabaseExecutor,
  personUserIds: ReadonlyArray<string>,
  anonymizedUserId: string,
): Promise<void> {
  await executor.query(
    [
      "UPDATE ai.usage_events SET",
      "user_id = $1,",
      "workspace_id = NULL,",
      "request_id = NULL",
      "WHERE user_id = ANY($2::text[])",
    ].join(" "),
    [anonymizedUserId, personUserIds],
  );
}

/** Guest upgrade also changes workspace attribution; account retirement must keep it intact. */
export async function transferAiUsageToUpgradedAccountInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
  targetUserId: string,
  targetWorkspaceId: string,
): Promise<void> {
  await executor.query(
    [
      "UPDATE ai.usage_events SET",
      "user_id = $3,",
      "workspace_id = CASE WHEN workspace_id = $2::uuid THEN $4::uuid ELSE workspace_id END",
      "WHERE user_id = $1",
    ].join(" "),
    [guestUserId, guestWorkspaceId, targetUserId, targetWorkspaceId],
  );
}


/** Resolve and fence on the append's connection so retirement cannot split ownership and insertion. */
export async function resolveAiUsageOwnerInExecutor(
  executor: DatabaseExecutor,
  originalUserId: string,
): Promise<string> {
  const userId = await resolveCanonicalAccountIdInExecutor(executor, originalUserId);
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  return userId;
}

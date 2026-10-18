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
  await executor.query("SELECT ai.anonymize_browser_guest_trial($1::text[], $2)",
    [personUserIds, anonymizedUserId]);
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
  await executor.query("SELECT ai.transfer_browser_guest_trial($1, $2)", [guestUserId, targetUserId]);
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

import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../../database";
import { unsafeTransaction } from "../../../database/unsafe";
import { resolveCanonicalAccountIdInExecutor } from "../../../auth/userIdentities";

/** Original ownership comes from the trusted, validated writer snapshot and stays immutable. */
export async function applyMultipartWriterOwnerScopeInExecutor(
  executor: DatabaseExecutor,
  originalScope: WorkspaceDatabaseScope,
): Promise<WorkspaceDatabaseScope> {
  const userId = await resolveCanonicalAccountIdInExecutor(executor, originalScope.userId);
  const scope = { userId, workspaceId: originalScope.workspaceId };
  await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
  return scope;
}

export function transactionWithMultipartWriterOwnerScope<Result>(
  originalScope: WorkspaceDatabaseScope,
  callback: (executor: DatabaseExecutor, scope: WorkspaceDatabaseScope) => Promise<Result>,
): Promise<Result> {
  return unsafeTransaction(async (executor) => {
    const scope = await applyMultipartWriterOwnerScopeInExecutor(executor, originalScope);
    return callback(executor, scope);
  });
}

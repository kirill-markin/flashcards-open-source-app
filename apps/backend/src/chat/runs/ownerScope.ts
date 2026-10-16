import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import { resolveCanonicalAccountIdInExecutor } from "../../auth/userIdentities";
import { selectChatRunWithExecutor } from "./repository";

/** The account handle must come from trusted dispatch, never a client-provided owner alias. */
export async function transactionWithChatWorkerOwnerScope<Result>(
  originalUserId: string,
  workspaceId: string,
  callback: (executor: DatabaseExecutor, scope: WorkspaceDatabaseScope) => Promise<Result>,
): Promise<Result> {
  if (typeof originalUserId !== "string" || originalUserId.trim() === ""
      || typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new Error("Trusted chat worker dispatch is missing its account or workspace");
  }
  return unsafeTransaction(async (executor) => {
    const userId = await resolveCanonicalAccountIdInExecutor(executor, originalUserId);
    const scope = { userId, workspaceId };
    await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
    return callback(executor, scope);
  });
}

export async function resolveTrustedChatWorkerOwner(
  originalUserId: string,
  workspaceId: string,
  runId: string,
  sessionId: string | null,
  requestId: string | null,
): Promise<string | null> {
  return transactionWithChatWorkerOwnerScope(originalUserId, workspaceId, async (executor, scope) => {
    const run = await selectChatRunWithExecutor(executor, scope, runId);
    if (run === null) return null;
    if ((sessionId !== null && run.session_id !== sessionId)
        || (requestId !== null && run.request_id !== requestId)) {
      throw new Error("Trusted chat worker dispatch does not match its persisted run");
    }
    return scope.userId;
  });
}

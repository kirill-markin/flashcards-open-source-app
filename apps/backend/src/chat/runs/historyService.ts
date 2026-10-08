import { transactionWithWorkspaceScope } from "../../database";
import {
  archiveLockedChatSessionWithExecutor,
  ChatSessionArchiveActiveRunError,
  lockHistoryChatSessionWithExecutor,
  type ArchivedChatSession,
} from "../store";
import { recoverStaleRunWithExecutor } from "./finalization";
import { selectSessionForUpdateWithExecutor } from "./repository";

/**
 * Archives the caller's own chat after recovering a stale active run, so a run whose worker is gone
 * never blocks archiving. A run with a live heartbeat is refused.
 */
export async function archiveChatSession(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<ArchivedChatSession> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const session = await lockHistoryChatSessionWithExecutor(executor, scope, sessionId);
    if (session.status === "running") {
      const lockedSession = await selectSessionForUpdateWithExecutor(executor, scope, sessionId);
      const recovered = await recoverStaleRunWithExecutor(executor, scope, lockedSession);
      if (!recovered) {
        throw new ChatSessionArchiveActiveRunError(sessionId);
      }
    }

    return archiveLockedChatSessionWithExecutor(executor, sessionId);
  });
}

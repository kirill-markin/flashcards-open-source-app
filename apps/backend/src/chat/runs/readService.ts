import { transactionWithWorkspaceScope } from "../../db";
import {
  recoverStaleRunWithExecutor,
} from "./finalization";
import {
  selectChatRunWithExecutor,
  selectSessionForUpdateWithExecutor,
} from "./repository";
import type { ChatRunSnapshot, RecoveredPaginatedSession } from "./types";
import {
  getChatSessionSnapshotWithExecutor,
  listChatMessagesBeforeWithExecutor,
  listChatMessagesLatestWithExecutor,
  resolveLatestOrCreateChatSessionWithExecutor,
  resolveRequestedChatSessionWithExecutor,
  type ChatSessionSnapshot,
} from "../store";

function toEpochMillisOrNull(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  return new Date(value).getTime();
}

/**
 * Returns a session snapshot and recovers any stale active run before the snapshot is returned to a client.
 */
export async function getRecoveredChatSessionSnapshot(
  userId: string,
  workspaceId: string,
  sessionId?: string,
): Promise<ChatSessionSnapshot> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const snapshot = await getChatSessionSnapshotWithExecutor(executor, scope, sessionId);
    if (snapshot.runState !== "running") {
      return snapshot;
    }

    const lockedSession = await selectSessionForUpdateWithExecutor(executor, scope, snapshot.sessionId);
    const recovered = await recoverStaleRunWithExecutor(executor, scope, lockedSession);
    if (!recovered) {
      return snapshot;
    }

    return getChatSessionSnapshotWithExecutor(executor, scope, snapshot.sessionId);
  });
}

/**
 * Resolves a session with stale-run recovery, then returns a paginated message window.
 */
export async function getRecoveredPaginatedSession(
  userId: string,
  workspaceId: string,
  sessionId: string | undefined,
  limit: number,
  beforeCursor: number | undefined,
): Promise<RecoveredPaginatedSession> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const sessionRow = sessionId === undefined
      ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
      : await resolveRequestedChatSessionWithExecutor(executor, scope, sessionId);

    if (sessionRow.status === "running") {
      const lockedSession = await selectSessionForUpdateWithExecutor(executor, scope, sessionRow.session_id);
      await recoverStaleRunWithExecutor(executor, scope, lockedSession);
    }

    const resolvedSession = sessionId === undefined
      ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
      : await resolveRequestedChatSessionWithExecutor(executor, scope, sessionRow.session_id);

    const page = beforeCursor === undefined
      ? await listChatMessagesLatestWithExecutor(executor, scope, resolvedSession.session_id, limit)
      : await listChatMessagesBeforeWithExecutor(executor, scope, resolvedSession.session_id, beforeCursor, limit);

    return {
      snapshot: await getChatSessionSnapshotWithExecutor(executor, scope, resolvedSession.session_id),
      page,
    };
  });
}

export async function getChatRunSnapshot(
  userId: string,
  workspaceId: string,
  runId: string,
): Promise<ChatRunSnapshot | null> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = await selectChatRunWithExecutor(executor, scope, runId);
    if (run === null) {
      return null;
    }

    return {
      runId: run.run_id,
      sessionId: run.session_id,
      assistantItemId: run.assistant_item_id,
      status: run.status,
      startedAt: toEpochMillisOrNull(run.started_at),
      finishedAt: toEpochMillisOrNull(run.finished_at),
      lastErrorMessage: run.last_error_message,
    };
  });
}

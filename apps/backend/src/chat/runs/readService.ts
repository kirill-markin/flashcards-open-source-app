import { transactionWithWorkspaceScope } from "../../database";
import {
  recoverStaleRunWithExecutor,
} from "./finalization";
import {
  claimChatLiveAttachOwnershipWithExecutor,
  selectChatRunWithExecutor,
  selectSessionForUpdateWithExecutor,
} from "./repository";
import type { ChatRunSnapshot, RecoveredPaginatedSession } from "./types";
import {
  getChatSessionSnapshotWithExecutor,
  listChatMessagesBeforeWithExecutor,
  listChatMessagesLatestWithExecutor,
  resolveLatestOrCreateChatSessionWithExecutor,
  resolveRequestedOrCreateChatSessionWithExecutor,
  type ChatSessionSnapshot,
} from "../store";

function toEpochMillisOrNull(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  return new Date(value).getTime();
}

function toLiveAttachSeq(value: string): number {
  const liveAttachSeq = Number(value);
  if (!Number.isSafeInteger(liveAttachSeq) || liveAttachSeq < 0) {
    throw new RangeError(`Chat run live attach sequence is not a non-negative safe integer: ${value}`);
  }

  return liveAttachSeq;
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
      : await resolveRequestedOrCreateChatSessionWithExecutor(executor, scope, sessionId);

    if (sessionRow.status === "running") {
      const lockedSession = await selectSessionForUpdateWithExecutor(executor, scope, sessionRow.session_id);
      await recoverStaleRunWithExecutor(executor, scope, lockedSession);
    }

    const resolvedSession = sessionId === undefined
      ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
      : await resolveRequestedOrCreateChatSessionWithExecutor(executor, scope, sessionRow.session_id);

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
      liveAttachClientId: run.live_attach_client_id,
      liveAttachSeq: toLiveAttachSeq(run.live_attach_seq),
    };
  });
}

/**
 * Makes this attach the owning live SSE connection for the run and returns the sequence it owns.
 * A later attach from the same client instance supersedes it by taking a greater sequence.
 */
export async function claimChatLiveAttachOwnership(
  userId: string,
  workspaceId: string,
  runId: string,
  liveAttachClientId: string,
): Promise<number> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    toLiveAttachSeq(await claimChatLiveAttachOwnershipWithExecutor(
      executor,
      { userId, workspaceId },
      runId,
      liveAttachClientId,
    )));
}

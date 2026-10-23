import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../database";
import {
  recoverStaleRunWithExecutor,
} from "./finalization";
import {
  claimChatLiveAttachOwnershipWithExecutor,
  selectChatRunWithExecutor,
  selectSessionForUpdateWithExecutor,
} from "./repository";
import type {
  ChatRunSnapshot,
  RecoveredChatSession,
  RecoveredPaginatedSession,
} from "./types";
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
 * Reads a running session under its row lock. Every writer that ends a run updates this row in the
 * same transaction, so the snapshot and any later read in the caller's transaction see one state.
 */
async function readRecoveredChatSessionSnapshotWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string | undefined,
): Promise<ChatSessionSnapshot> {
  const session = sessionId === undefined
    ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
    : await resolveRequestedOrCreateChatSessionWithExecutor(executor, scope, sessionId);
  if (session.status !== "running") {
    const snapshot = await getChatSessionSnapshotWithExecutor(executor, scope, session.session_id);
    if (snapshot.runState !== "running") {
      return snapshot;
    }
  }

  const lockedSession = await selectSessionForUpdateWithExecutor(executor, scope, session.session_id);
  await recoverStaleRunWithExecutor(executor, scope, lockedSession);
  return getChatSessionSnapshotWithExecutor(executor, scope, session.session_id);
}

async function readRecoveredChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string | undefined,
): Promise<RecoveredChatSession> {
  const snapshot = await readRecoveredChatSessionSnapshotWithExecutor(executor, scope, sessionId);
  return {
    snapshot,
    latestMessagesPage: snapshot.runState === "running"
      ? await listChatMessagesLatestWithExecutor(executor, scope, snapshot.sessionId, 2)
      : null,
  };
}

/**
 * Returns a session snapshot and recovers any stale active run before the snapshot is returned to a client.
 */
export async function getRecoveredChatSessionSnapshot(
  userId: string,
  workspaceId: string,
  sessionId?: string,
): Promise<ChatSessionSnapshot> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    readRecoveredChatSessionSnapshotWithExecutor(executor, { userId, workspaceId }, sessionId));
}

/**
 * Returns a recovered session snapshot together with the latest messages read in the same locked state.
 */
export async function getRecoveredChatSession(
  userId: string,
  workspaceId: string,
  sessionId: string | undefined,
): Promise<RecoveredChatSession> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    readRecoveredChatSessionWithExecutor(executor, { userId, workspaceId }, sessionId));
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
    const recoveredSession = await readRecoveredChatSessionWithExecutor(executor, scope, sessionId);
    const resolvedSessionId = recoveredSession.snapshot.sessionId;
    const page = beforeCursor === undefined
      ? await listChatMessagesLatestWithExecutor(executor, scope, resolvedSessionId, limit)
      : await listChatMessagesBeforeWithExecutor(executor, scope, resolvedSessionId, beforeCursor, limit);

    return {
      ...recoveredSession,
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

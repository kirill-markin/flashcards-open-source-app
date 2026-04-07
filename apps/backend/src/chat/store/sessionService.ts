import {
  queryWithWorkspaceScope,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../db";
import { createChatSessionRequestedSessionIdConflictError } from "../errors";
import {
  clearActiveChatComposerSuggestionGenerationWithExecutor,
  createInitialChatComposerSuggestionGenerationWithExecutor,
} from "./composerSuggestionService";
import {
  insertGeneratedChatSessionRowWithExecutor,
  insertRequestedChatSessionRowWithExecutor,
  selectLatestChatSessionRowWithExecutor,
  selectRequestedChatSessionRowWithExecutor,
  updateChatSessionStatusRowWithExecutor,
  type ChatSessionRow,
} from "./repository";
import {
  ChatSessionNotFoundError,
  type ChatSessionRunState,
} from "./types";

async function createChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  requestedSessionId: string | undefined,
): Promise<ChatSessionRow> {
  const insertedSession = requestedSessionId === undefined
    ? await insertGeneratedChatSessionRowWithExecutor(executor, scope, scope.userId, scope.workspaceId)
    : await insertRequestedChatSessionRowWithExecutor(
      executor,
      scope,
      requestedSessionId,
      scope.userId,
      scope.workspaceId,
    );

  if (insertedSession === null && requestedSessionId !== undefined) {
    const existingSession = await selectRequestedChatSessionWithExecutor(executor, scope, requestedSessionId);
    if (existingSession !== null) {
      return existingSession;
    }

    throw createChatSessionRequestedSessionIdConflictError(requestedSessionId);
  }

  if (insertedSession === null) {
    throw new Error("Chat session insert returned no row");
  }

  await createInitialChatComposerSuggestionGenerationWithExecutor(
    executor,
    scope,
    insertedSession.session_id,
  );
  return resolveRequestedChatSessionWithExecutor(executor, scope, insertedSession.session_id);
}

export async function selectRequestedChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ChatSessionRow | null> {
  return selectRequestedChatSessionRowWithExecutor(
    executor,
    scope,
    scope.userId,
    scope.workspaceId,
    sessionId,
  );
}

async function selectLatestChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<ChatSessionRow | null> {
  return selectLatestChatSessionRowWithExecutor(
    executor,
    scope,
    scope.userId,
    scope.workspaceId,
  );
}

export async function resolveRequestedChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ChatSessionRow> {
  const row = await selectRequestedChatSessionWithExecutor(executor, scope, sessionId);
  if (row !== null) {
    return row;
  }

  throw new ChatSessionNotFoundError(sessionId);
}

export async function resolveRequestedOrCreateChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ChatSessionRow> {
  const row = await selectRequestedChatSessionWithExecutor(executor, scope, sessionId);
  if (row !== null) {
    return row;
  }

  return createChatSessionWithExecutor(executor, scope, sessionId);
}

export async function resolveLatestOrCreateChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<ChatSessionRow> {
  const latestSession = await selectLatestChatSessionWithExecutor(executor, scope);
  if (latestSession !== null) {
    return latestSession;
  }

  return createChatSessionWithExecutor(executor, scope, undefined);
}

export const getChatSessionIdWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<string | null> => {
  const row = await selectRequestedChatSessionWithExecutor(executor, scope, sessionId);
  return row?.session_id ?? null;
};

export const getLatestChatSessionIdWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<string | null> => {
  const row = await selectLatestChatSessionWithExecutor(executor, scope);
  return row?.session_id ?? null;
};

export const createFreshChatSessionWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  requestedSessionId: string | undefined,
): Promise<string> => {
  const row = await createChatSessionWithExecutor(executor, scope, requestedSessionId);
  return row.session_id;
};

export const touchChatSessionHeartbeatWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  heartbeatAt: Date,
  activeRunId: string,
): Promise<void> => {
  await updateChatSessionStatusRowWithExecutor(
    executor,
    scope,
    sessionId,
    "running",
    activeRunId,
    heartbeatAt,
  );
};

export const updateChatSessionRunStateWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  runState: ChatSessionRunState,
  activeRunId: string | null,
  activeRunHeartbeatAt: Date | null,
): Promise<void> => {
  await updateChatSessionStatusRowWithExecutor(
    executor,
    scope,
    sessionId,
    runState,
    activeRunId,
    activeRunHeartbeatAt,
  );
};

export const getChatSessionId = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<string | null> =>
  queryWithWorkspaceScope({ userId, workspaceId }, `
    SELECT session_id
    FROM ai.chat_sessions
    WHERE user_id = $1
      AND workspace_id = $2
      AND session_id = $3
  `, [userId, workspaceId, sessionId]).then((result) => {
    const row = result.rows[0] as Readonly<{ session_id: string }> | undefined;
    return row?.session_id ?? null;
  });

export const getLatestChatSessionId = async (
  userId: string,
  workspaceId: string,
): Promise<string | null> =>
  queryWithWorkspaceScope({ userId, workspaceId }, `
    SELECT session_id
    FROM ai.chat_sessions
    WHERE user_id = $1
      AND workspace_id = $2
    ORDER BY created_at DESC, session_id DESC
    LIMIT 1
  `, [userId, workspaceId]).then((result) => {
    const row = result.rows[0] as Readonly<{ session_id: string }> | undefined;
    return row?.session_id ?? null;
  });

export const createFreshChatSession = async (
  userId: string,
  workspaceId: string,
  requestedSessionId: string | undefined,
): Promise<string> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    createFreshChatSessionWithExecutor(executor, { userId, workspaceId }, requestedSessionId));

export const rolloverToFreshChatSession = async (
  userId: string,
  workspaceId: string,
  previousSessionId: string,
): Promise<string> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    await clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      previousSessionId,
      "new_chat_rollover",
    );
    return createFreshChatSessionWithExecutor(executor, scope, undefined);
  });

export const touchChatSessionHeartbeat = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  heartbeatAt: Date,
  activeRunId: string,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    touchChatSessionHeartbeatWithExecutor(
      executor,
      { userId, workspaceId },
      sessionId,
      heartbeatAt,
      activeRunId,
    ));

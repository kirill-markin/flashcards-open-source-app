import type { QueryResultRow } from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  queryWithWorkspaceScope,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../db";
import type { StoredMessage } from "./history";
import type { ContentPart } from "./types";

export type ChatSessionRunState = "idle" | "running" | "interrupted";
export type ChatItemState = "in_progress" | "completed" | "error" | "cancelled";

type ChatSessionRow = Readonly<{
  session_id: string;
  status: ChatSessionRunState;
  active_run_heartbeat_at: string | null;
  main_content_invalidation_version: string | number;
  updated_at: string;
}>;

type ChatItemPayload = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
}>;

type ChatItemRow = Readonly<{
  item_id: string;
  session_id: string;
  state: ChatItemState;
  payload: ChatItemPayload;
  created_at: string;
  updated_at: string;
}>;

export class ChatSessionNotFoundError extends Error {
  public constructor(sessionId: string) {
    super(`Chat session not found: ${sessionId}`);
    this.name = "ChatSessionNotFoundError";
  }
}

export class ChatSessionConflictError extends Error {
  public constructor(sessionId: string) {
    super(`Chat session already has an active run: ${sessionId}`);
    this.name = "ChatSessionConflictError";
  }
}

export type PersistedChatMessageItem = Readonly<{
  itemId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  state: ChatItemState;
  isError: boolean;
  isStopped: boolean;
  timestamp: number;
  updatedAt: number;
}>;

export type ChatSessionSnapshot = Readonly<{
  sessionId: string;
  runState: ChatSessionRunState;
  updatedAt: number;
  activeRunHeartbeatAt: number | null;
  mainContentInvalidationVersion: number;
  messages: ReadonlyArray<StoredMessage>;
}>;

const SELECT_SESSION_SQL = `
  SELECT session_id, status, active_run_heartbeat_at, main_content_invalidation_version, updated_at
  FROM ai.chat_sessions
  WHERE user_id = $1
    AND workspace_id = $2
    AND session_id = $3
`;

const SELECT_LATEST_SESSION_SQL = `
  SELECT session_id, status, active_run_heartbeat_at, main_content_invalidation_version, updated_at
  FROM ai.chat_sessions
  WHERE user_id = $1
    AND workspace_id = $2
  ORDER BY created_at DESC, session_id DESC
  LIMIT 1
`;

const INSERT_SESSION_SQL = `
  INSERT INTO ai.chat_sessions (
    user_id,
    workspace_id,
    status,
    active_run_heartbeat_at,
    main_content_invalidation_version,
    updated_at
  )
  VALUES ($1, $2, 'idle', NULL, 0, now())
  RETURNING session_id, status, active_run_heartbeat_at, main_content_invalidation_version, updated_at
`;

const LIST_CHAT_ITEMS_SQL = `
  SELECT
    item_id,
    session_id,
    state,
    payload,
    created_at,
    updated_at
  FROM ai.chat_items
  WHERE session_id = $1
    AND item_kind = 'message'
  ORDER BY item_order ASC
`;

const UPDATE_CHAT_SESSION_HEARTBEAT_SQL = `
  UPDATE ai.chat_sessions
  SET active_run_heartbeat_at = $2,
      updated_at = now()
  WHERE session_id = $1
  RETURNING session_id, status, active_run_heartbeat_at, main_content_invalidation_version, updated_at
`;

const UPDATE_CHAT_SESSION_STATUS_SQL = `
  UPDATE ai.chat_sessions
  SET status = $2,
      active_run_heartbeat_at = $3,
      updated_at = now()
  WHERE session_id = $1
  RETURNING session_id, status, active_run_heartbeat_at, main_content_invalidation_version, updated_at
`;

const parseMainContentInvalidationVersion = (
  value: string | number,
  operation: string,
): number => {
  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Chat session ${operation} returned an invalid main_content_invalidation_version`);
  }

  return parsedValue;
};

const mapSessionRow = (
  row: ChatSessionRow,
): Omit<ChatSessionSnapshot, "messages"> => ({
  sessionId: row.session_id,
  runState: row.status,
  updatedAt: new Date(row.updated_at).getTime(),
  activeRunHeartbeatAt: row.active_run_heartbeat_at === null
    ? null
    : new Date(row.active_run_heartbeat_at).getTime(),
  mainContentInvalidationVersion: parseMainContentInvalidationVersion(
    row.main_content_invalidation_version,
    "read",
  ),
});

const mapChatItemRow = (
  row: ChatItemRow,
): PersistedChatMessageItem => ({
  itemId: row.item_id,
  sessionId: row.session_id,
  role: row.payload.role,
  content: row.payload.content,
  state: row.state,
  isError: row.state === "error",
  isStopped: row.state === "cancelled",
  timestamp: new Date(row.created_at).getTime(),
  updatedAt: new Date(row.updated_at).getTime(),
});

const mapPersistedMessagesToStoredMessages = (
  messages: ReadonlyArray<PersistedChatMessageItem>,
): ReadonlyArray<StoredMessage> =>
  messages.map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    isError: message.isError,
    isStopped: message.isStopped,
  }));

const requireSessionRow = (
  row: ChatSessionRow | undefined,
  operation: string,
): ChatSessionRow => {
  if (row === undefined) {
    throw new Error(`Chat session ${operation} failed: query returned no row`);
  }

  return row;
};

const executeQuery = async <Row extends QueryResultRow>(
  executor: DatabaseExecutor,
  text: string,
  params: ReadonlyArray<string | null>,
): Promise<ReadonlyArray<Row>> => {
  const result = await executor.query<Row>(text, params);
  return result.rows;
};

const createChatSessionWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<ChatSessionRow> => {
  const rows = await executeQuery<ChatSessionRow>(executor, INSERT_SESSION_SQL, [
    scope.userId,
    scope.workspaceId,
  ]);

  return requireSessionRow(rows[0], "insert");
};

const selectRequestedChatSessionWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ChatSessionRow | null> => {
  const rows = await executeQuery<ChatSessionRow>(executor, SELECT_SESSION_SQL, [
    scope.userId,
    scope.workspaceId,
    sessionId,
  ]);

  return (rows[0] as ChatSessionRow | undefined) ?? null;
};

const selectLatestChatSessionWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<ChatSessionRow | null> => {
  const rows = await executeQuery<ChatSessionRow>(executor, SELECT_LATEST_SESSION_SQL, [
    scope.userId,
    scope.workspaceId,
  ]);

  return (rows[0] as ChatSessionRow | undefined) ?? null;
};

const resolveRequestedChatSessionWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ChatSessionRow> => {
  const row = await selectRequestedChatSessionWithExecutor(executor, scope, sessionId);
  if (row !== null) {
    return row;
  }

  throw new ChatSessionNotFoundError(sessionId);
};

const resolveLatestOrCreateChatSessionWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<ChatSessionRow> => {
  const latestSession = await selectLatestChatSessionWithExecutor(executor, scope);
  if (latestSession !== null) {
    return latestSession;
  }

  return createChatSessionWithExecutor(executor, scope);
};

const withScopedExecutor = async <Result>(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  callback: () => Promise<Result>,
): Promise<Result> => {
  await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
  return callback();
};

export const getChatSessionIdWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<string | null> =>
  withScopedExecutor(executor, scope, async () => {
    const row = await selectRequestedChatSessionWithExecutor(executor, scope, sessionId);
    return row?.session_id ?? null;
  });

export const getLatestChatSessionIdWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<string | null> =>
  withScopedExecutor(executor, scope, async () => {
    const row = await selectLatestChatSessionWithExecutor(executor, scope);
    return row?.session_id ?? null;
  });

export const createFreshChatSessionWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<string> =>
  withScopedExecutor(executor, scope, async () => {
    const row = await createChatSessionWithExecutor(executor, scope);
    return row.session_id;
  });

export const listChatMessagesWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ReadonlyArray<PersistedChatMessageItem>> =>
  withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemRow>(executor, LIST_CHAT_ITEMS_SQL, [sessionId]);
    return rows.map((row) => mapChatItemRow(row));
  });

export const getChatSessionSnapshotWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId?: string,
): Promise<ChatSessionSnapshot> =>
  withScopedExecutor(executor, scope, async () => {
    const sessionRow = sessionId === undefined
      ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
      : await resolveRequestedChatSessionWithExecutor(executor, scope, sessionId);
    const rows = await executeQuery<ChatItemRow>(executor, LIST_CHAT_ITEMS_SQL, [sessionRow.session_id]);
    const messages = rows.map((row) => mapChatItemRow(row));

    return {
      ...mapSessionRow(sessionRow),
      messages: mapPersistedMessagesToStoredMessages(messages),
    };
  });

export const touchChatSessionHeartbeatWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  heartbeatAt: Date,
): Promise<void> =>
  withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, UPDATE_CHAT_SESSION_HEARTBEAT_SQL, [
      sessionId,
      heartbeatAt.toISOString(),
    ]);
    if (rows.length === 0) {
      throw new ChatSessionNotFoundError(sessionId);
    }
  });

export const updateChatSessionRunStateWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  runState: ChatSessionRunState,
  activeRunHeartbeatAt: Date | null,
): Promise<void> =>
  withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, UPDATE_CHAT_SESSION_STATUS_SQL, [
      sessionId,
      runState,
      activeRunHeartbeatAt?.toISOString() ?? null,
    ]);
    if (rows.length === 0) {
      throw new ChatSessionNotFoundError(sessionId);
    }
  });

export const getChatSessionId = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<string | null> =>
  queryWithWorkspaceScope({ userId, workspaceId }, SELECT_SESSION_SQL, [userId, workspaceId, sessionId])
    .then((result) => {
      const row = result.rows[0] as ChatSessionRow | undefined;
      return row?.session_id ?? null;
    });

export const getLatestChatSessionId = async (
  userId: string,
  workspaceId: string,
): Promise<string | null> =>
  queryWithWorkspaceScope({ userId, workspaceId }, SELECT_LATEST_SESSION_SQL, [userId, workspaceId])
    .then((result) => {
      const row = result.rows[0] as ChatSessionRow | undefined;
      return row?.session_id ?? null;
    });

export const createFreshChatSession = async (
  userId: string,
  workspaceId: string,
): Promise<string> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    createFreshChatSessionWithExecutor(executor, { userId, workspaceId }));

export const listChatMessages = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<ReadonlyArray<PersistedChatMessageItem>> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    listChatMessagesWithExecutor(executor, { userId, workspaceId }, sessionId));

export const getChatSessionSnapshot = async (
  userId: string,
  workspaceId: string,
  sessionId?: string,
): Promise<ChatSessionSnapshot> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    getChatSessionSnapshotWithExecutor(executor, { userId, workspaceId }, sessionId));

export const touchChatSessionHeartbeat = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  heartbeatAt: Date,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    touchChatSessionHeartbeatWithExecutor(executor, { userId, workspaceId }, sessionId, heartbeatAt));

export const updateChatSessionRunState = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  runState: ChatSessionRunState,
  activeRunHeartbeatAt: Date | null,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    updateChatSessionRunStateWithExecutor(
      executor,
      { userId, workspaceId },
      sessionId,
      runState,
      activeRunHeartbeatAt,
    ));

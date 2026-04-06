/**
 * Persistence helpers for backend-owned chat sessions, items, and derived snapshots.
 * This module is the main bridge between the runtime and the `ai.chat_*` tables.
 */
import type { QueryResultRow } from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  queryWithWorkspaceScope,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../db";
import {
  buildInitialChatComposerSuggestions,
  emptyChatComposerSuggestions,
  parsePersistedChatComposerSuggestions,
  type ChatComposerSuggestion,
  type ChatComposerSuggestionInvalidationReason,
  type ChatComposerSuggestionSource,
} from "./composerSuggestions";
import {
  ChatItemRowNotFoundError,
  ChatSessionRowNotFoundError,
  createChatSessionRequestedSessionIdConflictError,
} from "./errors";
import { finalizePendingToolCallContent, type StoredMessage } from "./history";
import type {
  ServerChatMessage,
  StoredOpenAIReplayItem,
} from "./openai/replayItems";
import type { ContentPart } from "./types";

export type ChatSessionRunState = "idle" | "running" | "interrupted";
export type ChatItemState = "in_progress" | "completed" | "error" | "cancelled";
const INCOMPLETE_TOOL_CALL_PROVIDER_STATUS = "incomplete";
export const STOPPED_BY_USER_TOOL_OUTPUT = "Stopped by user";
export const INTERRUPTED_TOOL_CALL_OUTPUT = "Interrupted before output was captured.";
export const FAILED_TOOL_CALL_OUTPUT = "Tool failed before returning output.";

export type ChatSessionRow = Readonly<{
  session_id: string;
  status: ChatSessionRunState;
  active_run_id: string | null;
  active_run_heartbeat_at: string | null;
  composer_suggestions: unknown;
  active_composer_suggestion_generation_id: string | null;
  active_generation_suggestions: unknown | null;
  main_content_invalidation_version: string | number;
  updated_at: string;
}>;

type InsertedChatSessionRow = Readonly<{
  session_id: string;
}>;

type ChatComposerSuggestionGenerationRow = Readonly<{
  generation_id: string;
  session_id: string;
  assistant_item_id: string | null;
  source: ChatComposerSuggestionSource;
  suggestions: unknown;
  invalidated_at: string | null;
  invalidated_reason: ChatComposerSuggestionInvalidationReason | null;
  created_at: string;
}>;

type ChatItemPayload = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  openaiItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

type ChatItemRow = Readonly<{
  item_id: string;
  session_id: string;
  item_order: string | number;
  state: ChatItemState;
  payload: ChatItemPayload;
  created_at: string;
  updated_at: string;
}>;

type ChatItemWithInvalidationRow = ChatItemRow & Readonly<{
  main_content_invalidation_version: string | number;
}>;

type InsertChatItemParams = Readonly<{
  sessionId: string;
  role: "user" | "assistant";
  state: ChatItemState;
  content: ReadonlyArray<ContentPart>;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

type UpdateChatMessageItemParams = Readonly<{
  itemId: string;
  content: ReadonlyArray<ContentPart>;
  state: ChatItemState;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

type UpdateChatMessageItemAndInvalidateMainContentParams = Readonly<{
  itemId: string;
  content: ReadonlyArray<ContentPart>;
  state: ChatItemState;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

type PersistAssistantTerminalErrorParams = Readonly<{
  runId: string;
  sessionId: string;
  assistantItemId: string;
  assistantContent: ReadonlyArray<ContentPart>;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
  errorMessage: string;
  sessionState: ChatSessionRunState;
}>;

type PersistAssistantCancelledParams = Readonly<{
  runId: string;
  sessionId: string;
  assistantItemId: string;
  assistantContent: ReadonlyArray<ContentPart>;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

type CompleteChatRunParams = Readonly<{
  runId: string;
  sessionId: string;
  assistantItemId: string;
  assistantContent: ReadonlyArray<ContentPart>;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
  composerSuggestions?: ReadonlyArray<ChatComposerSuggestion>;
}>;

type UserStoppedChatRunUpdatePlan = Readonly<{
  assistantItem: PersistedChatMessageItem | null;
  assistantContent: ReadonlyArray<ContentPart> | null;
  assistantOpenAIItems: ReadonlyArray<StoredOpenAIReplayItem> | null;
  sessionState: ChatSessionRunState;
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
  itemOrder: number;
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  openaiItems?: ReadonlyArray<StoredOpenAIReplayItem>;
  state: ChatItemState;
  isError: boolean;
  isStopped: boolean;
  timestamp: number;
  updatedAt: number;
}>;

export type ChatSessionSnapshot = Readonly<{
  sessionId: string;
  runState: ChatSessionRunState;
  activeRunId: string | null;
  updatedAt: number;
  activeRunHeartbeatAt: number | null;
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
  mainContentInvalidationVersion: number;
  messages: ReadonlyArray<StoredMessage>;
}>;

const SELECT_SESSION_SQL = `
  SELECT
    chat_sessions.session_id,
    chat_sessions.status,
    chat_sessions.active_run_id,
    chat_sessions.active_run_heartbeat_at,
    chat_sessions.composer_suggestions,
    chat_sessions.active_composer_suggestion_generation_id,
    active_generation.suggestions AS active_generation_suggestions,
    chat_sessions.main_content_invalidation_version,
    chat_sessions.updated_at
  FROM ai.chat_sessions AS chat_sessions
  LEFT JOIN ai.chat_composer_suggestion_generations AS active_generation
    ON active_generation.generation_id = chat_sessions.active_composer_suggestion_generation_id
  WHERE chat_sessions.user_id = $1
    AND chat_sessions.workspace_id = $2
    AND chat_sessions.session_id = $3
`;

const SELECT_SESSION_FOR_UPDATE_SQL = `
  SELECT
    chat_sessions.session_id,
    chat_sessions.status,
    chat_sessions.active_run_id,
    chat_sessions.active_run_heartbeat_at,
    chat_sessions.composer_suggestions,
    chat_sessions.active_composer_suggestion_generation_id,
    active_generation.suggestions AS active_generation_suggestions,
    chat_sessions.main_content_invalidation_version,
    chat_sessions.updated_at
  FROM ai.chat_sessions AS chat_sessions
  LEFT JOIN ai.chat_composer_suggestion_generations AS active_generation
    ON active_generation.generation_id = chat_sessions.active_composer_suggestion_generation_id
  WHERE chat_sessions.session_id = $1
  FOR UPDATE OF chat_sessions
`;

const SELECT_LATEST_SESSION_SQL = `
  SELECT
    chat_sessions.session_id,
    chat_sessions.status,
    chat_sessions.active_run_id,
    chat_sessions.active_run_heartbeat_at,
    chat_sessions.composer_suggestions,
    chat_sessions.active_composer_suggestion_generation_id,
    active_generation.suggestions AS active_generation_suggestions,
    chat_sessions.main_content_invalidation_version,
    chat_sessions.updated_at
  FROM ai.chat_sessions AS chat_sessions
  LEFT JOIN ai.chat_composer_suggestion_generations AS active_generation
    ON active_generation.generation_id = chat_sessions.active_composer_suggestion_generation_id
  WHERE chat_sessions.user_id = $1
    AND chat_sessions.workspace_id = $2
  ORDER BY chat_sessions.created_at DESC, chat_sessions.session_id DESC
  LIMIT 1
`;

const INSERT_SESSION_SQL = `
  INSERT INTO ai.chat_sessions (
    user_id,
    workspace_id,
    status,
    active_run_id,
    active_run_heartbeat_at,
    composer_suggestions,
    main_content_invalidation_version,
    updated_at
  )
  VALUES ($1, $2, 'idle', NULL, NULL, '[]'::jsonb, 0, now())
  RETURNING session_id
`;

const INSERT_REQUESTED_SESSION_SQL = `
  INSERT INTO ai.chat_sessions (
    session_id,
    user_id,
    workspace_id,
    status,
    active_run_id,
    active_run_heartbeat_at,
    composer_suggestions,
    main_content_invalidation_version,
    updated_at
  )
  VALUES ($1::uuid, $2, $3, 'idle', NULL, NULL, '[]'::jsonb, 0, now())
  ON CONFLICT (session_id) DO NOTHING
  RETURNING session_id
`;

const LIST_CHAT_ITEMS_SQL = `
  SELECT
    item_id,
    session_id,
    item_order,
    state,
    payload,
    created_at,
    updated_at
  FROM ai.chat_items
  WHERE session_id = $1
    AND item_kind = 'message'
  ORDER BY item_order ASC
`;

const LIST_CHAT_ITEMS_LATEST_SQL = `
  SELECT
    item_id,
    session_id,
    item_order,
    state,
    payload,
    created_at,
    updated_at
  FROM ai.chat_items
  WHERE session_id = $1
    AND item_kind = 'message'
  ORDER BY item_order DESC
  LIMIT $2
`;

const LIST_CHAT_ITEMS_BEFORE_CURSOR_SQL = `
  SELECT
    item_id,
    session_id,
    item_order,
    state,
    payload,
    created_at,
    updated_at
  FROM ai.chat_items
  WHERE session_id = $1
    AND item_kind = 'message'
    AND item_order < $2
  ORDER BY item_order DESC
  LIMIT $3
`;

const LIST_CHAT_ITEMS_AFTER_CURSOR_SQL = `
  SELECT
    item_id,
    session_id,
    item_order,
    state,
    payload,
    created_at,
    updated_at
  FROM ai.chat_items
  WHERE session_id = $1
    AND item_kind = 'message'
    AND item_order > $2
  ORDER BY item_order ASC
`;

const INSERT_CHAT_ITEM_SQL = `
  WITH inserted_item AS (
    INSERT INTO ai.chat_items (
      session_id,
      item_kind,
      state,
      payload,
      updated_at
    )
    VALUES ($1, 'message', $2, $3::jsonb, now())
    RETURNING item_id, session_id, item_order, state, payload, created_at, updated_at
  ),
  touched_session AS (
    UPDATE ai.chat_sessions
    SET updated_at = now()
    WHERE session_id = (SELECT session_id FROM inserted_item)
  )
  SELECT item_id, session_id, item_order, state, payload, created_at, updated_at
  FROM inserted_item
`;

const UPDATE_CHAT_ITEM_SQL = `
  WITH updated_item AS (
    UPDATE ai.chat_items
    SET payload = $2::jsonb,
        state = $3,
        updated_at = now()
    WHERE item_id = $1
    RETURNING item_id, session_id, item_order, state, payload, created_at, updated_at
  ),
  touched_session AS (
    UPDATE ai.chat_sessions
    SET updated_at = now()
    WHERE session_id = (SELECT session_id FROM updated_item)
  )
  SELECT item_id, session_id, item_order, state, payload, created_at, updated_at
  FROM updated_item
`;

const UPDATE_CHAT_SESSION_STATUS_SQL = `
  UPDATE ai.chat_sessions
  SET status = $2,
      active_run_id = $3,
      active_run_heartbeat_at = $4,
      updated_at = now()
  WHERE session_id = $1
  RETURNING
    session_id,
    status,
    active_run_id,
    active_run_heartbeat_at,
    composer_suggestions,
    active_composer_suggestion_generation_id,
    NULL::jsonb AS active_generation_suggestions,
    main_content_invalidation_version,
    updated_at
`;

const INSERT_CHAT_COMPOSER_SUGGESTION_GENERATION_SQL = `
  INSERT INTO ai.chat_composer_suggestion_generations (
    session_id,
    assistant_item_id,
    source,
    suggestions
  )
  VALUES ($1, $2, $3, $4::jsonb)
  RETURNING
    generation_id,
    session_id,
    assistant_item_id,
    source,
    suggestions,
    invalidated_at,
    invalidated_reason,
    created_at
`;

const INVALIDATE_CHAT_COMPOSER_SUGGESTION_GENERATION_SQL = `
  UPDATE ai.chat_composer_suggestion_generations
  SET invalidated_at = now(),
      invalidated_reason = $2
  WHERE generation_id = $1
    AND invalidated_at IS NULL
  RETURNING
    generation_id,
    session_id,
    assistant_item_id,
    source,
    suggestions,
    invalidated_at,
    invalidated_reason,
    created_at
`;

const UPDATE_CHAT_SESSION_ACTIVE_COMPOSER_SUGGESTION_GENERATION_SQL = `
  UPDATE ai.chat_sessions
  SET active_composer_suggestion_generation_id = $2::uuid,
      composer_suggestions = $3::jsonb,
      updated_at = now()
  WHERE session_id = $1
  RETURNING
    session_id,
    status,
    active_run_id,
    active_run_heartbeat_at,
    composer_suggestions,
    active_composer_suggestion_generation_id,
    NULL::jsonb AS active_generation_suggestions,
    main_content_invalidation_version,
    updated_at
`;

const UPDATE_CHAT_ITEM_AND_INVALIDATE_MAIN_CONTENT_SQL = `
  WITH updated_item AS (
    UPDATE ai.chat_items
    SET payload = $2::jsonb,
        state = $3,
        updated_at = now()
    WHERE item_id = $1
    RETURNING item_id, session_id, item_order, state, payload, created_at, updated_at
  ),
  invalidated_session AS (
    UPDATE ai.chat_sessions
    SET main_content_invalidation_version = main_content_invalidation_version + 1,
        updated_at = now()
    WHERE session_id = (SELECT session_id FROM updated_item)
    RETURNING main_content_invalidation_version
  )
  SELECT
    updated_item.item_id,
    updated_item.session_id,
    updated_item.item_order,
    updated_item.state,
    updated_item.payload,
    updated_item.created_at,
    updated_item.updated_at,
    invalidated_session.main_content_invalidation_version
  FROM updated_item
  CROSS JOIN invalidated_session
`;

function parseMainContentInvalidationVersion(
  value: string | number,
  operation: string,
): number {
  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Chat session ${operation} returned an invalid main_content_invalidation_version`);
  }

  return parsedValue;
}

function mapSessionRow(row: ChatSessionRow): Omit<ChatSessionSnapshot, "messages"> {
  if (
    row.active_composer_suggestion_generation_id !== null
    && row.active_generation_suggestions === null
  ) {
    throw new Error(
      `Chat session ${row.session_id} is missing active composer suggestion generation ${row.active_composer_suggestion_generation_id}`,
    );
  }

  return {
    sessionId: row.session_id,
    runState: row.status,
    activeRunId: row.active_run_id,
    updatedAt: new Date(row.updated_at).getTime(),
    activeRunHeartbeatAt: row.active_run_heartbeat_at === null
      ? null
      : new Date(row.active_run_heartbeat_at).getTime(),
    composerSuggestions: row.active_composer_suggestion_generation_id === null
      ? emptyChatComposerSuggestions()
      : parsePersistedChatComposerSuggestions(
        row.active_generation_suggestions,
        `session ${row.session_id} active generation ${row.active_composer_suggestion_generation_id}`,
      ),
    mainContentInvalidationVersion: parseMainContentInvalidationVersion(
      row.main_content_invalidation_version,
      "read",
    ),
  };
}

function parseItemOrder(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Chat item has an invalid item_order: ${String(value)}`);
  }
  return parsed;
}

function mapChatItemRow(row: ChatItemRow): PersistedChatMessageItem {
  return {
    itemId: row.item_id,
    sessionId: row.session_id,
    itemOrder: parseItemOrder(row.item_order),
    role: row.payload.role,
    content: row.payload.content,
    openaiItems: row.payload.role === "assistant" ? row.payload.openaiItems : undefined,
    state: row.state,
    isError: row.state === "error",
    isStopped: row.state === "cancelled",
    timestamp: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function mapPersistedMessagesToStoredMessages(
  messages: ReadonlyArray<PersistedChatMessageItem>,
): ReadonlyArray<StoredMessage> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    isError: message.isError,
    isStopped: message.isStopped,
    cursor: String(message.itemOrder),
    itemId: message.role === "assistant" ? message.itemId : null,
  }));
}

/**
 * Strips binary payload from image and file content parts, keeping only reference metadata.
 */
export function stripBase64FromContentParts(
  parts: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> {
  return parts.map((part) => {
    if (part.type === "image") {
      return { type: "image" as const, mediaType: part.mediaType, base64Data: "" };
    }
    if (part.type === "file") {
      return { type: "file" as const, mediaType: part.mediaType, base64Data: "", fileName: part.fileName };
    }
    return part;
  });
}

/**
 * Builds the lightweight replay message shape consumed by the runtime from persisted chat items.
 */
export function buildLocalChatMessages(
  messages: ReadonlyArray<PersistedChatMessageItem>,
): ReadonlyArray<ServerChatMessage> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.openaiItems !== undefined ? { openaiItems: message.openaiItems } : {}),
  }));
}

function requireSessionRow(
  row: ChatSessionRow | undefined,
  operation: string,
): ChatSessionRow {
  if (row === undefined) {
    throw new ChatSessionRowNotFoundError(operation);
  }

  return row;
}

function requireChatItemRow(
  row: ChatItemRow | undefined,
  operation: string,
): ChatItemRow {
  if (row === undefined) {
    throw new ChatItemRowNotFoundError(operation);
  }

  return row;
}

function requireChatComposerSuggestionGenerationRow(
  row: ChatComposerSuggestionGenerationRow | undefined,
  operation: string,
): ChatComposerSuggestionGenerationRow {
  if (row === undefined) {
    throw new Error(`Chat composer suggestion generation not found during ${operation}`);
  }

  return row;
}

async function executeQuery<Row extends QueryResultRow>(
  executor: DatabaseExecutor,
  text: string,
  params: ReadonlyArray<string | null>,
): Promise<ReadonlyArray<Row>> {
  const result = await executor.query<Row>(text, params);
  return result.rows;
}

async function withScopedExecutor<Result>(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  callback: () => Promise<Result>,
): Promise<Result> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
  return callback();
}

function toChatItemPayload(
  role: "user" | "assistant",
  content: ReadonlyArray<ContentPart>,
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>,
): ChatItemPayload {
  return {
    role,
    content,
    ...(role === "assistant" && assistantOpenAIItems !== undefined
      ? { openaiItems: assistantOpenAIItems }
      : {}),
  };
}

/**
 * Inserts one persisted chat item inside an existing transaction scope.
 */
export async function insertChatItemWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: InsertChatItemParams,
): Promise<PersistedChatMessageItem> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemRow>(executor, INSERT_CHAT_ITEM_SQL, [
      params.sessionId,
      params.state,
      JSON.stringify(toChatItemPayload(params.role, params.content, params.assistantOpenAIItems)),
    ]);

    return mapChatItemRow(requireChatItemRow(rows[0], "insert"));
  });
}

/**
 * Updates one persisted assistant item inside an existing transaction scope.
 */
export async function updateChatItemWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: UpdateChatMessageItemParams,
): Promise<PersistedChatMessageItem> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemRow>(executor, UPDATE_CHAT_ITEM_SQL, [
      params.itemId,
      JSON.stringify(toChatItemPayload("assistant", params.content, params.assistantOpenAIItems)),
      params.state,
    ]);

    return mapChatItemRow(requireChatItemRow(rows[0], "update"));
  });
}

async function updateChatItemAndInvalidateMainContentWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: UpdateChatMessageItemAndInvalidateMainContentParams,
): Promise<Readonly<{
  item: PersistedChatMessageItem;
  mainContentInvalidationVersion: number;
}>> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemWithInvalidationRow>(executor, UPDATE_CHAT_ITEM_AND_INVALIDATE_MAIN_CONTENT_SQL, [
      params.itemId,
      JSON.stringify(toChatItemPayload("assistant", params.content, params.assistantOpenAIItems)),
      params.state,
    ]);
    const row = rows[0];
    if (row === undefined) {
      throw new ChatItemRowNotFoundError("update+invalidate");
    }

    return {
      item: mapChatItemRow(row),
      mainContentInvalidationVersion: parseMainContentInvalidationVersion(
        row.main_content_invalidation_version,
        "update+invalidate",
      ),
    };
  });
}

async function createChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  requestedSessionId?: string,
): Promise<ChatSessionRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = requestedSessionId === undefined
      ? await executeQuery<InsertedChatSessionRow>(executor, INSERT_SESSION_SQL, [
        scope.userId,
        scope.workspaceId,
      ])
      : await executeQuery<InsertedChatSessionRow>(executor, INSERT_REQUESTED_SESSION_SQL, [
        requestedSessionId,
        scope.userId,
        scope.workspaceId,
      ]);
    const insertedSession = rows[0];

    if (insertedSession === undefined && requestedSessionId !== undefined) {
      const existingSession = await selectRequestedChatSessionWithExecutor(executor, scope, requestedSessionId);
      if (existingSession !== null) {
        return existingSession;
      }

      throw createChatSessionRequestedSessionIdConflictError(requestedSessionId);
    }

    if (insertedSession === undefined) {
      throw new ChatSessionRowNotFoundError("insert");
    }

    await createInitialChatComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      insertedSession.session_id,
    );
    return resolveRequestedChatSessionWithExecutor(executor, scope, insertedSession.session_id);
  });
}

function requireNonEmptyChatComposerSuggestions(
  suggestions: ReadonlyArray<ChatComposerSuggestion>,
  operation: string,
): void {
  if (suggestions.length === 0) {
    throw new Error(`Chat composer suggestions must not be empty during ${operation}`);
  }
}

async function insertChatComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: Readonly<{
    sessionId: string;
    assistantItemId: string | null;
    source: ChatComposerSuggestionSource;
    suggestions: ReadonlyArray<ChatComposerSuggestion>;
  }>,
): Promise<ChatComposerSuggestionGenerationRow> {
  requireNonEmptyChatComposerSuggestions(params.suggestions, "generation insert");
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatComposerSuggestionGenerationRow>(
      executor,
      INSERT_CHAT_COMPOSER_SUGGESTION_GENERATION_SQL,
      [
        params.sessionId,
        params.assistantItemId,
        params.source,
        JSON.stringify(params.suggestions),
      ],
    );
    return requireChatComposerSuggestionGenerationRow(rows[0], "insert");
  });
}

async function updateChatSessionActiveComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  generationId: string | null,
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>,
): Promise<void> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(
      executor,
      UPDATE_CHAT_SESSION_ACTIVE_COMPOSER_SUGGESTION_GENERATION_SQL,
      [
        sessionId,
        generationId,
        JSON.stringify(composerSuggestions),
      ],
    );
    if (rows.length === 0) {
      throw new ChatSessionNotFoundError(sessionId);
    }
  });
}

/**
 * Activates one generation for UI reads and mirrors its suggestions into the
 * legacy session JSONB column so a rollback can still read the latest state.
 */
export async function activateChatComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  generationId: string,
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>,
): Promise<void> {
  requireNonEmptyChatComposerSuggestions(composerSuggestions, "generation activation");
  return withScopedExecutor(executor, scope, async () => {
    const lockedRows = await executeQuery<ChatSessionRow>(executor, SELECT_SESSION_FOR_UPDATE_SQL, [sessionId]);
    const lockedSession = requireSessionRow(lockedRows[0], "activate-generation");
    if (lockedSession.active_composer_suggestion_generation_id !== null) {
      throw new Error(
        `Chat session ${sessionId} already has active composer suggestion generation ${lockedSession.active_composer_suggestion_generation_id}`,
      );
    }

    await updateChatSessionActiveComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      sessionId,
      generationId,
      composerSuggestions,
    );
  });
}

/**
 * Clears the active suggestion pointer and records why the previous active
 * generation stopped being the current UI projection.
 */
export async function clearActiveChatComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  invalidationReason: ChatComposerSuggestionInvalidationReason,
): Promise<void> {
  return withScopedExecutor(executor, scope, async () => {
    const lockedRows = await executeQuery<ChatSessionRow>(executor, SELECT_SESSION_FOR_UPDATE_SQL, [sessionId]);
    const lockedSession = requireSessionRow(lockedRows[0], "clear-generation");
    const activeGenerationId = lockedSession.active_composer_suggestion_generation_id;

    if (activeGenerationId !== null) {
      const invalidatedRows = await executeQuery<ChatComposerSuggestionGenerationRow>(
        executor,
        INVALIDATE_CHAT_COMPOSER_SUGGESTION_GENERATION_SQL,
        [activeGenerationId, invalidationReason],
      );
      requireChatComposerSuggestionGenerationRow(invalidatedRows[0], "invalidate");
    }

    await updateChatSessionActiveComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      sessionId,
      null,
      emptyChatComposerSuggestions(),
    );
  });
}

/**
 * Creates and activates the initial suggestion generation for a fresh session.
 */
export async function createInitialChatComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<void> {
  const suggestions = buildInitialChatComposerSuggestions();
  const generation = await insertChatComposerSuggestionGenerationWithExecutor(executor, scope, {
    sessionId,
    assistantItemId: null,
    source: "initial",
    suggestions,
  });
  await activateChatComposerSuggestionGenerationWithExecutor(
    executor,
    scope,
    sessionId,
    generation.generation_id,
    suggestions,
  );
}

/**
 * Creates and activates a follow-up suggestion generation when a completed
 * assistant turn produced suggestions for the next user reply.
 */
export async function createFollowUpChatComposerSuggestionGenerationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  assistantItemId: string,
  suggestions: ReadonlyArray<ChatComposerSuggestion>,
): Promise<void> {
  return withScopedExecutor(executor, scope, async () => {
    if (suggestions.length === 0) {
      const lockedRows = await executeQuery<ChatSessionRow>(executor, SELECT_SESSION_FOR_UPDATE_SQL, [sessionId]);
      const lockedSession = requireSessionRow(lockedRows[0], "complete-without-generation");
      if (lockedSession.active_composer_suggestion_generation_id !== null) {
        throw new Error(
          `Chat session ${sessionId} still has active composer suggestion generation ${lockedSession.active_composer_suggestion_generation_id} during empty follow-up completion`,
        );
      }

      await updateChatSessionActiveComposerSuggestionGenerationWithExecutor(
        executor,
        scope,
        sessionId,
        null,
        emptyChatComposerSuggestions(),
      );
      return;
    }

    const generation = await insertChatComposerSuggestionGenerationWithExecutor(executor, scope, {
      sessionId,
      assistantItemId,
      source: "assistant_follow_up",
      suggestions,
    });
    await activateChatComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      sessionId,
      generation.generation_id,
      suggestions,
    );
  });
}

/**
 * Selects the requested session inside an existing transaction scope.
 */
export async function selectRequestedChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ChatSessionRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, SELECT_SESSION_SQL, [
      scope.userId,
      scope.workspaceId,
      sessionId,
    ]);
    return rows[0] ?? null;
  });
}

async function selectLatestChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<ChatSessionRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, SELECT_LATEST_SESSION_SQL, [
      scope.userId,
      scope.workspaceId,
    ]);
    return rows[0] ?? null;
  });
}

/**
 * Resolves the requested session or throws when it does not exist for the scoped workspace.
 */
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

/**
 * Resolves the requested session or creates it with the exact explicit session id when missing.
 */
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

/**
 * Resolves the latest session for the workspace or creates a fresh one when none exists yet.
 */
export async function resolveLatestOrCreateChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<ChatSessionRow> {
  // Legacy callers may still omit sessionId. Keep resolving the latest-or-create
  // behavior for backward compatibility while newer clients pass an explicit id.
  const latestSession = await selectLatestChatSessionWithExecutor(executor, scope);
  if (latestSession !== null) {
    return latestSession;
  }

  return createChatSessionWithExecutor(executor, scope);
}

/**
 * Returns the requested session id when it exists inside the current transaction scope.
 */
export const getChatSessionIdWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<string | null> =>
  withScopedExecutor(executor, scope, async () => {
    const row = await selectRequestedChatSessionWithExecutor(executor, scope, sessionId);
    return row?.session_id ?? null;
  });

/**
 * Returns the latest session id visible inside the current transaction scope.
 */
export const getLatestChatSessionIdWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<string | null> =>
  withScopedExecutor(executor, scope, async () => {
    const row = await selectLatestChatSessionWithExecutor(executor, scope);
    return row?.session_id ?? null;
  });

/**
 * Creates a fresh chat session and returns its identifier inside the current transaction scope.
 */
export const createFreshChatSessionWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  requestedSessionId?: string,
): Promise<string> =>
  withScopedExecutor(executor, scope, async () => {
    const row = await createChatSessionWithExecutor(executor, scope, requestedSessionId);
    return row.session_id;
  });

/**
 * Lists persisted chat message items for a session inside the current transaction scope.
 */
export const listChatMessagesWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ReadonlyArray<PersistedChatMessageItem>> =>
  withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemRow>(executor, LIST_CHAT_ITEMS_SQL, [sessionId]);
    return rows.map((row) => mapChatItemRow(row));
  });

export type PaginatedChatMessages = Readonly<{
  messages: ReadonlyArray<PersistedChatMessageItem>;
  hasOlder: boolean;
  oldestCursor: string | null;
  newestCursor: string | null;
}>;

/**
 * Returns the latest N messages for a session, in ascending order, with pagination metadata.
 * Fetches limit+1 rows to determine whether older messages exist beyond the window.
 */
export const listChatMessagesLatestWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  limit: number,
): Promise<PaginatedChatMessages> =>
  withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemRow>(
      executor,
      LIST_CHAT_ITEMS_LATEST_SQL,
      [sessionId, String(limit + 1)],
    );
    const hasOlder = rows.length > limit;
    const windowRows = hasOlder ? rows.slice(0, limit) : rows;
    const messages = windowRows.map((row) => mapChatItemRow(row)).reverse();
    return {
      messages,
      hasOlder,
      oldestCursor: messages.length > 0 ? String(messages[0]!.itemOrder) : null,
      newestCursor: messages.length > 0 ? String(messages[messages.length - 1]!.itemOrder) : null,
    };
  });

/**
 * Returns N messages before the given cursor, in ascending order, with pagination metadata.
 */
export const listChatMessagesBeforeWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  beforeCursor: number,
  limit: number,
): Promise<PaginatedChatMessages> =>
  withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemRow>(
      executor,
      LIST_CHAT_ITEMS_BEFORE_CURSOR_SQL,
      [sessionId, String(beforeCursor), String(limit + 1)],
    );
    const hasOlder = rows.length > limit;
    const windowRows = hasOlder ? rows.slice(0, limit) : rows;
    const messages = windowRows.map((row) => mapChatItemRow(row)).reverse();
    return {
      messages,
      hasOlder,
      oldestCursor: messages.length > 0 ? String(messages[0]!.itemOrder) : null,
      newestCursor: messages.length > 0 ? String(messages[messages.length - 1]!.itemOrder) : null,
    };
  });

/**
 * Returns all messages after the given cursor, in ascending order. Used for SSE backlog replay.
 */
export const listChatMessagesAfterCursorWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  afterCursor: number,
): Promise<ReadonlyArray<PersistedChatMessageItem>> =>
  withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemRow>(
      executor,
      LIST_CHAT_ITEMS_AFTER_CURSOR_SQL,
      [sessionId, String(afterCursor)],
    );
    return rows.map((row) => mapChatItemRow(row));
  });

/**
 * Builds the full session snapshot, including ordered messages, inside the current transaction scope.
 */
export const getChatSessionSnapshotWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId?: string,
): Promise<ChatSessionSnapshot> =>
  withScopedExecutor(executor, scope, async () => {
    // sessionId === undefined is a backward-compatible branch for older clients
    // that still omit session selection. Newer clients should send an explicit id.
    const sessionRow = sessionId === undefined
      ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
      : await resolveRequestedOrCreateChatSessionWithExecutor(executor, scope, sessionId);
    const rows = await executeQuery<ChatItemRow>(executor, LIST_CHAT_ITEMS_SQL, [sessionRow.session_id]);
    const messages = rows.map((row) => mapChatItemRow(row));

    return {
      ...mapSessionRow(sessionRow),
      messages: mapPersistedMessagesToStoredMessages(messages),
    };
  });

/**
 * Touches the heartbeat stored on the session row for the active run inside the current transaction scope.
 */
export const touchChatSessionHeartbeatWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  heartbeatAt: Date,
  activeRunId: string,
): Promise<void> =>
  withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, UPDATE_CHAT_SESSION_STATUS_SQL, [
      sessionId,
      "running",
      activeRunId,
      heartbeatAt.toISOString(),
    ]);
    if (rows.length === 0) {
      throw new ChatSessionNotFoundError(sessionId);
    }
  });

/**
 * Updates the session-level run state and active-run pointer inside the current transaction scope.
 */
export const updateChatSessionRunStateWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  runState: ChatSessionRunState,
  activeRunId: string | null,
  activeRunHeartbeatAt: Date | null,
): Promise<void> =>
  withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, UPDATE_CHAT_SESSION_STATUS_SQL, [
      sessionId,
      runState,
      activeRunId,
      activeRunHeartbeatAt?.toISOString() ?? null,
    ]);
    if (rows.length === 0) {
      throw new ChatSessionNotFoundError(sessionId);
    }
  });

/**
 * Returns the requested session id through the public store surface.
 */
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

/**
 * Returns the latest session id through the public store surface.
 */
export const getLatestChatSessionId = async (
  userId: string,
  workspaceId: string,
): Promise<string | null> =>
  queryWithWorkspaceScope({ userId, workspaceId }, SELECT_LATEST_SESSION_SQL, [userId, workspaceId])
    .then((result) => {
      const row = result.rows[0] as ChatSessionRow | undefined;
      return row?.session_id ?? null;
    });

/**
 * Creates a fresh chat session through the public store surface.
 */
export const createFreshChatSession = async (
  userId: string,
  workspaceId: string,
  requestedSessionId?: string,
): Promise<string> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    createFreshChatSessionWithExecutor(executor, { userId, workspaceId }, requestedSessionId));

/**
 * Invalidates the previous session's active generation and creates a fresh
 * session in the same transaction so "new chat" rollover is atomic.
 */
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
    return createFreshChatSessionWithExecutor(executor, scope);
  });

/**
 * Lists persisted chat items for a session through the public store surface.
 */
export const listChatMessages = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<ReadonlyArray<PersistedChatMessageItem>> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    listChatMessagesWithExecutor(executor, { userId, workspaceId }, sessionId));

/**
 * Returns the latest N messages for a session through the public store surface.
 */
export const listChatMessagesLatest = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  limit: number,
): Promise<PaginatedChatMessages> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    listChatMessagesLatestWithExecutor(executor, { userId, workspaceId }, sessionId, limit));

/**
 * Returns N messages before the given cursor through the public store surface.
 */
export const listChatMessagesBefore = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  beforeCursor: number,
  limit: number,
): Promise<PaginatedChatMessages> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    listChatMessagesBeforeWithExecutor(executor, { userId, workspaceId }, sessionId, beforeCursor, limit));

/**
 * Returns all messages after the given cursor through the public store surface.
 */
export const listChatMessagesAfterCursor = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  afterCursor: number,
): Promise<ReadonlyArray<PersistedChatMessageItem>> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    listChatMessagesAfterCursorWithExecutor(executor, { userId, workspaceId }, sessionId, afterCursor));

/**
 * Returns a full chat session snapshot through the public store surface.
 */
export const getChatSessionSnapshot = async (
  userId: string,
  workspaceId: string,
  sessionId?: string,
): Promise<ChatSessionSnapshot> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    getChatSessionSnapshotWithExecutor(executor, { userId, workspaceId }, sessionId));

/**
 * Updates the persisted assistant item through the public store surface.
 */
export const updateAssistantMessageItem = async (
  userId: string,
  workspaceId: string,
  params: UpdateChatMessageItemParams,
): Promise<PersistedChatMessageItem> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    updateChatItemWithExecutor(executor, { userId, workspaceId }, params));

/**
 * Updates the persisted assistant item and bumps the main-content invalidation version.
 */
export const updateAssistantMessageItemAndInvalidateMainContent = async (
  userId: string,
  workspaceId: string,
  params: UpdateChatMessageItemAndInvalidateMainContentParams,
): Promise<number> => {
  const result = await transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    updateChatItemAndInvalidateMainContentWithExecutor(executor, { userId, workspaceId }, params));
  return result.mainContentInvalidationVersion;
};

/**
 * Updates the session heartbeat stored alongside the active run.
 */
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

/**
 * Completes a run in the store-only layer used by older call sites and tests.
 */
export const completeChatRun = async (
  userId: string,
  workspaceId: string,
  params: CompleteChatRunParams,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const updatedAssistant = await updateChatItemWithExecutor(
      executor,
      { userId, workspaceId },
      {
        itemId: params.assistantItemId,
        content: params.assistantContent,
        state: "completed",
        assistantOpenAIItems: params.assistantOpenAIItems,
      },
    );

    await updateChatSessionRunStateWithExecutor(
      executor,
      { userId, workspaceId },
      params.sessionId,
      "idle",
      null,
      null,
    );
    await createFollowUpChatComposerSuggestionGenerationWithExecutor(
      executor,
      { userId, workspaceId },
      params.sessionId,
      params.assistantItemId,
      params.composerSuggestions ?? emptyChatComposerSuggestions(),
    );
  });

/**
 * Marks unfinished tool calls as stopped-by-user in assistant content.
 */
export const buildUserStoppedAssistantContent = (
  content: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> =>
  content.map((part) => {
    if (part.type !== "tool_call" || part.status !== "started") {
      return part;
    }

    return {
      ...part,
      status: "completed",
      providerStatus: INCOMPLETE_TOOL_CALL_PROVIDER_STATUS,
      output: part.output ?? STOPPED_BY_USER_TOOL_OUTPUT,
    };
  });

/**
 * Finds the in-progress assistant item that should be updated when a user stops the active run.
 */
export const buildUserStoppedChatRunUpdatePlan = (
  messages: ReadonlyArray<PersistedChatMessageItem>,
): UserStoppedChatRunUpdatePlan => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || message.state !== "in_progress") {
      continue;
    }

    return {
      assistantItem: message,
      assistantContent: buildUserStoppedAssistantContent(message.content),
      assistantOpenAIItems: message.openaiItems ?? null,
      sessionState: "idle",
    };
  }

  return {
    assistantItem: null,
    assistantContent: null,
    assistantOpenAIItems: null,
    sessionState: "idle",
  };
};

export const persistAssistantTerminalError = async (
  userId: string,
  workspaceId: string,
  params: PersistAssistantTerminalErrorParams,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const finalizedAssistantContent = finalizePendingToolCallContent(
      params.assistantContent,
      INCOMPLETE_TOOL_CALL_PROVIDER_STATUS,
      FAILED_TOOL_CALL_OUTPUT,
    );

    if (finalizedAssistantContent.length === 0) {
      await updateChatItemWithExecutor(executor, { userId, workspaceId }, {
        itemId: params.assistantItemId,
        content: [{ type: "text", text: params.errorMessage }],
        state: "error",
        assistantOpenAIItems: params.assistantOpenAIItems,
      });
    } else {
      await updateChatItemWithExecutor(executor, { userId, workspaceId }, {
        itemId: params.assistantItemId,
        content: finalizedAssistantContent,
        state: "completed",
        assistantOpenAIItems: params.assistantOpenAIItems,
      });
      await insertChatItemWithExecutor(executor, { userId, workspaceId }, {
        sessionId: params.sessionId,
        role: "assistant",
        state: "error",
        content: [{ type: "text", text: params.errorMessage }],
      });
    }

    await updateChatSessionRunStateWithExecutor(
      executor,
      { userId, workspaceId },
      params.sessionId,
      params.sessionState,
      null,
      null,
    );
    await clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      { userId, workspaceId },
      params.sessionId,
      params.sessionState === "interrupted" ? "run_interrupted" : "run_failed",
    );
  });

export const persistAssistantCancelled = async (
  userId: string,
  workspaceId: string,
  params: PersistAssistantCancelledParams,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await updateChatItemWithExecutor(executor, { userId, workspaceId }, {
      itemId: params.assistantItemId,
      content: buildUserStoppedAssistantContent(params.assistantContent),
      state: "cancelled",
      assistantOpenAIItems: params.assistantOpenAIItems,
    });

    await updateChatSessionRunStateWithExecutor(
      executor,
      { userId, workspaceId },
      params.sessionId,
      "idle",
      null,
      null,
    );
    await clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      { userId, workspaceId },
      params.sessionId,
      "run_cancelled",
    );
  });

export const cancelActiveChatRunByUserWithExecutor = async (
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<boolean> =>
  withScopedExecutor(executor, scope, async () => {
    await resolveRequestedChatSessionWithExecutor(executor, scope, sessionId);

    const lockedSessionRows = await executeQuery<ChatSessionRow>(executor, SELECT_SESSION_FOR_UPDATE_SQL, [
      sessionId,
    ]);
    const lockedSession = requireSessionRow(lockedSessionRows[0], "lock");

    if (lockedSession.status !== "running") {
      return false;
    }

    const messagesRows = await executeQuery<ChatItemRow>(executor, LIST_CHAT_ITEMS_SQL, [sessionId]);
    const messages = messagesRows.map((row) => mapChatItemRow(row));
    const updatePlan = buildUserStoppedChatRunUpdatePlan(messages);

    if (updatePlan.assistantItem !== null && updatePlan.assistantContent !== null) {
      await updateChatItemWithExecutor(executor, scope, {
        itemId: updatePlan.assistantItem.itemId,
        content: updatePlan.assistantContent,
        state: "cancelled",
        assistantOpenAIItems: updatePlan.assistantOpenAIItems ?? undefined,
      });
    }

    await updateChatSessionRunStateWithExecutor(
      executor,
      scope,
      sessionId,
      updatePlan.sessionState,
      null,
      null,
    );
    await clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      sessionId,
      "run_cancelled",
    );
    return true;
  });

export const cancelActiveChatRunByUser = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<boolean> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    cancelActiveChatRunByUserWithExecutor(executor, { userId, workspaceId }, sessionId));

/**
 * Clears the active composer suggestion generation through the public store surface.
 */
export const clearActiveChatComposerSuggestionGeneration = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  invalidationReason: ChatComposerSuggestionInvalidationReason,
): Promise<void> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      { userId, workspaceId },
      sessionId,
      invalidationReason,
    ));

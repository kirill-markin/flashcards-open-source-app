import type { QueryResultRow } from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../db";
import type {
  ChatComposerSuggestionInvalidationReason,
  ChatComposerSuggestionSource,
} from "../composerSuggestions";
import {
  ChatItemRowNotFoundError,
  ChatSessionRowNotFoundError,
} from "../errors";
import type { StoredOpenAIReplayItem } from "../openai/replayItems";
import type { ContentPart } from "../types";
import type {
  ChatItemState,
  ChatSessionRunState,
} from "./types";

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

export type InsertedChatSessionRow = Readonly<{
  session_id: string;
}>;

export type ChatComposerSuggestionGenerationRow = Readonly<{
  generation_id: string;
  session_id: string;
  assistant_item_id: string | null;
  source: ChatComposerSuggestionSource;
  suggestions: unknown;
  invalidated_at: string | null;
  invalidated_reason: ChatComposerSuggestionInvalidationReason | null;
  created_at: string;
}>;

export type ChatItemPayload = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  openaiItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

export type ChatItemRow = Readonly<{
  item_id: string;
  session_id: string;
  item_order: string | number;
  state: ChatItemState;
  payload: ChatItemPayload;
  created_at: string;
  updated_at: string;
}>;

export type ChatItemWithInvalidationRow = ChatItemRow & Readonly<{
  main_content_invalidation_version: string | number;
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

const UPDATE_CHAT_SESSION_STATUS_FOR_ACTIVE_RUN_SQL = `
  UPDATE ai.chat_sessions
  SET status = $2,
      active_run_id = $3,
      active_run_heartbeat_at = $4,
      updated_at = now()
  WHERE session_id = $1
    AND active_run_id = $5
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

export async function executeQuery<Row extends QueryResultRow>(
  executor: DatabaseExecutor,
  text: string,
  params: ReadonlyArray<string | null>,
): Promise<ReadonlyArray<Row>> {
  const result = await executor.query<Row>(text, params);
  return result.rows;
}

export async function withScopedExecutor<Result>(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  callback: () => Promise<Result>,
): Promise<Result> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
  return callback();
}

export function requireSessionRow(
  row: ChatSessionRow | undefined,
  operation: string,
): ChatSessionRow {
  if (row === undefined) {
    throw new ChatSessionRowNotFoundError(operation);
  }

  return row;
}

export function requireChatItemRow(
  row: ChatItemRow | undefined,
  operation: string,
): ChatItemRow {
  if (row === undefined) {
    throw new ChatItemRowNotFoundError(operation);
  }

  return row;
}

export function requireChatComposerSuggestionGenerationRow(
  row: ChatComposerSuggestionGenerationRow | undefined,
  operation: string,
): ChatComposerSuggestionGenerationRow {
  if (row === undefined) {
    throw new Error(`Chat composer suggestion generation not found during ${operation}`);
  }

  return row;
}

function requireInsertedChatSessionRow(
  row: InsertedChatSessionRow | undefined,
  operation: string,
): InsertedChatSessionRow {
  if (row === undefined) {
    throw new ChatSessionRowNotFoundError(operation);
  }

  return row;
}

export async function selectRequestedChatSessionRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<ChatSessionRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, SELECT_SESSION_SQL, [
      userId,
      workspaceId,
      sessionId,
    ]);
    return rows[0] ?? null;
  });
}

export async function selectLatestChatSessionRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  userId: string,
  workspaceId: string,
): Promise<ChatSessionRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, SELECT_LATEST_SESSION_SQL, [
      userId,
      workspaceId,
    ]);
    return rows[0] ?? null;
  });
}

export async function selectChatSessionForUpdateRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ChatSessionRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, SELECT_SESSION_FOR_UPDATE_SQL, [sessionId]);
    return requireSessionRow(rows[0], "lock");
  });
}

export async function insertGeneratedChatSessionRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  userId: string,
  workspaceId: string,
): Promise<InsertedChatSessionRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<InsertedChatSessionRow>(executor, INSERT_SESSION_SQL, [
      userId,
      workspaceId,
    ]);
    return requireInsertedChatSessionRow(rows[0], "insert");
  });
}

export async function insertRequestedChatSessionRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  requestedSessionId: string,
  userId: string,
  workspaceId: string,
): Promise<InsertedChatSessionRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<InsertedChatSessionRow>(executor, INSERT_REQUESTED_SESSION_SQL, [
      requestedSessionId,
      userId,
      workspaceId,
    ]);
    return rows[0] ?? null;
  });
}

export async function listChatItemRowsWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ReadonlyArray<ChatItemRow>> {
  return withScopedExecutor(executor, scope, async () =>
    executeQuery<ChatItemRow>(executor, LIST_CHAT_ITEMS_SQL, [sessionId]));
}

export async function listLatestChatItemRowsWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  limit: number,
): Promise<ReadonlyArray<ChatItemRow>> {
  return withScopedExecutor(executor, scope, async () =>
    executeQuery<ChatItemRow>(executor, LIST_CHAT_ITEMS_LATEST_SQL, [sessionId, String(limit)]));
}

export async function listChatItemRowsBeforeCursorWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  beforeCursor: number,
  limit: number,
): Promise<ReadonlyArray<ChatItemRow>> {
  return withScopedExecutor(executor, scope, async () =>
    executeQuery<ChatItemRow>(executor, LIST_CHAT_ITEMS_BEFORE_CURSOR_SQL, [
      sessionId,
      String(beforeCursor),
      String(limit),
    ]));
}

export async function listChatItemRowsAfterCursorWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  afterCursor: number,
): Promise<ReadonlyArray<ChatItemRow>> {
  return withScopedExecutor(executor, scope, async () =>
    executeQuery<ChatItemRow>(executor, LIST_CHAT_ITEMS_AFTER_CURSOR_SQL, [
      sessionId,
      String(afterCursor),
    ]));
}

export async function insertChatItemRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  state: ChatItemState,
  payload: ChatItemPayload,
): Promise<ChatItemRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemRow>(executor, INSERT_CHAT_ITEM_SQL, [
      sessionId,
      state,
      JSON.stringify(payload),
    ]);
    return requireChatItemRow(rows[0], "insert");
  });
}

export async function updateChatItemRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  itemId: string,
  payload: ChatItemPayload,
  state: ChatItemState,
): Promise<ChatItemRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemRow>(executor, UPDATE_CHAT_ITEM_SQL, [
      itemId,
      JSON.stringify(payload),
      state,
    ]);
    return requireChatItemRow(rows[0], "update");
  });
}

export async function updateChatItemAndInvalidateMainContentRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  itemId: string,
  payload: ChatItemPayload,
  state: ChatItemState,
): Promise<ChatItemWithInvalidationRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatItemWithInvalidationRow>(
      executor,
      UPDATE_CHAT_ITEM_AND_INVALIDATE_MAIN_CONTENT_SQL,
      [itemId, JSON.stringify(payload), state],
    );
    return requireChatItemRow(rows[0], "update+invalidate") as ChatItemWithInvalidationRow;
  });
}

export async function updateChatSessionStatusRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  runState: ChatSessionRunState,
  activeRunId: string | null,
  activeRunHeartbeatAt: Date | null,
): Promise<ChatSessionRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, UPDATE_CHAT_SESSION_STATUS_SQL, [
      sessionId,
      runState,
      activeRunId,
      activeRunHeartbeatAt?.toISOString() ?? null,
    ]);
    return requireSessionRow(rows[0], "update");
  });
}

export async function updateChatSessionStatusForActiveRunRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  runState: ChatSessionRunState,
  activeRunId: string | null,
  activeRunHeartbeatAt: Date | null,
  expectedActiveRunId: string,
): Promise<ChatSessionRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, UPDATE_CHAT_SESSION_STATUS_FOR_ACTIVE_RUN_SQL, [
      sessionId,
      runState,
      activeRunId,
      activeRunHeartbeatAt?.toISOString() ?? null,
      expectedActiveRunId,
    ]);
    return rows[0] ?? null;
  });
}

export async function insertChatComposerSuggestionGenerationRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  assistantItemId: string | null,
  source: ChatComposerSuggestionSource,
  suggestionsJson: string,
): Promise<ChatComposerSuggestionGenerationRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatComposerSuggestionGenerationRow>(
      executor,
      INSERT_CHAT_COMPOSER_SUGGESTION_GENERATION_SQL,
      [sessionId, assistantItemId, source, suggestionsJson],
    );
    return requireChatComposerSuggestionGenerationRow(rows[0], "insert");
  });
}

export async function invalidateChatComposerSuggestionGenerationRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  generationId: string,
  invalidationReason: ChatComposerSuggestionInvalidationReason,
): Promise<ChatComposerSuggestionGenerationRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatComposerSuggestionGenerationRow>(
      executor,
      INVALIDATE_CHAT_COMPOSER_SUGGESTION_GENERATION_SQL,
      [generationId, invalidationReason],
    );
    return requireChatComposerSuggestionGenerationRow(rows[0], "invalidate");
  });
}

export async function updateChatSessionActiveComposerSuggestionGenerationRowWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  generationId: string | null,
  composerSuggestionsJson: string,
): Promise<ChatSessionRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(
      executor,
      UPDATE_CHAT_SESSION_ACTIVE_COMPOSER_SUGGESTION_GENERATION_SQL,
      [sessionId, generationId, composerSuggestionsJson],
    );
    return requireSessionRow(rows[0], "activate");
  });
}

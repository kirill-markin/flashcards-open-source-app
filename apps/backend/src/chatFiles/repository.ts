import type { QueryResultRow } from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type SqlValue,
  type WorkspaceDatabaseScope,
} from "../database";
import type { ContentPart, InlineAttachmentContentPart } from "../chat/types";

export type InsertChatAttachmentFileParams = Readonly<{
  fileId: string;
  sessionId: string;
  path: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  s3Key: string;
}>;

/** Content of a stored row that may still carry inline attachments from before session files existed. */
export type StoredContent = ReadonlyArray<ContentPart | InlineAttachmentContentPart>;

export type InlineAttachmentChatItemRow = Readonly<{
  item_id: string;
  payload: Readonly<{ content: StoredContent }>;
}>;

export type InlineAttachmentChatRunRow = Readonly<{
  session_id: string;
  inline_turn_input: StoredContent | null;
}>;

type ChatFilePathRow = Readonly<{ path: string }>;

const LIST_CHAT_FILE_PATHS_SQL = `
  SELECT path
  FROM ai.chat_files
  WHERE session_id = $1
`;

const INSERT_CHAT_ATTACHMENT_FILE_SQL = `
  INSERT INTO ai.chat_files (
    file_id,
    session_id,
    user_id,
    workspace_id,
    path,
    origin,
    media_type,
    size_bytes,
    sha256,
    s3_key
  )
  VALUES ($1, $2, $3, $4, $5, 'attachment', $6, $7, $8, $9)
`;

const LOCK_CHAT_SESSION_SQL = `
  SELECT session_id
  FROM ai.chat_sessions
  WHERE session_id = $1
  FOR UPDATE
`;

// jsonb_path_exists keeps rows without inline bytes on the server instead of shipping every payload.
const LIST_INLINE_ATTACHMENT_USER_ITEMS_SQL = `
  SELECT item_id, payload
  FROM ai.chat_items
  WHERE session_id = $1
    AND item_kind = 'message'
    AND role = 'user'
    AND jsonb_path_exists(payload, '$.content[*].base64Data')
  ORDER BY item_order ASC
`;

const SELECT_ACTIVE_RUN_INLINE_TURN_INPUT_SQL = `
  SELECT
    session_id,
    CASE
      WHEN jsonb_path_exists(turn_input, '$[*].base64Data') THEN turn_input
      ELSE NULL
    END AS inline_turn_input
  FROM ai.chat_runs
  WHERE run_id = $1
    AND status IN ('queued', 'running')
`;

const UPDATE_CHAT_ITEM_CONTENT_SQL = `
  UPDATE ai.chat_items
  SET payload = jsonb_set(payload, '{content}', $2::jsonb),
      updated_at = now()
  WHERE item_id = $1
`;

const UPDATE_CHAT_RUN_TURN_INPUT_SQL = `
  UPDATE ai.chat_runs
  SET turn_input = $2::jsonb,
      updated_at = now()
  WHERE run_id = $1
`;

async function queryWithScope<Row extends QueryResultRow>(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<Readonly<{ rows: ReadonlyArray<Row>; rowCount: number }>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
  const result = await executor.query<Row>(text, params);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}

function requireOneUpdatedRow(rowCount: number, operation: string, id: string): void {
  if (rowCount !== 1) {
    throw new Error(`Chat file ${operation} updated ${rowCount} rows instead of 1. id=${id}`);
  }
}

export async function listChatFilePathsWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ReadonlySet<string>> {
  const result = await queryWithScope<ChatFilePathRow>(executor, scope, LIST_CHAT_FILE_PATHS_SQL, [sessionId]);
  return new Set(result.rows.map((row) => row.path));
}

export async function insertChatAttachmentFileWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: InsertChatAttachmentFileParams,
): Promise<void> {
  await queryWithScope(executor, scope, INSERT_CHAT_ATTACHMENT_FILE_SQL, [
    params.fileId,
    params.sessionId,
    scope.userId,
    scope.workspaceId,
    params.path,
    params.mediaType,
    params.sizeBytes,
    params.sha256,
    params.s3Key,
  ]);
}

export async function lockChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<void> {
  const result = await queryWithScope(executor, scope, LOCK_CHAT_SESSION_SQL, [sessionId]);
  if (result.rows.length !== 1) {
    throw new Error(`Chat session to convert attachments for was not found. sessionId=${sessionId}`);
  }
}

export async function listInlineAttachmentUserItemsWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ReadonlyArray<InlineAttachmentChatItemRow>> {
  const result = await queryWithScope<InlineAttachmentChatItemRow>(
    executor,
    scope,
    LIST_INLINE_ATTACHMENT_USER_ITEMS_SQL,
    [sessionId],
  );
  return result.rows;
}

/** Null when the run is not queued or running, the only states a worker can still claim. */
export async function selectActiveRunInlineTurnInputWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  runId: string,
): Promise<InlineAttachmentChatRunRow | null> {
  const result = await queryWithScope<InlineAttachmentChatRunRow>(
    executor,
    scope,
    SELECT_ACTIVE_RUN_INLINE_TURN_INPUT_SQL,
    [runId],
  );
  return result.rows[0] ?? null;
}

export async function updateChatItemContentWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  itemId: string,
  content: ReadonlyArray<ContentPart>,
): Promise<void> {
  const result = await queryWithScope(executor, scope, UPDATE_CHAT_ITEM_CONTENT_SQL, [
    itemId,
    JSON.stringify(content),
  ]);
  requireOneUpdatedRow(result.rowCount, "chat item content update", itemId);
}

export async function updateChatRunTurnInputWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  runId: string,
  turnInput: ReadonlyArray<ContentPart>,
): Promise<void> {
  const result = await queryWithScope(executor, scope, UPDATE_CHAT_RUN_TURN_INPUT_SQL, [
    runId,
    JSON.stringify(turnInput),
  ]);
  requireOneUpdatedRow(result.rowCount, "chat run turn input update", runId);
}

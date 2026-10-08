import {
  queryWithWorkspaceScope,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../database";
import { ChatSessionRowNotFoundError } from "../errors";
import {
  ChatSessionNotFoundError,
  type ArchivedChatSession,
  type ChatSessionHistoryCursor,
  type ChatSessionHistoryPage,
  type ChatSessionHistorySummary,
  type ChatSessionRunState,
} from "./types";

const DERIVED_TITLE_MAX_LENGTH = 80;
const PREVIEW_MAX_LENGTH = 120;

type ChatSessionHistorySummaryRow = Readonly<{
  session_id: string;
  title: string | null;
  first_user_message_text: string | null;
  last_message_text: string | null;
  message_count: string | number;
  created_at: Date | string;
  last_activity_at: Date | string;
  last_activity_cursor: string;
}>;

export type HistoryChatSessionLockRow = Readonly<{
  session_id: string;
  status: ChatSessionRunState;
}>;

type ArchivedChatSessionRow = Readonly<{
  session_id: string;
  archived_at: Date | string;
}>;

// Last activity is the newest message's created_at, so renaming, archiving, or a run heartbeat never
// reorders the history list.
const CHAT_SESSION_ACTIVITY_LATERAL_SQL = `
  CROSS JOIN LATERAL (
    SELECT
      count(*) AS message_count,
      max(chat_items.created_at) AS last_activity_at
    FROM ai.chat_items AS chat_items
    WHERE chat_items.session_id = chat_sessions.session_id
      AND chat_items.item_kind = 'message'
  ) AS activity
`;

// Only text content parts are read: attachment base64, cards, and tool payloads are never matched or shown.
const CHAT_SESSION_HISTORY_SUMMARY_SELECT_SQL = `
  SELECT
    history_sessions.session_id,
    history_sessions.title,
    first_user_message.text AS first_user_message_text,
    last_message.text AS last_message_text,
    history_sessions.message_count,
    history_sessions.created_at,
    history_sessions.last_activity_at,
    to_char(
      history_sessions.last_activity_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS last_activity_cursor
  FROM history_sessions
  LEFT JOIN LATERAL (
    SELECT string_agg(text_part.value #>> '{}', ' ' ORDER BY text_part.ordinal) AS text
    FROM (
      SELECT chat_items.payload
      FROM ai.chat_items AS chat_items
      WHERE chat_items.session_id = history_sessions.session_id
        AND chat_items.item_kind = 'message'
        AND chat_items.role = 'user'
      ORDER BY chat_items.item_order ASC
      LIMIT 1
    ) AS first_user_item
    CROSS JOIN LATERAL jsonb_path_query(first_user_item.payload, '$.content[*] ? (@.type == "text").text')
      WITH ORDINALITY AS text_part(value, ordinal)
  ) AS first_user_message ON TRUE
  LEFT JOIN LATERAL (
    SELECT string_agg(text_part.value #>> '{}', ' ' ORDER BY text_part.ordinal) AS text
    FROM (
      SELECT chat_items.payload
      FROM ai.chat_items AS chat_items
      WHERE chat_items.session_id = history_sessions.session_id
        AND chat_items.item_kind = 'message'
      ORDER BY chat_items.item_order DESC
      LIMIT 1
    ) AS last_item
    CROSS JOIN LATERAL jsonb_path_query(last_item.payload, '$.content[*] ? (@.type == "text").text')
      WITH ORDINALITY AS text_part(value, ordinal)
  ) AS last_message ON TRUE
  ORDER BY history_sessions.last_activity_at DESC, history_sessions.session_id DESC
`;

const LIST_CHAT_SESSION_HISTORY_SQL = `
  WITH history_sessions AS (
    SELECT
      chat_sessions.session_id,
      chat_sessions.title,
      chat_sessions.created_at,
      activity.message_count,
      activity.last_activity_at
    FROM ai.chat_sessions AS chat_sessions
    ${CHAT_SESSION_ACTIVITY_LATERAL_SQL}
    WHERE chat_sessions.user_id = $1
      AND chat_sessions.workspace_id = $2
      AND chat_sessions.archived_at IS NULL
      AND activity.message_count > 0
      AND (
        $3::timestamptz IS NULL
        OR (activity.last_activity_at, chat_sessions.session_id) < ($3::timestamptz, $4::uuid)
      )
      AND (
        $5::text IS NULL
        OR chat_sessions.title ILIKE $5 ESCAPE '\\'
        OR EXISTS (
          SELECT 1
          FROM ai.chat_items AS search_items
          CROSS JOIN LATERAL jsonb_path_query(search_items.payload, '$.content[*] ? (@.type == "text").text')
            AS search_text(value)
          WHERE search_items.session_id = chat_sessions.session_id
            AND search_items.item_kind = 'message'
            AND search_text.value #>> '{}' ILIKE $5 ESCAPE '\\'
        )
      )
    ORDER BY activity.last_activity_at DESC, chat_sessions.session_id DESC
    LIMIT $6
  )
  ${CHAT_SESSION_HISTORY_SUMMARY_SELECT_SQL}
`;

// A session without messages was last active when it was created.
const SELECT_CHAT_SESSION_HISTORY_SUMMARY_SQL = `
  WITH history_sessions AS (
    SELECT
      chat_sessions.session_id,
      chat_sessions.title,
      chat_sessions.created_at,
      activity.message_count,
      COALESCE(activity.last_activity_at, chat_sessions.created_at) AS last_activity_at
    FROM ai.chat_sessions AS chat_sessions
    ${CHAT_SESSION_ACTIVITY_LATERAL_SQL}
    WHERE chat_sessions.session_id = $1
  )
  ${CHAT_SESSION_HISTORY_SUMMARY_SELECT_SQL}
`;

const LOCK_HISTORY_CHAT_SESSION_SQL = `
  SELECT session_id, status
  FROM ai.chat_sessions
  WHERE user_id = $1
    AND workspace_id = $2
    AND session_id = $3
    AND archived_at IS NULL
  FOR UPDATE
`;

// Neither statement touches updated_at: renaming or archiving is not chat activity.
const RENAME_CHAT_SESSION_SQL = `
  UPDATE ai.chat_sessions
  SET title = $2
  WHERE session_id = $1
`;

const ARCHIVE_CHAT_SESSION_SQL = `
  UPDATE ai.chat_sessions
  SET archived_at = now()
  WHERE session_id = $1
  RETURNING session_id, archived_at
`;

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Collapses whitespace and truncates by code point, so a surrogate pair is never split.
 */
function summarizeChatText(text: string | null, maximumLength: number): string | null {
  if (text === null) {
    return null;
  }

  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText === "") {
    return null;
  }

  const characters = Array.from(normalizedText);
  if (characters.length <= maximumLength) {
    return normalizedText;
  }

  return `${characters.slice(0, maximumLength - 1).join("").trimEnd()}…`;
}

function parseMessageCount(value: string | number): number {
  const messageCount = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(messageCount) || messageCount < 0) {
    throw new Error(`Chat session history returned an invalid message_count: ${String(value)}`);
  }

  return messageCount;
}

function mapChatSessionHistorySummaryRow(row: ChatSessionHistorySummaryRow): ChatSessionHistorySummary {
  return {
    sessionId: row.session_id,
    title: row.title ?? summarizeChatText(row.first_user_message_text, DERIVED_TITLE_MAX_LENGTH),
    hasCustomTitle: row.title !== null,
    preview: summarizeChatText(row.last_message_text, PREVIEW_MAX_LENGTH),
    messageCount: parseMessageCount(row.message_count),
    createdAt: new Date(row.created_at).getTime(),
    lastActivityAt: new Date(row.last_activity_at).getTime(),
  };
}

/**
 * Locks the caller's own non-archived session, or throws ChatSessionNotFoundError.
 */
export async function lockHistoryChatSessionWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<HistoryChatSessionLockRow> {
  const result = await executor.query<HistoryChatSessionLockRow>(LOCK_HISTORY_CHAT_SESSION_SQL, [
    scope.userId,
    scope.workspaceId,
    sessionId,
  ]);
  const row = result.rows[0];
  if (row === undefined) {
    throw new ChatSessionNotFoundError(sessionId);
  }

  return row;
}

/**
 * Lists the caller's non-archived sessions that have at least one message, newest activity first.
 * `searchText` matches the custom title or the text of any message, case-insensitively.
 */
export const listChatSessionHistory = async (
  userId: string,
  workspaceId: string,
  limit: number,
  cursor: ChatSessionHistoryCursor | null,
  searchText: string | null,
): Promise<ChatSessionHistoryPage> => {
  const result = await queryWithWorkspaceScope<ChatSessionHistorySummaryRow>(
    { userId, workspaceId },
    LIST_CHAT_SESSION_HISTORY_SQL,
    [
      userId,
      workspaceId,
      cursor?.lastActivityAt ?? null,
      cursor?.sessionId ?? null,
      searchText === null ? null : `%${escapeLikeValue(searchText)}%`,
      limit + 1,
    ],
  );
  const pageRows = result.rows.slice(0, limit);
  const lastPageRow = pageRows[pageRows.length - 1];

  return {
    sessions: pageRows.map(mapChatSessionHistorySummaryRow),
    nextCursor: result.rows.length > limit && lastPageRow !== undefined
      ? { lastActivityAt: lastPageRow.last_activity_cursor, sessionId: lastPageRow.session_id }
      : null,
  };
};

export const renameChatSession = async (
  userId: string,
  workspaceId: string,
  sessionId: string,
  title: string,
): Promise<ChatSessionHistorySummary> =>
  transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await lockHistoryChatSessionWithExecutor(executor, { userId, workspaceId }, sessionId);
    await executor.query(RENAME_CHAT_SESSION_SQL, [sessionId, title]);
    const result = await executor.query<ChatSessionHistorySummaryRow>(SELECT_CHAT_SESSION_HISTORY_SUMMARY_SQL, [
      sessionId,
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new ChatSessionRowNotFoundError("rename");
    }

    return mapChatSessionHistorySummaryRow(row);
  });

/**
 * Hides the session from history and latest-session resolution; its transcript is kept.
 * The caller must hold the lock from lockHistoryChatSessionWithExecutor and have settled any active run.
 */
export async function archiveLockedChatSessionWithExecutor(
  executor: DatabaseExecutor,
  sessionId: string,
): Promise<ArchivedChatSession> {
  const result = await executor.query<ArchivedChatSessionRow>(ARCHIVE_CHAT_SESSION_SQL, [sessionId]);
  const row = result.rows[0];
  if (row === undefined) {
    throw new ChatSessionRowNotFoundError("archive");
  }

  return {
    sessionId: row.session_id,
    archivedAt: new Date(row.archived_at).getTime(),
  };
}

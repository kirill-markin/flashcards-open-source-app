import { runAdminQuery, type AdminQueryResultSet, type AdminQueryRow, type AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";
import type { DataTableColumn, DataTableState } from "../../table/dataTableModel";
import {
  buildDistinctOptionsSql,
  buildNamedColumnsSql,
  emptyEnumOptions,
  parseEnumOptionsResponse,
  parsePageTotal,
} from "../../table/dataTableServerQuery";
import { buildDataTableSqlClauses, type DataTableSqlClauses } from "../../table/dataTableSql";
import { utcInstantSql } from "../usersQuery";
import {
  readNullableNumber,
  readNullableString,
  readNumber,
  readRowArray,
  readRowNullableString,
  readRowNumber,
  readRowString,
  readString,
} from "./queryRowValues";
import { buildMatchesUserIdSql, buildUserSubjectSql, isUuid } from "./userSubjectSql";

const listLabel = "User chats";
const chatLabel = "User chat";

/**
 * Tool input and output are cut to this many characters in SQL, because they dominate a long chat's
 * size and the whole transcript has to fit one Lambda response.
 */
export const chatToolTextLimit = 2000;

export type ChatSessionRow = Readonly<{
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  workspaceName: string | null;
  messageCount: number;
  userMessageCount: number;
  /** Text characters of every message, as `ai.chat_items.content_char_count` counts them. */
  characterCount: number;
  lastMessageAt: string | null;
  runCount: number;
  failedRunCount: number;
  models: string | null;
  clientPlatforms: string | null;
}>;

/** The first `chatToolTextLimit` characters of a tool input or output, and its full length. */
export type CappedText = Readonly<{ text: string; totalLength: number }>;

export type ChatPart =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "card"; frontText: string; backText: string; tags: string | null }>
  | Readonly<{ type: "tool_call"; name: string; status: string | null; input: CappedText | null; output: CappedText | null }>
  | Readonly<{ type: "reasoning_summary"; summary: string }>
  /** The attachment body never leaves the database; only what names it does. */
  | Readonly<{ type: "image"; mediaType: string | null }>
  | Readonly<{ type: "file"; mediaType: string | null; fileName: string | null }>;

export type ChatItem = Readonly<{
  order: number;
  role: string;
  state: string;
  createdAt: string;
  parts: ReadonlyArray<ChatPart>;
}>;

export type ChatTranscript = Readonly<{
  session: Readonly<{ createdAt: string; updatedAt: string; status: string; workspaceName: string | null }>;
  items: ReadonlyArray<ChatItem>;
}>;

type ChatSessionField = keyof ChatSessionRow;

/**
 * The SQL every column's filter and sort read, keyed by the column ids `ChatsTab` declares, over the
 * joins of `chatSessionsFromSql`. A date is the raw `timestamptz`.
 */
const chatColumnSqlById: Readonly<Record<string, string>> = {
  session: "sessions.session_id::text",
  created: "sessions.created_at",
  updated: "sessions.updated_at",
  status: "sessions.status",
  workspace: "workspaces.name",
  messages: "items.message_count",
  "user-messages": "items.user_message_count",
  characters: "items.character_count",
  "last-message": "items.last_message_at",
  runs: "runs.run_count",
  "failed-runs": "runs.failed_run_count",
  models: "runs.models",
  platforms: "runs.client_platforms",
};

/** Each `ChatSessionRow` field, selected under its own name by `buildChatSessionsPageSql`. */
const chatSessionFieldSql: Readonly<Record<ChatSessionField, string>> = {
  sessionId: "sessions.session_id::text",
  createdAt: utcInstantSql("sessions.created_at"),
  updatedAt: utcInstantSql("sessions.updated_at"),
  status: "sessions.status",
  workspaceName: "workspaces.name",
  messageCount: "items.message_count",
  userMessageCount: "items.user_message_count",
  characterCount: "items.character_count",
  lastMessageAt: utcInstantSql("items.last_message_at"),
  runCount: "runs.run_count",
  failedRunCount: "runs.failed_run_count",
  models: "runs.models",
  clientPlatforms: "runs.client_platforms",
};

const defaultOrderBySql = "sessions.updated_at DESC";

const tiebreakOrderBySql = "sessions.session_id DESC";

const chatSessionsWorkspaceJoinSql = "LEFT JOIN org.workspaces AS workspaces ON workspaces.workspace_id = sessions.workspace_id";

function buildOwnedChatSessionSql(userId: string): string {
  return buildMatchesUserIdSql("sessions.user_id", buildUserSubjectSql(userId));
}

/** Every session with the workspace and the message and run counts its columns read. */
const chatSessionsFromSql = `FROM ai.chat_sessions AS sessions
  ${chatSessionsWorkspaceJoinSql}
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS message_count,
      count(*) FILTER (WHERE chat_items.role = 'user')::int AS user_message_count,
      COALESCE(sum(chat_items.content_char_count), 0)::int AS character_count,
      max(chat_items.created_at) AS last_message_at
    FROM ai.chat_items AS chat_items
    WHERE chat_items.session_id = sessions.session_id
  ) AS items
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS run_count,
      count(*) FILTER (WHERE chat_runs.status = 'failed')::int AS failed_run_count,
      string_agg(DISTINCT chat_runs.model_id, ', ') AS models,
      string_agg(DISTINCT chat_runs.client_platform, ', ') AS client_platforms
    FROM ai.chat_runs AS chat_runs
    WHERE chat_runs.session_id = sessions.session_id
  ) AS runs`;

function buildChatSessionsPageSql(userId: string, clauses: DataTableSqlClauses): string {
  return `SELECT ${buildNamedColumnsSql(chatSessionFieldSql).join(",\n    ")}
  ${chatSessionsFromSql}
  WHERE ${buildOwnedChatSessionSql(userId)} AND ${clauses.whereConditionSql}
  ${clauses.orderBySql}
  ${clauses.limitOffsetSql}`;
}

function buildChatSessionsTotalSql(userId: string, clauses: DataTableSqlClauses): string {
  return `SELECT count(*)::int AS total_count
  ${chatSessionsFromSql}
  WHERE ${buildOwnedChatSessionSql(userId)} AND ${clauses.whereConditionSql}`;
}

function parseChatSessionRow(row: AdminQueryRow, rowIndex: number): ChatSessionRow {
  const location = `${listLabel} row ${rowIndex}`;
  const string = (field: ChatSessionField): string => readRowString(row, field, location);
  const nullableString = (field: ChatSessionField): string | null => readRowNullableString(row, field, location);
  const number = (field: ChatSessionField): number => readRowNumber(row, field, location);
  return {
    sessionId: string("sessionId"),
    createdAt: string("createdAt"),
    updatedAt: string("updatedAt"),
    status: string("status"),
    workspaceName: nullableString("workspaceName"),
    messageCount: number("messageCount"),
    userMessageCount: number("userMessageCount"),
    characterCount: number("characterCount"),
    lastMessageAt: nullableString("lastMessageAt"),
    runCount: number("runCount"),
    failedRunCount: number("failedRunCount"),
    models: nullableString("models"),
    clientPlatforms: nullableString("clientPlatforms"),
  };
}

export type ChatSessionsPageResult = Readonly<{
  /** The person's sessions matching the filters across every page. */
  totalCount: number;
  rows: ReadonlyArray<ChatSessionRow>;
}>;

/** The page at `state.page` of the person's sessions and the matching total, in one request of two statements. */
export async function loadChatSessionsPage(
  config: AdminAppConfig,
  userId: string,
  state: DataTableState,
  columns: ReadonlyArray<DataTableColumn<ChatSessionRow>>,
): Promise<ChatSessionsPageResult> {
  const clauses = buildDataTableSqlClauses(state, columns, chatColumnSqlById, defaultOrderBySql, tiebreakOrderBySql);
  const response = await runAdminQuery(
    config,
    `${buildChatSessionsPageSql(userId, clauses)};\n${buildChatSessionsTotalSql(userId, clauses)}`,
  );
  const pageResult = response.resultSets[0];
  if (response.resultSets.length !== 2 || pageResult === undefined) {
    throw new Error(`${listLabel} query must return exactly two result sets.`);
  }
  return {
    totalCount: parsePageTotal(response.resultSets[1]?.rows[0]?.total_count, listLabel),
    rows: pageResult.rows.map((row, rowIndex) => parseChatSessionRow(row, rowIndex)),
  };
}

/** Every enum column `ChatsTab` declares. */
const chatEnumColumnIds: ReadonlyArray<string> = ["status", "workspace"];

/** Every value each enum column holds across the person's sessions, NULL as `""`. */
function buildChatSessionsEnumOptionsSql(userId: string): string {
  const optionsSql = chatEnumColumnIds.map((columnId) => {
    const sqlExpression = chatColumnSqlById[columnId];
    if (sqlExpression === undefined) {
      throw new Error(`${listLabel} enum column "${columnId}" has no SQL expression.`);
    }
    return `'${columnId}', ${buildDistinctOptionsSql(`COALESCE(${sqlExpression}, '')`)}`;
  });
  return `SELECT json_build_object(
    ${optionsSql.join(",\n    ")}
  ) AS o
  FROM ai.chat_sessions AS sessions
  ${chatSessionsWorkspaceJoinSql}
  WHERE ${buildOwnedChatSessionSql(userId)}`;
}

export type ChatSessionsEnumOptions = ReadonlyMap<string, ReadonlyArray<string>>;

/** Every enum column with no options, which the table shows until `loadChatSessionsEnumOptions` answers. */
export const emptyChatSessionsEnumOptions: ChatSessionsEnumOptions = emptyEnumOptions(chatEnumColumnIds);

export async function loadChatSessionsEnumOptions(config: AdminAppConfig, userId: string): Promise<ChatSessionsEnumOptions> {
  const response = await runAdminQuery(config, buildChatSessionsEnumOptionsSql(userId));
  return parseEnumOptionsResponse(response, chatEnumColumnIds, listLabel);
}

/**
 * One positional array per content part, tagged by its type. Attachment bodies (`base64Data`) are
 * never selected, and the payload's provider-side keys (`openaiItems` and the generated image
 * bookkeeping) are not read at all. An unknown part type is passed through as its type alone, so
 * nothing the query does not know about leaves the database, and the parser rejects it.
 */
const chatPartsSql = `(SELECT COALESCE(json_agg(CASE parts.part->>'type'
      WHEN 'text' THEN json_build_array('text', parts.part->>'text')
      WHEN 'card' THEN json_build_array('card', parts.part->>'frontText', parts.part->>'backText',
        (SELECT string_agg(tags.tag, ', ') FROM jsonb_array_elements_text(parts.part->'tags') AS tags(tag)))
      WHEN 'tool_call' THEN json_build_array('tool_call', parts.part->>'name', parts.part->>'status',
        left(parts.part->>'input', ${chatToolTextLimit}), length(parts.part->>'input'),
        left(parts.part->>'output', ${chatToolTextLimit}), length(parts.part->>'output'))
      WHEN 'reasoning_summary' THEN json_build_array('reasoning_summary', parts.part->>'summary')
      WHEN 'image' THEN json_build_array('image', parts.part->>'mediaType')
      WHEN 'file' THEN json_build_array('file', parts.part->>'mediaType', parts.part->>'fileName')
      ELSE json_build_array(parts.part->>'type')
    END ORDER BY parts.part_index), '[]'::json)
  FROM jsonb_array_elements(items.payload->'content') WITH ORDINALITY AS parts(part, part_index))`;

/** The session header, then its items in order; both read nothing unless the session is the person's. */
function buildChatTranscriptSql(userId: string, sessionId: string): string {
  const ownedSessionSql = `sessions.session_id = ${escapeSqlStringLiteral(sessionId)}::uuid
    AND ${buildMatchesUserIdSql("sessions.user_id", buildUserSubjectSql(userId))}`;
  return `SELECT json_build_array(
    ${utcInstantSql("sessions.created_at")},
    ${utcInstantSql("sessions.updated_at")},
    sessions.status,
    workspaces.name
  ) AS h
  FROM ai.chat_sessions AS sessions
  LEFT JOIN org.workspaces AS workspaces ON workspaces.workspace_id = sessions.workspace_id
  WHERE ${ownedSessionSql};
  SELECT json_build_array(
    items.item_order,
    items.role,
    items.state,
    ${utcInstantSql("items.created_at")},
    ${chatPartsSql}
  ) AS i
  FROM ai.chat_items AS items
  JOIN ai.chat_sessions AS sessions ON sessions.session_id = items.session_id
  WHERE ${ownedSessionSql}
  ORDER BY items.item_order`;
}

function readCappedText(values: ReadonlyArray<AdminQueryValue>, textIndex: number, fieldName: string, location: string): CappedText | null {
  const text = readNullableString(values, textIndex, fieldName, location);
  const totalLength = readNullableNumber(values, textIndex + 1, `${fieldName}Length`, location);
  if (text === null && totalLength === null) {
    return null;
  }
  if (text === null || totalLength === null) {
    throw new Error(`${location} field "${fieldName}" and its length must be both null or both set.`);
  }
  return { text, totalLength };
}

function parseChatPart(value: AdminQueryValue, location: string): ChatPart {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${location} must be a non-empty array.`);
  }
  const type = readNullableString(value, 0, "type", location);
  switch (type) {
    case "text": {
      const values = readRowArray(value, 2, location);
      return { type: "text", text: readString(values, 1, "text", location) };
    }
    case "card": {
      const values = readRowArray(value, 4, location);
      return {
        type: "card",
        frontText: readString(values, 1, "frontText", location),
        backText: readString(values, 2, "backText", location),
        tags: readNullableString(values, 3, "tags", location),
      };
    }
    case "tool_call": {
      const values = readRowArray(value, 7, location);
      return {
        type: "tool_call",
        name: readString(values, 1, "name", location),
        status: readNullableString(values, 2, "status", location),
        input: readCappedText(values, 3, "input", location),
        output: readCappedText(values, 5, "output", location),
      };
    }
    case "reasoning_summary": {
      const values = readRowArray(value, 2, location);
      return { type: "reasoning_summary", summary: readString(values, 1, "summary", location) };
    }
    case "image": {
      const values = readRowArray(value, 2, location);
      return { type: "image", mediaType: readNullableString(values, 1, "mediaType", location) };
    }
    case "file": {
      const values = readRowArray(value, 3, location);
      return {
        type: "file",
        mediaType: readNullableString(values, 1, "mediaType", location),
        fileName: readNullableString(values, 2, "fileName", location),
      };
    }
    default:
      throw new Error(`${location} has unsupported part type: ${type ?? "(missing)"}`);
  }
}

function parseChatItem(value: AdminQueryValue | undefined, rowIndex: number): ChatItem {
  const location = `${chatLabel} item ${rowIndex}`;
  const values = readRowArray(value, 5, location);
  const parts = values[4];
  if (!Array.isArray(parts)) {
    throw new Error(`${location} field "parts" must be an array.`);
  }
  return {
    order: readNumber(values, 0, "order", location),
    role: readString(values, 1, "role", location),
    state: readString(values, 2, "state", location),
    createdAt: readString(values, 3, "createdAt", location),
    parts: parts.map((part: AdminQueryValue, partIndex: number) => parseChatPart(part, `${location} part ${partIndex}`)),
  };
}

function parseTranscriptItems(result: AdminQueryResultSet | undefined): ReadonlyArray<ChatItem> {
  if (result === undefined) {
    throw new Error(`${chatLabel} items result set is missing.`);
  }
  return result.rows.map((row, rowIndex) => parseChatItem(row.i, rowIndex));
}

/** Null when no session with this id belongs to the person. */
export async function loadChatTranscript(config: AdminAppConfig, userId: string, sessionId: string): Promise<ChatTranscript | null> {
  if (!isUuid(sessionId)) {
    throw new Error(`${chatLabel} session id must be a UUID, got: ${sessionId}`);
  }
  const response = await runAdminQuery(config, buildChatTranscriptSql(userId, sessionId));
  if (response.resultSets.length !== 2) {
    throw new Error(`${chatLabel} query must return exactly two result sets.`);
  }
  const headerRows = response.resultSets[0]?.rows ?? [];
  if (headerRows.length > 1) {
    throw new Error(`${chatLabel} header must have at most one row.`);
  }
  const headerRow = headerRows[0];
  if (headerRow === undefined) {
    return null;
  }
  const location = `${chatLabel} header`;
  const header = readRowArray(headerRow.h, 4, location);
  return {
    session: {
      createdAt: readString(header, 0, "createdAt", location),
      updatedAt: readString(header, 1, "updatedAt", location),
      status: readString(header, 2, "status", location),
      workspaceName: readNullableString(header, 3, "workspaceName", location),
    },
    items: parseTranscriptItems(response.resultSets[1]),
  };
}

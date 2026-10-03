import { runAdminQuery, type AdminQueryResultSet, type AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";
import { utcInstantSql } from "../usersQuery";
import { readNullableNumber, readNullableString, readNumber, readRowArray, readString } from "./queryRowValues";
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

function buildChatSessionsSql(userId: string): string {
  const subject = buildUserSubjectSql(userId);
  return `SELECT json_build_array(
    sessions.session_id::text,
    ${utcInstantSql("sessions.created_at")},
    ${utcInstantSql("sessions.updated_at")},
    sessions.status,
    workspaces.name,
    items.message_count,
    items.user_message_count,
    items.character_count,
    ${utcInstantSql("items.last_message_at")},
    runs.run_count,
    runs.failed_run_count,
    runs.models,
    runs.client_platforms
  ) AS s
  FROM ai.chat_sessions AS sessions
  LEFT JOIN org.workspaces AS workspaces ON workspaces.workspace_id = sessions.workspace_id
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
  ) AS runs
  WHERE ${buildMatchesUserIdSql("sessions.user_id", subject)}
  ORDER BY sessions.updated_at DESC, sessions.session_id DESC`;
}

function parseChatSessionRow(value: AdminQueryValue | undefined, rowIndex: number): ChatSessionRow {
  const location = `${listLabel} row ${rowIndex}`;
  const values = readRowArray(value, 13, location);
  return {
    sessionId: readString(values, 0, "sessionId", location),
    createdAt: readString(values, 1, "createdAt", location),
    updatedAt: readString(values, 2, "updatedAt", location),
    status: readString(values, 3, "status", location),
    workspaceName: readNullableString(values, 4, "workspaceName", location),
    messageCount: readNumber(values, 5, "messageCount", location),
    userMessageCount: readNumber(values, 6, "userMessageCount", location),
    characterCount: readNumber(values, 7, "characterCount", location),
    lastMessageAt: readNullableString(values, 8, "lastMessageAt", location),
    runCount: readNumber(values, 9, "runCount", location),
    failedRunCount: readNumber(values, 10, "failedRunCount", location),
    models: readNullableString(values, 11, "models", location),
    clientPlatforms: readNullableString(values, 12, "clientPlatforms", location),
  };
}

/** Every chat session the person owns, most recently updated first, with its message and run counts. */
export async function loadChatSessions(config: AdminAppConfig, userId: string): Promise<ReadonlyArray<ChatSessionRow>> {
  const response = await runAdminQuery(config, buildChatSessionsSql(userId));
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${listLabel} query must return exactly one result set.`);
  }
  return result.rows.map((row, rowIndex) => parseChatSessionRow(row.s, rowIndex));
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

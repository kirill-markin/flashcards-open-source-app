import {
  type ChatComposerSuggestionsLocale,
  normalizeChatComposerSuggestionsUiLocale,
} from "../composerSuggestions";
import { HttpError } from "../../shared/errors";
import type { ChatSessionHistoryCursor } from "../store";
import type { InlineFileContentPart, InlineImageContentPart, UploadContentPart } from "../types";
import {
  normalizeChatUploadAttachmentType,
  validateChatFileAttachmentContent,
  validateChatImageAttachmentContent,
} from "../attachmentPolicy";
import { assertChatUploadCountPerTurn } from "../../chatFiles";
import {
  expectNonEmptyString,
  expectRecord,
  expectUuidString,
  expectWorkspaceIdString,
} from "../../server/requestParsing";

export const chatMaximumStartRunRequestBytes = 5 * 1024 * 1024;
export const chatRequestTooLargeCode = "CHAT_REQUEST_TOO_LARGE";
export const chatRequestTooLargeMessage = `AI chat request is too large. Maximum request size is ${chatMaximumStartRunRequestBytes} bytes.`;

type ChatTextContentPart = Readonly<{
  type: "text";
  text: string;
}>;

type ChatCardContentPart = Readonly<{
  type: "card";
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
}>;

type ChatToolCallContentPart = Readonly<{
  type: "tool_call";
  id: string;
  name: string;
  status: "started" | "completed";
  input: string | null;
  output: string | null;
}>;

export type ChatContentPart =
  | ChatTextContentPart
  | InlineImageContentPart
  | InlineFileContentPart
  | UploadContentPart
  | ChatCardContentPart
  | ChatToolCallContentPart;

export type ChatRequestBody = Readonly<{
  // First-party AI clients newer than 1.5.0 no longer rely on omitting
  // sessionId on /chat. Keep this optional only for released clients at 1.5.0
  // and older, and remove the session-less path in a future legacy chat cleanup.
  sessionId?: string;
  clientRequestId: string;
  content: ReadonlyArray<ChatContentPart>;
  timezone: string;
  // Optional explicit routing during the workspaceId client migration.
  // First-party AI clients newer than 1.5.0 send workspaceId; keep the
  // selected-workspace fallback only for released clients at 1.5.0 and older.
  workspaceId?: string;
  // Optional for released clients at 1.5.0 and older that still send the
  // pre-uiLocale request shape. Remove once the minimum supported first-party
  // AI client version is greater than 1.5.0.
  uiLocale?: ChatComposerSuggestionsLocale;
}>;

export type ChatFileUploadRequestBody = Readonly<{
  fileName: string;
  mediaType: string;
  sizeBytes: number;
}>;

export type NewChatRequestBody = Readonly<{
  // First-party AI clients newer than 1.5.0 no longer rely on omitting
  // sessionId on /chat/new. Keep this optional only for released clients at
  // 1.5.0 and older, and remove the session-less path in a future legacy chat
  // cleanup.
  sessionId?: string;
  // Optional explicit routing during the workspaceId client migration.
  // First-party AI clients newer than 1.5.0 send workspaceId; keep the
  // selected-workspace fallback only for released clients at 1.5.0 and older.
  workspaceId?: string;
  // Optional for released clients at 1.5.0 and older that still send the
  // pre-uiLocale request shape. Remove once the minimum supported first-party
  // AI client version is greater than 1.5.0.
  uiLocale?: ChatComposerSuggestionsLocale;
}>;

export type StopChatRequestBody = Readonly<{
  sessionId: string;
  // TODO: Make runId required once the minimum supported first-party AI client
  // version is greater than 1.5.0. This optional path supports older releases.
  runId?: string;
  // Optional explicit routing during the workspaceId client migration.
  // First-party AI clients newer than 1.5.0 send workspaceId; keep the
  // selected-workspace fallback only for released clients at 1.5.0 and older.
  workspaceId?: string;
}>;

export type ChatPageQuery = Readonly<{
  limit: number;
  beforeCursor: number | undefined;
}>;

export type ChatSessionsListQuery = Readonly<{
  limit: number;
  cursor: ChatSessionHistoryCursor | null;
  searchText: string | null;
}>;

export type RenameChatSessionRequestBody = Readonly<{
  title: string;
}>;

const MAX_CHAT_PAGE_LIMIT = 50;
const DEFAULT_CHAT_SESSIONS_PAGE_LIMIT = 20;
const MAX_CHAT_SESSIONS_SEARCH_LENGTH = 200;
const MAX_CHAT_SESSION_TITLE_LENGTH = 200;
const CHAT_SESSIONS_CURSOR_TIMESTAMP_PATTERN = /^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const chatSessionsCursorInvalidCode = "CHAT_SESSIONS_CURSOR_INVALID";
const chatSessionsSearchTooLongCode = "CHAT_SESSIONS_SEARCH_TOO_LONG";
const chatSessionTitleInvalidCode = "CHAT_SESSION_TITLE_INVALID";

const UNSUPPORTED_CHAT_REQUEST_FIELDS = [
  // First-party AI clients newer than 1.5.0 no longer send these legacy
  // request-shape fields. Keep rejecting them while the remaining compatibility
  // branches are still present, then revisit this guard in the future legacy
  // chat cleanup.
  // Model selection fields and legacy vendor/thinking aliases stay rejected
  // because the server owns runtime model/provider/reasoning selection.
  "messages",
  "model",
  "selectedModel",
  "selectedModelId",
  "devicePlatform",
  "chatSessionId",
  "codeInterpreterContainerId",
  "userContext",
  "totalCards",
  "codeInterpreterContainer",
  "vendor",
  "thinking",
  "thinkingLevel",
] as const;

/**
 * Accepts nullable string fields in the new chat request contract without permitting empty strings.
 */
function expectNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return expectNonEmptyString(value, fieldName);
}

function expectString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  return value;
}

/**
 * `uiLocale` remains optional for backward compatibility while clients migrate
 * to the explicit request field. Released clients at 1.5.0 and older still omit
 * it and intentionally receive the English fallback path. This branch can be
 * simplified once the minimum supported first-party AI client version is greater
 * than 1.5.0.
 */
function parseOptionalUiLocale(
  value: unknown,
  fieldName: string,
): ChatComposerSuggestionsLocale | undefined {
  if (value === undefined) {
    return undefined;
  }

  const uiLocale = expectNonEmptyString(value, fieldName);

  try {
    return normalizeChatComposerSuggestionsUiLocale(uiLocale);
  } catch {
    throw new HttpError(400, `${fieldName} is invalid`);
  }
}

/**
 * Parses one content part from the backend-owned chat request contract.
 */
function parseChatContentPart(value: unknown, context: string): ChatContentPart {
  const body = expectRecord(value);
  const type = expectNonEmptyString(body.type, `${context}.type`);

  if (type === "text") {
    return {
      type: "text",
      text: expectNonEmptyString(body.text, `${context}.text`),
    };
  }

  if (type === "image") {
    const mediaType = expectString(body.mediaType, `${context}.mediaType`);
    const attachment = validateChatImageAttachmentContent(
      mediaType,
      expectNonEmptyString(body.base64Data, `${context}.base64Data`),
    );
    return {
      type: "image",
      mediaType: attachment.mediaType,
      base64Data: attachment.base64Data,
    };
  }

  if (type === "file") {
    const mediaType = expectString(body.mediaType, `${context}.mediaType`);
    const fileName = expectNonEmptyString(body.fileName, `${context}.fileName`);
    const attachment = validateChatFileAttachmentContent(
      fileName,
      mediaType,
      expectNonEmptyString(body.base64Data, `${context}.base64Data`),
    );
    return {
      type: "file",
      mediaType: attachment.mediaType,
      base64Data: attachment.base64Data,
      fileName,
    };
  }

  if (type === "upload") {
    const fileName = expectNonEmptyString(body.fileName, `${context}.fileName`);
    return {
      type: "upload",
      uploadId: expectUuidString(body.uploadId, `${context}.uploadId`),
      fileName,
      mediaType: normalizeChatUploadAttachmentType(
        fileName,
        expectString(body.mediaType, `${context}.mediaType`),
      ).mediaType,
    };
  }

  if (type === "card") {
    const tagsValue = body.tags;
    if (!Array.isArray(tagsValue)) {
      throw new HttpError(400, `${context}.tags must be an array`);
    }

    return {
      type: "card",
      cardId: expectNonEmptyString(body.cardId, `${context}.cardId`),
      frontText: expectString(body.frontText, `${context}.frontText`),
      backText: expectString(body.backText, `${context}.backText`),
      tags: tagsValue.map((tag, index) => expectNonEmptyString(tag, `${context}.tags[${index}]`)),
    };
  }

  if (type === "tool_call") {
    const status = expectNonEmptyString(body.status, `${context}.status`);
    if (status !== "started" && status !== "completed") {
      throw new HttpError(400, `${context}.status is invalid`);
    }

    return {
      type: "tool_call",
      id: expectNonEmptyString(body.id, `${context}.id`),
      name: expectNonEmptyString(body.name, `${context}.name`),
      status,
      input: expectNullableString(body.input ?? null, `${context}.input`),
      output: expectNullableString(body.output ?? null, `${context}.output`),
    };
  }

  throw new HttpError(400, `${context}.type is invalid`);
}

/**
 * Parses the user-supplied content array for a backend-owned chat turn.
 */
function parseChatContentParts(value: unknown, context: string): ReadonlyArray<ChatContentPart> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, `${context} must be a non-empty array`);
  }

  const parts = value.map((part, index) => parseChatContentPart(part, `${context}[${index}]`));
  assertChatUploadCountPerTurn(parts.filter((part) => part.type === "upload").length);
  return parts;
}

function parseOptionalWorkspaceIdField(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectWorkspaceIdString(value, "workspaceId");
}

/**
 * Rejects request fields that are not part of the backend-owned chat contract.
 */
function assertNoUnsupportedRequestFields(body: Record<string, unknown>): void {
  for (const fieldName of UNSUPPORTED_CHAT_REQUEST_FIELDS) {
    if (fieldName in body) {
      throw new HttpError(400, `Unsupported request field: ${fieldName}`);
    }
  }
}

/**
 * Parses the new backend-owned chat request body that contains only the current turn input.
 */
export function parseChatRequestBody(value: unknown): ChatRequestBody {
  const body = expectRecord(value);
  assertNoUnsupportedRequestFields(body);

  const sessionId = body.sessionId === undefined
    ? undefined
    : expectUuidString(body.sessionId, "sessionId");

  return {
    sessionId,
    clientRequestId: expectNonEmptyString(body.clientRequestId, "clientRequestId"),
    content: parseChatContentParts(body.content, "content"),
    timezone: expectNonEmptyString(body.timezone, "timezone"),
    workspaceId: parseOptionalWorkspaceIdField(body.workspaceId),
    uiLocale: parseOptionalUiLocale(body.uiLocale, "uiLocale"),
  };
}

export function parseChatFileUploadRequestBody(value: unknown): ChatFileUploadRequestBody {
  const body = expectRecord(value);
  const sizeBytes = body.sizeBytes;
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new HttpError(400, "sizeBytes must be a positive safe integer");
  }

  return {
    fileName: expectNonEmptyString(body.fileName, "fileName"),
    mediaType: expectString(body.mediaType, "mediaType"),
    sizeBytes,
  };
}

/**
 * Parses the request body for creating or resolving a chat session.
 */
export function parseNewChatRequestBody(value: unknown): NewChatRequestBody {
  const body = expectRecord(value);

  return {
    sessionId: body.sessionId === undefined
      ? undefined
      : expectUuidString(body.sessionId, "sessionId"),
    workspaceId: parseOptionalWorkspaceIdField(body.workspaceId),
    uiLocale: parseOptionalUiLocale(body.uiLocale, "uiLocale"),
  };
}

/**
 * Parses the stop request body for cancelling the active run of a server-owned chat session.
 */
export function parseStopChatRequestBody(value: unknown): StopChatRequestBody {
  const body = expectRecord(value);

  return {
    sessionId: expectUuidString(body.sessionId, "sessionId"),
    runId: body.runId === undefined
      ? undefined
      : expectUuidString(body.runId, "runId"),
    workspaceId: parseOptionalWorkspaceIdField(body.workspaceId),
  };
}

export function parseOptionalSessionIdQuery(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectUuidString(value, "sessionId");
}

export function parseChatPageQuery(
  limitParam: string | undefined,
  beforeParam: string | undefined,
): ChatPageQuery | null {
  if (limitParam === undefined) {
    return null;
  }

  const limit = Math.min(Math.max(Number.parseInt(limitParam, 10) || 7, 1), MAX_CHAT_PAGE_LIMIT);
  const beforeCursor = beforeParam !== undefined
    ? Number.parseInt(beforeParam, 10)
    : undefined;
  if (beforeParam !== undefined && (!Number.isSafeInteger(beforeCursor) || (beforeCursor as number) < 0)) {
    throw new HttpError(400, "Invalid before cursor");
  }

  return {
    limit,
    beforeCursor,
  };
}

export function encodeChatSessionsCursor(cursor: ChatSessionHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function createInvalidChatSessionsCursorError(reason: string): HttpError {
  return new HttpError(400, `cursor is invalid: ${reason}`, chatSessionsCursorInvalidCode);
}

/**
 * Rejects a timestamp Postgres would refuse, such as February 30, so a tampered cursor is a 400.
 */
function isValidChatSessionsCursorTimestamp(value: string): boolean {
  if (!CHAT_SESSIONS_CURSOR_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  const millisecondTimestamp = `${value.slice(0, 23)}Z`;
  const parsedMilliseconds = Date.parse(millisecondTimestamp);
  return !Number.isNaN(parsedMilliseconds)
    && new Date(parsedMilliseconds).toISOString() === millisecondTimestamp;
}

function parseChatSessionsCursor(value: string): ChatSessionHistoryCursor {
  let decodedValue: unknown;
  try {
    decodedValue = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw createInvalidChatSessionsCursorError("not base64url-encoded JSON");
  }

  if (typeof decodedValue !== "object" || decodedValue === null || Array.isArray(decodedValue)) {
    throw createInvalidChatSessionsCursorError("payload must be an object");
  }

  const { lastActivityAt, sessionId } = decodedValue as Record<string, unknown>;
  if (typeof lastActivityAt !== "string" || !isValidChatSessionsCursorTimestamp(lastActivityAt)) {
    throw createInvalidChatSessionsCursorError("lastActivityAt must be a microsecond UTC timestamp");
  }

  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) {
    throw createInvalidChatSessionsCursorError("sessionId must be a UUID");
  }

  return {
    lastActivityAt,
    sessionId: sessionId.toLowerCase(),
  };
}

function parseChatSessionsSearchText(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const searchText = value.trim();
  if (searchText === "") {
    return null;
  }

  if (Array.from(searchText).length > MAX_CHAT_SESSIONS_SEARCH_LENGTH) {
    throw new HttpError(
      400,
      `q must be at most ${MAX_CHAT_SESSIONS_SEARCH_LENGTH} characters`,
      chatSessionsSearchTooLongCode,
    );
  }

  return searchText;
}

/**
 * Parses `GET /chat/sessions` paging and search; `limit` is clamped like the message page limit.
 */
export function parseChatSessionsListQuery(
  limitParam: string | undefined,
  cursorParam: string | undefined,
  searchParam: string | undefined,
): ChatSessionsListQuery {
  const limit = limitParam === undefined
    ? DEFAULT_CHAT_SESSIONS_PAGE_LIMIT
    : Math.min(
      Math.max(Number.parseInt(limitParam, 10) || DEFAULT_CHAT_SESSIONS_PAGE_LIMIT, 1),
      MAX_CHAT_PAGE_LIMIT,
    );

  return {
    limit,
    cursor: cursorParam === undefined ? null : parseChatSessionsCursor(cursorParam),
    searchText: parseChatSessionsSearchText(searchParam),
  };
}

export function parseChatSessionIdPathParam(value: string | undefined): string {
  return expectUuidString(value, "sessionId");
}

/**
 * Titles are trimmed and limited by code point, matching the VARCHAR(200) column.
 */
export function parseRenameChatSessionRequestBody(value: unknown): RenameChatSessionRequestBody {
  const body = expectRecord(value);
  if (typeof body.title !== "string") {
    throw new HttpError(400, "title must be a string", chatSessionTitleInvalidCode);
  }

  const title = body.title.trim();
  const titleLength = Array.from(title).length;
  if (titleLength === 0 || titleLength > MAX_CHAT_SESSION_TITLE_LENGTH) {
    throw new HttpError(
      400,
      `title must be between 1 and ${MAX_CHAT_SESSION_TITLE_LENGTH} characters`,
      chatSessionTitleInvalidCode,
    );
  }

  return { title };
}

import {
  type ChatComposerSuggestionsLocale,
  normalizeChatComposerSuggestionsUiLocale,
} from "../composerSuggestions";
import { HttpError } from "../../shared/errors";
import {
  validateChatFileAttachmentContent,
  validateChatImageAttachmentContent,
} from "../attachmentPolicy";
import {
  expectNonEmptyString,
  expectRecord,
  expectUuidString,
} from "../../server/requestParsing";

export const chatMaximumStartRunRequestBytes = 5 * 1024 * 1024;
export const chatRequestTooLargeCode = "CHAT_REQUEST_TOO_LARGE";
export const chatRequestTooLargeMessage = `AI chat request is too large. Maximum request size is ${chatMaximumStartRunRequestBytes} bytes.`;

type ChatTextContentPart = Readonly<{
  type: "text";
  text: string;
}>;

type ChatImageContentPart = Readonly<{
  type: "image";
  mediaType: string;
  base64Data: string;
}>;

type ChatFileContentPart = Readonly<{
  type: "file";
  mediaType: string;
  base64Data: string;
  fileName: string;
}>;

type ChatCardContentPart = Readonly<{
  type: "card";
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: "fast" | "medium" | "long";
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
  | ChatImageContentPart
  | ChatFileContentPart
  | ChatCardContentPart
  | ChatToolCallContentPart;

export type ChatRequestBody = Readonly<{
  // First-party clients at >1.5.0 no longer rely on omitting sessionId on
  // /chat. Keep this optional only for temporary backward compatibility with
  // older released clients, and remove the session-less path in a future
  // legacy chat cleanup.
  sessionId?: string;
  clientRequestId: string;
  content: ReadonlyArray<ChatContentPart>;
  timezone: string;
  // Optional explicit routing during the workspaceId client migration. Older
  // released clients still rely on the server-side selected-workspace
  // fallback until every supported build sends workspaceId.
  workspaceId?: string;
  // Optional for backward compatibility with released clients that still send
  // the pre-uiLocale request shape. Remove once the minimum supported client
  // versions all send uiLocale.
  uiLocale?: ChatComposerSuggestionsLocale;
}>;

export type NewChatRequestBody = Readonly<{
  // First-party clients at >1.5.0 no longer rely on omitting sessionId on
  // /chat/new. Keep this optional only for temporary backward compatibility
  // with older released clients, and remove the session-less path in a future
  // legacy chat cleanup.
  sessionId?: string;
  // Optional explicit routing during the workspaceId client migration. Older
  // released clients still rely on the server-side selected-workspace
  // fallback until every supported build sends workspaceId.
  workspaceId?: string;
  // Optional for backward compatibility with released clients that still send
  // the pre-uiLocale request shape. Remove once the minimum supported client
  // versions all send uiLocale.
  uiLocale?: ChatComposerSuggestionsLocale;
}>;

export type StopChatRequestBody = Readonly<{
  sessionId: string;
  // TODO: Remove optional runId and make it required after most users have updated to the latest version. This is a legacy path.
  runId?: string;
  // Optional explicit routing during the workspaceId client migration. Older
  // released clients still rely on the server-side selected-workspace
  // fallback until every supported build sends workspaceId.
  workspaceId?: string;
}>;

export type ChatPageQuery = Readonly<{
  limit: number;
  beforeCursor: number | undefined;
}>;

const MAX_CHAT_PAGE_LIMIT = 50;

const UNSUPPORTED_CHAT_REQUEST_FIELDS = [
  // First-party clients at >1.5.0 no longer send these legacy request-shape
  // fields. Keep rejecting them while the remaining compatibility branches are
  // still present, then revisit this guard in the future legacy chat cleanup.
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
 * to the explicit request field. Older clients still omit it and intentionally
 * receive the English fallback path. Once every supported client sends
 * `uiLocale`, this parser branch can be simplified.
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

  if (type === "card") {
    const tagsValue = body.tags;
    if (!Array.isArray(tagsValue)) {
      throw new HttpError(400, `${context}.tags must be an array`);
    }

    const effortLevel = expectNonEmptyString(body.effortLevel, `${context}.effortLevel`);
    if (effortLevel !== "fast" && effortLevel !== "medium" && effortLevel !== "long") {
      throw new HttpError(400, `${context}.effortLevel is invalid`);
    }

    return {
      type: "card",
      cardId: expectNonEmptyString(body.cardId, `${context}.cardId`),
      frontText: expectString(body.frontText, `${context}.frontText`),
      backText: expectString(body.backText, `${context}.backText`),
      tags: tagsValue.map((tag, index) => expectNonEmptyString(tag, `${context}.tags[${index}]`)),
      effortLevel,
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

  return value.map((part, index) => parseChatContentPart(part, `${context}[${index}]`));
}

function parseOptionalWorkspaceIdField(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectUuidString(value, "workspaceId");
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

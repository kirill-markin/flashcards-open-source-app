import { Hono } from "hono";
import { isBackendOwnedChatEnabled } from "../chat/config";
import type { AuthTransport } from "../auth";
import { HttpError } from "../errors";
import {
  loadRequestContextFromRequest,
  type RequestContext,
} from "../server/requestContext";
import {
  expectNonEmptyString,
  expectRecord,
  parseJsonBody,
} from "../server/requestParsing";
import type { AppEnv } from "../app";

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

type ChatToolCallContentPart = Readonly<{
  type: "tool_call";
  toolCallId: string;
  name: string;
  status: "started" | "completed";
  input: string | null;
  output: string | null;
}>;

export type ChatContentPart =
  | ChatTextContentPart
  | ChatImageContentPart
  | ChatFileContentPart
  | ChatToolCallContentPart;

export type ChatRequestBody = Readonly<{
  sessionId?: string;
  content: ReadonlyArray<ChatContentPart>;
  timezone: string;
}>;

type StopChatRequestBody = Readonly<{
  sessionId: string;
}>;

type ChatRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  enabled?: boolean;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
}>;

const LEGACY_CHAT_REQUEST_FIELDS = [
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
] as const;

function expectNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return expectNonEmptyString(value, fieldName);
}

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
    return {
      type: "image",
      mediaType: expectNonEmptyString(body.mediaType, `${context}.mediaType`),
      base64Data: expectNonEmptyString(body.base64Data, `${context}.base64Data`),
    };
  }

  if (type === "file") {
    return {
      type: "file",
      mediaType: expectNonEmptyString(body.mediaType, `${context}.mediaType`),
      base64Data: expectNonEmptyString(body.base64Data, `${context}.base64Data`),
      fileName: expectNonEmptyString(body.fileName, `${context}.fileName`),
    };
  }

  if (type === "tool_call") {
    const status = expectNonEmptyString(body.status, `${context}.status`);
    if (status !== "started" && status !== "completed") {
      throw new HttpError(400, `${context}.status is invalid`);
    }

    return {
      type: "tool_call",
      toolCallId: expectNonEmptyString(body.toolCallId, `${context}.toolCallId`),
      name: expectNonEmptyString(body.name, `${context}.name`),
      status,
      input: expectNullableString(body.input ?? null, `${context}.input`),
      output: expectNullableString(body.output ?? null, `${context}.output`),
    };
  }

  throw new HttpError(400, `${context}.type is invalid`);
}

function parseChatContentParts(value: unknown, context: string): ReadonlyArray<ChatContentPart> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, `${context} must be a non-empty array`);
  }

  return value.map((part, index) => parseChatContentPart(part, `${context}[${index}]`));
}

function assertNoLegacyFields(body: Record<string, unknown>): void {
  for (const fieldName of LEGACY_CHAT_REQUEST_FIELDS) {
    if (fieldName in body) {
      throw new HttpError(400, `Unsupported legacy chat field: ${fieldName}`);
    }
  }
}

export function parseChatRequestBody(value: unknown): ChatRequestBody {
  const body = expectRecord(value);
  assertNoLegacyFields(body);

  const sessionId = body.sessionId === undefined
    ? undefined
    : expectNonEmptyString(body.sessionId, "sessionId");

  return {
    sessionId,
    content: parseChatContentParts(body.content, "content"),
    timezone: expectNonEmptyString(body.timezone, "timezone"),
  };
}

export function parseStopChatRequestBody(value: unknown): StopChatRequestBody {
  const body = expectRecord(value);

  return {
    sessionId: expectNonEmptyString(body.sessionId, "sessionId"),
  };
}

function assertBackendOwnedChatEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new HttpError(404, "Not found", "AI_CHAT_V2_DISABLED");
  }
}

function assertSupportedTransport(requestContext: RequestContext): void {
  const supportedTransports = new Set<AuthTransport>(["bearer", "session"]);
  if (supportedTransports.has(requestContext.transport)) {
    return;
  }

  throw new HttpError(
    403,
    "This endpoint requires Bearer or session authentication.",
    "AI_CHAT_V2_HUMAN_AUTH_REQUIRED",
  );
}

function createNotReadyError(): HttpError {
  return new HttpError(501, "Backend-owned AI chat is not implemented yet.", "AI_CHAT_V2_NOT_READY");
}

async function loadSupportedRequestContext(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest,
): Promise<RequestContext> {
  const { requestContext } = await loadRequestContextFromRequestFn(request, allowedOrigins);
  assertSupportedTransport(requestContext);
  return requestContext;
}

export function createChatRoutes(options: ChatRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const enabled = options.enabled ?? isBackendOwnedChatEnabled();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;

  app.get("/chat", async (context) => {
    assertBackendOwnedChatEnabled(enabled);
    await loadSupportedRequestContext(context.req.raw, options.allowedOrigins, loadRequestContextFromRequestFn);
    throw createNotReadyError();
  });

  app.post("/chat", async (context) => {
    assertBackendOwnedChatEnabled(enabled);
    await loadSupportedRequestContext(context.req.raw, options.allowedOrigins, loadRequestContextFromRequestFn);
    parseChatRequestBody(await parseJsonBody(context.req.raw));
    throw createNotReadyError();
  });

  app.delete("/chat", async (context) => {
    assertBackendOwnedChatEnabled(enabled);
    await loadSupportedRequestContext(context.req.raw, options.allowedOrigins, loadRequestContextFromRequestFn);
    throw createNotReadyError();
  });

  app.post("/chat/stop", async (context) => {
    assertBackendOwnedChatEnabled(enabled);
    await loadSupportedRequestContext(context.req.raw, options.allowedOrigins, loadRequestContextFromRequestFn);
    parseStopChatRequestBody(await parseJsonBody(context.req.raw));
    throw createNotReadyError();
  });

  return app;
}

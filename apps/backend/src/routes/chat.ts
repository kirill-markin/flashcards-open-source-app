/**
 * Route factory and request parsing for the backend-owned chat surface.
 * These routes accept user turn input, resolve or create server-owned sessions, and schedule persisted runs for asynchronous execution.
 */
import { Hono } from "hono";
import { getChatConfig, type ChatConfig } from "../chat/config";
import {
  getRecoveredChatSessionSnapshot,
  prepareChatRun,
  requestChatRunCancellation,
  type ChatRunStopState,
  type PreparedChatRun,
} from "../chat/runs";
import {
  ChatSessionConflictError,
  ChatSessionNotFoundError,
  createFreshChatSession,
  type ChatSessionSnapshot,
} from "../chat/store";
import { invokeChatWorkerOrPersistFailure } from "../chat/workerInvoke";
import type { AuthTransport } from "../auth";
import { HttpError } from "../errors";
import {
  loadRequestContextFromRequest,
  requireSelectedWorkspaceId,
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
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  getRecoveredChatSessionSnapshotFn?: typeof getRecoveredChatSessionSnapshot;
  createFreshChatSessionFn?: typeof createFreshChatSession;
  prepareChatRunFn?: typeof prepareChatRun;
  invokeChatWorkerFn?: typeof invokeChatWorkerOrPersistFailure;
  requestChatRunCancellationFn?: typeof requestChatRunCancellation;
}>;

const UNSUPPORTED_CHAT_REQUEST_FIELDS = [
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
    : expectNonEmptyString(body.sessionId, "sessionId");

  return {
    sessionId,
    content: parseChatContentParts(body.content, "content"),
    timezone: expectNonEmptyString(body.timezone, "timezone"),
  };
}

/**
 * Parses the stop request body for cancelling the active run of a server-owned chat session.
 */
export function parseStopChatRequestBody(value: unknown): StopChatRequestBody {
  const body = expectRecord(value);

  return {
    sessionId: expectNonEmptyString(body.sessionId, "sessionId"),
  };
}

/**
 * Restricts the backend-owned chat surface to human-facing auth transports.
 */
function assertSupportedTransport(requestContext: RequestContext): void {
  const supportedTransports = new Set<AuthTransport>(["bearer", "session", "guest"]);
  if (supportedTransports.has(requestContext.transport)) {
    return;
  }

  throw new HttpError(
    403,
    "This endpoint requires Bearer, session, or guest authentication.",
    "AI_CHAT_V2_HUMAN_AUTH_REQUIRED",
  );
}

type ChatHistoryResponse = Readonly<{
  sessionId: string;
  runState: ChatSessionSnapshot["runState"];
  updatedAt: number;
  mainContentInvalidationVersion: number;
  chatConfig: ChatConfig;
  messages: ReadonlyArray<Readonly<{
    role: "user" | "assistant";
    content: ChatSessionSnapshot["messages"][number]["content"];
    timestamp: number;
    isError: boolean;
    isStopped: boolean;
  }>>;
}>;

type ChatStartResponse = Readonly<{
  ok: true;
  sessionId: string;
  runId: string;
  runState: "running";
  chatConfig: ChatConfig;
}>;

type ChatResetResponse = Readonly<{
  ok: true;
  sessionId: string;
  chatConfig: ChatConfig;
}>;

/**
 * Converts a persisted session snapshot into the response contract consumed by thin clients.
 */
function toChatHistoryResponse(snapshot: ChatSessionSnapshot): ChatHistoryResponse {
  return {
    sessionId: snapshot.sessionId,
    runState: snapshot.runState,
    updatedAt: snapshot.updatedAt,
    mainContentInvalidationVersion: snapshot.mainContentInvalidationVersion,
    chatConfig: getChatConfig(),
    messages: snapshot.messages.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      isError: message.isError,
      isStopped: message.isStopped,
    })),
  };
}

/**
 * Maps store-layer errors into the HTTP error contract used by the thin chat clients.
 */
function mapStoreError(error: unknown): never {
  if (error instanceof ChatSessionNotFoundError) {
    throw new HttpError(404, error.message);
  }

  if (error instanceof ChatSessionConflictError) {
    throw new HttpError(409, "Chat session already has an active response");
  }

  throw error;
}

/**
 * Loads request context and enforces the auth transports supported by backend-owned chat.
 */
async function loadSupportedRequestContext(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest,
): Promise<RequestContext> {
  const { requestContext } = await loadRequestContextFromRequestFn(request, allowedOrigins);
  assertSupportedTransport(requestContext);
  return requestContext;
}

/**
 * Mounts the backend-owned `/chat` routes for history, start, reset, and stop operations.
 */
export function createChatRoutes(options: ChatRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const getRecoveredChatSessionSnapshotFn = options.getRecoveredChatSessionSnapshotFn ?? getRecoveredChatSessionSnapshot;
  const createFreshChatSessionFn = options.createFreshChatSessionFn ?? createFreshChatSession;
  const prepareChatRunFn = options.prepareChatRunFn ?? prepareChatRun;
  const invokeChatWorkerFn = options.invokeChatWorkerFn ?? invokeChatWorkerOrPersistFailure;
  const requestChatRunCancellationFn = options.requestChatRunCancellationFn ?? requestChatRunCancellation;

  app.get("/chat", async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const sessionId = context.req.query("sessionId") ?? undefined;

    try {
      const snapshot = await getRecoveredChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        sessionId,
      );
      return context.json(toChatHistoryResponse(snapshot));
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.post("/chat", async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseChatRequestBody(await parseJsonBody(context.req.raw));

    let preparedRun: PreparedChatRun;
    try {
      preparedRun = await prepareChatRunFn(
        requestContext.userId,
        workspaceId,
        body.sessionId,
        body.content,
        context.get("requestId"),
        body.timezone,
      );
    } catch (error) {
      return mapStoreError(error);
    }

    await invokeChatWorkerFn({
      runId: preparedRun.runId,
      userId: requestContext.userId,
      workspaceId,
    });

    return context.json({
      ok: true,
      sessionId: preparedRun.sessionId,
      runId: preparedRun.runId,
      runState: "running",
      chatConfig: getChatConfig(),
    } satisfies ChatStartResponse);
  });

  app.delete("/chat", async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const sessionId = context.req.query("sessionId") ?? undefined;

    let snapshot: ChatSessionSnapshot;
    try {
      snapshot = await getRecoveredChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        sessionId,
      );
    } catch (error) {
      return mapStoreError(error);
    }

    if (snapshot.messages.length === 0) {
      return context.json({
        ok: true,
        sessionId: snapshot.sessionId,
        chatConfig: getChatConfig(),
      } satisfies ChatResetResponse);
    }

    const newSessionId = await createFreshChatSessionFn(
      requestContext.userId,
      workspaceId,
    );

    return context.json({
      ok: true,
      sessionId: newSessionId,
      chatConfig: getChatConfig(),
    } satisfies ChatResetResponse);
  });

  app.post("/chat/stop", async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseStopChatRequestBody(await parseJsonBody(context.req.raw));

    let sessionId: string;
    try {
      sessionId = await getRecoveredChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        body.sessionId,
      ).then((snapshot) => snapshot.sessionId);
    } catch (error) {
      return mapStoreError(error);
    }

    const stopState: ChatRunStopState = await requestChatRunCancellationFn(
      requestContext.userId,
      workspaceId,
      sessionId,
    );

    return context.json({
      ok: true,
      sessionId: stopState.sessionId,
      runId: stopState.runId,
      stopped: stopState.stopped,
      stillRunning: stopState.stillRunning,
    });
  });

  return app;
}

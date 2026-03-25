import { Hono } from "hono";
import { isBackendOwnedChatEnabled, CHAT_MODEL_ID } from "../chat/config";
import {
  cancelActiveChatRunByUser,
  ChatSessionConflictError,
  ChatSessionNotFoundError,
  createFreshChatSession,
  getChatSessionSnapshot,
  getLatestChatSessionId,
  prepareChatRun,
  type ChatSessionSnapshot,
} from "../chat/store";
import {
  hasActiveChatRun,
  markActiveChatRunCancellationPersisted,
  startPersistedChatRun,
  stopActiveChatRun,
  type StartPersistedChatRunParams,
} from "../chat/runtime";
import type { ChatStreamEvent, ContentPart } from "../chat/types";
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
  getChatSessionSnapshotFn?: typeof getChatSessionSnapshot;
  getLatestChatSessionIdFn?: typeof getLatestChatSessionId;
  createFreshChatSessionFn?: typeof createFreshChatSession;
  prepareChatRunFn?: typeof prepareChatRun;
  startPersistedChatRunFn?: typeof startPersistedChatRun;
  stopActiveChatRunFn?: typeof stopActiveChatRun;
  cancelActiveChatRunByUserFn?: typeof cancelActiveChatRunByUser;
  markActiveChatRunCancellationPersistedFn?: typeof markActiveChatRunCancellationPersisted;
  hasActiveChatRunFn?: typeof hasActiveChatRun;
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
  "vendor",
  "thinking",
  "thinkingLevel",
] as const;

const CHAT_STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

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

type ChatHistoryResponse = Readonly<{
  sessionId: string;
  runState: ChatSessionSnapshot["runState"];
  updatedAt: number;
  mainContentInvalidationVersion: number;
  messages: ReadonlyArray<Readonly<{
    role: "user" | "assistant";
    content: ReadonlyArray<ContentPart>;
    timestamp: number;
    isError: boolean;
    isStopped: boolean;
  }>>;
}>;

function toChatHistoryResponse(snapshot: ChatSessionSnapshot): ChatHistoryResponse {
  return {
    sessionId: snapshot.sessionId,
    runState: snapshot.runState,
    updatedAt: snapshot.updatedAt,
    mainContentInvalidationVersion: snapshot.mainContentInvalidationVersion,
    messages: snapshot.messages.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      isError: message.isError,
      isStopped: message.isStopped,
    })),
  };
}

function mapStoreError(error: unknown): never {
  if (error instanceof ChatSessionNotFoundError) {
    throw new HttpError(404, error.message);
  }

  if (error instanceof ChatSessionConflictError) {
    throw new HttpError(409, "Chat session already has an active response");
  }

  throw error;
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

function isExpectedStreamClosureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Controller is already closed")
    || message.includes("ReadableStream is already closed")
    || message.includes("stream is already closed");
}

function createSseDataLine(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function createSseHeartbeatLine(): string {
  return ": keep-alive\n\n";
}

export function createChatEventStream(params: Readonly<{
  events: AsyncGenerator<ChatStreamEvent>;
  heartbeatIntervalMs: number;
  onStreamError: (error: string) => void;
}>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let isClosed = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  const clearHeartbeat = (): void => {
    if (heartbeatTimer !== null) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  return new ReadableStream({
    async start(controller) {
      const closeStream = (): void => {
        clearHeartbeat();
        if (isClosed) {
          return;
        }

        isClosed = true;
        try {
          controller.close();
        } catch (error) {
          if (!isExpectedStreamClosureError(error)) {
            throw error;
          }
        }
      };

      const enqueueChunk = (chunk: string): boolean => {
        if (isClosed) {
          return false;
        }

        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch (error) {
          clearHeartbeat();
          isClosed = true;
          if (isExpectedStreamClosureError(error)) {
            return false;
          }
          throw error;
        }
      };

      const scheduleHeartbeat = (): void => {
        clearHeartbeat();
        if (isClosed) {
          return;
        }

        heartbeatTimer = setTimeout(() => {
          try {
            const written = enqueueChunk(createSseHeartbeatLine());
            if (!written) {
              return;
            }
            scheduleHeartbeat();
          } catch (error) {
            if (isClosed || isExpectedStreamClosureError(error)) {
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            params.onStreamError(message);
            closeStream();
          }
        }, params.heartbeatIntervalMs);
      };

      scheduleHeartbeat();

      try {
        for await (const event of params.events) {
          if (isClosed) {
            return;
          }
          clearHeartbeat();
          const written = enqueueChunk(createSseDataLine(event));
          if (!written) {
            return;
          }
          if (event.type === "done") {
            closeStream();
            return;
          }
          scheduleHeartbeat();
        }
      } catch (error) {
        clearHeartbeat();
        if (isClosed || isExpectedStreamClosureError(error)) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        params.onStreamError(message);
        if (!isClosed) {
          const written = enqueueChunk(createSseDataLine({ type: "error", message }));
          if (!written) {
            return;
          }
        }
      }

      closeStream();
    },
    cancel() {
      isClosed = true;
      if (heartbeatTimer !== null) {
        clearTimeout(heartbeatTimer);
      }
      const returnFn = params.events.return?.bind(params.events);
      if (returnFn === undefined) {
        return;
      }

      return returnFn(undefined).then(
        (): void => undefined,
        (): void => undefined,
      );
    },
  });
}

export function createChatRoutes(options: ChatRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const enabled = options.enabled ?? isBackendOwnedChatEnabled();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const getChatSessionSnapshotFn = options.getChatSessionSnapshotFn ?? getChatSessionSnapshot;
  const getLatestChatSessionIdFn = options.getLatestChatSessionIdFn ?? getLatestChatSessionId;
  const createFreshChatSessionFn = options.createFreshChatSessionFn ?? createFreshChatSession;
  const prepareChatRunFn = options.prepareChatRunFn ?? prepareChatRun;
  const startPersistedChatRunFn = options.startPersistedChatRunFn ?? startPersistedChatRun;
  const stopActiveChatRunFn = options.stopActiveChatRunFn ?? stopActiveChatRun;
  const cancelActiveChatRunByUserFn = options.cancelActiveChatRunByUserFn ?? cancelActiveChatRunByUser;
  const markActiveChatRunCancellationPersistedFn = options.markActiveChatRunCancellationPersistedFn ?? markActiveChatRunCancellationPersisted;
  const hasActiveChatRunFn = options.hasActiveChatRunFn ?? hasActiveChatRun;

  app.get("/chat", async (context) => {
    assertBackendOwnedChatEnabled(enabled);
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const sessionId = context.req.query("sessionId") ?? undefined;

    try {
      const snapshot = await getChatSessionSnapshotFn(
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
    assertBackendOwnedChatEnabled(enabled);
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseChatRequestBody(await parseJsonBody(context.req.raw));

    try {
      const preparedRun = await prepareChatRunFn(
        requestContext.userId,
        workspaceId,
        body.sessionId,
        body.content,
      );

      const events = startPersistedChatRunFn({
        requestId: context.get("requestId"),
        userId: requestContext.userId,
        workspaceId,
        sessionId: preparedRun.sessionId,
        timezone: body.timezone,
        assistantItemId: preparedRun.assistantItem.itemId,
        localMessages: preparedRun.localMessages,
        turnInput: preparedRun.turnInput,
        diagnostics: {
          requestId: context.get("requestId"),
          userId: requestContext.userId,
          workspaceId,
          sessionId: preparedRun.sessionId,
          model: CHAT_MODEL_ID,
          messageCount: 1,
          hasAttachments: body.content.some((part) => part.type !== "text"),
          attachmentFileNames: body.content
            .filter((part): part is Extract<ChatContentPart, { type: "file" }> => part.type === "file")
            .map((part) => part.fileName),
        },
      } satisfies StartPersistedChatRunParams);

      const stream = createChatEventStream({
        events,
        heartbeatIntervalMs: CHAT_STREAM_HEARTBEAT_INTERVAL_MS,
        onStreamError: (): void => undefined,
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Chat-Session-Id": preparedRun.sessionId,
        },
      });
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.delete("/chat", async (context) => {
    assertBackendOwnedChatEnabled(enabled);
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const sessionId = context.req.query("sessionId") ?? undefined;

    try {
      if (sessionId !== undefined) {
        await getChatSessionSnapshotFn(
          requestContext.userId,
          workspaceId,
          sessionId,
        );
      } else {
        await getLatestChatSessionIdFn(
          requestContext.userId,
          workspaceId,
        );
      }
    } catch (error) {
      return mapStoreError(error);
    }

    const newSessionId = await createFreshChatSessionFn(
      requestContext.userId,
      workspaceId,
    );

    return context.json({
      ok: true,
      sessionId: newSessionId,
    });
  });

  app.post("/chat/stop", async (context) => {
    assertBackendOwnedChatEnabled(enabled);
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseStopChatRequestBody(await parseJsonBody(context.req.raw));

    let sessionId: string;
    try {
      sessionId = await getChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        body.sessionId,
      ).then((snapshot) => snapshot.sessionId);
    } catch (error) {
      return mapStoreError(error);
    }

    const stoppedRuntimeRun = stopActiveChatRunFn(sessionId);
    const persistedCancelledRun = await cancelActiveChatRunByUserFn(
      requestContext.userId,
      workspaceId,
      sessionId,
    );

    if (persistedCancelledRun) {
      markActiveChatRunCancellationPersistedFn(sessionId);
    }

    return context.json({
      ok: true,
      sessionId,
      stopped: stoppedRuntimeRun || persistedCancelledRun,
      stillRunning: hasActiveChatRunFn(sessionId),
    });
  });

  return app;
}

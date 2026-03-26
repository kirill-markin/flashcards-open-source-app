/**
 * Legacy chat backend HTTP parsing and streaming for old `/chat/turn` clients.
 * The backend-first `/chat` endpoints store sessions and runs on the server and expose a different contract.
 * TODO: Remove this legacy module after most users have updated to app versions that use the new chat endpoints.
 */
import { HttpError } from "../../errors";
import {
  assertGuestAiLimitAvailable,
  recordGuestChatUsage,
} from "../../guestAiQuota";
import {
  classifyAIEndpointFailure,
  makeAIEndpointNotConfiguredError,
  type AIEndpointFailureClassification,
} from "./aiAvailabilityErrors";
import type {
  AIChatContentPart,
  AIChatProviderUsage,
  AIChatTurnRequestBody,
  AIChatTurnStreamEvent,
  AIChatUserContext,
  AIChatWireMessage,
} from "./aiChatTypes";
import { CHAT_MODELS } from "./models";
import { hashAIProviderUserId } from "./providerSafety";
import type { RequestContext } from "../../server/requestContext";
import { requireSelectedWorkspaceId } from "../../server/requestContext";
import {
  expectNonEmptyString,
  expectNonNegativeInteger,
  expectNullableNonEmptyString,
  expectNullableNonNegativeInteger,
  expectRecord,
} from "../../server/requestParsing";
import { getErrorLogContext } from "../../server/logging";
type AIChatDiagnosticsBody = Readonly<{
  kind: "failure";
  clientRequestId: string;
  backendRequestId: string | null;
  stage: string;
  errorKind: string;
  statusCode: number | null;
  eventType: string | null;
  toolName: string | null;
  toolCallId: string | null;
  lineNumber: number | null;
  rawSnippet: string | null;
  decoderSummary: string | null;
  continuationAttempt: number | null;
  continuationToolCallIds: ReadonlyArray<string>;
  selectedModel: string;
  messageCount: number;
  appVersion: string;
  devicePlatform: string;
}>;

type AIChatLatencyDiagnosticsBody = Readonly<{
  kind: "latency";
  clientRequestId: string;
  backendRequestId: string | null;
  selectedModel: string;
  messageCount: number;
  appVersion: string;
  devicePlatform: string;
  result: string;
  statusCode: number | null;
  firstEventType: string | null;
  didReceiveFirstSseLine: boolean;
  didReceiveFirstDelta: boolean;
  tapToRequestStartMs: number | null;
  requestStartToHeadersMs: number | null;
  headersToFirstSseLineMs: number | null;
  firstSseLineToFirstDeltaMs: number | null;
  requestStartToFirstDeltaMs: number | null;
  tapToFirstDeltaMs: number | null;
  requestStartToTerminalMs: number | null;
  tapToTerminalMs: number | null;
}>;

type ParsedAIChatDiagnosticsBody =
  | AIChatDiagnosticsBody
  | AIChatLatencyDiagnosticsBody;

type AIChatStructuredError = Error & Readonly<{
  code: string;
  stage: string;
  classification: string;
}>;

/**
 * This legacy chat backend helper parses one content part from the old `/chat/turn` request body.
 * The backend-first `/chat` endpoints accept a different server-owned request contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function parseAIChatContentPart(
  value: unknown,
  context: string,
): AIChatContentPart {
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
    const inputValue = body.input;
    const outputValue = body.output;

    if (inputValue !== null && typeof inputValue !== "string") {
      throw new HttpError(400, `${context}.input must be a string or null`);
    }

    if (outputValue !== null && typeof outputValue !== "string") {
      throw new HttpError(400, `${context}.output must be a string or null`);
    }

    const status = expectNonEmptyString(body.status, `${context}.status`);
    if (status !== "started" && status !== "completed") {
      throw new HttpError(400, `${context}.status is invalid`);
    }

    return {
      type: "tool_call",
      toolCallId: expectNonEmptyString(body.toolCallId, `${context}.toolCallId`),
      name: expectNonEmptyString(body.name, `${context}.name`),
      status,
      input: inputValue ?? null,
      output: outputValue ?? null,
    };
  }

  throw new HttpError(400, `${context}.type is invalid`);
}

/**
 * This legacy chat backend helper parses content-part arrays from old `/chat/turn` requests.
 * The backend-first `/chat` stack validates content against a different server-owned contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function parseAIChatContentParts(
  value: unknown,
  context: string,
): ReadonlyArray<AIChatContentPart> {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${context} must be an array`);
  }

  return value.map((partValue, index) => parseAIChatContentPart(partValue, `${context}[${index}]`));
}

/**
 * This legacy chat backend helper parses message history from old `/chat/turn` requests.
 * The backend-first `/chat` endpoints own transcript state on the server instead of trusting client-provided history.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function parseAIChatMessages(value: unknown): ReadonlyArray<AIChatWireMessage> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "messages must be a non-empty array");
  }

  return value.map((messageValue, index) => {
    const body = expectRecord(messageValue);
    const role = expectNonEmptyString(body.role, `messages[${index}].role`);

    if (role === "user") {
      const content = parseAIChatContentParts(body.content, `messages[${index}].content`);
      for (const part of content) {
        if (part.type === "tool_call") {
          throw new HttpError(400, `messages[${index}].content cannot include tool_call parts for user messages`);
        }
      }

      return {
        role: "user",
        content,
      };
    }

    if (role === "assistant") {
      return {
        role: "assistant",
        content: parseAIChatContentParts(body.content, `messages[${index}].content`),
      };
    }

    throw new HttpError(400, `messages[${index}].role is invalid`);
  });
}

/**
 * This legacy chat backend helper parses lightweight user context from old `/chat/turn` requests.
 * The backend-first `/chat` stack builds server-owned session context differently.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function parseAIChatUserContext(value: unknown): AIChatUserContext {
  const body = expectRecord(value);

  return {
    totalCards: expectNonNegativeInteger(body.totalCards, "userContext.totalCards"),
  };
}

/**
 * This legacy chat backend entrypoint parses the old `/chat/turn` request contract.
 * The backend-first `/chat` endpoints use a session-based server-owned contract instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function parseAIChatTurnRequestBody(value: unknown): AIChatTurnRequestBody {
  const body = expectRecord(value);
  const model = expectNonEmptyString(body.model, "model");
  const timezone = expectNonEmptyString(body.timezone, "timezone");
  const devicePlatform = body.devicePlatform;
  const chatSessionId = expectNonEmptyString(body.chatSessionId, "chatSessionId");
  const codeInterpreterContainerId = expectNullableNonEmptyString(
    body.codeInterpreterContainerId ?? null,
    "codeInterpreterContainerId",
  );

  return {
    messages: parseAIChatMessages(body.messages),
    model,
    timezone,
    devicePlatform: devicePlatform === "web" || devicePlatform === "android" ? devicePlatform : "ios",
    chatSessionId,
    codeInterpreterContainerId,
    userContext: parseAIChatUserContext(body.userContext),
  };
}

/**
 * This legacy chat backend helper creates structured runtime errors for the old `/chat/turn` flow.
 * The backend-first `/chat` stack persists run failures in server-owned chat records instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function makeAIChatStructuredError(
  message: string,
  code: string,
  stage: string,
  classification: string,
): AIChatStructuredError {
  return Object.assign(new Error(message), {
    code,
    stage,
    classification,
  });
}

/**
 * This legacy chat backend helper validates boolean diagnostic fields for old `/chat/turn` clients.
 * The backend-first `/chat` stack reports diagnostics through a different server-owned runtime.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${context} must be a boolean`);
  }

  return value;
}

/**
 * This legacy chat backend helper validates string arrays in old `/chat/turn` diagnostics payloads.
 * The backend-first `/chat` stack reports runtime metadata through a different server-owned contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function expectStringArray(value: unknown, context: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${context} must be an array`);
  }

  return value.map((item, index) => expectNonEmptyString(item, `${context}[${index}]`));
}

/**
 * This legacy chat backend entrypoint parses diagnostics emitted by old `/chat/turn` clients.
 * The backend-first `/chat` endpoints have different server-owned observability boundaries.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function parseAIChatDiagnosticsBody(value: unknown): ParsedAIChatDiagnosticsBody {
  const body = expectRecord(value);
  const kind = expectNonEmptyString(body.kind, "kind");

  if (kind === "latency") {
    return {
      kind: "latency",
      clientRequestId: expectNonEmptyString(body.clientRequestId, "clientRequestId"),
      backendRequestId: expectNullableNonEmptyString(body.backendRequestId, "backendRequestId"),
      selectedModel: expectNonEmptyString(body.selectedModel, "selectedModel"),
      messageCount: expectNonNegativeInteger(body.messageCount, "messageCount"),
      appVersion: expectNonEmptyString(body.appVersion, "appVersion"),
      devicePlatform: expectNonEmptyString(body.devicePlatform, "devicePlatform"),
      result: expectNonEmptyString(body.result, "result"),
      statusCode: expectNullableNonNegativeInteger(body.statusCode, "statusCode"),
      firstEventType: expectNullableNonEmptyString(body.firstEventType, "firstEventType"),
      didReceiveFirstSseLine: expectBoolean(body.didReceiveFirstSseLine, "didReceiveFirstSseLine"),
      didReceiveFirstDelta: expectBoolean(body.didReceiveFirstDelta, "didReceiveFirstDelta"),
      tapToRequestStartMs: expectNullableNonNegativeInteger(body.tapToRequestStartMs, "tapToRequestStartMs"),
      requestStartToHeadersMs: expectNullableNonNegativeInteger(body.requestStartToHeadersMs, "requestStartToHeadersMs"),
      headersToFirstSseLineMs: expectNullableNonNegativeInteger(body.headersToFirstSseLineMs, "headersToFirstSseLineMs"),
      firstSseLineToFirstDeltaMs: expectNullableNonNegativeInteger(body.firstSseLineToFirstDeltaMs, "firstSseLineToFirstDeltaMs"),
      requestStartToFirstDeltaMs: expectNullableNonNegativeInteger(body.requestStartToFirstDeltaMs, "requestStartToFirstDeltaMs"),
      tapToFirstDeltaMs: expectNullableNonNegativeInteger(body.tapToFirstDeltaMs, "tapToFirstDeltaMs"),
      requestStartToTerminalMs: expectNullableNonNegativeInteger(body.requestStartToTerminalMs, "requestStartToTerminalMs"),
      tapToTerminalMs: expectNullableNonNegativeInteger(body.tapToTerminalMs, "tapToTerminalMs"),
    };
  }

  if (kind !== "failure") {
    throw new HttpError(400, "kind is invalid");
  }

  return {
    kind: "failure",
    clientRequestId: expectNonEmptyString(body.clientRequestId, "clientRequestId"),
    backendRequestId: expectNullableNonEmptyString(body.backendRequestId, "backendRequestId"),
    stage: expectNonEmptyString(body.stage, "stage"),
    errorKind: expectNonEmptyString(body.errorKind, "errorKind"),
    statusCode: expectNullableNonNegativeInteger(body.statusCode, "statusCode"),
    eventType: expectNullableNonEmptyString(body.eventType, "eventType"),
    toolName: expectNullableNonEmptyString(body.toolName, "toolName"),
    toolCallId: expectNullableNonEmptyString(body.toolCallId, "toolCallId"),
    lineNumber: expectNullableNonNegativeInteger(body.lineNumber, "lineNumber"),
    rawSnippet: expectNullableNonEmptyString(body.rawSnippet, "rawSnippet"),
    decoderSummary: expectNullableNonEmptyString(body.decoderSummary, "decoderSummary"),
    continuationAttempt: expectNullableNonNegativeInteger(body.continuationAttempt ?? null, "continuationAttempt"),
    continuationToolCallIds: body.continuationToolCallIds === undefined
      ? []
      : expectStringArray(body.continuationToolCallIds, "continuationToolCallIds"),
    selectedModel: expectNonEmptyString(body.selectedModel, "selectedModel"),
    messageCount: expectNonNegativeInteger(body.messageCount, "messageCount"),
    appVersion: expectNonEmptyString(body.appVersion, "appVersion"),
    devicePlatform: expectNonEmptyString(body.devicePlatform, "devicePlatform"),
  };
}

/**
 * This legacy chat backend helper extracts internal error text for old `/chat/turn` failure reporting.
 * The backend-first `/chat` stack stores normalized run failures differently on the server.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * This legacy chat backend helper narrows legacy structured runtime errors from old `/chat/turn` flows.
 * The backend-first `/chat` stack represents runtime failure state differently through persisted runs.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function getAIChatStructuredError(error: unknown): AIChatStructuredError | null {
  if (
    typeof error !== "object"
    || error === null
    || !("code" in error)
    || !("stage" in error)
    || !("classification" in error)
    || typeof error.code !== "string"
    || typeof error.stage !== "string"
    || typeof error.classification !== "string"
  ) {
    return null;
  }

  return Object.assign(new Error(getInternalErrorMessage(error)), {
    code: error.code,
    stage: error.stage,
    classification: error.classification,
  });
}

/**
 * This legacy chat backend entrypoint logs client-side diagnostics for old `/chat/turn` flows.
 * The backend-first `/chat` stack uses a different server-owned session and run model for diagnostics.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function logAIChatDiagnostics(
  requestContext: RequestContext,
  body: ParsedAIChatDiagnosticsBody,
): void {
  if (body.kind === "latency") {
    console.log(JSON.stringify({
      domain: "chat",
      vendor: "backend_chat",
      action: "ai_chat_latency_diagnostics",
      workspaceId: requestContext.selectedWorkspaceId,
      transport: requestContext.transport,
      userId: requestContext.userId,
      ...body,
    }));
    return;
  }

  console.error(JSON.stringify({
    domain: "chat",
    vendor: "backend_chat",
    action: "ai_chat_diagnostics",
    workspaceId: requestContext.selectedWorkspaceId,
    transport: requestContext.transport,
    userId: requestContext.userId,
    ...body,
  }));
}

/**
 * This legacy chat backend helper logs terminal streaming failures for old `/chat/turn` requests.
 * The backend-first `/chat` stack persists terminal run state on the server instead of relying on this path.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function logAIChatTerminalError(
  requestId: string,
  code: string,
  stage: string,
  message: string,
  error?: unknown,
  details?: AIEndpointFailureClassification,
  classification?: string,
): void {
  console.error(JSON.stringify({
    domain: "chat",
    vendor: "backend_chat",
    mode: "backend_chat",
    action: "terminal_error_emitted",
    requestId,
    code,
    stage,
    message,
    provider: details?.provider ?? "-",
    upstreamStatus: details?.upstreamStatus,
    upstreamRequestId: details?.upstreamRequestId ?? "-",
    upstreamMessage: details?.upstreamMessage ?? "-",
    originalMessage: details?.originalMessage ?? message,
    continuationAttempt: null,
    toolCallIds: [],
    classification: classification ?? null,
    ...getErrorLogContext(error ?? message),
  }));
}

/**
 * This legacy chat backend entrypoint creates an SSE error event for old `/chat/turn` clients.
 * The backend-first `/chat` stack exposes failure state through server-owned sessions and runs instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function createAIChatErrorEvent(
  message: string,
  requestId: string,
  code: string,
  stage: string,
): Extract<AIChatTurnStreamEvent, { type: "error" }> {
  return {
    type: "error",
    message,
    code,
    stage,
    requestId,
  };
}

/**
 * This legacy chat backend helper converts thrown errors into SSE error events for old `/chat/turn` clients.
 * The backend-first `/chat` stack derives failure state from server-owned runs instead of this legacy adapter.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function createAIChatErrorEventFromError(
  error: unknown,
  requestId: string,
  fallbackStage: string,
  provider: string | null,
): Extract<AIChatTurnStreamEvent, { type: "error" }> {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "stage" in error &&
    typeof error.code === "string" &&
    typeof error.stage === "string"
  ) {
    return createAIChatErrorEvent(
      getInternalErrorMessage(error),
      requestId,
      error.code,
      error.stage,
    );
  }

  const normalizedFailure = classifyAIEndpointFailure("chat", error, provider);
  return createAIChatErrorEvent(
    normalizedFailure.message,
    requestId,
    normalizedFailure.code,
    fallbackStage,
  );
}

/**
 * This legacy chat backend entrypoint creates an SSE error response for old `/chat/turn` clients.
 * The backend-first `/chat` endpoints expose errors through a different session-based surface.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function createAIChatErrorResponse(
  message: string,
  requestId: string,
  code: string,
  stage: string,
  error?: unknown,
): Response {
  const errorEvent = createAIChatErrorEvent(message, requestId, code, stage);
  logAIChatTerminalError(requestId, code, stage, message, error);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 500,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Chat-Request-Id": requestId,
    },
  });
}

/**
 * This legacy chat backend helper derives the provider safety identifier for old `/chat/turn` requests.
 * The backend-first `/chat` stack manages provider context through a different server-owned runtime.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function getProviderSafetyUserId(requestContext: RequestContext): string | null {
  if (requestContext.transport === "none") {
    return null;
  }

  return hashAIProviderUserId(requestContext.userId);
}

type PreparedAIChatTurnModule = Readonly<{
  prepareAIChatTurn: (
    params: Readonly<{
      messages: ReadonlyArray<AIChatWireMessage>;
      model: string;
      timezone: string;
      devicePlatform: "ios" | "android" | "web";
      chatSessionId: string;
      codeInterpreterContainerId: string | null;
      userContext: AIChatUserContext;
      providerSafetyUserId?: string | null;
      requestId: string;
      requestUrl: string;
      userId: string;
      workspaceId: string;
      selectedWorkspaceId: string | null;
      onUsage?: (usage: AIChatProviderUsage) => Promise<void>;
    }>,
  ) => Promise<Readonly<{
    codeInterpreterContainerId: string | null;
    stream: AsyncGenerator<AIChatTurnStreamEvent>;
  }>>;
}>;

/**
 * This legacy chat backend entrypoint streams the old `/chat/turn` response surface.
 * The backend-first `/chat` endpoints own session state, run recovery, and streaming differently on the server.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export async function streamAIChatResponse(
  body: AIChatTurnRequestBody,
  requestId: string,
  requestContext: RequestContext,
  requestUrl: string,
): Promise<Response> {
  if (requestContext.transport === "guest") {
    if (body.model !== "gpt-5.4") {
      throw new HttpError(
        400,
        "Guest AI is available only with GPT-5.4.",
        "GUEST_AI_MODEL_UNAVAILABLE",
      );
    }

    await assertGuestAiLimitAvailable(requestContext.userId, new Date());
  }

  const validModel = CHAT_MODELS.find((model) => model.id === body.model);
  if (validModel === undefined) {
    throw new HttpError(400, `Unknown AI chat model: ${body.model}`);
  }

  const apiKey = validModel.vendor === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw makeAIEndpointNotConfiguredError("chat");
  }

  const workspaceId = requireSelectedWorkspaceId(requestContext);

  const agentModule = (validModel.vendor === "anthropic"
    ? await import("./anthropic/aiChatAgent")
    : await import("./openai/aiChatAgent")) as PreparedAIChatTurnModule;
  const preparedTurn = await agentModule.prepareAIChatTurn({
    messages: body.messages,
    model: body.model,
    timezone: body.timezone,
    devicePlatform: body.devicePlatform,
    chatSessionId: body.chatSessionId,
    codeInterpreterContainerId: body.codeInterpreterContainerId,
    userContext: body.userContext,
    providerSafetyUserId: getProviderSafetyUserId(requestContext),
    requestId,
    requestUrl,
    userId: requestContext.userId,
    workspaceId,
    selectedWorkspaceId: requestContext.selectedWorkspaceId,
    onUsage: requestContext.transport === "guest"
      ? async (usage) => {
        await recordGuestChatUsage(
          requestContext.userId,
          usage.inputTokens,
          usage.outputTokens,
          new Date(),
        );
      }
      : undefined,
  });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of preparedTurn.stream) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === "done") {
            break;
          }
        }
      } catch (error) {
        const structuredError = getAIChatStructuredError(error);
        const normalizedFailure = classifyAIEndpointFailure("chat", error, validModel.vendor);
        const errorEvent = createAIChatErrorEventFromError(
          error,
          requestId,
          "stream_ai_chat_turn",
          validModel.vendor,
        );
        logAIChatTerminalError(
          requestId,
          errorEvent.code,
          errorEvent.stage,
          errorEvent.message,
          error,
          typeof error === "object"
            && error !== null
            && "code" in error
            && "stage" in error
            && typeof error.code === "string"
            && typeof error.stage === "string"
            ? undefined
            : normalizedFailure,
          structuredError?.classification ?? undefined,
        );
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent satisfies AIChatTurnStreamEvent)}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Chat-Request-Id": requestId,
      ...(preparedTurn.codeInterpreterContainerId === null
        ? {}
        : { "X-Code-Interpreter-Container-Id": preparedTurn.codeInterpreterContainerId }),
    },
  });
}

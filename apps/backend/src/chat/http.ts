import { HttpError } from "../errors";
import {
  classifyAIEndpointFailure,
  makeAIEndpointNotConfiguredError,
  type AIEndpointFailureClassification,
} from "./aiAvailabilityErrors";
import type {
  AIChatContentPart,
  AIChatTurnRequestBody,
  AIChatTurnStreamEvent,
  AIChatUserContext,
  AIChatWireMessage,
} from "./aiChatTypes";
import { CHAT_MODELS } from "./models";
import { hashAIProviderUserId } from "./providerSafety";
import type { RequestContext } from "../server/requestContext";
import { requireSelectedWorkspaceId } from "../server/requestContext";
import {
  expectNonEmptyString,
  expectNonNegativeInteger,
  expectNullableNonEmptyString,
  expectNullableNonNegativeInteger,
  expectRecord,
} from "../server/requestParsing";
import { getErrorLogContext } from "../server/logging";
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

function parseAIChatContentParts(
  value: unknown,
  context: string,
): ReadonlyArray<AIChatContentPart> {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${context} must be an array`);
  }

  return value.map((partValue, index) => parseAIChatContentPart(partValue, `${context}[${index}]`));
}

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

function parseAIChatUserContext(value: unknown): AIChatUserContext {
  const body = expectRecord(value);

  return {
    totalCards: expectNonNegativeInteger(body.totalCards, "userContext.totalCards"),
  };
}

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
    devicePlatform: devicePlatform === "web" ? "web" : "ios",
    chatSessionId,
    codeInterpreterContainerId,
    userContext: parseAIChatUserContext(body.userContext),
  };
}

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

function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${context} must be a boolean`);
  }

  return value;
}

function expectStringArray(value: unknown, context: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${context} must be an array`);
  }

  return value.map((item, index) => expectNonEmptyString(item, `${context}[${index}]`));
}

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

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
      devicePlatform: "ios" | "web";
      chatSessionId: string;
      codeInterpreterContainerId: string | null;
      userContext: AIChatUserContext;
      providerSafetyUserId?: string | null;
      requestId: string;
      requestUrl: string;
      userId: string;
      workspaceId: string;
      selectedWorkspaceId: string | null;
    }>,
  ) => Promise<Readonly<{
    codeInterpreterContainerId: string | null;
    stream: AsyncGenerator<AIChatTurnStreamEvent>;
  }>>;
}>;

export async function streamAIChatResponse(
  body: AIChatTurnRequestBody,
  requestId: string,
  requestContext: RequestContext,
  requestUrl: string,
): Promise<Response> {
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

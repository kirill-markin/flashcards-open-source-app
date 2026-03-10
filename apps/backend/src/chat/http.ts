import { HttpError } from "../errors";
import type {
  LocalAssistantToolCall,
  LocalChatMessage,
  LocalChatRequestBody,
  LocalChatStreamEvent,
} from "./localTypes";
import { CHAT_MODELS } from "./models";
import { createChatSseStream } from "./sse";
import type { ChatMessage, ChatStreamEvent } from "./types";
import type { RequestContext } from "../server/requestContext";
import {
  expectBoolean,
  expectNonEmptyString,
  expectNonNegativeInteger,
  expectNullableNonEmptyString,
  expectNullableNonNegativeInteger,
  expectRecord,
} from "../server/requestParsing";

type ChatRequestBody = Readonly<{
  messages: ReadonlyArray<ChatMessage>;
  model: string;
  timezone: string;
  deviceId: string;
  appVersion: string;
}>;

type ChatDiagnosticsStage =
  | "success"
  | "empty_response"
  | "response_not_ok"
  | "missing_reader"
  | "stream_error_event"
  | "fetch_throw"
  | "aborted";

type ChatDiagnosticsBody = Readonly<{
  clientRequestId: string;
  responseRequestId: string | null;
  model: string;
  stage: ChatDiagnosticsStage;
  statusCode: number | null;
  responseContentType: string | null;
  responseContentLength: string | null;
  responseContentEncoding: string | null;
  responseCacheControl: string | null;
  responseAmznRequestId: string | null;
  responseApiGatewayId: string | null;
  responseBodyMissing: boolean;
  chunkCount: number;
  bytesReceived: number;
  lineCount: number;
  nonEmptyLineCount: number;
  parseNullCount: number;
  deltaEventCount: number;
  toolCallEventCount: number;
  errorEventCount: number;
  doneEventCount: number;
  receivedContent: boolean;
  streamEnded: boolean;
  readerMissing: boolean;
  aborted: boolean;
  durationMs: number;
  bufferLength: number;
  errorName: string | null;
  lastEventType: string | null;
}>;

type LocalChatDiagnosticsBody = Readonly<{
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
  selectedModel: string;
  messageCount: number;
  appVersion: string;
  devicePlatform: string;
}>;

const CHAT_HEARTBEAT_INTERVAL_MS = 15_000;
const CHAT_STREAM_MAX_DURATION_MS = 15 * 60 * 1000;
const TIMER_SCHEDULER = {
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};

function parseChatMessages(value: unknown): ReadonlyArray<ChatMessage> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "messages must be a non-empty array");
  }

  return value as ReadonlyArray<ChatMessage>;
}

export function parseChatRequestBody(value: unknown): ChatRequestBody {
  const body = expectRecord(value);
  const model = expectNonEmptyString(body.model, "model");
  const timezone = expectNonEmptyString(body.timezone, "timezone");

  return {
    messages: parseChatMessages(body.messages),
    model,
    timezone,
    deviceId: expectNonEmptyString(body.deviceId, "deviceId"),
    appVersion: expectNonEmptyString(body.appVersion, "appVersion"),
  };
}

function parseLocalAssistantToolCall(value: unknown): LocalAssistantToolCall {
  const body = expectRecord(value);

  return {
    toolCallId: expectNonEmptyString(body.toolCallId, "toolCallId"),
    name: expectNonEmptyString(body.name, "name"),
    input: expectNonEmptyString(body.input, "input"),
  };
}

function parseLocalChatMessages(value: unknown): ReadonlyArray<LocalChatMessage> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "messages must be a non-empty array");
  }

  return value.map((messageValue, index) => {
    const body = expectRecord(messageValue);
    const role = expectNonEmptyString(body.role, `messages[${index}].role`);

    if (role === "user") {
      return {
        role: "user",
        content: expectNonEmptyString(body.content, `messages[${index}].content`),
      };
    }

    if (role === "assistant") {
      const toolCallsValue = body.toolCalls;
      const toolCalls = toolCallsValue === undefined
        ? []
        : Array.isArray(toolCallsValue)
        ? toolCallsValue.map(parseLocalAssistantToolCall)
        : (() => {
          throw new HttpError(400, `messages[${index}].toolCalls must be an array`);
        })();

      return {
        role: "assistant",
        content: typeof body.content === "string" ? body.content : "",
        toolCalls,
      };
    }

    if (role === "tool") {
      const outputValue = body.output;
      if (typeof outputValue !== "string") {
        throw new HttpError(400, `messages[${index}].output must be a string`);
      }

      return {
        role: "tool",
        toolCallId: expectNonEmptyString(body.toolCallId, `messages[${index}].toolCallId`),
        name: expectNonEmptyString(body.name, `messages[${index}].name`),
        output: outputValue,
      };
    }

    throw new HttpError(400, `messages[${index}].role is invalid`);
  });
}

export function parseLocalChatRequestBody(value: unknown): LocalChatRequestBody {
  const body = expectRecord(value);
  const model = expectNonEmptyString(body.model, "model");
  const timezone = expectNonEmptyString(body.timezone, "timezone");
  const devicePlatform = body.devicePlatform;

  return {
    messages: parseLocalChatMessages(body.messages),
    model,
    timezone,
    devicePlatform: devicePlatform === "web" ? "web" : "ios",
  };
}

/**
 * Restricts diagnostics logs to a known set of lifecycle stages so CloudWatch
 * queries stay stable and client payloads remain bounded.
 */
function parseChatDiagnosticsStage(value: unknown): ChatDiagnosticsStage {
  if (
    value === "success" ||
    value === "empty_response" ||
    value === "response_not_ok" ||
    value === "missing_reader" ||
    value === "stream_error_event" ||
    value === "fetch_throw" ||
    value === "aborted"
  ) {
    return value;
  }

  throw new HttpError(400, "stage is invalid");
}

/**
 * Accepts only scalar stream metadata from the browser and rejects any richer
 * payload shape that could accidentally include prompts, content, or files.
 */
export function parseChatDiagnosticsBody(value: unknown): ChatDiagnosticsBody {
  const body = expectRecord(value);

  return {
    clientRequestId: expectNonEmptyString(body.clientRequestId, "clientRequestId"),
    responseRequestId: expectNullableNonEmptyString(body.responseRequestId, "responseRequestId"),
    model: expectNonEmptyString(body.model, "model"),
    stage: parseChatDiagnosticsStage(body.stage),
    statusCode: expectNullableNonNegativeInteger(body.statusCode, "statusCode"),
    responseContentType: expectNullableNonEmptyString(body.responseContentType, "responseContentType"),
    responseContentLength: expectNullableNonEmptyString(body.responseContentLength, "responseContentLength"),
    responseContentEncoding: expectNullableNonEmptyString(body.responseContentEncoding, "responseContentEncoding"),
    responseCacheControl: expectNullableNonEmptyString(body.responseCacheControl, "responseCacheControl"),
    responseAmznRequestId: expectNullableNonEmptyString(body.responseAmznRequestId, "responseAmznRequestId"),
    responseApiGatewayId: expectNullableNonEmptyString(body.responseApiGatewayId, "responseApiGatewayId"),
    responseBodyMissing: expectBoolean(body.responseBodyMissing, "responseBodyMissing"),
    chunkCount: expectNonNegativeInteger(body.chunkCount, "chunkCount"),
    bytesReceived: expectNonNegativeInteger(body.bytesReceived, "bytesReceived"),
    lineCount: expectNonNegativeInteger(body.lineCount, "lineCount"),
    nonEmptyLineCount: expectNonNegativeInteger(body.nonEmptyLineCount, "nonEmptyLineCount"),
    parseNullCount: expectNonNegativeInteger(body.parseNullCount, "parseNullCount"),
    deltaEventCount: expectNonNegativeInteger(body.deltaEventCount, "deltaEventCount"),
    toolCallEventCount: expectNonNegativeInteger(body.toolCallEventCount, "toolCallEventCount"),
    errorEventCount: expectNonNegativeInteger(body.errorEventCount, "errorEventCount"),
    doneEventCount: expectNonNegativeInteger(body.doneEventCount, "doneEventCount"),
    receivedContent: expectBoolean(body.receivedContent, "receivedContent"),
    streamEnded: expectBoolean(body.streamEnded, "streamEnded"),
    readerMissing: expectBoolean(body.readerMissing, "readerMissing"),
    aborted: expectBoolean(body.aborted, "aborted"),
    durationMs: expectNonNegativeInteger(body.durationMs, "durationMs"),
    bufferLength: expectNonNegativeInteger(body.bufferLength, "bufferLength"),
    errorName: expectNullableNonEmptyString(body.errorName, "errorName"),
    lastEventType: expectNullableNonEmptyString(body.lastEventType, "lastEventType"),
  };
}

export function parseLocalChatDiagnosticsBody(value: unknown): LocalChatDiagnosticsBody {
  const body = expectRecord(value);

  return {
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
    selectedModel: expectNonEmptyString(body.selectedModel, "selectedModel"),
    messageCount: expectNonNegativeInteger(body.messageCount, "messageCount"),
    appVersion: expectNonEmptyString(body.appVersion, "appVersion"),
    devicePlatform: expectNonEmptyString(body.devicePlatform, "devicePlatform"),
  };
}

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Writes client-side stream diagnostics with the current selected workspace
 * context so browser failures can be correlated with backend request logs.
 */
export function logFrontendChatDiagnostics(
  requestContext: RequestContext,
  body: ChatDiagnosticsBody,
): void {
  const logRecord = {
    domain: "chat",
    vendor: "frontend",
    action: "frontend_diagnostics",
    workspaceId: requestContext.selectedWorkspaceId,
    transport: requestContext.transport,
    ...body,
  };

  if (body.stage === "success") {
    console.log(JSON.stringify(logRecord));
    return;
  }

  console.error(JSON.stringify(logRecord));
}

export function logLocalChatDiagnostics(
  requestContext: RequestContext,
  body: LocalChatDiagnosticsBody,
): void {
  console.error(JSON.stringify({
    domain: "chat",
    vendor: "local_client",
    action: "local_chat_diagnostics",
    workspaceId: requestContext.selectedWorkspaceId,
    transport: requestContext.transport,
    userId: requestContext.userId,
    ...body,
  }));
}

function logLocalChatTerminalError(
  requestId: string,
  code: string,
  stage: string,
  message: string,
): void {
  console.error(JSON.stringify({
    domain: "chat",
    vendor: "local_client",
    mode: "local_client",
    action: "terminal_error_emitted",
    requestId,
    code,
    stage,
    message,
  }));
}

/**
 * Keeps chat failures on the SSE transport so the frontend parser sees the
 * same envelope shape for both model and backend exceptions.
 */
export function createChatErrorResponse(message: string, requestId: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
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

export function createLocalChatErrorEvent(
  message: string,
  requestId: string,
  code: string,
  stage: string,
): Extract<LocalChatStreamEvent, { type: "error" }> {
  return {
    type: "error",
    message,
    code,
    stage,
    requestId,
  };
}

function createLocalChatErrorEventFromError(
  error: unknown,
  requestId: string,
  fallbackCode: string,
  fallbackStage: string,
): Extract<LocalChatStreamEvent, { type: "error" }> {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "stage" in error &&
    typeof error.code === "string" &&
    typeof error.stage === "string"
  ) {
    return createLocalChatErrorEvent(
      getInternalErrorMessage(error),
      requestId,
      error.code,
      error.stage,
    );
  }

  return createLocalChatErrorEvent(
    getInternalErrorMessage(error),
    requestId,
    fallbackCode,
    fallbackStage,
  );
}

export function createLocalChatErrorResponse(
  message: string,
  requestId: string,
  code: string,
  stage: string,
): Response {
  const errorEvent = createLocalChatErrorEvent(message, requestId, code, stage);
  logLocalChatTerminalError(requestId, code, stage, message);
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

export async function streamChatResponse(
  body: ChatRequestBody,
  workspaceId: string,
  requestId: string,
): Promise<Response> {
  const validModel = CHAT_MODELS.find((model) => model.id === body.model);
  if (validModel === undefined) {
    throw new HttpError(400, `Unknown model: ${body.model}`);
  }

  const envKey = validModel.vendor === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const apiKey = process.env[envKey];
  if (apiKey === undefined || apiKey === "") {
    throw new HttpError(500, `${envKey} environment variable is not set`);
  }

  const agentModule = validModel.vendor === "anthropic"
    ? await import("./anthropic/agent")
    : await import("./openai/agent");

  const stream = createChatSseStream({
    events: agentModule.streamAgentResponse({
      messages: body.messages,
      model: body.model,
      requestId,
      workspaceId,
      deviceId: body.deviceId,
      timezone: body.timezone,
    }),
    requestId,
    workspaceId,
    model: body.model,
    heartbeatIntervalMs: CHAT_HEARTBEAT_INTERVAL_MS,
    maxDurationMs: CHAT_STREAM_MAX_DURATION_MS,
    scheduler: TIMER_SCHEDULER,
    now: Date.now,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Chat-Request-Id": requestId,
    },
  });
}

export async function streamLocalChatResponse(
  body: LocalChatRequestBody,
  requestId: string,
): Promise<Response> {
  const validModel = CHAT_MODELS.find((model) => model.id === body.model);
  if (validModel === undefined) {
    throw new HttpError(400, `Unknown local chat model: ${body.model}`);
  }

  const apiKey = validModel.vendor === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new HttpError(500, `${validModel.vendor === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} environment variable is not set`);
  }

  const agentModule = validModel.vendor === "anthropic"
    ? await import("./anthropic/localAgent")
    : await import("./openai/localAgent");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of agentModule.streamLocalTurn({
          messages: body.messages,
          model: body.model,
          timezone: body.timezone,
          devicePlatform: body.devicePlatform,
          requestId,
        })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === "done" || event.type === "await_tool_results") {
            break;
          }
        }
      } catch (error) {
        const errorEvent = createLocalChatErrorEventFromError(
          error,
          requestId,
          "LOCAL_CHAT_STREAM_FAILED",
          "stream_local_turn",
        );
        logLocalChatTerminalError(requestId, errorEvent.code, errorEvent.stage, errorEvent.message);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent satisfies LocalChatStreamEvent)}\n\n`));
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
    },
  });
}

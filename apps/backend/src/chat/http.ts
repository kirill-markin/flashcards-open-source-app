import { HttpError } from "../errors";
import {
  classifyAIEndpointFailure,
  makeAIEndpointNotConfiguredError,
  type AIEndpointFailureClassification,
} from "./aiAvailabilityErrors";
import type {
  LocalChatUserContext,
  LocalContentPart,
  LocalChatMessage,
  LocalChatRequestBody,
  LocalChatStreamEvent,
} from "./localTypes";
import { CHAT_MODELS } from "./models";
import type { RequestContext } from "../server/requestContext";
import {
  expectNonEmptyString,
  expectNonNegativeInteger,
  expectNullableNonEmptyString,
  expectNullableNonNegativeInteger,
  expectRecord,
} from "../server/requestParsing";

type LocalChatDiagnosticsBody = Readonly<{
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
  selectedModel: string;
  messageCount: number;
  appVersion: string;
  devicePlatform: string;
}>;

type LocalChatLatencyDiagnosticsBody = Readonly<{
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

type ParsedLocalChatDiagnosticsBody =
  | LocalChatDiagnosticsBody
  | LocalChatLatencyDiagnosticsBody;

function parseLocalContentPart(
  value: unknown,
  context: string,
): LocalContentPart {
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

function parseLocalContentParts(
  value: unknown,
  context: string,
): ReadonlyArray<LocalContentPart> {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${context} must be an array`);
  }

  return value.map((partValue, index) => parseLocalContentPart(partValue, `${context}[${index}]`));
}

function parseLocalChatMessages(value: unknown): ReadonlyArray<LocalChatMessage> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "messages must be a non-empty array");
  }

  return value.map((messageValue, index) => {
    const body = expectRecord(messageValue);
    const role = expectNonEmptyString(body.role, `messages[${index}].role`);

    if (role === "user") {
      const content = parseLocalContentParts(body.content, `messages[${index}].content`);
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
        content: parseLocalContentParts(body.content, `messages[${index}].content`),
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

function parseLocalChatUserContext(value: unknown): LocalChatUserContext {
  const body = expectRecord(value);

  return {
    totalCards: expectNonNegativeInteger(body.totalCards, "userContext.totalCards"),
  };
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
    userContext: parseLocalChatUserContext(body.userContext),
  };
}

function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${context} must be a boolean`);
  }

  return value;
}

export function parseLocalChatDiagnosticsBody(value: unknown): ParsedLocalChatDiagnosticsBody {
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
    selectedModel: expectNonEmptyString(body.selectedModel, "selectedModel"),
    messageCount: expectNonNegativeInteger(body.messageCount, "messageCount"),
    appVersion: expectNonEmptyString(body.appVersion, "appVersion"),
    devicePlatform: expectNonEmptyString(body.devicePlatform, "devicePlatform"),
  };
}

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function logLocalChatDiagnostics(
  requestContext: RequestContext,
  body: ParsedLocalChatDiagnosticsBody,
): void {
  if (body.kind === "latency") {
    console.log(JSON.stringify({
      domain: "chat",
      vendor: "local_client",
      action: "local_chat_latency_diagnostics",
      workspaceId: requestContext.selectedWorkspaceId,
      transport: requestContext.transport,
      userId: requestContext.userId,
      ...body,
    }));
    return;
  }

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
  details?: AIEndpointFailureClassification,
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
    provider: details?.provider ?? "-",
    upstreamStatus: details?.upstreamStatus,
    upstreamRequestId: details?.upstreamRequestId ?? "-",
    upstreamMessage: details?.upstreamMessage ?? "-",
    originalMessage: details?.originalMessage ?? message,
  }));
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
  fallbackStage: string,
  provider: string | null,
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

  const normalizedFailure = classifyAIEndpointFailure("chat", error, provider);
  return createLocalChatErrorEvent(
    normalizedFailure.message,
    requestId,
    normalizedFailure.code,
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
    throw makeAIEndpointNotConfiguredError("chat");
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
          userContext: body.userContext,
          requestId,
        })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === "done" || event.type === "await_tool_results") {
            break;
          }
        }
      } catch (error) {
        const normalizedFailure = classifyAIEndpointFailure("chat", error, validModel.vendor);
        const errorEvent = createLocalChatErrorEventFromError(
          error,
          requestId,
          "stream_local_turn",
          validModel.vendor,
        );
        logLocalChatTerminalError(
          requestId,
          errorEvent.code,
          errorEvent.stage,
          errorEvent.message,
          typeof error === "object"
            && error !== null
            && "code" in error
            && "stage" in error
            && typeof error.code === "string"
            && typeof error.stage === "string"
            ? undefined
            : normalizedFailure,
        );
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

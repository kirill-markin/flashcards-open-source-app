import { HttpError } from "../errors";
import type {
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

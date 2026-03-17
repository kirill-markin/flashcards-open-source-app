import {
  ATTACHMENT_LIMIT_ERROR_MESSAGE,
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  sanitizeErrorText,
  toRequestBodySizeBytes,
} from "./chatHelpers";
import { buildChatResponseMetadata } from "./aiChatDiagnostics";
import { parseAIChatSSELine } from "./aiChatWire";
import type {
  AIChatDiagnosticsPayload,
  AIChatFailureDiagnosticsPayload,
  AIChatLatencyDiagnosticsPayload,
  AIChatLatencyResult,
  AIChatTurnRequestBody,
  AIChatWireMessage,
} from "../types";

export type AIChatRuntimeDependencies = Readonly<{
  createRequestBody: (
    messages: ReadonlyArray<AIChatWireMessage>,
    model: string,
    timezone: string,
    chatSessionId: string,
    codeInterpreterContainerId: string | null,
  ) => AIChatTurnRequestBody;
  streamChat: (body: AIChatTurnRequestBody, signal: AbortSignal) => Promise<Response>;
  reportDiagnostics: (payload: AIChatDiagnosticsPayload) => Promise<void>;
  generateRequestId: () => string;
  now: () => number;
  appVersion: string;
  devicePlatform: "web";
}>;

export type AIChatRuntimeCallbacks = Readonly<{
  onAssistantStarted: () => void;
  onAssistantText: (text: string) => void;
  onToolCallStarted: (name: string, toolCallId: string, input: string | null) => void;
  onToolCallCompleted: (toolCallId: string, input: string | null, output: string | null) => void;
  onAssistantCompleted: () => void;
  onAssistantError: (message: string) => void;
  onCodeInterpreterContainerIdChanged: (containerId: string) => void;
  onDiagnostics: (payload: AIChatDiagnosticsPayload) => void;
}>;

export type AIChatRuntimeRequest = Readonly<{
  initialMessages: ReadonlyArray<AIChatWireMessage>;
  selectedModel: string;
  timezone: string;
  chatSessionId: string;
  initialCodeInterpreterContainerId: string | null;
  tapStartedAt: number;
  signal: AbortSignal;
  callbacks: AIChatRuntimeCallbacks;
}>;

type AIChatLatencyTracker = Readonly<{
  tapStartedAt: number;
  requestStartAt: number | null;
  headersReceivedAt: number | null;
  firstSseLineAt: number | null;
  firstDeltaAt: number | null;
  firstEventType: string | null;
  didReceiveFirstSseLine: boolean;
  didReceiveFirstDelta: boolean;
}>;

function createLatencyTracker(tapStartedAt: number): AIChatLatencyTracker {
  return {
    tapStartedAt,
    requestStartAt: null,
    headersReceivedAt: null,
    firstSseLineAt: null,
    firstDeltaAt: null,
    firstEventType: null,
    didReceiveFirstSseLine: false,
    didReceiveFirstDelta: false,
  };
}

function durationBetween(start: number | null, end: number | null): number | null {
  if (start === null || end === null) {
    return null;
  }

  return Math.max(end - start, 0);
}

function buildFailurePayload(
  context: Readonly<{
    clientRequestId: string;
    backendRequestId: string | null;
    selectedModel: string;
    messageCount: number;
    appVersion: string;
    statusCode: number | null;
    eventType: string | null;
    stage: string;
    errorKind: string;
    decoderSummary: string | null;
  }>,
): AIChatFailureDiagnosticsPayload {
  return {
    kind: "failure",
    clientRequestId: context.clientRequestId,
    backendRequestId: context.backendRequestId,
    stage: context.stage,
    errorKind: context.errorKind,
    statusCode: context.statusCode,
    eventType: context.eventType,
    toolName: null,
    toolCallId: null,
    lineNumber: null,
    rawSnippet: null,
    decoderSummary: context.decoderSummary,
    continuationAttempt: null,
    continuationToolCallIds: [],
    selectedModel: context.selectedModel,
    messageCount: context.messageCount,
    appVersion: context.appVersion,
    devicePlatform: "web",
  };
}

function buildLatencyPayload(
  tracker: AIChatLatencyTracker,
  context: Readonly<{
    clientRequestId: string;
    backendRequestId: string | null;
    selectedModel: string;
    messageCount: number;
    appVersion: string;
    result: AIChatLatencyResult;
    statusCode: number | null;
    terminalAt: number;
  }>,
): AIChatLatencyDiagnosticsPayload {
  return {
    kind: "latency",
    clientRequestId: context.clientRequestId,
    backendRequestId: context.backendRequestId,
    selectedModel: context.selectedModel,
    messageCount: context.messageCount,
    appVersion: context.appVersion,
    devicePlatform: "web",
    result: context.result,
    statusCode: context.statusCode,
    firstEventType: tracker.firstEventType,
    didReceiveFirstSseLine: tracker.didReceiveFirstSseLine,
    didReceiveFirstDelta: tracker.didReceiveFirstDelta,
    tapToRequestStartMs: durationBetween(tracker.tapStartedAt, tracker.requestStartAt),
    requestStartToHeadersMs: durationBetween(tracker.requestStartAt, tracker.headersReceivedAt),
    headersToFirstSseLineMs: durationBetween(tracker.headersReceivedAt, tracker.firstSseLineAt),
    firstSseLineToFirstDeltaMs: durationBetween(tracker.firstSseLineAt, tracker.firstDeltaAt),
    requestStartToFirstDeltaMs: durationBetween(tracker.requestStartAt, tracker.firstDeltaAt),
    tapToFirstDeltaMs: durationBetween(tracker.tapStartedAt, tracker.firstDeltaAt),
    requestStartToTerminalMs: durationBetween(tracker.requestStartAt, context.terminalAt),
    tapToTerminalMs: durationBetween(tracker.tapStartedAt, context.terminalAt),
  };
}

function isAbortLikeError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted
    || (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError");
}

export async function runAIChatRuntime(
  dependencies: AIChatRuntimeDependencies,
  request: AIChatRuntimeRequest,
): Promise<void> {
  const {
    callbacks,
    chatSessionId,
    initialCodeInterpreterContainerId,
    initialMessages,
    selectedModel,
    signal,
    tapStartedAt,
    timezone,
  } = request;
  callbacks.onAssistantStarted();

  const clientRequestId = dependencies.generateRequestId();
  const requestBody = dependencies.createRequestBody(
    initialMessages,
    selectedModel,
    timezone,
    chatSessionId,
    initialCodeInterpreterContainerId,
  );
  if (toRequestBodySizeBytes(requestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
    callbacks.onAssistantError(ATTACHMENT_LIMIT_ERROR_MESSAGE);
    return;
  }

  const tracker = createLatencyTracker(tapStartedAt);
  const startedToolCalls = new Set<string>();
  let backendRequestId: string | null = null;
  let responseStatusCode: number | null = null;
  let lastEventType: string | null = null;

  const emitPayload = (payload: AIChatDiagnosticsPayload): void => {
    callbacks.onDiagnostics(payload);
    void dependencies.reportDiagnostics(payload);
  };

  try {
    const mutableTracker = { ...tracker };
    mutableTracker.requestStartAt = dependencies.now();
    const response = await dependencies.streamChat(requestBody, signal);
    responseStatusCode = response.status;

    const responseMetadata = buildChatResponseMetadata(response);
    backendRequestId = responseMetadata.responseRequestId;
    if (responseMetadata.responseCodeInterpreterContainerId !== null) {
      callbacks.onCodeInterpreterContainerIdChanged(responseMetadata.responseCodeInterpreterContainerId);
    }
    mutableTracker.headersReceivedAt = dependencies.now();

    if (!response.ok) {
      const message = `Error ${response.status}: ${sanitizeErrorText(response.status, await response.text())}`;
      callbacks.onAssistantError(message);
      emitPayload(buildFailurePayload({
        clientRequestId,
        backendRequestId,
        selectedModel,
        messageCount: requestBody.messages.length,
        appVersion: dependencies.appVersion,
        statusCode: response.status,
        eventType: null,
        stage: "response_not_ok",
        errorKind: "response_not_ok",
        decoderSummary: message,
      }));
      emitPayload(buildLatencyPayload(mutableTracker, {
        clientRequestId,
        backendRequestId,
        selectedModel,
        messageCount: requestBody.messages.length,
        appVersion: dependencies.appVersion,
        result: "response_not_ok",
        statusCode: response.status,
        terminalAt: dependencies.now(),
      }));
      return;
    }

    const reader = response.body?.getReader();
    if (reader === undefined) {
      callbacks.onAssistantError("The AI chat response stream is missing.");
      emitPayload(buildFailurePayload({
        clientRequestId,
        backendRequestId,
        selectedModel,
        messageCount: requestBody.messages.length,
        appVersion: dependencies.appVersion,
        statusCode: response.status,
        eventType: null,
        stage: "missing_reader",
        errorKind: "missing_reader",
        decoderSummary: "ReadableStream reader is unavailable",
      }));
      emitPayload(buildLatencyPayload(mutableTracker, {
        clientRequestId,
        backendRequestId,
        selectedModel,
        messageCount: requestBody.messages.length,
        appVersion: dependencies.appVersion,
        result: "missing_reader",
        statusCode: response.status,
        terminalAt: dependencies.now(),
      }));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine === "") {
          continue;
        }

        if (mutableTracker.firstSseLineAt === null) {
          mutableTracker.firstSseLineAt = dependencies.now();
        }
        mutableTracker.didReceiveFirstSseLine = true;

        const parsedEvent = parseAIChatSSELine(trimmedLine);
        if (parsedEvent === null) {
          callbacks.onAssistantError("The AI chat stream returned an invalid event.");
          emitPayload(buildFailurePayload({
            clientRequestId,
            backendRequestId,
            selectedModel,
            messageCount: requestBody.messages.length,
            appVersion: dependencies.appVersion,
            statusCode: response.status,
            eventType: null,
            stage: "decoding_event_json",
            errorKind: "invalid_sse_event_json",
            decoderSummary: trimmedLine,
          }));
          return;
        }

        if (mutableTracker.firstEventType === null) {
          mutableTracker.firstEventType = parsedEvent.type;
        }
        lastEventType = parsedEvent.type;

        if (parsedEvent.type === "delta") {
          if (mutableTracker.firstDeltaAt === null) {
            mutableTracker.firstDeltaAt = dependencies.now();
          }
          mutableTracker.didReceiveFirstDelta = true;
          callbacks.onAssistantText(parsedEvent.text);
          continue;
        }

        if (parsedEvent.type === "tool_call_request") {
          if (startedToolCalls.has(parsedEvent.toolCallId) === false) {
            startedToolCalls.add(parsedEvent.toolCallId);
            callbacks.onToolCallStarted(parsedEvent.name, parsedEvent.toolCallId, parsedEvent.input);
          }
          continue;
        }

        if (parsedEvent.type === "tool_call") {
          if (parsedEvent.status === "started") {
            if (startedToolCalls.has(parsedEvent.toolCallId) === false) {
              startedToolCalls.add(parsedEvent.toolCallId);
              callbacks.onToolCallStarted(parsedEvent.name, parsedEvent.toolCallId, parsedEvent.input);
            }
            continue;
          }

          callbacks.onToolCallCompleted(parsedEvent.toolCallId, parsedEvent.input, parsedEvent.output);
          continue;
        }

        if (parsedEvent.type === "repair_attempt") {
          continue;
        }

        if (parsedEvent.type === "done") {
          callbacks.onAssistantCompleted();
          emitPayload(buildLatencyPayload(mutableTracker, {
            clientRequestId,
            backendRequestId,
            selectedModel,
            messageCount: requestBody.messages.length,
            appVersion: dependencies.appVersion,
            result: "success",
            statusCode: response.status,
            terminalAt: dependencies.now(),
          }));
          return;
        }

        callbacks.onAssistantError(parsedEvent.message);
        emitPayload(buildFailurePayload({
          clientRequestId,
          backendRequestId,
          selectedModel,
          messageCount: requestBody.messages.length,
          appVersion: dependencies.appVersion,
          statusCode: response.status,
          eventType: parsedEvent.type,
          stage: parsedEvent.stage,
          errorKind: parsedEvent.code,
          decoderSummary: parsedEvent.message,
        }));
        emitPayload(buildLatencyPayload(mutableTracker, {
          clientRequestId,
          backendRequestId,
          selectedModel,
          messageCount: requestBody.messages.length,
          appVersion: dependencies.appVersion,
          result: mutableTracker.didReceiveFirstDelta ? "success" : "stream_error_before_first_delta",
          statusCode: response.status,
          terminalAt: dependencies.now(),
        }));
        return;
      }
    }

    callbacks.onAssistantCompleted();
    emitPayload(buildLatencyPayload(mutableTracker, {
      clientRequestId,
      backendRequestId,
      selectedModel,
      messageCount: requestBody.messages.length,
      appVersion: dependencies.appVersion,
      result: mutableTracker.didReceiveFirstDelta ? "success" : "empty_response",
      statusCode: responseStatusCode,
      terminalAt: dependencies.now(),
    }));
  } catch (error) {
    if (isAbortLikeError(error, signal)) {
      emitPayload(buildLatencyPayload(createLatencyTracker(tapStartedAt), {
        clientRequestId,
        backendRequestId,
        selectedModel,
        messageCount: requestBody.messages.length,
        appVersion: dependencies.appVersion,
        result: "cancelled_before_headers",
        statusCode: responseStatusCode,
        terminalAt: dependencies.now(),
      }));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    callbacks.onAssistantError(message);
    emitPayload(buildFailurePayload({
      clientRequestId,
      backendRequestId,
      selectedModel,
      messageCount: requestBody.messages.length,
      appVersion: dependencies.appVersion,
      statusCode: responseStatusCode,
      eventType: lastEventType,
      stage: "fetch_throw",
      errorKind: "fetch_throw",
      decoderSummary: message,
    }));
  }
}

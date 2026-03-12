/**
 * Browser-local chat runtime.
 *
 * This module owns the request/stream/tool loop for the web local-chat flow.
 * It keeps protocol state in a pure reducer and isolates side effects in the
 * runner so `ChatPanel` can stay focused on UI state and DOM events.
 */
import {
  ATTACHMENT_LIMIT_ERROR_MESSAGE,
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  sanitizeErrorText,
  toRequestBodySizeBytes,
} from "./chatHelpers";
import { buildChatResponseMetadata } from "./localChatDiagnostics";
import { parseLocalSSELine } from "./localRuntime";
import type { LocalToolCallRequest } from "./localToolExecutor";
import type {
  ContentPart,
  LocalChatDiagnosticsPayload,
  LocalChatFailureDiagnosticsPayload,
  LocalChatLatencyDiagnosticsPayload,
  LocalChatLatencyResult,
  LocalChatMessage,
  LocalChatRequestBody,
  LocalChatStreamEvent,
} from "../types";

export type LocalToolExecutionResult = Readonly<{
  output: string;
  didMutateAppState: boolean;
}>;

export type LocalChatRuntimeDiagnosticDetails = Readonly<{
  stage: string;
  errorKind: string;
  eventType: string | null;
  toolName: string | null;
  toolCallId: string | null;
  lineNumber: number | null;
  rawSnippet: string | null;
  decoderSummary: string | null;
}>;

export type LocalChatRuntimeToolCallRequestEvent = Extract<LocalChatStreamEvent, { type: "tool_call_request" }>;
type ToolCallPart = Extract<ContentPart, { type: "tool_call" }>;
export type LocalChatRuntimeReducerInput =
  | LocalChatStreamEvent
  | Readonly<{ type: "invalid_event_json" }>;

export type LocalChatRuntimeDependencies = Readonly<{
  createRequestBody: (
    messages: ReadonlyArray<LocalChatMessage>,
    model: string,
    timezone: string,
  ) => LocalChatRequestBody;
  streamChat: (body: LocalChatRequestBody, signal: AbortSignal) => Promise<Response>;
  executeTool: (toolCallRequest: LocalToolCallRequest) => Promise<LocalToolExecutionResult>;
  reportDiagnostics: (payload: LocalChatDiagnosticsPayload) => Promise<void>;
  generateRequestId: () => string;
  now: () => number;
  appVersion: string;
  devicePlatform: "web";
}>;

export type LocalChatRuntimeCallbacks = Readonly<{
  onAssistantStarted: () => void;
  onAssistantText: (text: string) => void;
  onToolCallStarted: (name: string, toolCallId: string, input: string | null) => void;
  onToolCallCompleted: (toolCallId: string, input: string | null, output: string | null) => void;
  onAssistantCompleted: () => void;
  onAssistantError: (message: string) => void;
  onDiagnostics: (payload: LocalChatDiagnosticsPayload) => void;
}>;

export type LocalChatRuntimeRequest = Readonly<{
  initialMessages: ReadonlyArray<LocalChatMessage>;
  selectedModel: string;
  timezone: string;
  tapStartedAt: number;
  signal: AbortSignal;
  callbacks: LocalChatRuntimeCallbacks;
}>;

export type LocalChatRuntimeState = Readonly<{
  assistantContentParts: ReadonlyArray<ContentPart>;
  pendingToolCalls: ReadonlyArray<LocalChatRuntimeToolCallRequestEvent>;
  receivedContent: boolean;
  shouldAwaitToolResults: boolean;
  lastEventType: string | null;
}>;

export type LocalChatRuntimeEffect =
  | Readonly<{ type: "append_assistant_text"; text: string }>
  | Readonly<{ type: "start_tool_call"; name: string; toolCallId: string; input: string | null }>
  | Readonly<{ type: "complete_tool_call"; toolCallId: string; input: string | null; output: string | null }>
  | Readonly<{ type: "fail_turn"; userMessage: string; details: LocalChatRuntimeDiagnosticDetails }>;

const LOCAL_TOOL_EXECUTION_ERROR_CODE = "LOCAL_TOOL_EXECUTION_FAILED";
const MAX_CONSECUTIVE_TOOL_EXECUTION_FAILURES = 3;

type LocalChatLatencyTracker = {
  tapStartedAt: number;
  requestStartAt: number | null;
  headersReceivedAt: number | null;
  firstSseLineAt: number | null;
  firstDeltaAt: number | null;
  firstEventType: string | null;
  didReceiveFirstSseLine: boolean;
  didReceiveFirstDelta: boolean;
  emitted: boolean;
};

function buildLocalToolExecutionErrorOutput(message: string): string {
  return JSON.stringify({
    ok: false,
    error: {
      code: LOCAL_TOOL_EXECUTION_ERROR_CODE,
      message,
    },
  });
}

function buildTerminalToolExecutionFailureMessage(message: string): string {
  return `Tool execution failed ${MAX_CONSECUTIVE_TOOL_EXECUTION_FAILURES} times in a row. Last error: ${message}`;
}

function buildLocalChatFailureDiagnosticsPayload(
  details: LocalChatRuntimeDiagnosticDetails,
  context: Readonly<{
    clientRequestId: string;
    backendRequestId: string | null;
    selectedModel: string;
    messageCount: number;
    appVersion: string;
    devicePlatform: "web";
  }>,
): LocalChatFailureDiagnosticsPayload {
  return {
    kind: "failure",
    clientRequestId: context.clientRequestId,
    backendRequestId: context.backendRequestId,
    stage: details.stage,
    errorKind: details.errorKind,
    statusCode: null,
    eventType: details.eventType,
    toolName: details.toolName,
    toolCallId: details.toolCallId,
    lineNumber: details.lineNumber,
    rawSnippet: details.rawSnippet,
    decoderSummary: details.decoderSummary,
    selectedModel: context.selectedModel,
    messageCount: context.messageCount,
    appVersion: context.appVersion,
    devicePlatform: context.devicePlatform,
  };
}

function createLocalChatLatencyTracker(tapStartedAt: number): LocalChatLatencyTracker {
  return {
    tapStartedAt,
    requestStartAt: null,
    headersReceivedAt: null,
    firstSseLineAt: null,
    firstDeltaAt: null,
    firstEventType: null,
    didReceiveFirstSseLine: false,
    didReceiveFirstDelta: false,
    emitted: false,
  };
}

function durationBetween(start: number | null, end: number | null): number | null {
  if (start === null || end === null) {
    return null;
  }

  return Math.max(end - start, 0);
}

function buildLocalChatLatencyDiagnosticsPayload(
  tracker: LocalChatLatencyTracker,
  context: Readonly<{
    clientRequestId: string;
    backendRequestId: string | null;
    selectedModel: string;
    messageCount: number;
    appVersion: string;
    devicePlatform: "web";
    result: LocalChatLatencyResult;
    statusCode: number | null;
    terminalAt: number;
  }>,
): LocalChatLatencyDiagnosticsPayload {
  return {
    kind: "latency",
    clientRequestId: context.clientRequestId,
    backendRequestId: context.backendRequestId,
    selectedModel: context.selectedModel,
    messageCount: context.messageCount,
    appVersion: context.appVersion,
    devicePlatform: context.devicePlatform,
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

/**
 * Returns the runtime state used for a single streamed assistant turn.
 */
export function createInitialLocalChatRuntimeState(): LocalChatRuntimeState {
  return {
    assistantContentParts: [],
    pendingToolCalls: [],
    receivedContent: false,
    shouldAwaitToolResults: false,
    lastEventType: null,
  };
}

/**
 * Applies a single parsed SSE event to the current runtime state and returns
 * the side effects that the runner must project onto UI state and diagnostics.
 */
export function reduceLocalChatRuntimeEvent(
  state: LocalChatRuntimeState,
  event: LocalChatRuntimeReducerInput,
): Readonly<{
  nextState: LocalChatRuntimeState;
  effects: ReadonlyArray<LocalChatRuntimeEffect>;
}> {
  if (event.type === "invalid_event_json") {
    return {
      nextState: state,
      effects: [{
        type: "fail_turn",
        userMessage: "The local chat stream returned an invalid event.",
        details: {
          stage: "decoding_event_json",
          errorKind: "invalid_sse_event_json",
          eventType: null,
          toolName: null,
          toolCallId: null,
          lineNumber: null,
          rawSnippet: null,
          decoderSummary: "The local SSE event JSON could not be decoded",
        },
      }],
    };
  }

  if (event.type === "delta") {
    return {
      nextState: {
        ...state,
        assistantContentParts: appendAssistantTextPart(state.assistantContentParts, event.text),
        receivedContent: true,
        lastEventType: event.type,
      },
      effects: [{ type: "append_assistant_text", text: event.text }],
    };
  }

  if (event.type === "repair_attempt") {
    return {
      nextState: {
        ...state,
        lastEventType: event.type,
      },
      effects: [],
    };
  }

  if (event.type === "tool_call") {
    const toolCallPart: ToolCallPart = {
      type: "tool_call",
      toolCallId: event.toolCallId,
      name: event.name,
      status: event.status,
      input: event.input,
      output: event.output,
    };
    const hasExistingToolCall = state.assistantContentParts.some(
      (contentPart) => contentPart.type === "tool_call" && contentPart.toolCallId === event.toolCallId,
    );
    const effects: Array<LocalChatRuntimeEffect> = [];

    if (event.status === "started" || hasExistingToolCall === false) {
      effects.push({
        type: "start_tool_call",
        name: event.name,
        toolCallId: event.toolCallId,
        input: event.input,
      });
    }

    if (event.status === "completed") {
      effects.push({
        type: "complete_tool_call",
        toolCallId: event.toolCallId,
        input: event.input,
        output: event.output,
      });
    }

    return {
      nextState: {
        ...state,
        assistantContentParts: upsertAssistantToolCallPart(state.assistantContentParts, toolCallPart),
        receivedContent: true,
        lastEventType: event.type,
      },
      effects,
    };
  }

  if (event.type === "tool_call_request") {
    const toolCallPart: ToolCallPart = {
      type: "tool_call",
      toolCallId: event.toolCallId,
      name: event.name,
      status: "started",
      input: event.input,
      output: null,
    };
    return {
      nextState: {
        ...state,
        assistantContentParts: upsertAssistantToolCallPart(state.assistantContentParts, toolCallPart),
        pendingToolCalls: [...state.pendingToolCalls, event],
        receivedContent: true,
        lastEventType: event.type,
      },
      effects: [{
        type: "start_tool_call",
        name: event.name,
        toolCallId: event.toolCallId,
        input: event.input,
      }],
    };
  }

  if (event.type === "await_tool_results") {
    return {
      nextState: {
        ...state,
        shouldAwaitToolResults: true,
        lastEventType: event.type,
      },
      effects: [],
    };
  }

  if (event.type === "done") {
    return {
      nextState: {
        ...state,
        lastEventType: event.type,
      },
      effects: [],
    };
  }

  return {
    nextState: {
      ...state,
      lastEventType: event.type,
    },
    effects: [{
      type: "fail_turn",
      userMessage: event.message,
      details: {
        stage: event.stage,
        errorKind: event.code,
        eventType: event.type,
        toolName: null,
        toolCallId: null,
        lineNumber: null,
        rawSnippet: null,
        decoderSummary: event.message,
      },
    }],
  };
}

/**
 * Runs the browser-local assistant turn, including repeated tool-request
 * cycles, without letting transport details leak into the React component.
 */
export async function runLocalChatRuntime(
  dependencies: LocalChatRuntimeDependencies,
  request: LocalChatRuntimeRequest,
): Promise<void> {
  const { callbacks, initialMessages, selectedModel, signal, tapStartedAt, timezone } = request;
  callbacks.onAssistantStarted();

  const clientRequestId = dependencies.generateRequestId();
  const wireMessages = [...initialMessages];
  let backendRequestId: string | null = null;
  let bufferLength = 0;
  let lastEventType: string | null = null;
  let consecutiveToolExecutionFailures = 0;
  let shouldTrackLatency = true;

  while (true) {
    const requestBody = dependencies.createRequestBody(wireMessages, selectedModel, timezone);
    if (toRequestBodySizeBytes(requestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      callbacks.onAssistantError(ATTACHMENT_LIMIT_ERROR_MESSAGE);
      return;
    }

    let response: Response | null = null;
    let responseStatusCode: number | null = null;
    let buffer = "";
    let lineNumber = 0;
    let state = createInitialLocalChatRuntimeState();
    const latencyTracker = shouldTrackLatency
      ? createLocalChatLatencyTracker(tapStartedAt)
      : null;
    shouldTrackLatency = false;

    const emitPayload = (payload: LocalChatDiagnosticsPayload): void => {
      callbacks.onDiagnostics(payload);
      void dependencies.reportDiagnostics(payload);
    };

    const emitDiagnostics = (details: LocalChatRuntimeDiagnosticDetails): void => {
      const responseMetadata = buildChatResponseMetadata(response);
      backendRequestId = responseMetadata.responseRequestId;
      responseStatusCode = responseMetadata.statusCode;
      bufferLength = buffer.length;
      lastEventType = details.eventType;

      const payload = {
        ...buildLocalChatFailureDiagnosticsPayload(details, {
          clientRequestId,
          backendRequestId: responseMetadata.responseRequestId,
          selectedModel,
          messageCount: requestBody.messages.length,
          appVersion: dependencies.appVersion,
          devicePlatform: dependencies.devicePlatform,
        }),
        statusCode: responseMetadata.statusCode,
      } satisfies LocalChatFailureDiagnosticsPayload;

      emitPayload(payload);
    };

    const emitLatency = (result: LocalChatLatencyResult): void => {
      if (latencyTracker === null || latencyTracker.emitted) {
        return;
      }

      latencyTracker.emitted = true;
      emitPayload(buildLocalChatLatencyDiagnosticsPayload(latencyTracker, {
        clientRequestId,
        backendRequestId,
        selectedModel,
        messageCount: requestBody.messages.length,
        appVersion: dependencies.appVersion,
        devicePlatform: dependencies.devicePlatform,
        result,
        statusCode: responseStatusCode,
        terminalAt: dependencies.now(),
      }));
    };

    try {
      if (latencyTracker !== null) {
        latencyTracker.requestStartAt = dependencies.now();
      }

      response = await dependencies.streamChat(requestBody, signal);
      responseStatusCode = response.status;
      backendRequestId = buildChatResponseMetadata(response).responseRequestId;
      if (latencyTracker !== null) {
        latencyTracker.headersReceivedAt = dependencies.now();
      }

      if (!response.ok) {
        const message = `Error ${response.status}: ${sanitizeErrorText(response.status, await response.text())}`;
        callbacks.onAssistantError(message);
        emitDiagnostics({
          stage: "response_not_ok",
          errorKind: "response_not_ok",
          eventType: null,
          toolName: null,
          toolCallId: null,
          lineNumber: null,
          rawSnippet: null,
          decoderSummary: message,
        });
        emitLatency("response_not_ok");
        return;
      }

      const reader = response.body?.getReader();
      if (reader === undefined) {
        callbacks.onAssistantError("The local chat response stream is missing.");
        emitDiagnostics({
          stage: "missing_reader",
          errorKind: "missing_reader",
          eventType: null,
          toolName: null,
          toolCallId: null,
          lineNumber: null,
          rawSnippet: null,
          decoderSummary: "ReadableStream reader is unavailable",
        });
        emitLatency("missing_reader");
        return;
      }

      const decoder = new TextDecoder();

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
          if (latencyTracker !== null && trimmedLine !== "") {
            latencyTracker.didReceiveFirstSseLine = true;
            if (latencyTracker.firstSseLineAt === null) {
              latencyTracker.firstSseLineAt = dependencies.now();
            }
            const parsedLatencyEvent = parseLocalSSELine(trimmedLine);
            if (parsedLatencyEvent !== null) {
              if (latencyTracker.firstEventType === null) {
                latencyTracker.firstEventType = parsedLatencyEvent.type;
              }
              if (parsedLatencyEvent.type === "delta" && latencyTracker.firstDeltaAt === null) {
                latencyTracker.firstDeltaAt = dependencies.now();
                latencyTracker.didReceiveFirstDelta = true;
              }
            }
          }

          const turnShouldStop = applyStreamLine({
            line,
            lineNumber,
            state,
            callbacks,
            emitDiagnostics,
          });
          lineNumber = turnShouldStop.nextLineNumber;
          state = turnShouldStop.nextState;
          lastEventType = state.lastEventType;

          if (turnShouldStop.shouldStop) {
            emitLatency(latencyTracker?.didReceiveFirstDelta === true ? "success" : "stream_error_before_first_delta");
            return;
          }
        }
      }

      buffer += decoder.decode();
      if (buffer !== "") {
        const lines = buffer.split("\n");
        buffer = "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (latencyTracker !== null && trimmedLine !== "") {
            latencyTracker.didReceiveFirstSseLine = true;
            if (latencyTracker.firstSseLineAt === null) {
              latencyTracker.firstSseLineAt = dependencies.now();
            }
            const parsedLatencyEvent = parseLocalSSELine(trimmedLine);
            if (parsedLatencyEvent !== null) {
              if (latencyTracker.firstEventType === null) {
                latencyTracker.firstEventType = parsedLatencyEvent.type;
              }
              if (parsedLatencyEvent.type === "delta" && latencyTracker.firstDeltaAt === null) {
                latencyTracker.firstDeltaAt = dependencies.now();
                latencyTracker.didReceiveFirstDelta = true;
              }
            }
          }

          const turnShouldStop = applyStreamLine({
            line,
            lineNumber,
            state,
            callbacks,
            emitDiagnostics,
          });
          lineNumber = turnShouldStop.nextLineNumber;
          state = turnShouldStop.nextState;
          lastEventType = state.lastEventType;

          if (turnShouldStop.shouldStop) {
            emitLatency(latencyTracker?.didReceiveFirstDelta === true ? "success" : "stream_error_before_first_delta");
            return;
          }
        }
      }

      if (state.shouldAwaitToolResults) {
        if (state.pendingToolCalls.length === 0) {
          callbacks.onAssistantError("The local chat runtime requested tool results without any tool call.");
          emitDiagnostics({
            stage: "await_tool_results",
            errorKind: "missing_tool_call_request",
            eventType: "await_tool_results",
            toolName: null,
            toolCallId: null,
            lineNumber: null,
            rawSnippet: null,
            decoderSummary: "await_tool_results without tool_call_request",
          });
          emitLatency(latencyTracker?.didReceiveFirstDelta === true ? "success" : "stream_error_before_first_delta");
          return;
        }

        wireMessages.push({
          role: "assistant",
          content: state.assistantContentParts,
        });

        let terminalToolExecutionMessage: string | null = null;
        for (const toolCall of state.pendingToolCalls) {
          try {
            const result = await dependencies.executeTool({
              toolCallId: toolCall.toolCallId,
              name: toolCall.name,
              input: toolCall.input,
            });
            consecutiveToolExecutionFailures = 0;
            callbacks.onToolCallCompleted(toolCall.toolCallId, toolCall.input, result.output);
            wireMessages.push({
              role: "tool",
              toolCallId: toolCall.toolCallId,
              name: toolCall.name,
              output: result.output,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errorOutput = buildLocalToolExecutionErrorOutput(message);
            consecutiveToolExecutionFailures += 1;
            callbacks.onToolCallCompleted(toolCall.toolCallId, toolCall.input, errorOutput);
            wireMessages.push({
              role: "tool",
              toolCallId: toolCall.toolCallId,
              name: toolCall.name,
              output: errorOutput,
            });
            emitDiagnostics({
              stage: "tool_execution",
              errorKind: "tool_execution_failed",
              eventType: "tool_call_request",
              toolName: toolCall.name,
              toolCallId: toolCall.toolCallId,
              lineNumber: null,
              rawSnippet: toolCall.input,
              decoderSummary: message,
            });

            if (consecutiveToolExecutionFailures >= MAX_CONSECUTIVE_TOOL_EXECUTION_FAILURES) {
              terminalToolExecutionMessage = buildTerminalToolExecutionFailureMessage(message);
              break;
            }
          }
        }

        if (terminalToolExecutionMessage !== null) {
          callbacks.onAssistantError(terminalToolExecutionMessage);
          emitLatency(latencyTracker?.didReceiveFirstDelta === true ? "success" : "stream_error_before_first_delta");
          return;
        }

        emitLatency("success");
        continue;
      }

      if (state.receivedContent) {
        callbacks.onAssistantCompleted();
        emitPayload({
          kind: "failure",
          clientRequestId,
          backendRequestId,
          stage: "success",
          errorKind: "success",
          statusCode: responseStatusCode,
          eventType: lastEventType,
          toolName: null,
          toolCallId: null,
          lineNumber: null,
          rawSnippet: null,
          decoderSummary: null,
          selectedModel,
          messageCount: requestBody.messages.length,
          appVersion: dependencies.appVersion,
          devicePlatform: dependencies.devicePlatform,
        });
        emitLatency("success");
        return;
      }

      callbacks.onAssistantError("The assistant returned an empty response.");
      emitPayload({
        kind: "failure",
        clientRequestId,
        backendRequestId,
        stage: "empty_response",
        errorKind: "empty_response",
        statusCode: responseStatusCode,
        eventType: lastEventType,
        toolName: null,
        toolCallId: null,
        lineNumber: null,
        rawSnippet: null,
        decoderSummary: `Empty local response after ${bufferLength} buffered chars`,
        selectedModel,
        messageCount: requestBody.messages.length,
        appVersion: dependencies.appVersion,
        devicePlatform: dependencies.devicePlatform,
      });
      emitLatency("empty_response");
      return;
    } catch (error) {
      if (latencyTracker !== null) {
        const latencyResult = latencyTracker.didReceiveFirstDelta
          ? "success"
          : isAbortLikeError(error, signal)
            ? response === null
              ? "cancelled_before_headers"
              : latencyTracker.didReceiveFirstSseLine
                ? "cancelled_before_first_delta"
                : "cancelled_before_first_sse_line"
            : "stream_error_before_first_delta";
        emitLatency(latencyResult);
      }

      throw error;
    }
  }
}

/**
 * Preserves the assistant text stream exactly as received while coalescing
 * adjacent text content into one logical transcript segment.
 */
function appendAssistantTextPart(
  content: ReadonlyArray<ContentPart>,
  text: string,
): ReadonlyArray<ContentPart> {
  const lastPart = content[content.length - 1];
  if (lastPart !== undefined && lastPart.type === "text") {
    return [...content.slice(0, -1), { ...lastPart, text: lastPart.text + text }];
  }

  return [...content, { type: "text", text }];
}

/**
 * Replaces or inserts a tool-call part by `toolCallId` so completed tool
 * events can update the visible assistant transcript in place.
 */
function upsertAssistantToolCallPart(
  content: ReadonlyArray<ContentPart>,
  part: ToolCallPart,
): ReadonlyArray<ContentPart> {
  const existingIndex = content.findIndex(
    (contentPart) => contentPart.type === "tool_call" && contentPart.toolCallId === part.toolCallId,
  );
  if (existingIndex >= 0) {
    return content.map((contentPart, index) => (index === existingIndex ? part : contentPart));
  }

  return [...content, part];
}

type ApplyStreamLineParams = Readonly<{
  line: string;
  lineNumber: number;
  state: LocalChatRuntimeState;
  callbacks: LocalChatRuntimeCallbacks;
  emitDiagnostics: (details: LocalChatRuntimeDiagnosticDetails) => void;
}>;

/**
 * Parses one SSE line, applies the reducer transition, and projects the
 * resulting effects onto chat-history callbacks.
 */
function applyStreamLine(
  params: ApplyStreamLineParams,
): Readonly<{
  nextLineNumber: number;
  nextState: LocalChatRuntimeState;
  shouldStop: boolean;
}> {
  const { callbacks, emitDiagnostics, line, state } = params;
  const nextLineNumber = params.lineNumber + 1;
  const trimmedLine = line.trim();

  if (trimmedLine === "") {
    return {
      nextLineNumber,
      nextState: state,
      shouldStop: false,
    };
  }

  const parsedEvent = parseLocalSSELine(trimmedLine);
  const transition = reduceLocalChatRuntimeEvent(
    state,
    parsedEvent === null ? { type: "invalid_event_json" } : parsedEvent,
  );

  for (const effect of transition.effects) {
    if (effect.type === "append_assistant_text") {
      callbacks.onAssistantText(effect.text);
      continue;
    }

    if (effect.type === "start_tool_call") {
      callbacks.onToolCallStarted(effect.name, effect.toolCallId, effect.input);
      continue;
    }

    if (effect.type === "complete_tool_call") {
      callbacks.onToolCallCompleted(effect.toolCallId, effect.input, effect.output);
      continue;
    }

    callbacks.onAssistantError(effect.userMessage);
    emitDiagnostics({
      ...effect.details,
      lineNumber: nextLineNumber,
      rawSnippet: trimmedLine,
    });
    return {
      nextLineNumber,
      nextState: transition.nextState,
      shouldStop: true,
    };
  }

  return {
    nextLineNumber,
    nextState: transition.nextState,
    shouldStop: false,
  };
}

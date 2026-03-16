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
import { LOCAL_TOOL_NAMES, type LocalToolCallRequest } from "./localToolExecutor";
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
  continuationAttempt: number | null;
  continuationToolCallIds: ReadonlyArray<string>;
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

type LocalChatTurnPhase =
  | "streaming"
  | "awaiting_tool_results"
  | "completed"
  | "failed"
  | "aborted";

type LocalChatTurnContext = Readonly<{
  assistantTurnId: string;
  continuationAttempt: number;
  pendingToolCallIds: ReadonlyArray<string>;
  completedToolCallIds: ReadonlyArray<string>;
  phase: LocalChatTurnPhase;
  terminalStatus: "none" | "completed" | "failed" | "aborted";
}>;

type LocalChatRequestPreflight = Readonly<{
  continuationAttempt: number;
  toolCallIds: ReadonlyArray<string>;
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

const LOCAL_TOOL_NAME_SET = new Set<string>(LOCAL_TOOL_NAMES);

function isLocalToolName(name: string): name is (typeof LOCAL_TOOL_NAMES)[number] {
  return LOCAL_TOOL_NAME_SET.has(name);
}

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
    continuationAttempt: details.continuationAttempt,
    continuationToolCallIds: details.continuationToolCallIds,
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

function createInitialLocalChatTurnContext(assistantTurnId: string): LocalChatTurnContext {
  return {
    assistantTurnId,
    continuationAttempt: 0,
    pendingToolCallIds: [],
    completedToolCallIds: [],
    phase: "streaming",
    terminalStatus: "none",
  };
}

function markTurnAwaitingToolResults(
  turnContext: LocalChatTurnContext,
  pendingToolCallIds: ReadonlyArray<string>,
): LocalChatTurnContext {
  return {
    ...turnContext,
    pendingToolCallIds,
    completedToolCallIds: [],
    phase: "awaiting_tool_results",
  };
}

function recordCompletedToolCall(
  turnContext: LocalChatTurnContext,
  toolCallId: string,
): LocalChatTurnContext {
  if (turnContext.completedToolCallIds.includes(toolCallId)) {
    return turnContext;
  }

  return {
    ...turnContext,
    completedToolCallIds: [...turnContext.completedToolCallIds, toolCallId],
  };
}

function beginNextContinuationAttempt(
  turnContext: LocalChatTurnContext,
): LocalChatTurnContext {
  return {
    ...turnContext,
    continuationAttempt: turnContext.continuationAttempt + 1,
    pendingToolCallIds: [],
    completedToolCallIds: [],
    phase: "streaming",
  };
}

function activeTurnToolCallIds(
  turnContext: LocalChatTurnContext,
): ReadonlyArray<string> {
  return turnContext.pendingToolCallIds.length === 0
    ? turnContext.completedToolCallIds
    : turnContext.pendingToolCallIds;
}

function markTerminalTurn(
  turnContext: LocalChatTurnContext,
  terminalStatus: "completed" | "failed" | "aborted",
): LocalChatTurnContext {
  return {
    ...turnContext,
    phase: terminalStatus,
    terminalStatus,
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

function validateLocalChatWireMessages(
  messages: ReadonlyArray<LocalChatMessage>,
): LocalChatRequestPreflight {
  let continuationAttempt = 0;
  const toolCallIds = new Set<string>();
  const seenToolOutputIds = new Set<string>();
  let expectedToolOutputIds: Set<string> | null = null;

  for (const message of messages) {
    if (message.role === "assistant") {
      if (expectedToolOutputIds !== null && expectedToolOutputIds.size > 0) {
        throw new Error("Assistant continuation history is missing a tool output before the next message.");
      }

      const assistantToolCallIds = new Set<string>();
      const completedLocalToolCallIds: Array<string> = [];
      for (const part of message.content) {
        if (part.type !== "tool_call" || isLocalToolName(part.name) === false) {
          continue;
        }

        if (assistantToolCallIds.has(part.toolCallId)) {
          throw new Error("Assistant continuation history contains a duplicate tool call id.");
        }

        assistantToolCallIds.add(part.toolCallId);
        toolCallIds.add(part.toolCallId);

        if (part.status !== "completed" || part.output === null) {
          throw new Error("Assistant continuation history contains a local tool call without a completed output.");
        }

        completedLocalToolCallIds.push(part.toolCallId);
      }

      if (completedLocalToolCallIds.length > 0) {
        continuationAttempt += 1;
        expectedToolOutputIds = new Set(completedLocalToolCallIds);
      }

      continue;
    }

    if (message.role === "tool") {
      toolCallIds.add(message.toolCallId);

      if (seenToolOutputIds.has(message.toolCallId)) {
        throw new Error("Assistant continuation history contains a duplicate tool output.");
      }

      if (expectedToolOutputIds === null || !expectedToolOutputIds.has(message.toolCallId)) {
        throw new Error("Assistant continuation history contains an unexpected tool output.");
      }

      seenToolOutputIds.add(message.toolCallId);
      expectedToolOutputIds.delete(message.toolCallId);
      if (expectedToolOutputIds.size === 0) {
        expectedToolOutputIds = null;
      }

      continue;
    }

    if (expectedToolOutputIds !== null && expectedToolOutputIds.size > 0) {
      throw new Error("Assistant continuation history is missing a tool output before the next user message.");
    }
  }

  if (expectedToolOutputIds !== null && expectedToolOutputIds.size > 0) {
    throw new Error("Assistant continuation history ended before all tool outputs were added.");
  }

  return {
    continuationAttempt,
    toolCallIds: [...toolCallIds],
  };
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
          continuationAttempt: null,
          continuationToolCallIds: [],
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
        continuationAttempt: null,
        continuationToolCallIds: [],
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
  let turnContext = createInitialLocalChatTurnContext(clientRequestId);
  let backendRequestId: string | null = null;
  let bufferLength = 0;
  let lastEventType: string | null = null;
  let consecutiveToolExecutionFailures = 0;
  let shouldTrackLatency = true;

  while (true) {
    try {
      if (turnContext.terminalStatus !== "none") {
        throw new Error(`Assistant turn is already terminal: ${turnContext.terminalStatus}`);
      }

      validateLocalChatWireMessages(wireMessages);
      if (turnContext.phase === "awaiting_tool_results") {
        throw new Error("Assistant continuation requested a new stream before local tool results were appended.");
      }
    } catch (error) {
      callbacks.onAssistantError("The local chat session became inconsistent. Please try again.");
      emitLocalPreflightDiagnostics({
        callbacks,
        dependencies,
        clientRequestId,
        backendRequestId,
        selectedModel,
        messageCount: wireMessages.length,
        error,
        continuationAttempt: turnContext.continuationAttempt,
        continuationToolCallIds: activeTurnToolCallIds(turnContext),
      });
      return;
    }

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
          continuationAttempt: turnContext.continuationAttempt,
          continuationToolCallIds: activeTurnToolCallIds(turnContext),
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
          continuationAttempt: turnContext.continuationAttempt,
          continuationToolCallIds: activeTurnToolCallIds(turnContext),
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
          turnContext = markTerminalTurn(turnContext, "failed");
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
            continuationAttempt: turnContext.continuationAttempt,
            continuationToolCallIds: [],
          });
          emitLatency(latencyTracker?.didReceiveFirstDelta === true ? "success" : "stream_error_before_first_delta");
          return;
        }

        turnContext = markTurnAwaitingToolResults(
          turnContext,
          state.pendingToolCalls.map((toolCall) => toolCall.toolCallId),
        );

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
            const updatedWireMessages = completeAssistantToolCallInWireMessages(
              wireMessages,
              toolCall.toolCallId,
              result.output,
            );
            wireMessages.splice(0, wireMessages.length, ...updatedWireMessages);
            wireMessages.push({
              role: "tool",
              toolCallId: toolCall.toolCallId,
              name: toolCall.name,
              output: result.output,
            });
            turnContext = recordCompletedToolCall(turnContext, toolCall.toolCallId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errorOutput = buildLocalToolExecutionErrorOutput(message);
            consecutiveToolExecutionFailures += 1;
            callbacks.onToolCallCompleted(toolCall.toolCallId, toolCall.input, errorOutput);
            const updatedWireMessages = completeAssistantToolCallInWireMessages(
              wireMessages,
              toolCall.toolCallId,
              errorOutput,
            );
            wireMessages.splice(0, wireMessages.length, ...updatedWireMessages);
            wireMessages.push({
              role: "tool",
              toolCallId: toolCall.toolCallId,
              name: toolCall.name,
              output: errorOutput,
            });
            turnContext = recordCompletedToolCall(turnContext, toolCall.toolCallId);
            emitDiagnostics({
              stage: "tool_execution",
              errorKind: "tool_execution_failed",
              eventType: "tool_call_request",
              toolName: toolCall.name,
              toolCallId: toolCall.toolCallId,
              lineNumber: null,
              rawSnippet: toolCall.input,
              decoderSummary: message,
              continuationAttempt: turnContext.continuationAttempt,
              continuationToolCallIds: turnContext.pendingToolCallIds,
            });

            if (consecutiveToolExecutionFailures >= MAX_CONSECUTIVE_TOOL_EXECUTION_FAILURES) {
              terminalToolExecutionMessage = buildTerminalToolExecutionFailureMessage(message);
              break;
            }
          }
        }

        if (terminalToolExecutionMessage !== null) {
          turnContext = markTerminalTurn(turnContext, "failed");
          callbacks.onAssistantError(terminalToolExecutionMessage);
          emitLatency(latencyTracker?.didReceiveFirstDelta === true ? "success" : "stream_error_before_first_delta");
          return;
        }

        turnContext = beginNextContinuationAttempt(turnContext);
        emitLatency("success");
        continue;
      }

      if (state.receivedContent) {
        turnContext = markTerminalTurn(turnContext, "completed");
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
          continuationAttempt: turnContext.continuationAttempt,
          continuationToolCallIds: activeTurnToolCallIds(turnContext),
          selectedModel,
          messageCount: requestBody.messages.length,
          appVersion: dependencies.appVersion,
          devicePlatform: dependencies.devicePlatform,
        });
        emitLatency("success");
        return;
      }

      turnContext = markTerminalTurn(turnContext, "failed");
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
        continuationAttempt: turnContext.continuationAttempt,
        continuationToolCallIds: activeTurnToolCallIds(turnContext),
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

      if (isAbortLikeError(error, signal)) {
        turnContext = markTerminalTurn(turnContext, "aborted");
      } else {
        turnContext = markTerminalTurn(turnContext, "failed");
      }

      throw error;
    }
  }
}

function emitLocalPreflightDiagnostics(
  params: Readonly<{
    callbacks: LocalChatRuntimeCallbacks;
    dependencies: LocalChatRuntimeDependencies;
    clientRequestId: string;
    backendRequestId: string | null;
    selectedModel: string;
    messageCount: number;
    error: unknown;
    continuationAttempt: number;
    continuationToolCallIds: ReadonlyArray<string>;
  }>,
): void {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  const payload: LocalChatFailureDiagnosticsPayload = {
    kind: "failure",
    clientRequestId: params.clientRequestId,
    backendRequestId: params.backendRequestId,
    stage: "request_preflight",
    errorKind: "invalid_stream_contract",
    statusCode: null,
    eventType: null,
    toolName: null,
    toolCallId: null,
    lineNumber: null,
    rawSnippet: null,
    decoderSummary: message,
    continuationAttempt: params.continuationAttempt,
    continuationToolCallIds: params.continuationToolCallIds,
    selectedModel: params.selectedModel,
    messageCount: params.messageCount,
    appVersion: params.dependencies.appVersion,
    devicePlatform: params.dependencies.devicePlatform,
  };
  params.callbacks.onDiagnostics(payload);
  void params.dependencies.reportDiagnostics(payload);
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

function completeAssistantToolCallInWireMessages(
  messages: ReadonlyArray<LocalChatMessage>,
  toolCallId: string,
  output: string,
): ReadonlyArray<LocalChatMessage> {
  if (messages.length === 0) {
    return messages;
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage === undefined || lastMessage.role !== "assistant") {
    return messages;
  }

  const updatedContent = lastMessage.content.map((part) => {
    if (part.type !== "tool_call" || part.toolCallId !== toolCallId) {
      return part;
    }

    return {
      ...part,
      status: "completed" as const,
      output,
    };
  });

  return [
    ...messages.slice(0, -1),
    {
      role: "assistant",
      content: updatedContent,
    },
  ];
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

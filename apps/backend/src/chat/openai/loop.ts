/**
 * OpenAI model loop for backend-owned chat runs.
 * The loop replays persisted history, streams provider events, executes tool calls, and returns replay items for the next recovery point.
 */
import type OpenAI from "openai";
import type { LangfuseObservation } from "@langfuse/tracing";
import {
  applyFunctionCallArgumentsDelta,
  applyFunctionCallArgumentsDone,
  applyToolCallOutput,
  applyToolCallStarted,
  createToolCallStateMap,
  type FunctionToolCallRawItem,
  type ToolCallPosition,
} from "./toolCalls";
import { buildChatCompletionInput } from "./input";
import { getObservedOpenAIClient } from "./client";
import { runOneToolCall as runObservedToolCall } from "./toolExecutor";
import {
  toOpenAIResponseInputItem,
  toStoredOpenAIReplayItem,
  type ServerChatMessage,
  type StoredOpenAIReplayItem,
  type StoredOpenAIReplayMessage,
} from "./replayItems";
import {
  OPENAI_CHAT_TOOLS,
  type ExecutedChatToolCall,
} from "./tools";
import { buildOpenAISafetyIdentifier } from "./safetyIdentifier";
import type { ChatStreamEvent, ContentPart } from "../types";
import {
  CHAT_MODEL_ID,
  CHAT_MODEL_REASONING_EFFORT,
  CHAT_MODEL_REASONING_SUMMARY,
} from "../config";

export const CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS = 30;
const MAX_REASONING_ITEMS = 8;
const TOOL_LIMIT_FALLBACK_ITEM_ID = "tool-limit-summary";

type OpenAILoopDependencies = Readonly<{
  buildChatCompletionInput: typeof buildChatCompletionInput;
  getObservedOpenAIClient: typeof getObservedOpenAIClient;
  runOneToolCall: (params: Readonly<{
    item: OpenAI.Responses.ResponseFunctionToolCall;
    userId: string;
    workspaceId: string;
    rootObservation: LangfuseObservation | null;
  }>) => Promise<ExecutedChatToolCall>;
}>;

export type OpenAILoopCompletion = Readonly<{
  openaiItems: ReadonlyArray<StoredOpenAIReplayItem>;
  terminationReason: "completed" | "stopped_before_next_step";
}>;

export type OpenAILoopEventSink = (
  event: ChatStreamEvent,
) => Promise<void> | void;

type ParsedFunctionToolCall = OpenAI.Responses.ResponseFunctionToolCall & Readonly<{
  parsed_arguments?: unknown;
}>;

type ResponseStreamWithOptionalFinalResponse = AsyncIterable<OpenAI.Responses.ResponseStreamEvent> & Readonly<{
  finalResponse?: () => Promise<OpenAI.Responses.Response>;
}>;

type OpenAIResponsesRequest = Readonly<{
  model: typeof CHAT_MODEL_ID;
  store: false;
  include: ["reasoning.encrypted_content"];
  tools: Array<OpenAI.Responses.Tool>;
  input: Array<OpenAI.Responses.ResponseInputItem>;
  reasoning: Readonly<{
    effort: typeof CHAT_MODEL_REASONING_EFFORT;
    summary: typeof CHAT_MODEL_REASONING_SUMMARY;
  }>;
  prompt_cache_key: string;
  safety_identifier: string;
}>;

type BuildOpenAIResponsesRequestParams = Readonly<{
  baseInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>;
  continuationItems: ReadonlyArray<StoredOpenAIReplayItem>;
  userId: string;
  sessionId: string;
  extraInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>;
  tools: ReadonlyArray<OpenAI.Responses.Tool>;
}>;

export type StartOpenAILoopParams = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  timezone: string;
  localMessages: ReadonlyArray<ServerChatMessage>;
  turnInput: ReadonlyArray<ContentPart>;
  rootObservation: LangfuseObservation | null;
  signal?: AbortSignal;
  onExecutionPhaseChanged?: (phase: "idle" | "model" | "tool") => void;
  shouldStopBeforeNextStep?: () => boolean;
}>;

type ModelCallResult = Readonly<{
  finalResponse: OpenAI.Responses.Response;
  functionCalls: ReadonlyArray<ParsedFunctionToolCall>;
  replayItems: ReadonlyArray<StoredOpenAIReplayItem>;
  streamedText: string;
  toolStates: ReturnType<typeof createToolCallStateMap>;
}>;

function createToolCallPosition(
  event: OpenAI.Responses.ResponseOutputItemAddedEvent,
  responseIndex: number,
): ToolCallPosition {
  return {
    itemId: typeof event.item.id === "string" && event.item.id.length > 0
      ? event.item.id
      : `response-output-${String(event.output_index)}`,
    responseIndex,
    outputIndex: event.output_index,
    sequenceNumber: event.sequence_number,
  };
}

function toFunctionToolCallRawItem(
  item: OpenAI.Responses.ResponseFunctionToolCall,
): FunctionToolCallRawItem {
  return {
    type: "function_call",
    callId: item.call_id,
    id: item.id,
    name: item.name,
    arguments: item.arguments,
    status: item.status ?? undefined,
  };
}

function toFunctionCallOutputInputItem(
  callId: string,
  output: string,
): OpenAI.Responses.ResponseInputItem.FunctionCallOutput {
  return {
    type: "function_call_output",
    call_id: callId,
    output,
  };
}

function isReasoningSummaryDelta(
  event: OpenAI.Responses.ResponseStreamEvent,
): event is OpenAI.Responses.ResponseReasoningSummaryTextDeltaEvent {
  return event.type === "response.reasoning_summary_text.delta";
}

function isReasoningSummaryStarted(
  event: OpenAI.Responses.ResponseStreamEvent,
): event is OpenAI.Responses.ResponseReasoningSummaryPartAddedEvent {
  return event.type === "response.reasoning_summary_part.added";
}

function isOutputTextDelta(
  event: OpenAI.Responses.ResponseStreamEvent,
): event is OpenAI.Responses.ResponseTextDeltaEvent {
  return event.type === "response.output_text.delta";
}

function isResponseCompletedEvent(
  event: OpenAI.Responses.ResponseStreamEvent,
): event is OpenAI.Responses.ResponseCompletedEvent {
  return event.type === "response.completed";
}

async function getFinalResponseFromStream(
  stream: ResponseStreamWithOptionalFinalResponse,
  completedResponse: OpenAI.Responses.Response | null,
): Promise<OpenAI.Responses.Response> {
  if (completedResponse !== null) {
    return completedResponse;
  }

  if (typeof stream.finalResponse === "function") {
    return stream.finalResponse();
  }

  throw new Error("OpenAI response stream completed without a final response");
}

async function runOneToolCall(
  params: Readonly<{
    item: OpenAI.Responses.ResponseFunctionToolCall;
    userId: string;
    workspaceId: string;
    rootObservation: LangfuseObservation | null;
  }>,
): Promise<ExecutedChatToolCall> {
  return runObservedToolCall(params);
}

const DEFAULT_OPENAI_LOOP_DEPENDENCIES: OpenAILoopDependencies = {
  buildChatCompletionInput,
  getObservedOpenAIClient,
  runOneToolCall,
};

function createInputTextMessage(
  role: "system" | "user",
  text: string,
): OpenAI.Responses.ResponseInputItem.Message {
  return {
    type: "message",
    role,
    content: [{
      type: "input_text",
      text,
    }],
  };
}

function buildToolLimitSummaryInstruction(toolEnabledModelCallLimit: number): OpenAI.Responses.ResponseInputItem.Message {
  return createInputTextMessage(
    "system",
    [
      `The tool-enabled model call limit for this turn (${String(toolEnabledModelCallLimit)}) has been reached.`,
      "Do not call any tools in this response.",
      "Briefly summarize what you already completed.",
      "Briefly state what remains unfinished.",
      "Ask the user to send another message such as continue if they want you to keep going from the same chat session.",
    ].join(" "),
  );
}

function buildToolLimitFallbackText(): string {
  return `I reached the tool-call limit for this turn (${String(CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS)}). Send another message such as continue and I will resume from the same chat session.`;
}

function createAssistantReplayMessage(text: string): StoredOpenAIReplayMessage {
  return {
    type: "message",
    role: "assistant",
    status: "completed",
    phase: "final_answer",
    content: [{
      type: "output_text",
      text,
      annotations: [],
    }],
  };
}

async function emitSyntheticAssistantDelta(
  onEvent: OpenAILoopEventSink,
  text: string,
  responseIndex: number,
): Promise<void> {
  if (text.trim().length === 0) {
    return;
  }

  await onEvent({
    type: "delta",
    text,
    itemId: TOOL_LIMIT_FALLBACK_ITEM_ID,
    responseIndex,
    outputIndex: 0,
    contentIndex: 0,
    sequenceNumber: 0,
  });
}

function buildOpenAIInput(
  baseInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>,
  continuationItems: ReadonlyArray<StoredOpenAIReplayItem>,
  extraInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>,
): Array<OpenAI.Responses.ResponseInputItem> {
  return [
    ...baseInput,
    ...continuationItems.map(toOpenAIResponseInputItem),
    ...extraInput,
  ];
}

/**
 * Returns the stable prompt cache key used for all model calls within one chat session.
 */
export function buildPromptCacheKey(sessionId: string): string {
  return sessionId;
}

function buildOpenAIResponsesRequest(params: BuildOpenAIResponsesRequestParams): OpenAIResponsesRequest {
  return {
    model: CHAT_MODEL_ID,
    store: false,
    include: ["reasoning.encrypted_content"],
    tools: [...params.tools],
    input: buildOpenAIInput(params.baseInput, params.continuationItems, params.extraInput),
    reasoning: {
      effort: CHAT_MODEL_REASONING_EFFORT,
      summary: CHAT_MODEL_REASONING_SUMMARY,
    },
    prompt_cache_key: buildPromptCacheKey(params.sessionId),
    safety_identifier: buildOpenAISafetyIdentifier(params.userId),
  };
}

function setExecutionPhase(
  params: StartOpenAILoopParams,
  phase: "idle" | "model" | "tool",
): void {
  params.onExecutionPhaseChanged?.(phase);
}

function shouldStopBeforeNextStep(params: StartOpenAILoopParams): boolean {
  return params.shouldStopBeforeNextStep?.() === true;
}

async function runOneModelCall(
  client: OpenAI,
  params: StartOpenAILoopParams,
  onEvent: OpenAILoopEventSink,
  request: OpenAIResponsesRequest,
  callIndex: number,
): Promise<ModelCallResult> {
  const stream: ResponseStreamWithOptionalFinalResponse = client.responses.stream(request, {
    signal: params.signal,
  });

  const reasoningSummaries = new Map<string, string>();
  const reasoningOrder: Array<string> = [];
  let toolStates = createToolCallStateMap();
  let completedResponse: OpenAI.Responses.Response | null = null;
  let streamedText = "";

  for await (const event of stream) {
    if (isResponseCompletedEvent(event)) {
      completedResponse = event.response;
      continue;
    }

    if (isOutputTextDelta(event)) {
      streamedText = `${streamedText}${event.delta}`;
      await onEvent({
        type: "delta",
        text: event.delta,
        itemId: event.item_id,
        responseIndex: callIndex - 1,
        outputIndex: event.output_index,
        contentIndex: event.content_index,
        sequenceNumber: event.sequence_number,
      });
      continue;
    }

    if (event.type === "response.output_item.added" && event.item.type === "function_call") {
      const update = applyToolCallStarted(
        toolStates,
        toFunctionToolCallRawItem(event.item),
        createToolCallPosition(event, callIndex - 1),
        Date.now(),
      );
      toolStates = update.toolStates;
      if (update.event !== null) {
        await onEvent(update.event);
      }
      continue;
    }

    if (event.type === "response.function_call_arguments.delta") {
      const update = applyFunctionCallArgumentsDelta(toolStates, {
        itemId: event.item_id,
        outputIndex: event.output_index,
        sequenceNumber: event.sequence_number,
        delta: event.delta,
      });
      toolStates = update.toolStates;
      if (update.event !== null) {
        await onEvent(update.event);
      }
      continue;
    }

    if (event.type === "response.function_call_arguments.done") {
      const update = applyFunctionCallArgumentsDone(toolStates, {
        itemId: event.item_id,
        outputIndex: event.output_index,
        sequenceNumber: event.sequence_number,
        arguments: event.arguments,
      });
      toolStates = update.toolStates;
      if (update.event !== null) {
        await onEvent(update.event);
      }
      continue;
    }

    if (isReasoningSummaryStarted(event)) {
      if (!reasoningSummaries.has(event.item_id)) {
        reasoningOrder.push(event.item_id);
        if (reasoningOrder.length > MAX_REASONING_ITEMS) {
          const removedItemId = reasoningOrder.shift();
          if (removedItemId !== undefined) {
            reasoningSummaries.delete(removedItemId);
          }
        }
      }

      reasoningSummaries.set(event.item_id, reasoningSummaries.get(event.item_id) ?? "");
      await onEvent({
        type: "reasoning_summary",
        itemId: event.item_id,
        responseIndex: callIndex - 1,
        outputIndex: event.output_index,
        sequenceNumber: event.sequence_number,
        summary: reasoningSummaries.get(event.item_id) ?? "",
      });
      continue;
    }

    if (isReasoningSummaryDelta(event)) {
      if (!reasoningSummaries.has(event.item_id)) {
        reasoningOrder.push(event.item_id);
        if (reasoningOrder.length > MAX_REASONING_ITEMS) {
          const removedItemId = reasoningOrder.shift();
          if (removedItemId !== undefined) {
            reasoningSummaries.delete(removedItemId);
          }
        }
      }

      const nextSummary = `${reasoningSummaries.get(event.item_id) ?? ""}${event.delta}`;
      reasoningSummaries.set(event.item_id, nextSummary);
      await onEvent({
        type: "reasoning_summary",
        itemId: event.item_id,
        responseIndex: callIndex - 1,
        outputIndex: event.output_index,
        sequenceNumber: event.sequence_number,
        summary: nextSummary,
      });
    }
  }

  const finalResponse = await getFinalResponseFromStream(stream, completedResponse);
  return {
    finalResponse,
    functionCalls: finalResponse.output
      .filter((item) => item.type === "function_call")
      .map((item) => item as ParsedFunctionToolCall),
    replayItems: finalResponse.output.map(toStoredOpenAIReplayItem),
    streamedText,
    toolStates,
  };
}

async function runOneModelCallWithPhase(
  client: OpenAI,
  params: StartOpenAILoopParams,
  onEvent: OpenAILoopEventSink,
  request: OpenAIResponsesRequest,
  callIndex: number,
): Promise<ModelCallResult> {
  setExecutionPhase(params, "model");
  return runOneModelCall(
    client,
    params,
    onEvent,
    request,
    callIndex,
  ).finally(() => {
    setExecutionPhase(params, "idle");
  });
}

async function completeToolLimitSummaryTurn(
  params: StartOpenAILoopParams,
  onEvent: OpenAILoopEventSink,
  client: OpenAI,
  baseInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>,
  continuationItems: Array<StoredOpenAIReplayItem>,
): Promise<OpenAILoopCompletion> {
  const summaryCallIndex = CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1;
  const summaryCall = await runOneModelCallWithPhase(
    client,
    params,
    onEvent,
    buildOpenAIResponsesRequest({
      baseInput,
      continuationItems,
      userId: params.userId,
      sessionId: params.sessionId,
      extraInput: [buildToolLimitSummaryInstruction(CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS)],
      tools: [],
    }),
    summaryCallIndex,
  );

  const finalResponseText = summaryCall.finalResponse.output_text.trim();
  const finalAssistantText = finalResponseText.length > 0
    ? finalResponseText
    : summaryCall.streamedText.trim();

  if (summaryCall.functionCalls.length === 0 && finalAssistantText.length > 0) {
    continuationItems.push(...summaryCall.replayItems);
    if (summaryCall.streamedText.length === 0) {
      await emitSyntheticAssistantDelta(onEvent, finalAssistantText, summaryCallIndex - 1);
    }
    await onEvent({ type: "done" });
    return {
      openaiItems: continuationItems,
      terminationReason: "completed",
    };
  }

  const fallbackText = buildToolLimitFallbackText();
  continuationItems.push(createAssistantReplayMessage(fallbackText));
  if (summaryCall.streamedText.length === 0) {
    await emitSyntheticAssistantDelta(onEvent, fallbackText, summaryCallIndex - 1);
  }
  await onEvent({ type: "done" });
  return {
    openaiItems: continuationItems,
    terminationReason: "completed",
  };
}

async function runLoopWithDeps(
  params: StartOpenAILoopParams,
  onEvent: OpenAILoopEventSink,
  dependencies: OpenAILoopDependencies,
): Promise<OpenAILoopCompletion> {
  const client = dependencies.getObservedOpenAIClient();
  const baseInput = await dependencies.buildChatCompletionInput(
    params.localMessages,
    params.turnInput,
    params.timezone,
  );
  const continuationItems: Array<StoredOpenAIReplayItem> = [];

  for (let callIndex = 1; callIndex <= CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS; callIndex += 1) {
    if (shouldStopBeforeNextStep(params)) {
      return {
        openaiItems: continuationItems,
        terminationReason: "stopped_before_next_step",
      };
    }

    const modelCall = await runOneModelCallWithPhase(
      client,
      params,
      onEvent,
      buildOpenAIResponsesRequest({
        baseInput,
        continuationItems,
        userId: params.userId,
        sessionId: params.sessionId,
        extraInput: [],
        tools: OPENAI_CHAT_TOOLS,
      }),
      callIndex,
    );

    continuationItems.push(...modelCall.replayItems);

    if (modelCall.functionCalls.length === 0) {
      await onEvent({ type: "done" });
      return {
        openaiItems: continuationItems,
        terminationReason: "completed",
      };
    }

    if (shouldStopBeforeNextStep(params)) {
      return {
        openaiItems: continuationItems,
        terminationReason: "stopped_before_next_step",
      };
    }

    let toolStates = modelCall.toolStates;
    for (const functionCall of modelCall.functionCalls) {
      if (shouldStopBeforeNextStep(params)) {
        return {
          openaiItems: continuationItems,
          terminationReason: "stopped_before_next_step",
        };
      }

      setExecutionPhase(params, "tool");
      try {
        const output = await dependencies.runOneToolCall({
          item: functionCall,
          userId: params.userId,
          workspaceId: params.workspaceId,
          rootObservation: params.rootObservation,
        });
        const update = applyToolCallOutput(
          toolStates,
          {
            type: "function_call_output",
            callId: functionCall.call_id,
            id: functionCall.id,
            name: functionCall.name,
          },
          output.output,
          Date.now(),
          output.succeeded && output.isMutating,
        );
        toolStates = update.toolStates;
        if (update.event !== null) {
          await onEvent(update.event);
        }
        continuationItems.push(toStoredOpenAIReplayItem(
          toFunctionCallOutputInputItem(functionCall.call_id, output.output),
        ));
      } finally {
        setExecutionPhase(params, "idle");
      }

      if (shouldStopBeforeNextStep(params)) {
        return {
          openaiItems: continuationItems,
          terminationReason: "stopped_before_next_step",
        };
      }
    }

    if (callIndex === CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS) {
      return completeToolLimitSummaryTurn(
        params,
        onEvent,
        client,
        baseInput,
        continuationItems,
      );
    }
  }

  throw new Error("OpenAI chat loop exceeded the expected control flow");
}

/**
 * Runs the OpenAI loop inside one awaited control flow so provider aborts
 * cannot escape through an unobserved background promise.
 */
export async function startOpenAILoopWithDeps(
  params: StartOpenAILoopParams,
  onEvent: OpenAILoopEventSink,
  dependencies: OpenAILoopDependencies,
): Promise<OpenAILoopCompletion> {
  setExecutionPhase(params, "idle");
  return runLoopWithDeps(params, onEvent, dependencies).finally(() => {
    setExecutionPhase(params, "idle");
  });
}

/**
 * Runs the OpenAI loop with the production dependency set.
 */
export async function startOpenAILoop(
  params: StartOpenAILoopParams,
  onEvent: OpenAILoopEventSink,
): Promise<OpenAILoopCompletion> {
  return startOpenAILoopWithDeps(params, onEvent, DEFAULT_OPENAI_LOOP_DEPENDENCIES);
}

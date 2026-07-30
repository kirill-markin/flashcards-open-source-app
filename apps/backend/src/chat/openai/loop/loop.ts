/**
 * OpenAI model loop for backend-owned chat runs.
 * The loop replays persisted history, streams provider events, executes tool calls, and returns replay items for the next recovery point.
 */
import OpenAI from "openai";
import type { LangfuseObservation } from "@langfuse/tracing";
import {
  applyFunctionCallArgumentsDelta,
  applyFunctionCallArgumentsDone,
  applyToolCallOutput,
  applyToolCallStarted,
  createToolCallStateMap,
  type FunctionToolCallRawItem,
  type ToolCallPosition,
} from "../tools/toolCalls";
import {
  buildChatCompletionInput,
  buildChatCompletionInputWithBudget,
  estimateStoredReplayItemsTokens,
} from "./input";
import { getObservedOpenAIClient } from "../client";
import { isContextLengthExceededError } from "../../runtime/providerErrors";
import { runOneToolCall as runObservedToolCall } from "../tools/toolExecutor";
import {
  toOpenAIResponseInputItem,
  toStoredOpenAIReplayItem,
  type ServerChatMessage,
  type StoredOpenAIReplayItem,
  type StoredOpenAIReplayMessage,
} from "../replayItems";
import {
  buildOpenAIChatTools,
  type ExecutedChatToolCall,
} from "../tools/tools";
import { buildOpenAISafetyIdentifier } from "../safetyIdentifier";
import type { ChatStreamEvent, ContentPart } from "../../types";
import { createProviderTerminalEventError } from "../../providerFailure";
import {
  CHAT_HISTORY_REPLAY_TOKEN_BUDGET,
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_MODEL_CONTEXT_WINDOW_TOKENS,
  CHAT_MODEL_REASONING_SUMMARY,
  type ChatRuntimeModelId,
  type ChatRuntimeReasoningEffort,
} from "../../config";
import type { ChatRunClaimToken } from "../../runs";
import { createGeneratedImageOperationKey } from "../../generatedImageOperationIdentity";
import { GENERATED_IMAGE_TOOL_NAME } from "../tools/generatedImageToolContract";

export const CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS = 30;
const MAX_REASONING_ITEMS = 8;
const TOOL_LIMIT_FALLBACK_ITEM_ID = "tool-limit-summary";

/**
 * Maximum estimated tokens of within-run continuation growth (model output plus
 * tool-call replay items accumulated across tool rounds) before the loop diverts
 * into the tool-limit summary turn instead of scheduling another tool-enabled
 * call. Reserves the history-replay budget for the base input and the
 * `max_output_tokens` headroom for the response, so the loop diverts into the
 * summary turn before `base input + continuation + reserved output` can exceed
 * the model context window even when the character-based estimate under-counts
 * dense content.
 */
const MAX_WITHIN_RUN_REPLAY_TOKENS = CHAT_MODEL_CONTEXT_WINDOW_TOKENS
  - CHAT_HISTORY_REPLAY_TOKEN_BUDGET
  - CHAT_MAX_OUTPUT_TOKENS;

/**
 * Tighter history-replay budget used to rebuild the base input when the first
 * model call overflows the context window before anything streamed. Halving the
 * default budget drops more of the oldest history while always preserving the
 * current turn, which is reserved separately and never truncated.
 */
const REDUCED_HISTORY_REPLAY_TOKEN_BUDGET = Math.floor(CHAT_HISTORY_REPLAY_TOKEN_BUDGET / 2);

type OpenAILoopDependencies = Readonly<{
  buildChatCompletionInput: typeof buildChatCompletionInput;
  buildChatCompletionInputWithBudget: typeof buildChatCompletionInputWithBudget;
  getObservedOpenAIClient: typeof getObservedOpenAIClient;
  runOneToolCall: (params: Readonly<{
    item: OpenAI.Responses.ResponseFunctionToolCall;
    requestId: string;
    runId: string;
    sessionId: string;
    operationKey: string;
    generatedImageEligible: boolean;
    claimToken: ChatRunClaimToken;
    userId: string;
    workspaceId: string;
    signal: AbortSignal | null;
    generatedImageOperationDeadlineMs: number;
    rootObservation: LangfuseObservation | null;
  }>) => Promise<ExecutedChatToolCall>;
}>;

export type OpenAILoopCompletion = Readonly<{
  openaiItems: ReadonlyArray<StoredOpenAIReplayItem>;
  terminationReason: "completed" | "stopped_before_next_step" | "run_inactive";
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
  model: ChatRuntimeModelId;
  store: false;
  include: ["reasoning.encrypted_content"];
  tools: Array<OpenAI.Responses.Tool>;
  input: Array<OpenAI.Responses.ResponseInputItem>;
  max_output_tokens: number;
  reasoning: Readonly<{
    effort: ChatRuntimeReasoningEffort;
    summary: typeof CHAT_MODEL_REASONING_SUMMARY;
  }>;
  prompt_cache_key: string;
  safety_identifier: string;
  parallel_tool_calls?: false;
}>;

type BuildOpenAIResponsesRequestParams = Readonly<{
  baseInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>;
  continuationItems: ReadonlyArray<StoredOpenAIReplayItem>;
  userId: string;
  sessionId: string;
  modelId: ChatRuntimeModelId;
  reasoningEffort: ChatRuntimeReasoningEffort;
  extraInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>;
  tools: ReadonlyArray<OpenAI.Responses.Tool>;
}>;

export type StartOpenAILoopParams = Readonly<{
  requestId: string;
  runId: string;
  claimToken: ChatRunClaimToken;
  userId: string;
  workspaceId: string;
  sessionId: string;
  generatedImageEligible: boolean;
  generatedImageOperationDeadlineMs: number;
  modelId: ChatRuntimeModelId;
  reasoningEffort: ChatRuntimeReasoningEffort;
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
  // True when the response was capped at `max_output_tokens` after streaming a
  // partial answer. The loop must finish with that partial text and never run
  // any (possibly truncated) function call carried in the same output.
  forceComplete: boolean;
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

function isResponseFailedEvent(
  event: OpenAI.Responses.ResponseStreamEvent,
): event is OpenAI.Responses.ResponseFailedEvent {
  return event.type === "response.failed";
}

function isResponseIncompleteEvent(
  event: OpenAI.Responses.ResponseStreamEvent,
): event is OpenAI.Responses.ResponseIncompleteEvent {
  return event.type === "response.incomplete";
}

function isResponseErrorEvent(
  event: OpenAI.Responses.ResponseStreamEvent,
): event is OpenAI.Responses.ResponseErrorEvent {
  return event.type === "error";
}

const OPENAI_STREAM_ABORT_ERROR_MESSAGE = "OpenAI response stream was aborted before a final response";

class OpenAIStreamAbortError extends Error {
  constructor() {
    super(OPENAI_STREAM_ABORT_ERROR_MESSAGE);
    this.name = "AbortError";
  }
}

function createOpenAIStreamAbortError(): OpenAIStreamAbortError {
  return new OpenAIStreamAbortError();
}

function isOpenAIAbortError(error: unknown): boolean {
  return error instanceof OpenAI.APIUserAbortError
    || error instanceof OpenAIStreamAbortError;
}

async function getFinalResponseFromStream(
  stream: ResponseStreamWithOptionalFinalResponse,
  completedResponse: OpenAI.Responses.Response | null,
  signal: AbortSignal | undefined,
): Promise<OpenAI.Responses.Response> {
  if (completedResponse !== null) {
    return completedResponse;
  }

  if (typeof stream.finalResponse === "function") {
    return stream.finalResponse();
  }

  if (signal?.aborted === true) {
    throw createOpenAIStreamAbortError();
  }

  throw createProviderTerminalEventError({
    code: "stream_closed_without_response",
    message: "OpenAI response stream completed without a final response",
  });
}

async function runOneToolCall(
  params: Readonly<{
    item: OpenAI.Responses.ResponseFunctionToolCall;
    requestId: string;
    runId: string;
    sessionId: string;
    operationKey: string;
    generatedImageEligible: boolean;
    claimToken: ChatRunClaimToken;
    userId: string;
    workspaceId: string;
    signal: AbortSignal | null;
    generatedImageOperationDeadlineMs: number;
    rootObservation: LangfuseObservation | null;
  }>,
): Promise<ExecutedChatToolCall> {
  return runObservedToolCall(params);
}

const DEFAULT_OPENAI_LOOP_DEPENDENCIES: OpenAILoopDependencies = {
  buildChatCompletionInput,
  buildChatCompletionInputWithBudget,
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

/**
 * Drops the replay items that a `max_output_tokens`-capped response cannot persist
 * safely alongside its partial streamed answer.
 *
 * The loop finishes with the partial text and never executes the truncated
 * `function_call` items, so persisting them would leave orphan `function_call`
 * items with no paired `function_call_output`. Dropping a trailing `function_call`
 * can in turn orphan a `reasoning` item that immediately preceded it: a reasoning
 * item replayed with no following same-turn output item is the same orphan class
 * and the Responses API rejects it on the next turn. So a `reasoning` item is kept
 * only when a later item in the same response output survives this filter; trailing
 * reasoning items left unpaired by the dropped calls are dropped too. The
 * user-visible answer is preserved via the streamed deltas regardless.
 */
function pruneUnpairedToolReplayItems(
  items: ReadonlyArray<StoredOpenAIReplayItem>,
): ReadonlyArray<StoredOpenAIReplayItem> {
  const functionCallIds = new Set(
    items.filter((item) => item.type === "function_call").map((item) => item.call_id),
  );
  const outputCallIds = new Set(
    items.filter((item) => item.type === "function_call_output").map((item) => item.call_id),
  );
  const pairedItems = items.filter((item) => {
    if (item.type === "function_call") {
      return outputCallIds.has(item.call_id);
    }
    if (item.type === "function_call_output") {
      return functionCallIds.has(item.call_id);
    }
    return true;
  });
  const kept: Array<StoredOpenAIReplayItem> = [];

  let hasFollowingKeptItem = false;
  for (let index = pairedItems.length - 1; index >= 0; index -= 1) {
    const item = pairedItems[index];
    if (item.type === "reasoning" && !hasFollowingKeptItem) {
      continue;
    }

    kept.push(item);
    hasFollowingKeptItem = true;
  }

  return kept.reverse();
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
    model: params.modelId,
    store: false,
    include: ["reasoning.encrypted_content"],
    tools: [...params.tools],
    input: buildOpenAIInput(params.baseInput, params.continuationItems, params.extraInput),
    max_output_tokens: CHAT_MAX_OUTPUT_TOKENS,
    reasoning: {
      effort: params.reasoningEffort,
      summary: CHAT_MODEL_REASONING_SUMMARY,
    },
    prompt_cache_key: buildPromptCacheKey(params.sessionId),
    safety_identifier: buildOpenAISafetyIdentifier(params.userId),
    ...(params.tools.some((tool) => tool.type === "function"
      && tool.name === "add_generated_image_to_card")
      ? { parallel_tool_calls: false as const }
      : {}),
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

function shouldStopForOpenAIAbort(params: StartOpenAILoopParams, error: unknown): boolean {
  return shouldStopBeforeNextStep(params) && isOpenAIAbortError(error);
}

function createStoppedBeforeNextStepCompletion(
  continuationItems: ReadonlyArray<StoredOpenAIReplayItem>,
): OpenAILoopCompletion {
  return {
    openaiItems: pruneUnpairedToolReplayItems(continuationItems),
    terminationReason: "stopped_before_next_step",
  };
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
  let forceComplete = false;

  for await (const event of stream) {
    if (isResponseCompletedEvent(event)) {
      completedResponse = event.response;
      continue;
    }

    if (isResponseFailedEvent(event)) {
      throw createProviderTerminalEventError({
        code: event.response.error?.code ?? null,
        message: event.response.error?.message ?? null,
      });
    }

    if (isResponseIncompleteEvent(event)) {
      // A `max_output_tokens` incomplete response means the model hit the
      // reserved output cap after streaming a partial answer. Treat it as a
      // normal completion so the loop returns the partial text and emits `done`
      // instead of failing the run, and mark it `forceComplete` so the loop
      // finishes with that partial text and never runs a truncated function
      // call that may also appear in the capped output. All other incomplete
      // reasons (e.g. `content_filter`) still throw. An empty partial answer is
      // never returned silently: it falls through to the stream-without-response
      // throw below.
      if (
        event.response.incomplete_details?.reason === "max_output_tokens"
        && streamedText.length > 0
      ) {
        completedResponse = event.response;
        forceComplete = true;
        continue;
      }

      throw createProviderTerminalEventError({
        code: event.response.incomplete_details?.reason ?? null,
        message: null,
      });
    }

    if (isResponseErrorEvent(event)) {
      throw createProviderTerminalEventError({
        code: event.code ?? null,
        message: event.message,
      });
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

  const finalResponse = await getFinalResponseFromStream(stream, completedResponse, params.signal);
  return {
    finalResponse,
    functionCalls: finalResponse.output
      .filter((item) => item.type === "function_call")
      .map((item) => item as ParsedFunctionToolCall),
    replayItems: finalResponse.output.map(toStoredOpenAIReplayItem),
    streamedText,
    toolStates,
    forceComplete,
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
  dependencies: OpenAILoopDependencies,
  client: OpenAI,
  baseInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>,
  continuationItems: Array<StoredOpenAIReplayItem>,
): Promise<OpenAILoopCompletion> {
  const summaryCallIndex = CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1;
  let summaryCall: ModelCallResult;
  try {
    const call = await runModelCallWithOverflowRetry(
      client,
      params,
      onEvent,
      dependencies,
      baseInput,
      (input) => buildOpenAIResponsesRequest({
        baseInput: input,
        continuationItems,
        userId: params.userId,
        sessionId: params.sessionId,
        modelId: params.modelId,
        reasoningEffort: params.reasoningEffort,
        extraInput: [buildToolLimitSummaryInstruction(CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS)],
        tools: [],
      }),
      summaryCallIndex,
    );
    summaryCall = call.modelCall;
  } catch (error) {
    if (shouldStopForOpenAIAbort(params, error)) {
      return createStoppedBeforeNextStepCompletion(continuationItems);
    }

    throw error;
  }

  const finalResponseText = summaryCall.finalResponse.output_text.trim();
  const finalAssistantText = finalResponseText.length > 0
    ? finalResponseText
    : summaryCall.streamedText.trim();

  // A `max_output_tokens`-capped summary turn (`forceComplete`) keeps its
  // partial answer even if the truncated output also carries a function call,
  // so the user sees the real summary instead of the generic fallback text. The
  // truncated call is dropped so it is never persisted as an orphan replay item.
  if ((summaryCall.forceComplete || summaryCall.functionCalls.length === 0) && finalAssistantText.length > 0) {
    continuationItems.push(...(summaryCall.forceComplete
      ? pruneUnpairedToolReplayItems(summaryCall.replayItems)
      : summaryCall.replayItems));
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

type ModelCallWithOverflowRetryResult = Readonly<{
  baseInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>;
  modelCall: ModelCallResult;
}>;

type BuildModelCallRequest = (
  baseInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>,
) => OpenAIResponsesRequest;

/**
 * Runs exactly one model call and, on a `context_length_exceeded` overflow,
 * rebuilds only the history base input with a tighter history-replay budget and
 * retries the same call once. Any other failure, or a second overflow,
 * propagates to the existing graceful terminal handling.
 *
 * The retry only shrinks the replayed history: the caller's already-accumulated
 * continuation items are carried by `buildRequest` and are never dropped. The
 * returned `baseInput` is the input actually sent (reduced when the retry fired),
 * so later calls reuse the smaller history.
 */
async function runModelCallWithOverflowRetry(
  client: OpenAI,
  params: StartOpenAILoopParams,
  onEvent: OpenAILoopEventSink,
  dependencies: OpenAILoopDependencies,
  baseInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>,
  buildRequest: BuildModelCallRequest,
  callIndex: number,
): Promise<ModelCallWithOverflowRetryResult> {
  try {
    return {
      baseInput,
      modelCall: await runOneModelCallWithPhase(
        client,
        params,
        onEvent,
        buildRequest(baseInput),
        callIndex,
      ),
    };
  } catch (error) {
    if (!isContextLengthExceededError(error)) {
      throw error;
    }

    const reducedBaseInput = await dependencies.buildChatCompletionInputWithBudget(
      params.localMessages,
      params.turnInput,
      params.timezone,
      params.generatedImageEligible,
      REDUCED_HISTORY_REPLAY_TOKEN_BUDGET,
    );
    return {
      baseInput: reducedBaseInput,
      modelCall: await runOneModelCallWithPhase(
        client,
        params,
        onEvent,
        buildRequest(reducedBaseInput),
        callIndex,
      ),
    };
  }
}

async function runLoopWithDeps(
  params: StartOpenAILoopParams,
  onEvent: OpenAILoopEventSink,
  dependencies: OpenAILoopDependencies,
): Promise<OpenAILoopCompletion> {
  const client = dependencies.getObservedOpenAIClient();
  let baseInput = await dependencies.buildChatCompletionInput(
    params.localMessages,
    params.turnInput,
    params.timezone,
    params.generatedImageEligible,
  );
  const continuationItems: Array<StoredOpenAIReplayItem> = [];
  const tools = buildOpenAIChatTools(params.generatedImageEligible);
  let generatedImageOperationCount = 0;

  for (let callIndex = 1; callIndex <= CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS; callIndex += 1) {
    if (shouldStopBeforeNextStep(params)) {
      return createStoppedBeforeNextStepCompletion(continuationItems);
    }

    let modelCall: ModelCallResult;
    try {
      const call = await runModelCallWithOverflowRetry(
        client,
        params,
        onEvent,
        dependencies,
        baseInput,
        (input) => buildOpenAIResponsesRequest({
          baseInput: input,
          continuationItems,
          userId: params.userId,
          sessionId: params.sessionId,
          modelId: params.modelId,
          reasoningEffort: params.reasoningEffort,
          extraInput: [],
          tools,
        }),
        callIndex,
      );
      baseInput = call.baseInput;
      modelCall = call.modelCall;
    } catch (error) {
      if (shouldStopForOpenAIAbort(params, error)) {
        return createStoppedBeforeNextStepCompletion(continuationItems);
      }

      throw error;
    }

    // `forceComplete` wins over any function call: a `max_output_tokens`-capped
    // response may carry a truncated function_call alongside the partial answer,
    // and the loop must finish with that partial text instead of executing it.
    // That unexecuted call, plus any reasoning item it orphans, is dropped here
    // so neither is persisted as an unpaired replay item that the Responses API
    // would reject on a later turn.
    if (modelCall.forceComplete) {
      continuationItems.push(...pruneUnpairedToolReplayItems(modelCall.replayItems));
      await onEvent({ type: "done" });
      return {
        openaiItems: continuationItems,
        terminationReason: "completed",
      };
    }

    continuationItems.push(...modelCall.replayItems);

    if (modelCall.functionCalls.length === 0) {
      await onEvent({ type: "done" });
      return {
        openaiItems: continuationItems,
        terminationReason: "completed",
      };
    }

    if (shouldStopBeforeNextStep(params)) {
      return createStoppedBeforeNextStepCompletion(continuationItems);
    }

    let toolStates = modelCall.toolStates;
    for (
      let functionCallIndex = 0;
      functionCallIndex < modelCall.functionCalls.length;
      functionCallIndex += 1
    ) {
      const functionCall = modelCall.functionCalls[functionCallIndex];
      const operationKey = functionCall.name === GENERATED_IMAGE_TOOL_NAME
        ? createGeneratedImageOperationKey(++generatedImageOperationCount)
        : "not-generated-image";
      if (shouldStopBeforeNextStep(params)) {
        return createStoppedBeforeNextStepCompletion(continuationItems);
      }

      setExecutionPhase(params, "tool");
      try {
        const output = await dependencies.runOneToolCall({
          item: functionCall,
          requestId: params.requestId,
          runId: params.runId,
          sessionId: params.sessionId,
          operationKey,
          generatedImageEligible: params.generatedImageEligible,
          claimToken: params.claimToken,
          userId: params.userId,
          workspaceId: params.workspaceId,
          signal: params.signal ?? null,
          generatedImageOperationDeadlineMs: params.generatedImageOperationDeadlineMs,
          rootObservation: params.rootObservation,
        });
        if (output.stopReason !== null) {
          return {
            openaiItems: pruneUnpairedToolReplayItems(continuationItems),
            terminationReason: output.stopReason === "run_inactive"
              ? "run_inactive" : "stopped_before_next_step",
          };
        }
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
          output.shouldInvalidateMainContent,
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
        return createStoppedBeforeNextStepCompletion(continuationItems);
      }
    }

    const reachedToolCallLimit = callIndex === CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS;
    const exceededWithinRunReplayBudget = estimateStoredReplayItemsTokens(continuationItems)
      > MAX_WITHIN_RUN_REPLAY_TOKENS;
    if (reachedToolCallLimit || exceededWithinRunReplayBudget) {
      return completeToolLimitSummaryTurn(
        params,
        onEvent,
        dependencies,
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

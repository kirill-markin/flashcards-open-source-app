import OpenAI from "openai";
import type { LangfuseObservation } from "@langfuse/tracing";
import { applyToolCallOutput, type ToolCallStateMap } from "../tools/toolCalls";
import {
  toOpenAIResponseInputItem,
  toStoredOpenAIReplayItem,
  type StoredOpenAIReplayItem,
  type StoredOpenAIReplayMessage,
} from "../replayItems";
import type { ExecutedChatToolCall } from "../tools/tools";
import { buildOpenAISafetyIdentifier } from "../safetyIdentifier";
import {
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_MODEL_REASONING_SUMMARY,
  type ChatRuntimeModelId,
  type ChatRuntimeReasoningEffort,
} from "../../config";
import type { ChatRunClaimToken } from "../../runs";
import { createGeneratedImageOperationKey } from "../../generatedImageOperationIdentity";
import { GENERATED_IMAGE_TOOL_NAME } from "../tools/generatedImageToolContract";
import {
  collectResponseStream,
  type ModelCallResult,
  type OpenAILoopEventSink,
  type ParsedFunctionToolCall,
  type ResponseStreamWithOptionalFinalResponse,
} from "./responseStream";

export const CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS = 30;
const TOOL_LIMIT_FALLBACK_ITEM_ID = "tool-limit-summary";

export type OpenAIResponsesRequest = Readonly<{
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

type RunOneModelCallParams = Readonly<{
  client: OpenAI;
  signal: AbortSignal | undefined;
  onExecutionPhaseChanged: ((phase: "idle" | "model" | "tool") => void) | undefined;
  onEvent: OpenAILoopEventSink;
  request: OpenAIResponsesRequest;
  callIndex: number;
}>;

export type RunOneToolCall = (params: Readonly<{
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

type ExecuteToolCallsParams = Readonly<{
  functionCalls: ReadonlyArray<ParsedFunctionToolCall>;
  toolStates: ToolCallStateMap;
  generatedImageOperationCount: number;
  requestId: string;
  runId: string;
  sessionId: string;
  generatedImageEligible: boolean;
  claimToken: ChatRunClaimToken;
  userId: string;
  workspaceId: string;
  signal: AbortSignal | undefined;
  generatedImageOperationDeadlineMs: number;
  rootObservation: LangfuseObservation | null;
  onExecutionPhaseChanged: ((phase: "idle" | "model" | "tool") => void) | undefined;
  shouldStopBeforeNextStep: (() => boolean) | undefined;
  onEvent: OpenAILoopEventSink;
  runOneToolCall: RunOneToolCall;
}>;

export type ExecuteToolCallsResult = Readonly<{
  replayItems: ReadonlyArray<StoredOpenAIReplayItem>;
  generatedImageOperationCount: number;
  terminationReason: "stopped_before_next_step" | "run_inactive" | null;
}>;

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

export function buildToolLimitSummaryInstruction(
  toolEnabledModelCallLimit: number,
): OpenAI.Responses.ResponseInputItem.Message {
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

export function buildPromptCacheKey(sessionId: string): string {
  return sessionId;
}

export function buildOpenAIResponsesRequest(
  params: BuildOpenAIResponsesRequestParams,
): OpenAIResponsesRequest {
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

export async function runOneModelCallWithPhase(
  params: RunOneModelCallParams,
): Promise<ModelCallResult> {
  params.onExecutionPhaseChanged?.("model");
  try {
    const stream: ResponseStreamWithOptionalFinalResponse = params.client.responses.stream(
      params.request,
      { signal: params.signal },
    );
    return await collectResponseStream({
      stream,
      signal: params.signal,
      onEvent: params.onEvent,
      callIndex: params.callIndex,
    });
  } finally {
    params.onExecutionPhaseChanged?.("idle");
  }
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

function shouldStopBeforeNextStep(
  callback: (() => boolean) | undefined,
): boolean {
  return callback?.() === true;
}

export async function executeToolCalls(
  params: ExecuteToolCallsParams,
): Promise<ExecuteToolCallsResult> {
  const replayItems: Array<StoredOpenAIReplayItem> = [];
  let toolStates = params.toolStates;
  let generatedImageOperationCount = params.generatedImageOperationCount;

  for (const functionCall of params.functionCalls) {
    const operationKey = functionCall.name === GENERATED_IMAGE_TOOL_NAME
      ? createGeneratedImageOperationKey(++generatedImageOperationCount)
      : "not-generated-image";
    if (shouldStopBeforeNextStep(params.shouldStopBeforeNextStep)) {
      return {
        replayItems,
        generatedImageOperationCount,
        terminationReason: "stopped_before_next_step",
      };
    }

    params.onExecutionPhaseChanged?.("tool");
    try {
      const output = await params.runOneToolCall({
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
          replayItems,
          generatedImageOperationCount,
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
        await params.onEvent(update.event);
      }
      replayItems.push(toStoredOpenAIReplayItem(
        toFunctionCallOutputInputItem(functionCall.call_id, output.output),
      ));
    } finally {
      params.onExecutionPhaseChanged?.("idle");
    }

    if (shouldStopBeforeNextStep(params.shouldStopBeforeNextStep)) {
      return {
        replayItems,
        generatedImageOperationCount,
        terminationReason: "stopped_before_next_step",
      };
    }
  }

  return {
    replayItems,
    generatedImageOperationCount,
    terminationReason: null,
  };
}

export function pruneUnpairedToolReplayItems(
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

export async function completeToolLimitSummaryTurn(
  summaryCall: ModelCallResult,
  onEvent: OpenAILoopEventSink,
  continuationItems: ReadonlyArray<StoredOpenAIReplayItem>,
): Promise<ReadonlyArray<StoredOpenAIReplayItem>> {
  const summaryCallIndex = CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1;
  const finalResponseText = summaryCall.finalResponse.output_text.trim();
  const finalAssistantText = finalResponseText.length > 0
    ? finalResponseText
    : summaryCall.streamedText.trim();

  if ((summaryCall.forceComplete || summaryCall.functionCalls.length === 0) && finalAssistantText.length > 0) {
    const summaryReplayItems = summaryCall.forceComplete
      ? pruneUnpairedToolReplayItems(summaryCall.replayItems)
      : summaryCall.replayItems;
    if (summaryCall.streamedText.length === 0) {
      await emitSyntheticAssistantDelta(onEvent, finalAssistantText, summaryCallIndex - 1);
    }
    await onEvent({ type: "done" });
    return [...continuationItems, ...summaryReplayItems];
  }

  const fallbackText = buildToolLimitFallbackText();
  if (summaryCall.streamedText.length === 0) {
    await emitSyntheticAssistantDelta(onEvent, fallbackText, summaryCallIndex - 1);
  }
  await onEvent({ type: "done" });
  return [...continuationItems, createAssistantReplayMessage(fallbackText)];
}

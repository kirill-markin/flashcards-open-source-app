/**
 * OpenAI model loop for backend-owned chat runs.
 * The loop replays persisted history, sequences model and tool steps, and returns replay items for the next recovery point.
 */
import OpenAI from "openai";
import type { LangfuseObservation } from "@langfuse/tracing";
import {
  buildChatCompletionInput,
  buildChatCompletionInputWithBudget,
  estimateStoredReplayItemsTokens,
} from "./input";
import { getObservedOpenAIClient } from "../client";
import { isContextLengthExceededError } from "../../runtime/providerErrors";
import { runOneToolCall as runObservedToolCall } from "../tools/toolExecutor";
import type {
  ServerChatMessage,
  StoredOpenAIReplayItem,
} from "../replayItems";
import { buildOpenAIChatTools, type ExecutedChatToolCall } from "../tools/tools";
import type { ContentPart } from "../../types";
import {
  CHAT_HISTORY_REPLAY_TOKEN_BUDGET,
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_MODEL_CONTEXT_WINDOW_TOKENS,
  type ChatRuntimeModelId,
  type ChatRuntimeReasoningEffort,
} from "../../config";
import type { ChatRunClaimToken } from "../../runs";
import {
  buildOpenAIResponsesRequest,
  buildPromptCacheKey,
  buildToolLimitSummaryInstruction,
  CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS,
  completeToolLimitSummaryTurn,
  executeToolCalls,
  pruneUnpairedToolReplayItems,
  runOneModelCallWithPhase,
  type OpenAIResponsesRequest,
  type RunOneToolCall,
} from "./modelCall";
import {
  isOpenAIAbortError,
  type ModelCallResult,
  type OpenAILoopEventSink,
} from "./responseStream";

export {
  buildPromptCacheKey,
  CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS,
};
export type { OpenAILoopEventSink };

/**
 * Maximum estimated tokens of within-run continuation growth (model output plus
 * tool-call replay items accumulated across tool rounds) before the loop diverts
 * into the tool-limit summary turn instead of scheduling another tool-enabled
 * call.
 */
const MAX_WITHIN_RUN_REPLAY_TOKENS = CHAT_MODEL_CONTEXT_WINDOW_TOKENS
  - CHAT_HISTORY_REPLAY_TOKEN_BUDGET
  - CHAT_MAX_OUTPUT_TOKENS;

/**
 * Tighter history-replay budget used to rebuild the base input when a model
 * call overflows the context window.
 */
const REDUCED_HISTORY_REPLAY_TOKEN_BUDGET = Math.floor(CHAT_HISTORY_REPLAY_TOKEN_BUDGET / 2);

type OpenAILoopDependencies = Readonly<{
  buildChatCompletionInput: typeof buildChatCompletionInput;
  buildChatCompletionInputWithBudget: typeof buildChatCompletionInputWithBudget;
  getObservedOpenAIClient: typeof getObservedOpenAIClient;
  runOneToolCall: RunOneToolCall;
}>;

export type OpenAILoopCompletion = Readonly<{
  openaiItems: ReadonlyArray<StoredOpenAIReplayItem>;
  terminationReason: "completed" | "stopped_before_next_step" | "run_inactive";
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
 * retries the same call once.
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
      modelCall: await runOneModelCallWithPhase({
        client,
        signal: params.signal,
        onExecutionPhaseChanged: params.onExecutionPhaseChanged,
        onEvent,
        request: buildRequest(baseInput),
        callIndex,
      }),
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
      modelCall: await runOneModelCallWithPhase({
        client,
        signal: params.signal,
        onExecutionPhaseChanged: params.onExecutionPhaseChanged,
        onEvent,
        request: buildRequest(reducedBaseInput),
        callIndex,
      }),
    };
  }
}

async function runToolLimitSummaryTurn(
  params: StartOpenAILoopParams,
  onEvent: OpenAILoopEventSink,
  dependencies: OpenAILoopDependencies,
  client: OpenAI,
  baseInput: ReadonlyArray<OpenAI.Responses.ResponseInputItem>,
  continuationItems: ReadonlyArray<StoredOpenAIReplayItem>,
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

  return {
    openaiItems: await completeToolLimitSummaryTurn(summaryCall, onEvent, continuationItems),
    terminationReason: "completed",
  };
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

    const toolCalls = await executeToolCalls({
      functionCalls: modelCall.functionCalls,
      toolStates: modelCall.toolStates,
      generatedImageOperationCount,
      requestId: params.requestId,
      runId: params.runId,
      sessionId: params.sessionId,
      generatedImageEligible: params.generatedImageEligible,
      claimToken: params.claimToken,
      userId: params.userId,
      workspaceId: params.workspaceId,
      signal: params.signal,
      generatedImageOperationDeadlineMs: params.generatedImageOperationDeadlineMs,
      rootObservation: params.rootObservation,
      onExecutionPhaseChanged: params.onExecutionPhaseChanged,
      shouldStopBeforeNextStep: params.shouldStopBeforeNextStep,
      onEvent,
      runOneToolCall: dependencies.runOneToolCall,
    });
    continuationItems.push(...toolCalls.replayItems);
    generatedImageOperationCount = toolCalls.generatedImageOperationCount;
    if (toolCalls.terminationReason !== null) {
      return {
        openaiItems: pruneUnpairedToolReplayItems(continuationItems),
        terminationReason: toolCalls.terminationReason,
      };
    }

    const reachedToolCallLimit = callIndex === CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS;
    const exceededWithinRunReplayBudget = estimateStoredReplayItemsTokens(continuationItems)
      > MAX_WITHIN_RUN_REPLAY_TOKENS;
    if (reachedToolCallLimit || exceededWithinRunReplayBudget) {
      return runToolLimitSummaryTurn(
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

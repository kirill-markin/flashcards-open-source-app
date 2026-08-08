import OpenAI from "openai";
import {
  applyFunctionCallArgumentsDelta,
  applyFunctionCallArgumentsDone,
  applyToolCallStarted,
  createToolCallStateMap,
  type FunctionToolCallRawItem,
  type ToolCallPosition,
} from "../tools/toolCalls";
import { toStoredOpenAIReplayItem, type StoredOpenAIReplayItem } from "../replayItems";
import type { ChatStreamEvent } from "../../types";
import {
  createProviderTerminalEventError,
  type ChatProviderStreamDiagnostics,
} from "../../providerFailure";

const MAX_REASONING_ITEMS = 8;
const OPENAI_STREAM_ABORT_ERROR_MESSAGE = "OpenAI response stream was aborted before a final response";

export type OpenAILoopEventSink = (
  event: ChatStreamEvent,
) => Promise<void> | void;

export type ParsedFunctionToolCall = OpenAI.Responses.ResponseFunctionToolCall & Readonly<{
  parsed_arguments?: unknown;
}>;

export type ResponseStreamWithOptionalFinalResponse = AsyncIterable<OpenAI.Responses.ResponseStreamEvent> & Readonly<{
  finalResponse?: () => Promise<OpenAI.Responses.Response>;
}>;

export type ModelCallResult = Readonly<{
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

type CollectResponseStreamParams = Readonly<{
  stream: ResponseStreamWithOptionalFinalResponse;
  signal: AbortSignal | undefined;
  onEvent: OpenAILoopEventSink;
  callIndex: number;
}>;

type ResponseStreamCounters = Readonly<{
  responseId: string | null;
  eventCount: number;
  lastEventType: string | null;
  sawIncompleteEvent: boolean;
  sawFailedEvent: boolean;
}>;

const EMPTY_RESPONSE_STREAM_COUNTERS: ResponseStreamCounters = {
  responseId: null,
  eventCount: 0,
  lastEventType: null,
  sawIncompleteEvent: false,
  sawFailedEvent: false,
};

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

class OpenAIStreamAbortError extends Error {
  constructor() {
    super(OPENAI_STREAM_ABORT_ERROR_MESSAGE);
    this.name = "AbortError";
  }
}

function createOpenAIStreamAbortError(): OpenAIStreamAbortError {
  return new OpenAIStreamAbortError();
}

export function isOpenAIAbortError(error: unknown): boolean {
  return error instanceof OpenAI.APIUserAbortError
    || error instanceof OpenAIStreamAbortError;
}

function accumulateResponseStreamCounters(
  counters: ResponseStreamCounters,
  event: OpenAI.Responses.ResponseStreamEvent,
): ResponseStreamCounters {
  return {
    responseId: event.type === "response.created" ? event.response.id : counters.responseId,
    eventCount: counters.eventCount + 1,
    lastEventType: event.type,
    sawIncompleteEvent: counters.sawIncompleteEvent || isResponseIncompleteEvent(event),
    sawFailedEvent: counters.sawFailedEvent || isResponseFailedEvent(event),
  };
}

function toStreamDiagnostics(
  counters: ResponseStreamCounters,
  streamedTextLength: number,
): ChatProviderStreamDiagnostics {
  return {
    streamResponseId: counters.responseId,
    streamEventCount: counters.eventCount,
    streamLastEventType: counters.lastEventType,
    streamSawIncompleteEvent: counters.sawIncompleteEvent,
    streamSawFailedEvent: counters.sawFailedEvent,
    streamedTextLength,
  };
}

function hasProviderErrorCode(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as Readonly<Record<string, unknown>>).code;
  return typeof code === "string" && code.trim() !== "";
}

function markFinalResponseRejection(
  error: unknown,
  streamDiagnostics: ChatProviderStreamDiagnostics,
): unknown {
  if (typeof error !== "object" || error === null) {
    return error;
  }

  if (hasProviderErrorCode(error)) {
    return Object.assign(error, { streamDiagnostics });
  }

  return Object.assign(error, {
    streamDiagnostics,
    code: "stream_final_response_rejected",
  });
}

async function getFinalResponseFromStream(
  stream: ResponseStreamWithOptionalFinalResponse,
  completedResponse: OpenAI.Responses.Response | null,
  signal: AbortSignal | undefined,
  streamDiagnostics: ChatProviderStreamDiagnostics,
): Promise<OpenAI.Responses.Response> {
  if (completedResponse !== null) {
    return completedResponse;
  }

  if (typeof stream.finalResponse === "function") {
    try {
      return await stream.finalResponse();
    } catch (error) {
      if (isOpenAIAbortError(error) || signal?.aborted === true) {
        throw error;
      }

      throw markFinalResponseRejection(error, streamDiagnostics);
    }
  }

  if (signal?.aborted === true) {
    throw createOpenAIStreamAbortError();
  }

  throw createProviderTerminalEventError({
    code: "stream_closed_without_final_response_accessor",
    message: "OpenAI response stream completed without a final response and exposed no final response accessor",
    streamDiagnostics,
  });
}

export async function collectResponseStream(
  params: CollectResponseStreamParams,
): Promise<ModelCallResult> {
  const reasoningSummaries = new Map<string, string>();
  const reasoningOrder: Array<string> = [];
  let toolStates = createToolCallStateMap();
  let completedResponse: OpenAI.Responses.Response | null = null;
  let streamedText = "";
  let forceComplete = false;
  let streamCounters = EMPTY_RESPONSE_STREAM_COUNTERS;

  for await (const event of params.stream) {
    streamCounters = accumulateResponseStreamCounters(streamCounters, event);

    if (isResponseCompletedEvent(event)) {
      completedResponse = event.response;
      continue;
    }

    if (isResponseFailedEvent(event)) {
      throw createProviderTerminalEventError({
        code: event.response.error?.code ?? null,
        message: event.response.error?.message ?? null,
        streamDiagnostics: toStreamDiagnostics(streamCounters, streamedText.length),
      });
    }

    if (isResponseIncompleteEvent(event)) {
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
        streamDiagnostics: toStreamDiagnostics(streamCounters, streamedText.length),
      });
    }

    if (isResponseErrorEvent(event)) {
      throw createProviderTerminalEventError({
        code: event.code ?? null,
        message: event.message,
        streamDiagnostics: toStreamDiagnostics(streamCounters, streamedText.length),
      });
    }

    if (isOutputTextDelta(event)) {
      streamedText = `${streamedText}${event.delta}`;
      await params.onEvent({
        type: "delta",
        text: event.delta,
        itemId: event.item_id,
        responseIndex: params.callIndex - 1,
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
        createToolCallPosition(event, params.callIndex - 1),
        Date.now(),
      );
      toolStates = update.toolStates;
      if (update.event !== null) {
        await params.onEvent(update.event);
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
        await params.onEvent(update.event);
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
        await params.onEvent(update.event);
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
      await params.onEvent({
        type: "reasoning_summary",
        itemId: event.item_id,
        responseIndex: params.callIndex - 1,
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
      await params.onEvent({
        type: "reasoning_summary",
        itemId: event.item_id,
        responseIndex: params.callIndex - 1,
        outputIndex: event.output_index,
        sequenceNumber: event.sequence_number,
        summary: nextSummary,
      });
    }
  }

  const finalResponse = await getFinalResponseFromStream(
    params.stream,
    completedResponse,
    params.signal,
    toStreamDiagnostics(streamCounters, streamedText.length),
  );
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

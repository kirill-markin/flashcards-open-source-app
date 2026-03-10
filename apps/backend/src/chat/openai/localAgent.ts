import OpenAI from "openai";
import type {
  EasyInputMessage,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { LocalAssistantToolCall, LocalChatMessage, LocalChatStreamEvent } from "../localTypes";
import {
  buildLocalSystemInstructions,
  isRepairableToolCallError,
  makeLocalRepairStatusEvent,
  MAX_LOCAL_TOOL_REPAIR_ATTEMPTS,
  toLocalAssistantToolCall,
} from "../localRuntimeShared";
import { OPENAI_LOCAL_FLASHCARDS_TOOLS } from "./localTools";

const LOCAL_CHAT_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.2",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
]);

type LocalResponseStreamEvent = Readonly<{
  type: string;
  delta?: string;
}>;

type ResponseStreamLike = AsyncIterable<LocalResponseStreamEvent> & Readonly<{
  finalResponse: () => Promise<Readonly<{
    output: ReadonlyArray<Readonly<{ type: string }>>;
  }>>;
}>;

type OpenAIResponsesClient = Readonly<{
  responses: Readonly<{
    stream: (body: Readonly<Record<string, unknown>>) => ResponseStreamLike;
  }>;
}>;

type LocalChatLogEvent =
  | Readonly<{
    action: "request";
    requestId: string;
    model: string;
    messageCount: number;
  }>
  | Readonly<{
    action: "stream_opened";
    requestId: string;
    model: string;
    attempt: number;
  }>
  | Readonly<{
    action: "tool_call_validated";
    requestId: string;
    model: string;
    toolName: string;
    toolCallId: string;
  }>
  | Readonly<{
    action: "repair_attempt";
    requestId: string;
    model: string;
    attempt: number;
    maxAttempts: number;
    toolName: string | null;
    details: string;
  }>
  | Readonly<{
    action: "repair_exhausted";
    requestId: string;
    model: string;
    toolName: string | null;
  }>
  | Readonly<{
    action: "stream_closed";
    requestId: string;
    model: string;
    attempt: number;
    deltaCount: number;
    toolCallCount: number;
  }>;

type RepairPromptState = Readonly<{
  assistantText: string;
  prompt: string;
}>;

type ValidatedToolCall = Readonly<{
  toolCallId: string;
  name: string;
  input: string;
}>;

export type StreamLocalTurnParams = Readonly<{
  messages: ReadonlyArray<LocalChatMessage>;
  model: string;
  timezone: string;
  devicePlatform: "ios" | "web";
  requestId: string;
}>;

export class LocalChatRuntimeError extends Error {
  readonly code: string;
  readonly stage: string;

  constructor(message: string, code: string, stage: string) {
    super(message);
    this.code = code;
    this.stage = stage;
  }
}

function logLocalChatEvent(event: LocalChatLogEvent): void {
  console.error(JSON.stringify({
    domain: "chat",
    vendor: "openai",
    mode: "local_client",
    ...event,
  }));
}

function mapMessage(message: LocalChatMessage): ReadonlyArray<ResponseInputItem> {
  if (message.role === "user") {
    const userMessage: EasyInputMessage = {
      type: "message",
      role: "user",
      content: message.content,
    };
    return [userMessage];
  }

  if (message.role === "assistant") {
    const items: Array<ResponseInputItem> = [];

    if (message.content !== "") {
      items.push({
        type: "message",
        role: "assistant",
        content: message.content,
      });
    }

    for (const toolCall of message.toolCalls) {
      items.push({
        type: "function_call",
        call_id: toolCall.toolCallId,
        name: toolCall.name,
        arguments: toolCall.input,
      });
    }

    return items;
  }

  return [{
    type: "function_call_output",
    call_id: message.toolCallId,
    output: message.output,
  }];
}

function buildInput(
  messages: ReadonlyArray<LocalChatMessage>,
  repairState: RepairPromptState | null,
): ReadonlyArray<ResponseInputItem> {
  const items: Array<ResponseInputItem> = [];

  for (const message of messages) {
    items.push(...mapMessage(message));
  }

  if (repairState === null) {
    return items;
  }

  if (repairState.assistantText !== "") {
    items.push({
      type: "message",
      role: "assistant",
      content: repairState.assistantText,
    });
  }

  items.push({
    type: "message",
    role: "user",
    content: repairState.prompt,
  });

  return items;
}

function isFunctionToolCall(
  item: Readonly<{ type: string }>,
): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}

function createClient(): OpenAIResponsesClient {
  return new OpenAI();
}

function normalizeToolCall(
  toolCall: ResponseFunctionToolCall,
  params: Readonly<{ requestId: string; model: string }>,
): ValidatedToolCall {
  const normalizedToolCall = toLocalAssistantToolCall(toolCall.call_id, toolCall.name, toolCall.arguments);
  logLocalChatEvent({
    action: "tool_call_validated",
    requestId: params.requestId,
    model: params.model,
    toolName: toolCall.name,
    toolCallId: toolCall.call_id,
  });
  return {
    toolCallId: normalizedToolCall.toolCallId,
    name: normalizedToolCall.name,
    input: normalizedToolCall.input,
  };
}

function normalizeToolCalls(
  toolCalls: ReadonlyArray<ResponseFunctionToolCall>,
  params: Readonly<{ requestId: string; model: string }>,
): ReadonlyArray<LocalAssistantToolCall> {
  return toolCalls.map((toolCall) => normalizeToolCall(toolCall, params));
}

export function isSupportedLocalChatModel(model: string): boolean {
  return LOCAL_CHAT_MODEL_IDS.has(model);
}

export async function* streamLocalAgentTurn(
  params: StreamLocalTurnParams,
  client: OpenAIResponsesClient,
): AsyncGenerator<LocalChatStreamEvent> {
  logLocalChatEvent({
    action: "request",
    requestId: params.requestId,
    model: params.model,
    messageCount: params.messages.length,
  });

  let repairState: RepairPromptState | null = null;
  let streamedAssistantText = "";
  let deltaCount = 0;

  for (let repairAttempt = 0; repairAttempt <= MAX_LOCAL_TOOL_REPAIR_ATTEMPTS; repairAttempt++) {
    logLocalChatEvent({
      action: "stream_opened",
      requestId: params.requestId,
      model: params.model,
      attempt: repairAttempt + 1,
    });
    const stream = client.responses.stream({
      model: params.model,
      instructions: buildLocalSystemInstructions(params.timezone, params.devicePlatform),
      input: buildInput(params.messages, repairState),
      tools: OPENAI_LOCAL_FLASHCARDS_TOOLS,
      parallel_tool_calls: false,
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta !== undefined) {
        deltaCount += 1;
        streamedAssistantText += event.delta;
        yield { type: "delta", text: event.delta };
      }
    }

    const finalResponse = await stream.finalResponse();
    const toolCalls = finalResponse.output.filter(isFunctionToolCall);

    if (toolCalls.length === 0) {
      logLocalChatEvent({
        action: "stream_closed",
        requestId: params.requestId,
        model: params.model,
        attempt: repairAttempt + 1,
        deltaCount,
        toolCallCount: 0,
      });
      yield { type: "done" };
      return;
    }

    try {
      const normalizedToolCalls = normalizeToolCalls(toolCalls, {
        requestId: params.requestId,
        model: params.model,
      });
      logLocalChatEvent({
        action: "stream_closed",
        requestId: params.requestId,
        model: params.model,
        attempt: repairAttempt + 1,
        deltaCount,
        toolCallCount: normalizedToolCalls.length,
      });

      for (const toolCall of normalizedToolCalls) {
        yield {
          type: "tool_call_request",
          toolCallId: toolCall.toolCallId,
          name: toolCall.name,
          input: toolCall.input,
        };
      }

      yield { type: "await_tool_results" };
      return;
    } catch (error) {
      if (isRepairableToolCallError(error) === false) {
        throw error;
      }

      if (repairAttempt >= MAX_LOCAL_TOOL_REPAIR_ATTEMPTS) {
        logLocalChatEvent({
          action: "repair_exhausted",
          requestId: params.requestId,
          model: params.model,
          toolName: error.toolName,
        });
        throw new LocalChatRuntimeError(
          "Assistant could not prepare a valid tool call. Try again.",
          "LOCAL_TOOL_CALL_INVALID",
          "tool_call_validation",
        );
      }

      const nextAttempt = repairAttempt + 1;
      logLocalChatEvent({
        action: "repair_attempt",
        requestId: params.requestId,
        model: params.model,
        attempt: nextAttempt,
        maxAttempts: MAX_LOCAL_TOOL_REPAIR_ATTEMPTS,
        toolName: error.toolName,
        details: error.rawDetails,
      });
      repairState = {
        assistantText: streamedAssistantText,
        prompt: error.repairPrompt,
      };
      yield makeLocalRepairStatusEvent(nextAttempt, error.toolName);
    }
  }

  throw new LocalChatRuntimeError(
    "Assistant could not prepare a valid tool call. Try again.",
    "LOCAL_TOOL_CALL_INVALID",
    "tool_call_validation",
  );
}

export async function* streamLocalTurn(
  params: StreamLocalTurnParams,
): AsyncGenerator<LocalChatStreamEvent> {
  yield* streamLocalAgentTurn(params, createClient());
}

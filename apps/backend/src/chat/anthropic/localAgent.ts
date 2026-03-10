import Anthropic from "@anthropic-ai/sdk";
import type { LocalAssistantToolCall, LocalChatMessage, LocalChatStreamEvent } from "../localTypes";
import {
  buildLocalSystemInstructions,
  isRepairableToolCallError,
  makeLocalRepairStatusEvent,
  MAX_LOCAL_TOOL_REPAIR_ATTEMPTS,
  toLocalAssistantToolCall,
} from "../localRuntimeShared";
import { CHAT_MODELS } from "../models";
import { OPENAI_LOCAL_FLASHCARDS_TOOLS } from "../openai/localTools";

const LOCAL_CHAT_MODEL_IDS = new Set(
  CHAT_MODELS
    .filter((model) => model.vendor === "anthropic")
    .map((model) => model.id),
);

type AnthropicTextDeltaEvent = Readonly<{
  type: "content_block_delta";
  delta: Readonly<{
    type: "text_delta";
    text: string;
  }>;
}>;

type AnthropicLocalStreamEvent = AnthropicTextDeltaEvent | Readonly<{ type: string }>;

type AnthropicToolUseBlock = Readonly<{
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}>;

type AnthropicTextBlock = Readonly<{
  type: "text";
  text: string;
}>;

type AnthropicFinalMessage = Readonly<{
  content: ReadonlyArray<AnthropicToolUseBlock | AnthropicTextBlock | Readonly<{ type: string }>>;
  stop_reason: string | null;
}>;

type AnthropicMessageParam = Readonly<{
  role: "user" | "assistant";
  content: string | ReadonlyArray<Readonly<Record<string, unknown>>>;
}>;

type AnthropicStreamLike = AsyncIterable<AnthropicLocalStreamEvent> & Readonly<{
  finalMessage: () => Promise<AnthropicFinalMessage>;
}>;

type AnthropicMessagesClient = Readonly<{
  beta: Readonly<{
    messages: Readonly<{
      stream: (body: Readonly<Record<string, unknown>>) => AnthropicStreamLike;
    }>;
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

/**
 * Raised when the Anthropic local-turn runtime cannot recover a valid local
 * tool request after the configured repair attempts.
 */
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
    vendor: "anthropic",
    mode: "local_client",
    ...event,
  }));
}

function createClient(): AnthropicMessagesClient {
  return new Anthropic();
}

function localAnthropicTools(): ReadonlyArray<Anthropic.Tool> {
  return OPENAI_LOCAL_FLASHCARDS_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  }));
}

function parseToolInput(rawInput: string): unknown {
  return JSON.parse(rawInput) as unknown;
}

function mapMessage(message: LocalChatMessage): AnthropicMessageParam {
  if (message.role === "user") {
    return {
      role: "user",
      content: message.content,
    };
  }

  if (message.role === "assistant") {
    const content: Array<Readonly<Record<string, unknown>>> = [];

    if (message.content !== "") {
      content.push({
        type: "text",
        text: message.content,
      });
    }

    for (const toolCall of message.toolCalls) {
      content.push({
        type: "tool_use",
        id: toolCall.toolCallId,
        name: toolCall.name,
        input: parseToolInput(toolCall.input),
      });
    }

    return {
      role: "assistant",
      content,
    };
  }

  return {
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: message.output,
    }],
  };
}

function buildInput(
  messages: ReadonlyArray<LocalChatMessage>,
  repairState: RepairPromptState | null,
): ReadonlyArray<AnthropicMessageParam> {
  const items = messages.map(mapMessage);

  if (repairState === null) {
    return items;
  }

  const repairedItems = [...items];
  if (repairState.assistantText !== "") {
    repairedItems.push({
      role: "assistant",
      content: repairState.assistantText,
    });
  }
  repairedItems.push({
    role: "user",
    content: repairState.prompt,
  });
  return repairedItems;
}

function isToolUseBlock(block: AnthropicFinalMessage["content"][number]): block is AnthropicToolUseBlock {
  return block.type === "tool_use";
}

function normalizeToolCall(
  toolCall: AnthropicToolUseBlock,
  params: Readonly<{ requestId: string; model: string }>,
): ValidatedToolCall {
  const normalizedToolCall = toLocalAssistantToolCall(
    toolCall.id,
    toolCall.name,
    JSON.stringify(toolCall.input),
  );
  logLocalChatEvent({
    action: "tool_call_validated",
    requestId: params.requestId,
    model: params.model,
    toolName: toolCall.name,
    toolCallId: toolCall.id,
  });
  return {
    toolCallId: normalizedToolCall.toolCallId,
    name: normalizedToolCall.name,
    input: normalizedToolCall.input,
  };
}

function normalizeToolCalls(
  toolCalls: ReadonlyArray<AnthropicToolUseBlock>,
  params: Readonly<{ requestId: string; model: string }>,
): ReadonlyArray<LocalAssistantToolCall> {
  return toolCalls.map((toolCall) => {
    const normalizedToolCall = normalizeToolCall(toolCall, params);
    return {
      toolCallId: normalizedToolCall.toolCallId,
      name: normalizedToolCall.name,
      input: normalizedToolCall.input,
    };
  });
}

export function isSupportedLocalChatModel(model: string): boolean {
  return LOCAL_CHAT_MODEL_IDS.has(model);
}

/**
 * Streams one Anthropic local-turn without executing tools on the server. The
 * caller receives validated `tool_call_request` events and is responsible for
 * running those tools against the client-side local database.
 */
export async function* streamLocalAgentTurn(
  params: StreamLocalTurnParams,
  client: AnthropicMessagesClient,
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

  for (let repairAttempt = 0; repairAttempt <= MAX_LOCAL_TOOL_REPAIR_ATTEMPTS; repairAttempt += 1) {
    logLocalChatEvent({
      action: "stream_opened",
      requestId: params.requestId,
      model: params.model,
      attempt: repairAttempt + 1,
    });

    const stream = client.beta.messages.stream({
      model: params.model,
      max_tokens: 8_192,
      system: buildLocalSystemInstructions(params.timezone, params.devicePlatform),
      messages: buildInput(params.messages, repairState),
      tools: localAnthropicTools(),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        deltaCount += 1;
        streamedAssistantText += event.delta.text;
        yield {
          type: "delta",
          text: event.delta.text,
        };
      }
    }

    const finalMessage = await stream.finalMessage();
    const toolCalls = finalMessage.content.filter(isToolUseBlock);

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

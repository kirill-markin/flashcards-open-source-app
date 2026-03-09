import OpenAI from "openai";
import type {
  EasyInputMessage,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { LocalChatMessage, LocalChatStreamEvent } from "../localTypes";
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

type ResponseStreamLike = AsyncIterable<LocalResponseStreamEvent> & {
  finalResponse: () => Promise<Readonly<{
    output: ReadonlyArray<Readonly<{ type: string }>>;
  }>>;
};

type OpenAIResponsesClient = Readonly<{
  responses: Readonly<{
    stream: (body: Readonly<Record<string, unknown>>) => ResponseStreamLike;
  }>;
}>;

export type StreamLocalTurnParams = Readonly<{
  messages: ReadonlyArray<LocalChatMessage>;
  model: string;
  timezone: string;
}>;

function formatDatetime(timezone: string): string {
  const now = new Date();
  const utc = now.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const local = now.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
  return `Current datetime - UTC: ${utc} | User local (${timezone}): ${local}`;
}

function buildLocalSystemInstructions(timezone: string): string {
  return [
    "You are a flashcards assistant for an offline-first flashcards app on iPhone.",
    "The local device database is the source of truth for reads.",
    "Use only the provided local tools to inspect workspace data.",
    "You may propose changes, but before any write tool call you must describe the exact change and then wait for explicit user confirmation.",
    "Use write tools only after the latest user message clearly confirms the exact proposed change.",
    "Never mutate hidden FSRS fields, sync metadata, outbox rows, cloud settings, or arbitrary local tables directly.",
    "Keep answers concise, direct, and operational.",
    formatDatetime(timezone),
  ].join("\n");
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

function buildInput(messages: ReadonlyArray<LocalChatMessage>): ReadonlyArray<ResponseInputItem> {
  const items: Array<ResponseInputItem> = [];

  for (const message of messages) {
    items.push(...mapMessage(message));
  }

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

export function isSupportedLocalChatModel(model: string): boolean {
  return LOCAL_CHAT_MODEL_IDS.has(model);
}

export async function* streamLocalAgentTurn(
  params: StreamLocalTurnParams,
  client: OpenAIResponsesClient,
): AsyncGenerator<LocalChatStreamEvent> {
  const stream = client.responses.stream({
    model: params.model,
    instructions: buildLocalSystemInstructions(params.timezone),
    input: buildInput(params.messages),
    tools: OPENAI_LOCAL_FLASHCARDS_TOOLS,
    parallel_tool_calls: false,
  });

  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && event.delta !== undefined) {
      yield { type: "delta", text: event.delta };
    }
  }

  const finalResponse = await stream.finalResponse();
  const toolCalls = finalResponse.output.filter(isFunctionToolCall);
  if (toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      yield {
        type: "tool_call_request",
        toolCallId: toolCall.call_id,
        name: toolCall.name,
        input: toolCall.arguments,
      };
    }
    yield { type: "await_tool_results" };
    return;
  }

  yield { type: "done" };
}

export async function* streamLocalTurn(
  params: StreamLocalTurnParams,
): AsyncGenerator<LocalChatStreamEvent> {
  yield* streamLocalAgentTurn(params, createClient());
}

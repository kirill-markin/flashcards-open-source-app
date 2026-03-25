import type OpenAI from "openai";
import type { ChatMessage } from "../types";

export type StoredOpenAIReplayReasoningItem = Readonly<{
  type: "reasoning";
  summary: OpenAI.Responses.ResponseReasoningItem["summary"];
  encrypted_content: string;
  status?: OpenAI.Responses.ResponseReasoningItem["status"];
}>;

export type StoredOpenAIReplayMessage = Readonly<{
  type: "message";
  role: "assistant";
  status: OpenAI.Responses.ResponseOutputMessage["status"];
  content: OpenAI.Responses.ResponseOutputMessage["content"];
  phase?: OpenAI.Responses.ResponseOutputMessage["phase"];
}>;

export type StoredOpenAIReplayFunctionToolCall = Readonly<{
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  status?: OpenAI.Responses.ResponseFunctionToolCall["status"];
}>;

export type StoredOpenAIReplayFunctionCallOutput = Readonly<{
  type: "function_call_output";
  call_id: string;
  output: OpenAI.Responses.ResponseInputItem.FunctionCallOutput["output"];
  status?: OpenAI.Responses.ResponseInputItem.FunctionCallOutput["status"];
}>;

export type StoredOpenAIReplayItem =
  | StoredOpenAIReplayReasoningItem
  | StoredOpenAIReplayMessage
  | StoredOpenAIReplayFunctionToolCall
  | StoredOpenAIReplayFunctionCallOutput;

type LegacyStoredOpenAIReplayItem =
  | OpenAI.Responses.ResponseOutputMessage
  | OpenAI.Responses.ResponseReasoningItem
  | OpenAI.Responses.ResponseFunctionToolCall
  | OpenAI.Responses.ResponseInputItem.FunctionCallOutput;

type NormalizeStoredOpenAIReplayItemsResult = Readonly<{
  items: ReadonlyArray<StoredOpenAIReplayItem>;
  droppedReasoningItems: number;
}>;

export type ServerChatMessage = ChatMessage & Readonly<{
  openaiItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

export function toStoredOpenAIReplayItem(
  item: OpenAI.Responses.ResponseOutputItem | OpenAI.Responses.ResponseInputItem.FunctionCallOutput,
): StoredOpenAIReplayItem {
  if (item.type === "message") {
    return {
      type: "message",
      role: item.role,
      status: item.status,
      content: item.content,
      ...(item.phase !== undefined ? { phase: item.phase } : {}),
    };
  }

  if (item.type === "reasoning") {
    if (typeof item.encrypted_content !== "string" || item.encrypted_content.length === 0) {
      throw new Error("OpenAI reasoning item is missing encrypted_content for stateless replay");
    }

    return {
      type: "reasoning",
      summary: item.summary,
      encrypted_content: item.encrypted_content,
      ...(item.status !== undefined ? { status: item.status } : {}),
    };
  }

  if (item.type === "function_call") {
    return {
      type: "function_call",
      call_id: item.call_id,
      name: item.name,
      arguments: item.arguments,
      ...(item.status !== undefined ? { status: item.status } : {}),
    };
  }

  if (item.type === "function_call_output") {
    return {
      type: "function_call_output",
      call_id: item.call_id,
      output: item.output,
      ...(item.status !== undefined && item.status !== null ? { status: item.status } : {}),
    };
  }

  throw new Error(`Unsupported OpenAI response item for chat replay: ${item.type}`);
}

function normalizeStoredOpenAIReplayItem(
  item: StoredOpenAIReplayItem | LegacyStoredOpenAIReplayItem,
): StoredOpenAIReplayItem | null {
  if (item.type === "message") {
    return {
      type: "message",
      role: item.role,
      status: item.status,
      content: item.content,
      ...(item.phase !== undefined ? { phase: item.phase } : {}),
    };
  }

  if (item.type === "reasoning") {
    if (typeof item.encrypted_content !== "string" || item.encrypted_content.length === 0) {
      return null;
    }

    return {
      type: "reasoning",
      summary: item.summary,
      encrypted_content: item.encrypted_content,
      ...(item.status !== undefined ? { status: item.status } : {}),
    };
  }

  if (item.type === "function_call") {
    return {
      type: "function_call",
      call_id: item.call_id,
      name: item.name,
      arguments: item.arguments,
      ...(item.status !== undefined ? { status: item.status } : {}),
    };
  }

  if (item.type === "function_call_output") {
    return {
      type: "function_call_output",
      call_id: item.call_id,
      output: item.output,
      ...(item.status !== undefined && item.status !== null ? { status: item.status } : {}),
    };
  }

  return null;
}

export function normalizeStoredOpenAIReplayItems(
  items: ReadonlyArray<StoredOpenAIReplayItem | LegacyStoredOpenAIReplayItem>,
): NormalizeStoredOpenAIReplayItemsResult {
  const normalizedItems: Array<StoredOpenAIReplayItem> = [];
  let droppedReasoningItems = 0;

  for (const item of items) {
    const normalizedItem = normalizeStoredOpenAIReplayItem(item);
    if (normalizedItem === null) {
      if (item.type === "reasoning") {
        droppedReasoningItems += 1;
      }
      continue;
    }

    normalizedItems.push(normalizedItem);
  }

  return {
    items: normalizedItems,
    droppedReasoningItems,
  };
}

export function toOpenAIResponseInputItem(
  item: StoredOpenAIReplayItem,
): OpenAI.Responses.ResponseInputItem {
  return item as unknown as OpenAI.Responses.ResponseInputItem;
}

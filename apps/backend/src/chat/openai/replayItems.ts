/**
 * Conversion helpers between persisted replay items and OpenAI Responses input items.
 * The backend-owned chat stack stores only the minimal replay shape needed to resume stateless turns safely.
 */
import type OpenAI from "openai";
import type { ChatMessage } from "../types";

export type StoredOpenAIReplayReasoningItem = Readonly<{
  type: "reasoning";
  summary: OpenAI.Responses.ResponseReasoningItem["summary"];
  encrypted_content: string;
  status?: OpenAI.Responses.ResponseReasoningItem["status"];
  /**
   * True when the item was produced with the person's own OpenAI key. An item stored without it was produced with
   * the platform key. Never sent to OpenAI.
   */
  user_supplied_key?: boolean;
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

/**
 * Emitted by OpenAI server-side compaction. It stands in for every input and output item before it, so replay
 * starts at the latest one.
 */
export type StoredOpenAIReplayCompactionItem = Readonly<{
  type: "compaction";
  id: string;
  encrypted_content: string;
  /** As on reasoning items. Never sent to OpenAI. */
  user_supplied_key: boolean;
}>;

export type StoredOpenAIReplayItem =
  | StoredOpenAIReplayReasoningItem
  | StoredOpenAIReplayCompactionItem
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

/**
 * Converts one provider item into the persisted replay shape stored with assistant messages.
 */
export function toStoredOpenAIReplayItem(
  item: OpenAI.Responses.ResponseOutputItem | OpenAI.Responses.ResponseInputItem.FunctionCallOutput,
  userSuppliedKey: boolean,
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
    const encryptedContent = item.encrypted_content;
    if (typeof encryptedContent !== "string" || encryptedContent.length === 0) {
      throw new Error("OpenAI reasoning item is missing encrypted_content for stateless replay");
    }

    return {
      type: "reasoning",
      summary: item.summary,
      encrypted_content: encryptedContent,
      ...(item.status !== undefined ? { status: item.status } : {}),
      user_supplied_key: userSuppliedKey,
    };
  }

  if (item.type === "compaction") {
    const encryptedContent = item.encrypted_content;
    if (typeof encryptedContent !== "string" || encryptedContent.length === 0) {
      throw new Error("OpenAI compaction item is missing encrypted_content for stateless replay");
    }

    return {
      type: "compaction",
      id: item.id,
      encrypted_content: encryptedContent,
      user_supplied_key: userSuppliedKey,
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
    const callId = item.call_id;
    if (typeof callId !== "string" || callId.length === 0) {
      throw new Error("OpenAI function call output is missing call_id for stateless replay");
    }

    return {
      type: "function_call_output",
      call_id: callId,
      output: item.output,
      ...(item.status !== undefined && item.status !== null ? { status: item.status } : {}),
    };
  }

  throw new Error(`Unsupported OpenAI response item for chat replay: ${item.type}`);
}

/**
 * Normalizes one persisted or legacy replay item into the canonical replay shape used by the new runtime.
 */
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
    const encryptedContent = item.encrypted_content;
    if (typeof encryptedContent !== "string" || encryptedContent.length === 0) {
      return null;
    }

    return {
      type: "reasoning",
      summary: item.summary,
      encrypted_content: encryptedContent,
      ...(item.status !== undefined ? { status: item.status } : {}),
      user_supplied_key: "user_supplied_key" in item && item.user_supplied_key === true,
    };
  }

  if (item.type === "compaction") {
    return {
      type: "compaction",
      id: item.id,
      encrypted_content: item.encrypted_content,
      user_supplied_key: item.user_supplied_key === true,
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
    const callId = item.call_id;
    if (typeof callId !== "string" || callId.length === 0) {
      return null;
    }

    return {
      type: "function_call_output",
      call_id: callId,
      output: item.output,
      ...(item.status !== undefined && item.status !== null ? { status: item.status } : {}),
    };
  }

  return null;
}

/**
 * Normalizes stored replay items and drops reasoning items that cannot be replayed safely.
 */
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

/**
 * Drops the reasoning and compaction items of earlier turns that the other key produced. Their encrypted_content
 * belongs to the OpenAI organization that produced it, and a session can switch between the platform key and the
 * person's own key from one turn to the next. The turns' messages and tool calls are kept, as when normalization
 * drops a reasoning item it cannot replay, so replay then starts at an earlier compaction item of this key or none.
 */
export function dropHistoryEncryptedItemsFromOtherKey(
  messages: ReadonlyArray<ServerChatMessage>,
  userSuppliedKey: boolean,
): Readonly<{
  messages: ReadonlyArray<ServerChatMessage>;
  droppedReasoningItems: number;
  droppedCompactionItems: number;
}> {
  let droppedReasoningItems = 0;
  let droppedCompactionItems = 0;
  const keptMessages = messages.map((message) => {
    if (message.openaiItems === undefined) {
      return message;
    }
    const openaiItems = message.openaiItems.filter((item) => {
      if (item.type !== "reasoning" && item.type !== "compaction") {
        return true;
      }
      if ((item.user_supplied_key === true) === userSuppliedKey) {
        return true;
      }
      if (item.type === "reasoning") {
        droppedReasoningItems += 1;
      } else {
        droppedCompactionItems += 1;
      }
      return false;
    });
    return { ...message, openaiItems };
  });
  return { messages: keptMessages, droppedReasoningItems, droppedCompactionItems };
}

function findLatestCompactionItemIndex(
  items: ReadonlyArray<StoredOpenAIReplayItem>,
): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].type === "compaction") {
      return index;
    }
  }
  return -1;
}

/**
 * Returns the items to replay from the latest compaction item onward, or null when there is none. OpenAI ignores
 * every input item before the latest compaction item, so a function call made before it and answered after it moves
 * right after it, with the reasoning just before that call; otherwise OpenAI rejects the output with "No tool call
 * found for function call output".
 */
export function sliceReplayItemsFromLatestCompaction(
  items: ReadonlyArray<StoredOpenAIReplayItem>,
): ReadonlyArray<StoredOpenAIReplayItem> | null {
  const compactionIndex = findLatestCompactionItemIndex(items);
  if (compactionIndex === -1) {
    return null;
  }

  const itemsAfterCompaction = items.slice(compactionIndex + 1);
  const callIdsAnsweredAfterCompaction = new Set(
    itemsAfterCompaction.filter((item) => item.type === "function_call_output").map((item) => item.call_id),
  );
  const movedItems: Array<StoredOpenAIReplayItem> = [];
  let movesPrecedingReasoning = false;
  for (let index = compactionIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === "function_call" && callIdsAnsweredAfterCompaction.has(item.call_id)) {
      movedItems.push(item);
      movesPrecedingReasoning = true;
      continue;
    }
    if (item.type === "reasoning" && movesPrecedingReasoning) {
      movedItems.push(item);
      continue;
    }
    movesPrecedingReasoning = false;
  }

  return [items[compactionIndex], ...movedItems.reverse(), ...itemsAfterCompaction];
}

/**
 * Converts a persisted replay item back into the OpenAI Responses input shape expected by replay.
 */
export function toOpenAIResponseInputItem(
  item: StoredOpenAIReplayItem,
): OpenAI.Responses.ResponseInputItem {
  if (item.type === "reasoning") {
    return {
      type: "reasoning",
      summary: item.summary,
      encrypted_content: item.encrypted_content,
      ...(item.status !== undefined ? { status: item.status } : {}),
    } as unknown as OpenAI.Responses.ResponseInputItem;
  }
  if (item.type === "compaction") {
    return {
      type: "compaction",
      id: item.id,
      encrypted_content: item.encrypted_content,
    };
  }
  return item as unknown as OpenAI.Responses.ResponseInputItem;
}

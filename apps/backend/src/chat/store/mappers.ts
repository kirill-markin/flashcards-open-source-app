import {
  emptyChatComposerSuggestions,
  parsePersistedChatComposerSuggestions,
} from "../composerSuggestions";
import type { StoredMessage } from "../history";
import type {
  ServerChatMessage,
  StoredOpenAIReplayItem,
} from "../openai/replayItems";
import type { ContentPart } from "../types";
import type {
  ChatSessionSnapshot,
  PersistedChatMessageItem,
} from "./types";
import type {
  ChatItemRow,
  ChatItemPayload,
  ChatSessionRow,
} from "./repository";

export function parseMainContentInvalidationVersion(
  value: string | number,
  operation: string,
): number {
  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Chat session ${operation} returned an invalid main_content_invalidation_version`);
  }

  return parsedValue;
}

export function mapSessionRow(
  row: ChatSessionRow,
): Omit<ChatSessionSnapshot, "messages"> {
  if (
    row.active_composer_suggestion_generation_id !== null
    && row.active_generation_suggestions === null
  ) {
    throw new Error(
      `Chat session ${row.session_id} is missing active composer suggestion generation ${row.active_composer_suggestion_generation_id}`,
    );
  }

  return {
    sessionId: row.session_id,
    runState: row.status,
    activeRunId: row.active_run_id,
    updatedAt: new Date(row.updated_at).getTime(),
    activeRunHeartbeatAt: row.active_run_heartbeat_at === null
      ? null
      : new Date(row.active_run_heartbeat_at).getTime(),
    composerSuggestions: row.active_composer_suggestion_generation_id === null
      ? emptyChatComposerSuggestions()
      : parsePersistedChatComposerSuggestions(
        row.active_generation_suggestions,
        `session ${row.session_id} active generation ${row.active_composer_suggestion_generation_id}`,
      ),
    mainContentInvalidationVersion: parseMainContentInvalidationVersion(
      row.main_content_invalidation_version,
      "read",
    ),
  };
}

export function parseItemOrder(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Chat item has an invalid item_order: ${String(value)}`);
  }
  return parsed;
}

export function mapChatItemRow(row: ChatItemRow): PersistedChatMessageItem {
  return {
    itemId: row.item_id,
    sessionId: row.session_id,
    itemOrder: parseItemOrder(row.item_order),
    role: row.payload.role,
    content: row.payload.content,
    openaiItems: row.payload.role === "assistant" ? row.payload.openaiItems : undefined,
    state: row.state,
    isError: row.state === "error",
    isStopped: row.state === "cancelled",
    timestamp: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export function mapPersistedMessagesToStoredMessages(
  messages: ReadonlyArray<PersistedChatMessageItem>,
): ReadonlyArray<StoredMessage> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    isError: message.isError,
    isStopped: message.isStopped,
    cursor: String(message.itemOrder),
    itemId: message.role === "assistant" ? message.itemId : null,
  }));
}

export function toChatItemPayload(
  role: "user" | "assistant",
  content: ReadonlyArray<ContentPart>,
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>,
): ChatItemPayload {
  return {
    role,
    content,
    ...(role === "assistant" && assistantOpenAIItems !== undefined
      ? { openaiItems: assistantOpenAIItems }
      : {}),
  };
}

export function stripBase64FromContentParts(
  parts: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> {
  return parts.map((part) => {
    if (part.type === "image") {
      return { type: "image" as const, mediaType: part.mediaType, base64Data: "" };
    }
    if (part.type === "file") {
      return { type: "file" as const, mediaType: part.mediaType, base64Data: "", fileName: part.fileName };
    }
    return part;
  });
}

export function buildLocalChatMessages(
  messages: ReadonlyArray<PersistedChatMessageItem>,
): ReadonlyArray<ServerChatMessage> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.openaiItems !== undefined ? { openaiItems: message.openaiItems } : {}),
  }));
}

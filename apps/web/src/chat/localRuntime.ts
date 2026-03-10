import type { ContentPart, LocalChatMessage, LocalChatStreamEvent } from "../types";
import { LOCAL_TOOL_NAMES } from "./localToolExecutor";
import type { StoredMessage } from "./useChatHistory";

const LOCAL_TOOL_NAME_SET = new Set<string>(LOCAL_TOOL_NAMES);

function isLocalToolName(name: string): boolean {
  return LOCAL_TOOL_NAME_SET.has(name);
}

/**
 * Converts persisted web chat history into the local-turn wire format shared
 * by iOS and the browser runtime. Completed client-side tool calls are still
 * emitted as explicit `tool` messages so later turns can continue after local
 * mutations, while provider-side tool calls remain inside assistant content.
 */
export function toLocalChatMessages(messages: ReadonlyArray<StoredMessage>): ReadonlyArray<LocalChatMessage> {
  const localMessages: Array<LocalChatMessage> = [];

  for (const message of messages) {
    localMessages.push({
      role: message.role,
      content: message.content,
    });

    if (message.role !== "assistant") {
      continue;
    }

    for (const part of message.content) {
      if (part.type !== "tool_call" || part.status !== "completed" || part.output === null || isLocalToolName(part.name) === false) {
        continue;
      }

      localMessages.push({
        role: "tool",
        toolCallId: part.toolCallId,
        name: part.name,
        output: part.output,
      });
    }
  }

  return localMessages;
}

export function parseLocalSSELine(line: string): LocalChatStreamEvent | null {
  if (!line.startsWith("data: ")) {
    return null;
  }

  try {
    return JSON.parse(line.slice(6)) as LocalChatStreamEvent;
  } catch {
    return null;
  }
}

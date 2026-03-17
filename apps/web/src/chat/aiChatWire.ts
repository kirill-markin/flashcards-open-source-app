import type { AIChatTurnStreamEvent, AIChatWireMessage, ContentPart } from "../types";
import type { StoredMessage } from "./useChatHistory";

/**
 * Converts persisted web chat history into the backend chat wire format.
 * Assistant tool-call parts stay visible in local history, but they are not
 * replayed back to the backend as standalone tool-output messages.
 */
export function toAIChatMessages(messages: ReadonlyArray<StoredMessage>): ReadonlyArray<AIChatWireMessage> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.filter((part): part is ContentPart => {
      return message.role !== "assistant" || part.type !== "tool_call";
    }),
  }));
}

export function parseAIChatSSELine(line: string): AIChatTurnStreamEvent | null {
  if (!line.startsWith("data: ")) {
    return null;
  }

  try {
    return JSON.parse(line.slice(6)) as AIChatTurnStreamEvent;
  } catch {
    return null;
  }
}

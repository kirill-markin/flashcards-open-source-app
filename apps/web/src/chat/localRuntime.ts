import type { ContentPart, LocalAssistantToolCall, LocalChatMessage, LocalChatStreamEvent } from "../types";
import type { StoredMessage } from "./useChatHistory";

function contentPartToText(part: ContentPart): string {
  if (part.type === "text") {
    return part.text;
  }

  if (part.type === "image") {
    return "[image attached]";
  }

  if (part.type === "file") {
    return `[${part.fileName}]`;
  }

  return "";
}

function messageTextContent(content: ReadonlyArray<ContentPart>): string {
  return content
    .map(contentPartToText)
    .filter((part) => part !== "")
    .join("\n");
}

function assistantToolCalls(content: ReadonlyArray<ContentPart>): ReadonlyArray<LocalAssistantToolCall> {
  return content
    .filter((part): part is Extract<ContentPart, { type: "tool_call" }> => part.type === "tool_call")
    .map((part) => ({
      toolCallId: part.toolCallId,
      name: part.name,
      input: part.input ?? "{}",
    }));
}

/**
 * Local-turn history is text-only. If any browser message contains images or
 * files, the caller must keep using the server chat runtime for that thread.
 */
export function chatHistorySupportsLocalRuntime(messages: ReadonlyArray<StoredMessage>): boolean {
  return messages.every((message) => message.content.every((part) => part.type !== "image" && part.type !== "file"));
}

/**
 * Converts persisted web chat history into the local-turn wire format shared
 * by iOS and the browser local runtime. Tool outputs are emitted as explicit
 * `tool` messages so later turns can resume after prior local tool usage.
 */
export function toLocalChatMessages(messages: ReadonlyArray<StoredMessage>): ReadonlyArray<LocalChatMessage> {
  const localMessages: Array<LocalChatMessage> = [];

  for (const message of messages) {
    if (message.role === "user") {
      localMessages.push({
        role: "user",
        content: messageTextContent(message.content),
      });
      continue;
    }

    const content = messageTextContent(message.content);
    const toolCalls = assistantToolCalls(message.content);
    if (content !== "" || toolCalls.length > 0) {
      localMessages.push({
        role: "assistant",
        content,
        toolCalls,
      });
    }

    for (const part of message.content) {
      if (part.type === "tool_call" && part.status === "completed" && part.output !== null) {
        localMessages.push({
          role: "tool",
          toolCallId: part.toolCallId,
          name: part.name,
          output: part.output,
        });
      }
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

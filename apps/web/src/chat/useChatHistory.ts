import { useCallback, useState } from "react";
import type { ContentPart } from "../types";

export type StoredMessage = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  timestamp: number;
  isError: boolean;
  isStopped: boolean;
}>;

type ChatHistoryState = Readonly<{
  messages: ReadonlyArray<StoredMessage>;
  replaceMessages: (messages: ReadonlyArray<StoredMessage>) => void;
  appendUserMessage: (content: ReadonlyArray<ContentPart>) => void;
  startAssistantMessage: (initialText: string | null) => void;
  markAssistantError: (errorText: string) => void;
  clearHistory: () => void;
}>;

export const OPTIMISTIC_ASSISTANT_STATUS_TEXT = "Looking through your cards...";

function isOptimisticAssistantStatusContent(content: ReadonlyArray<ContentPart>): boolean {
  return content.length === 1
    && content[0]?.type === "text"
    && content[0].text === OPTIMISTIC_ASSISTANT_STATUS_TEXT;
}

export function appendAssistantErrorContent(
  content: ReadonlyArray<ContentPart>,
  errorText: string,
): ReadonlyArray<ContentPart> {
  if (isOptimisticAssistantStatusContent(content) || content.length === 0) {
    return [{ type: "text", text: errorText }];
  }

  const lastPart = content[content.length - 1];
  const errorPrefix = lastPart?.type === "text" ? "\n\n" : "";

  return [...content, { type: "text", text: `${errorPrefix}${errorText}` }];
}

export function useChatHistory(): ChatHistoryState {
  const [messages, setMessages] = useState<ReadonlyArray<StoredMessage>>([]);

  const replaceMessages = useCallback((nextMessages: ReadonlyArray<StoredMessage>): void => {
    setMessages(nextMessages);
  }, []);

  const appendUserMessage = useCallback((content: ReadonlyArray<ContentPart>): void => {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        role: "user",
        content,
        timestamp: Date.now(),
        isError: false,
        isStopped: false,
      },
    ]);
  }, []);

  const startAssistantMessage = useCallback((initialText: string | null): void => {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        role: "assistant",
        content: initialText === null ? [] : [{ type: "text", text: initialText }],
        timestamp: Date.now(),
        isError: false,
        isStopped: false,
      },
    ]);
  }, []);

  const markAssistantError = useCallback((errorText: string): void => {
    setMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return [
          ...currentMessages,
          {
            role: "assistant",
            content: [{ type: "text", text: errorText }],
            timestamp: Date.now(),
            isError: true,
            isStopped: false,
          },
        ];
      }

      return [
        ...currentMessages.slice(0, -1),
        {
          ...lastMessage,
          content: appendAssistantErrorContent(lastMessage.content, errorText),
          isError: true,
        },
      ];
    });
  }, []);

  const clearHistory = useCallback((): void => {
    setMessages([]);
  }, []);

  return {
    messages,
    replaceMessages,
    appendUserMessage,
    startAssistantMessage,
    markAssistantError,
    clearHistory,
  };
}

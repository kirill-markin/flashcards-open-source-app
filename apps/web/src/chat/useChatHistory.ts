import { useCallback, useState } from "react";
import type { ContentPart, ReasoningSummaryContentPart, ToolCallContentPart } from "../types";

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
  appendAssistantText: (text: string) => void;
  upsertAssistantToolCall: (toolCall: ToolCallContentPart) => void;
  upsertAssistantReasoningSummary: (summary: string) => void;
  finishAssistantMessage: (isError: boolean, isStopped: boolean) => void;
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

function removeOptimisticAssistantStatusContent(
  content: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> {
  return isOptimisticAssistantStatusContent(content) ? [] : content;
}

function appendAssistantTextContent(
  content: ReadonlyArray<ContentPart>,
  text: string,
): ReadonlyArray<ContentPart> {
  if (text === "") {
    return content;
  }

  const normalizedContent = removeOptimisticAssistantStatusContent(content);
  const lastPart = normalizedContent[normalizedContent.length - 1];
  if (lastPart?.type === "text") {
    return [
      ...normalizedContent.slice(0, -1),
      { type: "text", text: lastPart.text + text },
    ];
  }

  return [...normalizedContent, { type: "text", text }];
}

function upsertAssistantToolCallContent(
  content: ReadonlyArray<ContentPart>,
  toolCall: ToolCallContentPart,
): ReadonlyArray<ContentPart> {
  const normalizedContent = removeOptimisticAssistantStatusContent(content);
  const existingIndex = normalizedContent.findIndex((part) => {
    return part.type === "tool_call"
      && part.name === toolCall.name
      && part.input === toolCall.input;
  });

  if (existingIndex < 0) {
    return [...normalizedContent, toolCall];
  }

  return normalizedContent.map((part, index) => index === existingIndex ? toolCall : part);
}

function upsertAssistantReasoningSummaryContent(
  content: ReadonlyArray<ContentPart>,
  summary: string,
): ReadonlyArray<ContentPart> {
  const normalizedContent = removeOptimisticAssistantStatusContent(content);
  const reasoningSummaryPart: ReasoningSummaryContentPart = {
    type: "reasoning_summary",
    summary,
  };
  const existingIndex = normalizedContent.findIndex((part) => part.type === "reasoning_summary");

  if (existingIndex < 0) {
    return [reasoningSummaryPart, ...normalizedContent];
  }

  return normalizedContent.map((part, index) => index === existingIndex ? reasoningSummaryPart : part);
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

  const appendAssistantText = useCallback((text: string): void => {
    setMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return [
          ...currentMessages,
          {
            role: "assistant",
            content: appendAssistantTextContent([], text),
            timestamp: Date.now(),
            isError: false,
            isStopped: false,
          },
        ];
      }

      return [
        ...currentMessages.slice(0, -1),
        {
          ...lastMessage,
          content: appendAssistantTextContent(lastMessage.content, text),
        },
      ];
    });
  }, []);

  const upsertAssistantToolCall = useCallback((toolCall: ToolCallContentPart): void => {
    setMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return [
          ...currentMessages,
          {
            role: "assistant",
            content: upsertAssistantToolCallContent([], toolCall),
            timestamp: Date.now(),
            isError: false,
            isStopped: false,
          },
        ];
      }

      return [
        ...currentMessages.slice(0, -1),
        {
          ...lastMessage,
          content: upsertAssistantToolCallContent(lastMessage.content, toolCall),
        },
      ];
    });
  }, []);

  const upsertAssistantReasoningSummary = useCallback((summary: string): void => {
    setMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return [
          ...currentMessages,
          {
            role: "assistant",
            content: upsertAssistantReasoningSummaryContent([], summary),
            timestamp: Date.now(),
            isError: false,
            isStopped: false,
          },
        ];
      }

      return [
        ...currentMessages.slice(0, -1),
        {
          ...lastMessage,
          content: upsertAssistantReasoningSummaryContent(lastMessage.content, summary),
        },
      ];
    });
  }, []);

  const finishAssistantMessage = useCallback((isError: boolean, isStopped: boolean): void => {
    setMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return currentMessages;
      }

      return [
        ...currentMessages.slice(0, -1),
        {
          ...lastMessage,
          isError,
          isStopped,
        },
      ];
    });
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
    appendAssistantText,
    upsertAssistantToolCall,
    upsertAssistantReasoningSummary,
    finishAssistantMessage,
    markAssistantError,
    clearHistory,
  };
}

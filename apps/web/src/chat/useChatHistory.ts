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
  upsertAssistantReasoningSummary: (reasoningSummary: ReasoningSummaryContentPart) => void;
  completeAssistantReasoningSummary: (reasoningId: string) => void;
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
  const toolCallId = resolveToolCallId(toolCall);
  const existingIndex = normalizedContent.findIndex((part) => {
    return part.type === "tool_call"
      && toolCallId !== null
      && resolveToolCallId(part) === toolCallId;
  });

  if (existingIndex < 0) {
    return [...normalizedContent, toolCall];
  }

  return normalizedContent.map((part, index) => index === existingIndex ? toolCall : part);
}

function resolveToolCallId(part: ToolCallContentPart): string | null {
  if (part.id !== undefined && part.id !== "") {
    return part.id;
  }

  const itemId = part.streamPosition?.itemId;
  const outputIndex = part.streamPosition?.outputIndex;
  if (itemId === undefined || itemId === "" || outputIndex === undefined) {
    return null;
  }

  return `${itemId}:${String(outputIndex)}`;
}

function resolveReasoningId(part: ReasoningSummaryContentPart): string | null {
  if (part.reasoningId !== undefined && part.reasoningId !== "") {
    return part.reasoningId;
  }

  return part.streamPosition?.itemId ?? null;
}

function upsertAssistantReasoningSummaryContent(
  content: ReadonlyArray<ContentPart>,
  reasoningSummary: ReasoningSummaryContentPart,
): ReadonlyArray<ContentPart> {
  const normalizedContent = removeOptimisticAssistantStatusContent(content);
  const reasoningId = resolveReasoningId(reasoningSummary);
  const existingIndex = normalizedContent.findIndex((part) =>
    part.type === "reasoning_summary"
    && reasoningId !== null
    && resolveReasoningId(part) === reasoningId,
  );

  if (existingIndex < 0) {
    return [reasoningSummary, ...normalizedContent];
  }

  return normalizedContent.map((part, index) => {
    if (index !== existingIndex || part.type !== "reasoning_summary") {
      return part;
    }

    return {
      ...part,
      ...reasoningSummary,
      summary: reasoningSummary.summary === "" ? part.summary : reasoningSummary.summary,
      status: reasoningSummary.status ?? part.status ?? "completed",
      reasoningId: reasoningSummary.reasoningId ?? part.reasoningId,
      streamPosition: reasoningSummary.streamPosition ?? part.streamPosition,
    };
  });
}

function completeAssistantReasoningSummaryContent(
  content: ReadonlyArray<ContentPart>,
  reasoningId: string,
): ReadonlyArray<ContentPart> {
  return content.reduce<ContentPart[]>((nextContent, part) => {
    if (part.type !== "reasoning_summary" || resolveReasoningId(part) !== reasoningId) {
      nextContent.push(part);
      return nextContent;
    }

    if (part.summary === "") {
      return nextContent;
    }

    nextContent.push({
      ...part,
      status: "completed" as const,
    });
    return nextContent;
  }, []);
}

function finalizeAssistantContent(
  content: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> {
  const normalizedContent = removeOptimisticAssistantStatusContent(content);
  return normalizedContent.reduce<ContentPart[]>((nextContent, part) => {
    if (part.type !== "reasoning_summary") {
      nextContent.push(part);
      return nextContent;
    }

    if (part.summary === "") {
      return nextContent;
    }

    nextContent.push({
      ...part,
      status: "completed" as const,
    });
    return nextContent;
  }, []);
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

  const upsertAssistantReasoningSummary = useCallback((reasoningSummary: ReasoningSummaryContentPart): void => {
    setMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return [
          ...currentMessages,
          {
            role: "assistant",
            content: upsertAssistantReasoningSummaryContent([], reasoningSummary),
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
          content: upsertAssistantReasoningSummaryContent(lastMessage.content, reasoningSummary),
        },
      ];
    });
  }, []);

  const completeAssistantReasoningSummary = useCallback((reasoningId: string): void => {
    setMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return currentMessages;
      }

      return [
        ...currentMessages.slice(0, -1),
        {
          ...lastMessage,
          content: completeAssistantReasoningSummaryContent(lastMessage.content, reasoningId),
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
          content: finalizeAssistantContent(lastMessage.content),
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
          content: appendAssistantErrorContent(finalizeAssistantContent(lastMessage.content), errorText),
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
    completeAssistantReasoningSummary,
    finishAssistantMessage,
    markAssistantError,
    clearHistory,
  };
}

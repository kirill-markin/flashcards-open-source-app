import { useCallback, useRef, useState } from "react";
import type { ContentPart, ReasoningSummaryContentPart, ToolCallContentPart } from "../types";

export type StoredMessage = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  timestamp: number;
  isError: boolean;
  isStopped: boolean;
  cursor: string | null;
  itemId: string | null;
}>;

export type ChatHistoryState = Readonly<{
  messages: ReadonlyArray<StoredMessage>;
  replaceMessages: (messages: ReadonlyArray<StoredMessage>) => void;
  appendUserMessage: (content: ReadonlyArray<ContentPart>) => void;
  startAssistantMessage: (initialText: string | null) => void;
  appendAssistantText: (text: string, itemId: string, cursor: string) => void;
  upsertAssistantToolCall: (toolCall: ToolCallContentPart, itemId: string, cursor: string) => void;
  upsertAssistantReasoningSummary: (reasoningSummary: ReasoningSummaryContentPart, itemId: string, cursor: string) => void;
  completeAssistantReasoningSummary: (reasoningId: string, itemId: string, cursor: string) => void;
  finishAssistantMessage: (
    content: ReadonlyArray<ContentPart>,
    itemId: string,
    cursor: string,
    isError: boolean,
    isStopped: boolean,
  ) => boolean;
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

type StreamingAssistantResolution = Readonly<{
  messages: ReadonlyArray<StoredMessage>;
  index: number;
}>;

function withAssistantStreamIdentity(
  message: StoredMessage,
  itemId: string,
  cursor: string,
): StoredMessage {
  return {
    ...message,
    itemId,
    cursor,
  };
}

function resolveExistingStreamingAssistantMessage(
  messages: ReadonlyArray<StoredMessage>,
  itemId: string,
  cursor: string,
): StreamingAssistantResolution | null {
  const existingIndex = messages.findIndex((message) => message.role === "assistant" && message.itemId === itemId);
  if (existingIndex >= 0) {
    const existingMessage = messages[existingIndex];
    if (existingMessage === undefined) {
      return null;
    }

    return {
      messages: messages.map((message, index) => (
        index === existingIndex ? withAssistantStreamIdentity(existingMessage, itemId, cursor) : message
      )),
      index: existingIndex,
    };
  }

  const placeholderIndex = [...messages].reverse().findIndex((message) =>
    message.role === "assistant" && message.itemId === null && message.isStopped === false,
  );
  if (placeholderIndex >= 0) {
    const resolvedIndex = messages.length - 1 - placeholderIndex;
    const placeholderMessage = messages[resolvedIndex];
    if (placeholderMessage === undefined) {
      return null;
    }

    return {
      messages: messages.map((message, index) => (
        index === resolvedIndex ? withAssistantStreamIdentity(placeholderMessage, itemId, cursor) : message
      )),
      index: resolvedIndex,
    };
  }

  return null;
}

function resolveStreamingAssistantMessage(
  messages: ReadonlyArray<StoredMessage>,
  itemId: string,
  cursor: string,
): StreamingAssistantResolution {
  const existingResolution = resolveExistingStreamingAssistantMessage(messages, itemId, cursor);
  if (existingResolution !== null) {
    return existingResolution;
  }

  const nextMessages = [
    ...messages,
    {
      role: "assistant" as const,
      content: [],
      timestamp: Date.now(),
      isError: false,
      isStopped: false,
      cursor,
      itemId,
    },
  ];

  return {
    messages: nextMessages,
    index: nextMessages.length - 1,
  };
}

function shouldReconcileAssistantTerminalContent(
  content: ReadonlyArray<ContentPart>,
  isError: boolean,
  isStopped: boolean,
): boolean {
  if (isError || isStopped) {
    return false;
  }

  return content.every((part) => {
    if (part.type === "text") {
      return part.text.trim() === "";
    }
    if (part.type === "reasoning_summary") {
      return part.summary.trim() === "";
    }

    return false;
  });
}

export function useChatHistory(
  initialMessages?: ReadonlyArray<StoredMessage>,
): ChatHistoryState {
  const [messages, setMessages] = useState<ReadonlyArray<StoredMessage>>(initialMessages ?? []);
  const messagesRef = useRef<ReadonlyArray<StoredMessage>>(initialMessages ?? []);

  const commitMessages = useCallback((
    updater: (currentMessages: ReadonlyArray<StoredMessage>) => ReadonlyArray<StoredMessage>,
  ): ReadonlyArray<StoredMessage> => {
    const nextMessages = updater(messagesRef.current);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    return nextMessages;
  }, []);

  const replaceMessages = useCallback((nextMessages: ReadonlyArray<StoredMessage>): void => {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
  }, []);

  const appendUserMessage = useCallback((content: ReadonlyArray<ContentPart>): void => {
    commitMessages((currentMessages) => [
      ...currentMessages,
      {
        role: "user",
        content,
        timestamp: Date.now(),
        isError: false,
        isStopped: false,
        cursor: null,
        itemId: null,
      },
    ]);
  }, [commitMessages]);

  const startAssistantMessage = useCallback((initialText: string | null): void => {
    commitMessages((currentMessages) => [
      ...currentMessages,
      {
        role: "assistant",
        content: initialText === null ? [] : [{ type: "text", text: initialText }],
        timestamp: Date.now(),
        isError: false,
        isStopped: false,
        cursor: null,
        itemId: null,
      },
    ]);
  }, [commitMessages]);

  const appendAssistantText = useCallback((text: string, itemId: string, cursor: string): void => {
    commitMessages((currentMessages) => {
      const resolution = resolveStreamingAssistantMessage(currentMessages, itemId, cursor);
      const lastMessage = resolution.messages[resolution.index];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return currentMessages;
      }

      return resolution.messages.map((message, index) => (
        index === resolution.index
          ? {
            ...lastMessage,
            content: appendAssistantTextContent(lastMessage.content, text),
          }
          : message
      ));
    });
  }, [commitMessages]);

  const upsertAssistantToolCall = useCallback((toolCall: ToolCallContentPart, itemId: string, cursor: string): void => {
    commitMessages((currentMessages) => {
      const resolution = resolveStreamingAssistantMessage(currentMessages, itemId, cursor);
      const lastMessage = resolution.messages[resolution.index];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return currentMessages;
      }

      return resolution.messages.map((message, index) => (
        index === resolution.index
          ? {
            ...lastMessage,
            content: upsertAssistantToolCallContent(lastMessage.content, toolCall),
          }
          : message
      ));
    });
  }, [commitMessages]);

  const upsertAssistantReasoningSummary = useCallback((
    reasoningSummary: ReasoningSummaryContentPart,
    itemId: string,
    cursor: string,
  ): void => {
    commitMessages((currentMessages) => {
      const resolution = resolveStreamingAssistantMessage(currentMessages, itemId, cursor);
      const lastMessage = resolution.messages[resolution.index];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return currentMessages;
      }

      return resolution.messages.map((message, index) => (
        index === resolution.index
          ? {
            ...lastMessage,
            content: upsertAssistantReasoningSummaryContent(lastMessage.content, reasoningSummary),
          }
          : message
      ));
    });
  }, [commitMessages]);

  const completeAssistantReasoningSummary = useCallback((reasoningId: string, itemId: string, cursor: string): void => {
    commitMessages((currentMessages) => {
      const resolution = resolveStreamingAssistantMessage(currentMessages, itemId, cursor);
      const lastMessage = resolution.messages[resolution.index];
      if (lastMessage === undefined || lastMessage.role !== "assistant") {
        return currentMessages;
      }

      return resolution.messages.map((message, index) => (
        index === resolution.index
          ? {
            ...lastMessage,
            content: completeAssistantReasoningSummaryContent(lastMessage.content, reasoningId),
          }
          : message
      ));
    });
  }, [commitMessages]);

  const finishAssistantMessage = useCallback((
    content: ReadonlyArray<ContentPart>,
    itemId: string,
    cursor: string,
    isError: boolean,
    isStopped: boolean,
  ): boolean => {
    const currentMessages = messagesRef.current;
    const resolution = resolveExistingStreamingAssistantMessage(currentMessages, itemId, cursor);
    if (resolution === null) {
      return false;
    }

    const lastMessage = resolution.messages[resolution.index];
    if (lastMessage === undefined || lastMessage.role !== "assistant") {
      return false;
    }

    const finalizedContent = finalizeAssistantContent(content);
    if (shouldReconcileAssistantTerminalContent(finalizedContent, isError, isStopped)) {
      return false;
    }

    const nextMessages = resolution.messages.map((message, index) => (
      index === resolution.index
        ? {
          ...lastMessage,
          content: finalizedContent,
          isError,
          isStopped,
        }
        : message
    ));
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    return true;
  }, []);

  const markAssistantError = useCallback((errorText: string): void => {
    commitMessages((currentMessages) => {
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
            cursor: null,
            itemId: null,
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
  }, [commitMessages]);

  const clearHistory = useCallback((): void => {
    messagesRef.current = [];
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

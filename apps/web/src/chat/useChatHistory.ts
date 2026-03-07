import { useEffect, useRef, useState } from "react";
import type { ContentPart } from "../types";

export type StoredMessage = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  timestamp: number;
  isError: boolean;
}>;

type ChatHistoryState = Readonly<{
  messages: ReadonlyArray<StoredMessage>;
  appendUserMessage: (content: ReadonlyArray<ContentPart>) => void;
  startAssistantMessage: () => void;
  appendAssistantChunk: (text: string) => void;
  appendToolCall: (name: string) => void;
  completeToolCall: (name: string, input: string | null, output: string | null) => void;
  finalizeAssistant: () => void;
  markAssistantError: (errorText: string) => void;
  clearHistory: () => void;
}>;

const STORAGE_KEY = "flashcards-chat-messages";
const MAX_MESSAGES = 200;

function loadFromStorage(): ReadonlyArray<StoredMessage> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }

    const parsed = JSON.parse(raw) as ReadonlyArray<StoredMessage>;
    return parsed.slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

function saveToStorage(messages: ReadonlyArray<StoredMessage>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    // Ignore localStorage persistence failures.
  }
}

export function useChatHistory(): ChatHistoryState {
  const [messages, setMessages] = useState<ReadonlyArray<StoredMessage>>([]);
  const loadedRef = useRef<boolean>(false);

  useEffect(() => {
    setMessages(loadFromStorage());
    loadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!loadedRef.current) {
      return;
    }

    saveToStorage(messages);
  }, [messages]);

  function appendUserMessage(content: ReadonlyArray<ContentPart>): void {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        role: "user",
        content,
        timestamp: Date.now(),
        isError: false,
      },
    ]);
  }

  function startAssistantMessage(): void {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isError: false,
      },
    ]);
  }

  function appendAssistantChunk(text: string): void {
    setMessages((currentMessages) => {
      if (currentMessages.length === 0) {
        return currentMessages;
      }

      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage.role !== "assistant") {
        return currentMessages;
      }

      const lastPart = lastMessage.content[lastMessage.content.length - 1];
      const nextContent = lastPart !== undefined && lastPart.type === "text"
        ? [...lastMessage.content.slice(0, -1), { ...lastPart, text: lastPart.text + text }]
        : [...lastMessage.content, { type: "text" as const, text }];

      return [...currentMessages.slice(0, -1), { ...lastMessage, content: nextContent }];
    });
  }

  function appendToolCall(name: string): void {
    setMessages((currentMessages) => {
      if (currentMessages.length === 0) {
        return currentMessages;
      }

      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage.role !== "assistant") {
        return currentMessages;
      }

      return [
        ...currentMessages.slice(0, -1),
        {
          ...lastMessage,
          content: [
            ...lastMessage.content,
            { type: "tool_call", name, status: "started", input: null, output: null },
          ],
        },
      ];
    });
  }

  function completeToolCall(name: string, input: string | null, output: string | null): void {
    setMessages((currentMessages) => {
      if (currentMessages.length === 0) {
        return currentMessages;
      }

      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage.role !== "assistant") {
        return currentMessages;
      }

      let hasUpdated = false;
      const nextContent = [...lastMessage.content]
        .reverse()
        .map((part) => {
          if (!hasUpdated && part.type === "tool_call" && part.name === name && part.status === "started") {
            hasUpdated = true;
            return {
              ...part,
              status: "completed" as const,
              input,
              output,
            };
          }

          return part;
        })
        .reverse();

      if (!hasUpdated) {
        return currentMessages;
      }

      return [...currentMessages.slice(0, -1), { ...lastMessage, content: nextContent }];
    });
  }

  function finalizeAssistant(): void {
    setMessages((currentMessages) => [...currentMessages]);
  }

  function markAssistantError(errorText: string): void {
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
          },
        ];
      }

      return [
        ...currentMessages.slice(0, -1),
        {
          ...lastMessage,
          content: [{ type: "text", text: errorText }],
          isError: true,
        },
      ];
    });
  }

  function clearHistory(): void {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    messages,
    appendUserMessage,
    startAssistantMessage,
    appendAssistantChunk,
    appendToolCall,
    completeToolCall,
    finalizeAssistant,
    markAssistantError,
    clearHistory,
  };
}

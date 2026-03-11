import { useEffect, useState } from "react";
import type { ContentPart } from "../types";

export type StoredMessage = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  timestamp: number;
  isError: boolean;
}>;

type ChatHistoryState = Readonly<{
  messages: ReadonlyArray<StoredMessage>;
  isHydrated: boolean;
  appendUserMessage: (content: ReadonlyArray<ContentPart>) => void;
  startAssistantMessage: () => void;
  appendAssistantChunk: (text: string) => void;
  appendToolCall: (name: string, toolCallId: string) => void;
  completeToolCall: (toolCallId: string, input: string | null, output: string | null) => void;
  finalizeAssistant: () => void;
  markAssistantError: (errorText: string) => void;
  clearHistory: () => void;
}>;

const STORAGE_KEY = "flashcards-chat-messages";
const MAX_MESSAGES = 200;

function normalizeAssistantText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function appendAssistantTextContent(
  content: ReadonlyArray<ContentPart>,
  text: string,
): ReadonlyArray<ContentPart> {
  const normalizedText = normalizeAssistantText(text);
  if (normalizedText === "") {
    return content;
  }

  const lastPart = content[content.length - 1];
  if (lastPart !== undefined && lastPart.type === "text") {
    return [...content.slice(0, -1), { ...lastPart, text: lastPart.text + normalizedText }];
  }

  return [...content, { type: "text", text: normalizedText }];
}

function normalizeAssistantContent(content: ReadonlyArray<ContentPart>): ReadonlyArray<ContentPart> {
  let normalizedContent: ReadonlyArray<ContentPart> = [];

  for (const part of content) {
    if (part.type !== "text") {
      normalizedContent = [...normalizedContent, part];
      continue;
    }

    normalizedContent = appendAssistantTextContent(normalizedContent, part.text);
  }

  return normalizedContent;
}

function isContentPart(value: unknown): value is ContentPart {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  if (!("type" in value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "text") {
    return "text" in value && typeof value.text === "string";
  }

  if (value.type === "image") {
    return "mediaType" in value
      && typeof value.mediaType === "string"
      && "base64Data" in value
      && typeof value.base64Data === "string";
  }

  if (value.type === "file") {
    return "mediaType" in value
      && typeof value.mediaType === "string"
      && "base64Data" in value
      && typeof value.base64Data === "string"
      && "fileName" in value
      && typeof value.fileName === "string";
  }

  if (value.type === "tool_call") {
    return "toolCallId" in value
      && typeof value.toolCallId === "string"
      && value.toolCallId !== ""
      && "name" in value
      && typeof value.name === "string"
      && "status" in value
      && (value.status === "started" || value.status === "completed")
      && "input" in value
      && (typeof value.input === "string" || value.input === null)
      && "output" in value
      && (typeof value.output === "string" || value.output === null);
  }

  return false;
}

function isStoredMessage(value: unknown): value is StoredMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return "role" in value
    && (value.role === "user" || value.role === "assistant")
    && "content" in value
    && Array.isArray(value.content)
    && value.content.every(isContentPart)
    && "timestamp" in value
    && typeof value.timestamp === "number"
    && "isError" in value
    && typeof value.isError === "boolean";
}

function normalizeStoredMessage(value: unknown): StoredMessage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const contentValue = Array.isArray(record.content) ? record.content : [];
  const normalizedContent = contentValue.filter(isContentPart);
  const role = record.role;
  const timestamp = record.timestamp;
  const isError = record.isError;

  if ((role !== "user" && role !== "assistant") || typeof timestamp !== "number" || typeof isError !== "boolean") {
    return null;
  }

  return {
    role,
    content: role === "assistant" ? normalizeAssistantContent(normalizedContent) : normalizedContent,
    timestamp,
    isError,
  };
}

export function normalizeStoredMessageForTests(value: unknown): StoredMessage | null {
  return normalizeStoredMessage(value);
}

function loadFromStorage(): ReadonlyArray<StoredMessage> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) === false) {
      return [];
    }

    return parsed
      .map(normalizeStoredMessage)
      .filter((message): message is StoredMessage => message !== null)
      .slice(-MAX_MESSAGES);
  } catch (error) {
    console.error("Failed to load chat history", error);
    return [];
  }
}

function saveToStorage(messages: ReadonlyArray<StoredMessage>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch (error) {
    console.error("Failed to persist chat history", error);
  }
}

export function useChatHistory(): ChatHistoryState {
  const [messages, setMessages] = useState<ReadonlyArray<StoredMessage>>([]);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);

  useEffect(() => {
    setMessages(loadFromStorage());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    saveToStorage(messages);
  }, [isHydrated, messages]);

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

      const nextContent = appendAssistantTextContent(lastMessage.content, text);

      return [...currentMessages.slice(0, -1), { ...lastMessage, content: nextContent }];
    });
  }

  function appendToolCall(name: string, toolCallId: string): void {
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
            { type: "tool_call", toolCallId, name, status: "started", input: null, output: null },
          ],
        },
      ];
    });
  }

  function completeToolCall(toolCallId: string, input: string | null, output: string | null): void {
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
          if (!hasUpdated && part.type === "tool_call" && part.toolCallId === toolCallId && part.status === "started") {
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
    isHydrated,
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

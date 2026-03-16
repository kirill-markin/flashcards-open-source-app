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
  chatSessionId: string;
  codeInterpreterContainerId: string | null;
  isHydrated: boolean;
  appendUserMessage: (content: ReadonlyArray<ContentPart>) => void;
  startAssistantMessage: (initialText: string | null) => void;
  appendAssistantChunk: (text: string) => void;
  appendToolCall: (name: string, toolCallId: string, input: string | null) => void;
  completeToolCall: (toolCallId: string, input: string | null, output: string | null) => void;
  finalizeAssistant: () => void;
  markAssistantError: (errorText: string) => void;
  setCodeInterpreterContainerId: (containerId: string) => void;
  clearOptimisticAssistantStatus: () => void;
  clearHistory: () => void;
}>;

type StoredChatHistory = Readonly<{
  messages: ReadonlyArray<StoredMessage>;
  chatSessionId: string;
  codeInterpreterContainerId: string | null;
}>;

const STORAGE_KEY = "flashcards-chat-messages";
const MAX_MESSAGES = 200;
export const OPTIMISTIC_ASSISTANT_STATUS_TEXT = "Looking through your cards...";

function createChatSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("crypto.randomUUID is unavailable for chat session ids");
  }

  return globalThis.crypto.randomUUID();
}

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

function isOptimisticAssistantStatusContent(content: ReadonlyArray<ContentPart>): boolean {
  return content.length === 1
    && content[0]?.type === "text"
    && content[0].text === OPTIMISTIC_ASSISTANT_STATUS_TEXT;
}

function replaceOptimisticAssistantStatus(
  content: ReadonlyArray<ContentPart>,
  text: string,
): ReadonlyArray<ContentPart> {
  const normalizedText = normalizeAssistantText(text);
  if (normalizedText === "") {
    return content;
  }

  if (isOptimisticAssistantStatusContent(content)) {
    return [{ type: "text", text: normalizedText }];
  }

  return appendAssistantTextContent(content, normalizedText);
}

function removeOptimisticAssistantStatus(content: ReadonlyArray<ContentPart>): ReadonlyArray<ContentPart> {
  return isOptimisticAssistantStatusContent(content) ? [] : content;
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

export function appendAssistantErrorContent(
  content: ReadonlyArray<ContentPart>,
  errorText: string,
): ReadonlyArray<ContentPart> {
  if (isOptimisticAssistantStatusContent(content)) {
    return [{ type: "text", text: errorText }];
  }

  if (content.length === 0) {
    return [{ type: "text", text: errorText }];
  }

  const lastPart = content[content.length - 1];
  const errorPrefix = lastPart?.type === "text" ? "\n\n" : "";

  return [...content, { type: "text", text: `${errorPrefix}${errorText}` }];
}

function loadFromStorage(): StoredChatHistory {
  const emptyHistory = {
    messages: [],
    chatSessionId: createChatSessionId(),
    codeInterpreterContainerId: null,
  } satisfies StoredChatHistory;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return emptyHistory;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      return {
        messages: parsed
          .map(normalizeStoredMessage)
          .filter((message): message is StoredMessage => message !== null)
          .slice(-MAX_MESSAGES),
        chatSessionId: createChatSessionId(),
        codeInterpreterContainerId: null,
      };
    }

    if (typeof parsed !== "object" || parsed === null) {
      return emptyHistory;
    }

    const record = parsed as Record<string, unknown>;
    const messages = Array.isArray(record.messages)
      ? record.messages
        .map(normalizeStoredMessage)
        .filter((message): message is StoredMessage => message !== null)
        .slice(-MAX_MESSAGES)
      : [];
    const chatSessionId = typeof record.chatSessionId === "string" && record.chatSessionId.trim() !== ""
      ? record.chatSessionId
      : createChatSessionId();
    const codeInterpreterContainerId = typeof record.codeInterpreterContainerId === "string"
      && record.codeInterpreterContainerId.trim() !== ""
      ? record.codeInterpreterContainerId
      : null;

    return {
      messages,
      chatSessionId,
      codeInterpreterContainerId,
    };
  } catch (error) {
    console.error("Failed to load chat history", error);
    return emptyHistory;
  }
}

function saveToStorage(history: StoredChatHistory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      messages: history.messages.slice(-MAX_MESSAGES),
      chatSessionId: history.chatSessionId,
      codeInterpreterContainerId: history.codeInterpreterContainerId,
    } satisfies StoredChatHistory));
  } catch (error) {
    console.error("Failed to persist chat history", error);
  }
}

export function useChatHistory(): ChatHistoryState {
  const [messages, setMessages] = useState<ReadonlyArray<StoredMessage>>([]);
  const [chatSessionId, setChatSessionId] = useState<string>(() => createChatSessionId());
  const [codeInterpreterContainerId, setCodeInterpreterContainerIdState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);

  useEffect(() => {
    const history = loadFromStorage();
    setMessages(history.messages);
    setChatSessionId(history.chatSessionId);
    setCodeInterpreterContainerIdState(history.codeInterpreterContainerId);
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    saveToStorage({
      messages,
      chatSessionId,
      codeInterpreterContainerId,
    });
  }, [chatSessionId, codeInterpreterContainerId, isHydrated, messages]);

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

  function startAssistantMessage(initialText: string | null): void {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        role: "assistant",
        content: initialText === null ? [] : [{ type: "text", text: normalizeAssistantText(initialText) }],
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

      const nextContent = replaceOptimisticAssistantStatus(lastMessage.content, text);

      return [...currentMessages.slice(0, -1), { ...lastMessage, content: nextContent }];
    });
  }

  function appendToolCall(name: string, toolCallId: string, input: string | null): void {
    setMessages((currentMessages) => {
      if (currentMessages.length === 0) {
        return currentMessages;
      }

      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage.role !== "assistant") {
        return currentMessages;
      }

      const nextContent = removeOptimisticAssistantStatus(lastMessage.content);

      return [
        ...currentMessages.slice(0, -1),
        {
          ...lastMessage,
          content: [
            ...nextContent,
            { type: "tool_call", toolCallId, name, status: "started", input, output: null },
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

  function clearOptimisticAssistantStatus(): void {
    setMessages((currentMessages) => {
      if (currentMessages.length === 0) {
        return currentMessages;
      }

      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage.role !== "assistant" || isOptimisticAssistantStatusContent(lastMessage.content) === false) {
        return currentMessages;
      }

      return [...currentMessages.slice(0, -1), { ...lastMessage, content: [] }];
    });
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
          content: appendAssistantErrorContent(lastMessage.content, errorText),
          isError: true,
        },
      ];
    });
  }

  function setCodeInterpreterContainerId(containerId: string): void {
    setCodeInterpreterContainerIdState(containerId);
  }

  function clearHistory(): void {
    setMessages([]);
    setChatSessionId(createChatSessionId());
    setCodeInterpreterContainerIdState(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    messages,
    chatSessionId,
    codeInterpreterContainerId,
    isHydrated,
    appendUserMessage,
    startAssistantMessage,
    appendAssistantChunk,
    appendToolCall,
    completeToolCall,
    finalizeAssistant,
    markAssistantError,
    setCodeInterpreterContainerId,
    clearOptimisticAssistantStatus,
    clearHistory,
  };
}

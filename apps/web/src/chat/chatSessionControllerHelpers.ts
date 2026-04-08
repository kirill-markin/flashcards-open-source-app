import { ApiError } from "../api";
import type {
  ChatComposerSuggestion,
  ChatConfig,
  ContentPart,
  ReasoningSummaryContentPart,
  ToolCallContentPart,
} from "../types";
import { sanitizeErrorText } from "./chatHelpers";
import type { ChatLiveEvent } from "./liveStream";
import { OPTIMISTIC_ASSISTANT_STATUS_TEXT, type StoredMessage } from "./useChatHistory";

const CHAT_DEBUG_LOG_PREFIX = "chat_debug ";
const CHAT_DEBUG_STORAGE_KEY = "flashcards-chat-debug";

type ChatDebugDetailValue = string | number | boolean | null;
export type ChatDebugDetails = Readonly<Record<string, ChatDebugDetailValue>>;

type StreamPosition = Readonly<{
  itemId: string;
  responseIndex?: number;
  outputIndex: number;
  contentIndex: number | null;
  sequenceNumber: number | null;
}>;

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorText(500, error.message);
  }

  return String(error);
}

export function isChatApiError(error: unknown): error is Readonly<{
  statusCode: number;
  code: string | null;
}> {
  if (error instanceof ApiError) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  const code = "code" in error ? error.code : undefined;
  return typeof statusCode === "number" && (typeof code === "string" || code === null);
}

function areStreamPositionsEqual(
  left: StreamPosition | undefined,
  right: StreamPosition | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === undefined || right === undefined) {
    return false;
  }

  return left.itemId === right.itemId
    && left.responseIndex === right.responseIndex
    && left.outputIndex === right.outputIndex
    && left.contentIndex === right.contentIndex
    && left.sequenceNumber === right.sequenceNumber;
}

export function areContentPartsEqual(
  left: ReadonlyArray<ContentPart>,
  right: ReadonlyArray<ContentPart>,
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart?.type !== rightPart?.type) {
      return false;
    }

    switch (leftPart?.type) {
      case "text":
        if (rightPart.type !== "text" || leftPart.text !== rightPart.text) {
          return false;
        }
        break;
      case "image":
        if (
          rightPart.type !== "image"
          || leftPart.mediaType !== rightPart.mediaType
          || leftPart.base64Data !== rightPart.base64Data
        ) {
          return false;
        }
        break;
      case "file":
        if (
          rightPart.type !== "file"
          || leftPart.mediaType !== rightPart.mediaType
          || leftPart.base64Data !== rightPart.base64Data
          || leftPart.fileName !== rightPart.fileName
        ) {
          return false;
        }
        break;
      case "card":
        if (
          rightPart.type !== "card"
          || leftPart.cardId !== rightPart.cardId
          || leftPart.frontText !== rightPart.frontText
          || leftPart.backText !== rightPart.backText
          || leftPart.effortLevel !== rightPart.effortLevel
          || leftPart.tags.length !== rightPart.tags.length
          || leftPart.tags.some((tag, index) => tag !== rightPart.tags[index])
        ) {
          return false;
        }
        break;
      case "tool_call":
        if (
          rightPart.type !== "tool_call"
          || leftPart.id !== rightPart.id
          || leftPart.name !== rightPart.name
          || leftPart.status !== rightPart.status
          || leftPart.providerStatus !== rightPart.providerStatus
          || leftPart.input !== rightPart.input
          || leftPart.output !== rightPart.output
          || areStreamPositionsEqual(leftPart.streamPosition, rightPart.streamPosition) === false
        ) {
          return false;
        }
        break;
      case "reasoning_summary":
        if (
          rightPart.type !== "reasoning_summary"
          || leftPart.reasoningId !== rightPart.reasoningId
          || leftPart.summary !== rightPart.summary
          || leftPart.status !== rightPart.status
          || areStreamPositionsEqual(leftPart.streamPosition, rightPart.streamPosition) === false
        ) {
          return false;
        }
        break;
      default:
        return false;
    }
  }

  return true;
}

export function areMessagesEqual(
  left: ReadonlyArray<StoredMessage>,
  right: ReadonlyArray<StoredMessage>,
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftMessage = left[index];
    const rightMessage = right[index];

    if (
      leftMessage?.role !== rightMessage?.role
      || leftMessage.timestamp !== rightMessage.timestamp
      || leftMessage.isError !== rightMessage.isError
      || leftMessage.isStopped !== rightMessage.isStopped
      || leftMessage.itemId !== rightMessage.itemId
      || leftMessage.cursor !== rightMessage.cursor
      || areContentPartsEqual(leftMessage.content, rightMessage.content) === false
    ) {
      return false;
    }
  }

  return true;
}

export function areChatConfigsEqual(left: ChatConfig, right: ChatConfig): boolean {
  return left.provider.id === right.provider.id
    && left.provider.label === right.provider.label
    && left.model.id === right.model.id
    && left.model.label === right.model.label
    && left.model.badgeLabel === right.model.badgeLabel
    && left.reasoning.effort === right.reasoning.effort
    && left.reasoning.label === right.reasoning.label
    && left.features.modelPickerEnabled === right.features.modelPickerEnabled
    && left.features.dictationEnabled === right.features.dictationEnabled
    && left.features.attachmentsEnabled === right.features.attachmentsEnabled;
}

export function areComposerSuggestionsEqual(
  left: ReadonlyArray<ChatComposerSuggestion>,
  right: ReadonlyArray<ChatComposerSuggestion>,
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftSuggestion = left[index];
    const rightSuggestion = right[index];
    if (
      leftSuggestion?.id !== rightSuggestion?.id
      || leftSuggestion.text !== rightSuggestion.text
      || leftSuggestion.source !== rightSuggestion.source
      || leftSuggestion.assistantItemId !== rightSuggestion.assistantItemId
    ) {
      return false;
    }
  }

  return true;
}

function extractStoredMessageTextContent(message: StoredMessage): string {
  return message.content.reduce<string>((result, part) => {
    if (part.type !== "text") {
      return result;
    }

    if (part.text === OPTIMISTIC_ASSISTANT_STATUS_TEXT) {
      return result;
    }

    return result + part.text;
  }, "").trim();
}

export function extractAssistantErrorMessage(
  messages: ReadonlyArray<StoredMessage>,
): string | null {
  const assistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  if (assistantMessage === undefined || assistantMessage.isError === false) {
    return null;
  }

  const messageText = extractStoredMessageTextContent(assistantMessage);
  return messageText === "" ? null : messageText;
}

export function extractLatestAssistantMessageText(
  messages: ReadonlyArray<StoredMessage>,
): string | null {
  const assistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  if (assistantMessage === undefined) {
    return null;
  }

  const messageText = extractStoredMessageTextContent(assistantMessage);
  return messageText === "" ? null : messageText;
}

export function createChatControllerDebugId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `chat-controller-${String(Date.now())}`;
}

export function createClientChatSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().toLowerCase();
  }

  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
}

export function resolveInitialHydrationSessionId(
  workspaceId: string | null,
  currentSessionId: string | null,
): string | undefined {
  if (workspaceId === null || currentSessionId === null) {
    return undefined;
  }

  const trimmedSessionId = currentSessionId.trim();
  return trimmedSessionId === "" ? undefined : trimmedSessionId;
}

function isChatDebugLoggingEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get("chatDebug") === "1") {
    return true;
  }

  return window.localStorage.getItem(CHAT_DEBUG_STORAGE_KEY) === "true";
}

export function logChatControllerDebug(
  controllerId: string,
  event: string,
  details: ChatDebugDetails,
): void {
  if (isChatDebugLoggingEnabled() === false) {
    return;
  }

  console.info(`${CHAT_DEBUG_LOG_PREFIX}${JSON.stringify({
    source: "useChatSessionController",
    controllerId,
    event,
    ...details,
  })}`);
}

export function toAssistantToolCallContentPart(
  event: Extract<ChatLiveEvent, { type: "assistant_tool_call" }>,
): ToolCallContentPart {
  return {
    type: "tool_call",
    id: event.toolCallId,
    name: event.name,
    status: event.status,
    providerStatus: event.providerStatus ?? null,
    input: event.input,
    output: event.output,
    streamPosition: {
      itemId: event.itemId,
      outputIndex: event.outputIndex,
      contentIndex: null,
      sequenceNumber: null,
    },
  };
}

export function toAssistantReasoningSummaryContentPart(
  event: Extract<ChatLiveEvent, {
    type: "assistant_reasoning_started" | "assistant_reasoning_summary" | "assistant_reasoning_done";
  }>,
): ReasoningSummaryContentPart {
  const summary = event.type === "assistant_reasoning_summary" ? event.summary : "";
  const status = event.type === "assistant_reasoning_done" ? "completed" : "started";

  return {
    type: "reasoning_summary",
    reasoningId: event.reasoningId,
    summary,
    status,
    streamPosition: {
      itemId: event.reasoningId,
      outputIndex: event.outputIndex,
      contentIndex: null,
      sequenceNumber: null,
    },
  };
}

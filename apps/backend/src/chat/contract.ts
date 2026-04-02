import { getChatConfig, type ChatConfig } from "./config";
import type { ChatLiveStreamEnvelope } from "./liveAuth";
import type { PaginatedChatMessages, PersistedChatMessageItem, ChatSessionSnapshot } from "./store";
import type { ContentPart } from "./types";

type ChatConversationMessage = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  timestamp: number;
  isError: boolean;
  isStopped: boolean;
  cursor: string | null;
  itemId: string | null;
}>;

export type ChatConversation = Readonly<{
  messages: ReadonlyArray<ChatConversationMessage>;
  updatedAt: number;
  mainContentInvalidationVersion: number;
  hasOlder?: boolean;
  oldestCursor?: string | null;
}>;

export type ChatActiveRun = Readonly<{
  runId: string;
  status: "running";
  live: Readonly<{
    cursor: string | null;
    stream: ChatLiveStreamEnvelope;
  }>;
  lastHeartbeatAt?: number;
}>;

export type ChatConversationEnvelope = Readonly<{
  sessionId: string;
  conversationScopeId: string;
  conversation: ChatConversation;
  chatConfig: ChatConfig;
  activeRun: ChatActiveRun | null;
}>;

export type ChatAcceptedConversationEnvelope = ChatConversationEnvelope & Readonly<{
  accepted: true;
  deduplicated?: boolean;
}>;

export type ChatStopResponse = Readonly<{
  sessionId: string;
  conversationScopeId: string;
  runId: string | null;
  stopped: boolean;
  stillRunning: boolean;
}>;

type ChatLiveEventMetadata = Readonly<{
  sessionId: string;
  conversationScopeId: string;
  runId: string;
  cursor: string | null;
  sequenceNumber: number;
  streamEpoch: string;
}>;

export type ChatRunTerminalOutcome =
  | "completed"
  | "stopped"
  | "error"
  | "reset_required";

export type ChatLiveEvent =
  | (ChatLiveEventMetadata & Readonly<{
    type: "assistant_delta";
    text: string;
    itemId: string;
  }>)
  | (ChatLiveEventMetadata & Readonly<{
    type: "assistant_tool_call";
    toolCallId: string;
    name: string;
    status: "started" | "completed";
    input: string | null;
    output: string | null;
    providerStatus?: string | null;
    itemId: string;
    outputIndex: number;
  }>)
  | (ChatLiveEventMetadata & Readonly<{
    type: "assistant_reasoning_started";
    reasoningId: string;
    itemId: string;
    outputIndex: number;
  }>)
  | (ChatLiveEventMetadata & Readonly<{
    type: "assistant_reasoning_summary";
    reasoningId: string;
    summary: string;
    itemId: string;
    outputIndex: number;
  }>)
  | (ChatLiveEventMetadata & Readonly<{
    type: "assistant_reasoning_done";
    reasoningId: string;
    itemId: string;
    outputIndex: number;
  }>)
  | (ChatLiveEventMetadata & Readonly<{
    type: "assistant_message_done";
    itemId: string;
    content: ReadonlyArray<ContentPart>;
    isError: boolean;
    isStopped: boolean;
  }>)
  | (ChatLiveEventMetadata & Readonly<{
    type: "repair_status";
    message: string;
    attempt: number;
    maxAttempts: number;
    toolName: string | null;
  }>)
  | (ChatLiveEventMetadata & Readonly<{
    type: "run_terminal";
    outcome: ChatRunTerminalOutcome;
    message?: string;
    assistantItemId?: string;
    isError?: boolean;
    isStopped?: boolean;
  }>);

export type ChatLiveEventPayload =
  | Readonly<{
    type: "assistant_delta";
    cursor: string;
    text: string;
    itemId: string;
  }>
  | Readonly<{
    type: "assistant_tool_call";
    cursor: string;
    toolCallId: string;
    name: string;
    status: "started" | "completed";
    input: string | null;
    output: string | null;
    providerStatus?: string | null;
    itemId: string;
    outputIndex: number;
  }>
  | Readonly<{
    type: "assistant_reasoning_started";
    cursor: string;
    reasoningId: string;
    itemId: string;
    outputIndex: number;
  }>
  | Readonly<{
    type: "assistant_reasoning_summary";
    cursor: string;
    reasoningId: string;
    summary: string;
    itemId: string;
    outputIndex: number;
  }>
  | Readonly<{
    type: "assistant_reasoning_done";
    cursor: string;
    reasoningId: string;
    itemId: string;
    outputIndex: number;
  }>
  | Readonly<{
    type: "assistant_message_done";
    cursor: string;
    itemId: string;
    content: ReadonlyArray<ContentPart>;
    isError: boolean;
    isStopped: boolean;
  }>
  | Readonly<{
    type: "repair_status";
    cursor: string | null;
    message: string;
    attempt: number;
    maxAttempts: number;
    toolName: string | null;
  }>
  | Readonly<{
    type: "run_terminal";
    cursor: string | null;
    outcome: ChatRunTerminalOutcome;
    message?: string;
    assistantItemId?: string;
    isError?: boolean;
    isStopped?: boolean;
  }>;

export function buildConversationScopeId(sessionId: string): string {
  return sessionId;
}

function sanitizeContent(
  content: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> {
  return content.map((part) => {
    if (part.type === "image") {
      return {
        type: "image" as const,
        mediaType: part.mediaType,
        base64Data: "",
      };
    }

    if (part.type === "file") {
      return {
        type: "file" as const,
        mediaType: part.mediaType,
        base64Data: "",
        fileName: part.fileName,
      };
    }

    return part;
  });
}

export function toConversationMessage(
  message: Readonly<{
    role: "user" | "assistant";
    content: ReadonlyArray<ContentPart>;
    timestamp: number;
    isError: boolean;
    isStopped: boolean;
    cursor: string | null;
    itemId: string | null;
  }>,
): ChatConversationMessage {
  return {
    role: message.role,
    content: sanitizeContent(message.content),
    timestamp: message.timestamp,
    isError: message.isError,
    isStopped: message.isStopped,
    cursor: message.cursor,
    itemId: message.itemId,
  };
}

export function toConversationMessageFromPersisted(
  message: PersistedChatMessageItem,
): ChatConversationMessage {
  return toConversationMessage({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    isError: message.isError,
    isStopped: message.isStopped,
    cursor: String(message.itemOrder),
    itemId: message.role === "assistant" ? message.itemId : null,
  });
}

export function buildConversationEnvelope(
  params: Readonly<{
    sessionId: string;
    updatedAt: number;
    mainContentInvalidationVersion: number;
    messages: ReadonlyArray<ChatConversationMessage>;
    activeRun: ChatActiveRun | null;
    hasOlder?: boolean;
    oldestCursor?: string | null;
    chatConfig?: ChatConfig;
  }>,
): ChatConversationEnvelope {
  return {
    sessionId: params.sessionId,
    conversationScopeId: buildConversationScopeId(params.sessionId),
    conversation: {
      messages: params.messages,
      updatedAt: params.updatedAt,
      mainContentInvalidationVersion: params.mainContentInvalidationVersion,
      ...(params.hasOlder === undefined ? {} : { hasOlder: params.hasOlder }),
      ...(params.oldestCursor === undefined ? {} : { oldestCursor: params.oldestCursor }),
    },
    chatConfig: params.chatConfig ?? getChatConfig(),
    activeRun: params.activeRun,
  };
}

export function buildConversationEnvelopeFromSnapshot(
  snapshot: ChatSessionSnapshot,
  activeRun: ChatActiveRun | null,
): ChatConversationEnvelope {
  return buildConversationEnvelope({
    sessionId: snapshot.sessionId,
    updatedAt: snapshot.updatedAt,
    mainContentInvalidationVersion: snapshot.mainContentInvalidationVersion,
    messages: snapshot.messages.map((message) => toConversationMessage(message)),
    activeRun,
  });
}

export function buildConversationEnvelopeFromPaginatedSession(
  snapshot: ChatSessionSnapshot,
  page: PaginatedChatMessages,
  activeRun: ChatActiveRun | null,
): ChatConversationEnvelope {
  return buildConversationEnvelope({
    sessionId: snapshot.sessionId,
    updatedAt: snapshot.updatedAt,
    mainContentInvalidationVersion: snapshot.mainContentInvalidationVersion,
    messages: page.messages.map((message) => toConversationMessageFromPersisted(message)),
    activeRun,
    hasOlder: page.hasOlder,
    oldestCursor: page.oldestCursor,
  });
}

export function buildActiveRun(
  snapshot: ChatSessionSnapshot,
  cursor: string | null,
  stream: ChatLiveStreamEnvelope,
): ChatActiveRun {
  if (snapshot.activeRunId === null) {
    throw new Error(`Chat session ${snapshot.sessionId} is missing activeRunId while running`);
  }

  return {
    runId: snapshot.activeRunId,
    status: "running",
    live: {
      cursor,
      stream,
    },
    ...(snapshot.activeRunHeartbeatAt === null
      ? {}
      : { lastHeartbeatAt: snapshot.activeRunHeartbeatAt }),
  };
}

export function createChatLiveEventSerializer(
  params: Readonly<{
    sessionId: string;
    conversationScopeId: string;
    runId: string;
    streamEpoch: string;
  }>,
): (event: ChatLiveEventPayload) => ChatLiveEvent {
  let sequenceNumber = 0;

  return (event: ChatLiveEventPayload): ChatLiveEvent => {
    sequenceNumber += 1;

    return {
      ...event,
      sessionId: params.sessionId,
      conversationScopeId: params.conversationScopeId,
      runId: params.runId,
      cursor: event.cursor,
      sequenceNumber,
      streamEpoch: params.streamEpoch,
    };
  };
}

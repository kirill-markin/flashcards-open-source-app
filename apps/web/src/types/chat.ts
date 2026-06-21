import type { Locale } from "../i18n/types";

export type ChatTranscriptionSource = "ios" | "web";

export type ChatTranscriptionResponse = Readonly<{
  text: string;
  sessionId: string;
}>;

export type ChatSessionHistoryMessage = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  timestamp: number;
  isError: boolean;
  isStopped: boolean;
  cursor: string | null;
  itemId: string | null;
}>;

export type ChatConfig = Readonly<{
  features: Readonly<{
    dictationEnabled: boolean;
    attachmentsEnabled: boolean;
  }>;
}>;

export type ChatLiveStream = Readonly<{
  url: string;
  authorization: string;
  expiresAt: number;
}>;

export type ChatConversation = Readonly<{
  messages: ReadonlyArray<ChatSessionHistoryMessage>;
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
    stream: ChatLiveStream;
  }>;
  lastHeartbeatAt?: number;
}>;

export type ChatComposerSuggestion = Readonly<{
  id: string;
  text: string;
  source: "initial" | "assistant_follow_up";
  assistantItemId: string | null;
}>;

export type ChatSessionSnapshot = Readonly<{
  sessionId: string;
  conversationScopeId: string;
  conversation: ChatConversation;
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
  chatConfig: ChatConfig;
  activeRun: ChatActiveRun | null;
}>;

export type StartChatRunRequestBody = Readonly<{
  sessionId: string;
  // Optional on the wire until the minimum supported backend and first-party AI
  // client versions are greater than 1.5.0.
  workspaceId?: string;
  clientRequestId: string;
  content: ReadonlyArray<ContentPart>;
  timezone: string;
  // Optional on the wire until the minimum supported backend and first-party AI
  // client versions are greater than 1.5.0.
  uiLocale?: Locale;
}>;

export type StartChatRunResponse = ChatSessionSnapshot & Readonly<{
  accepted: true;
  deduplicated?: boolean;
}>;

export type NewChatSessionRequestBody = Readonly<{
  sessionId: string;
  // Optional on the wire until the minimum supported backend and first-party AI
  // client versions are greater than 1.5.0.
  workspaceId?: string;
  // Optional on the wire until the minimum supported backend and first-party AI
  // client versions are greater than 1.5.0.
  uiLocale?: Locale;
}>;

export type NewChatSessionResponse = Readonly<{
  ok: true;
  sessionId: string;
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
  chatConfig: ChatConfig;
}>;

export type StopChatRunResponse = Readonly<{
  sessionId: string;
  stopped: boolean;
  stillRunning: boolean;
}>;

export type StopChatRunRequestBody = Readonly<{
  sessionId: string;
  // Optional on the wire until the minimum supported backend and first-party AI
  // client versions are greater than 1.5.0.
  workspaceId?: string;
  // TODO: Make runId required once the minimum supported first-party AI client
  // version is greater than 1.5.0. This optional path supports older releases.
  runId?: string;
}>;

export type ChatRole = "user" | "assistant";

export type TextContentPart = Readonly<{
  type: "text";
  text: string;
}>;

export type ImageContentPart = Readonly<{
  type: "image";
  mediaType: string;
  base64Data: string;
}>;

export type FileContentPart = Readonly<{
  type: "file";
  mediaType: string;
  base64Data: string;
  fileName: string;
}>;

export type CardContentPart = Readonly<{
  type: "card";
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
}>;

export type ToolCallContentPart = Readonly<{
  type: "tool_call";
  id?: string;
  name: string;
  status: "started" | "completed";
  providerStatus?: string | null;
  input: string | null;
  output: string | null;
  streamPosition?: Readonly<{
    itemId: string;
    responseIndex?: number;
    outputIndex: number;
    contentIndex: number | null;
    sequenceNumber: number | null;
  }>;
}>;

export type ReasoningSummaryContentPart = Readonly<{
  type: "reasoning_summary";
  reasoningId?: string;
  summary: string;
  status?: "started" | "completed";
  streamPosition?: Readonly<{
    itemId: string;
    responseIndex?: number;
    outputIndex: number;
    contentIndex: number | null;
    sequenceNumber: number | null;
  }>;
}>;

export type ContentPart =
  | TextContentPart
  | ImageContentPart
  | FileContentPart
  | CardContentPart
  | ToolCallContentPart
  | ReasoningSummaryContentPart;

export type ChatMessage = Readonly<{
  role: ChatRole;
  content: ReadonlyArray<ContentPart>;
}>;

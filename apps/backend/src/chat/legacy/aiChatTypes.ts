/**
 * Legacy chat backend wire types for old `/chat/turn` clients.
 * The backend-first `/chat` stack persists sessions, items, and runs with a different server-owned model.
 * TODO: Remove this legacy module after most users have updated to app versions that use the new chat endpoints.
 */
export type AIChatDevicePlatform = "ios" | "android" | "web";

/**
 * High-level user facts for the legacy `/chat/turn` prompt contract.
 * The backend-first `/chat` stack derives and persists chat context differently on the server.
 * TODO: Remove this legacy type after most users have updated to app versions that use the new chat endpoints.
 */
export type AIChatUserContext = Readonly<{
  totalCards: number;
}>;

export type AIChatAssistantToolCall = Readonly<{
  toolCallId: string;
  name: string;
  input: string;
}>;

export type AIChatTextContentPart = Readonly<{
  type: "text";
  text: string;
}>;

export type AIChatImageContentPart = Readonly<{
  type: "image";
  mediaType: string;
  base64Data: string;
}>;

export type AIChatFileContentPart = Readonly<{
  type: "file";
  mediaType: string;
  base64Data: string;
  fileName: string;
}>;

export type AIChatToolCallContentPart = Readonly<{
  type: "tool_call";
  toolCallId: string;
  name: string;
  status: "started" | "completed";
  input: string | null;
  output: string | null;
}>;

export type AIChatContentPart =
  | AIChatTextContentPart
  | AIChatImageContentPart
  | AIChatFileContentPart
  | AIChatToolCallContentPart;

export type AIChatWireMessage =
  | Readonly<{
    role: "user";
    content: ReadonlyArray<AIChatContentPart>;
  }>
  | Readonly<{
    role: "assistant";
    content: ReadonlyArray<AIChatContentPart>;
  }>;

export type AIChatMessage =
  | AIChatWireMessage
  | Readonly<{
    role: "tool";
    toolCallId: string;
    name: string;
    output: string;
  }>;

export type AIChatTurnRequestBody = Readonly<{
  messages: ReadonlyArray<AIChatWireMessage>;
  model: string;
  timezone: string;
  devicePlatform: AIChatDevicePlatform;
  chatSessionId: string;
  codeInterpreterContainerId: string | null;
  userContext: AIChatUserContext;
}>;

export type AIChatProviderUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
}>;

export type AIChatTurnStreamEvent =
  | Readonly<{ type: "delta"; text: string }>
  | Readonly<{
    type: "tool_call";
    toolCallId: string;
    name: string;
    status: "started" | "completed";
    input: string | null;
    output: string | null;
  }>
  | Readonly<{ type: "tool_call_request"; toolCallId: string; name: string; input: string }>
  | Readonly<{
    type: "repair_attempt";
    message: string;
    attempt: number;
    maxAttempts: number;
    toolName: string | null;
  }>
  | Readonly<{ type: "done" }>
  | Readonly<{
    type: "error";
    message: string;
    code: string;
    stage: string;
    requestId: string;
  }>;

export type LocalChatDevicePlatform = "ios" | "web";

/**
 * High-level user facts injected into the system prompt before the model
 * reaches for workspace SQL. Keep this small, factual, and easy to extend.
 */
export type LocalChatUserContext = Readonly<{
  totalCards: number;
}>;

export type LocalAssistantToolCall = Readonly<{
  toolCallId: string;
  name: string;
  input: string;
}>;

export type LocalTextContentPart = Readonly<{
  type: "text";
  text: string;
}>;

export type LocalImageContentPart = Readonly<{
  type: "image";
  mediaType: string;
  base64Data: string;
}>;

export type LocalFileContentPart = Readonly<{
  type: "file";
  mediaType: string;
  base64Data: string;
  fileName: string;
}>;

export type LocalToolCallContentPart = Readonly<{
  type: "tool_call";
  toolCallId: string;
  name: string;
  status: "started" | "completed";
  input: string | null;
  output: string | null;
}>;

export type LocalContentPart =
  | LocalTextContentPart
  | LocalImageContentPart
  | LocalFileContentPart
  | LocalToolCallContentPart;

export type LocalChatMessage =
  | Readonly<{
    role: "user";
    content: ReadonlyArray<LocalContentPart>;
  }>
  | Readonly<{
    role: "assistant";
    content: ReadonlyArray<LocalContentPart>;
  }>
  | Readonly<{
    role: "tool";
    toolCallId: string;
    name: string;
    output: string;
  }>;

export type LocalChatRequestBody = Readonly<{
  messages: ReadonlyArray<LocalChatMessage>;
  model: string;
  timezone: string;
  devicePlatform: LocalChatDevicePlatform;
  chatSessionId: string;
  codeInterpreterContainerId: string | null;
  userContext: LocalChatUserContext;
}>;

export type LocalChatStreamEvent =
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
  | Readonly<{ type: "await_tool_results" }>
  | Readonly<{ type: "done" }>
  | Readonly<{
    type: "error";
    message: string;
    code: string;
    stage: string;
    requestId: string;
  }>;

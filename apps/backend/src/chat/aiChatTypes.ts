export type AIChatDevicePlatform = "ios" | "web";

/**
 * High-level user facts injected into the system prompt before the model
 * reaches for workspace SQL. Keep this small, factual, and easy to extend.
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

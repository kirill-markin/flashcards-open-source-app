export type LocalAssistantToolCall = Readonly<{
  toolCallId: string;
  name: string;
  input: string;
}>;

export type LocalChatMessage =
  | Readonly<{
    role: "user";
    content: string;
  }>
  | Readonly<{
    role: "assistant";
    content: string;
    toolCalls: ReadonlyArray<LocalAssistantToolCall>;
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
}>;

export type LocalChatStreamEvent =
  | Readonly<{ type: "delta"; text: string }>
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

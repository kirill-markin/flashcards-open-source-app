export type ChatRole = "user" | "assistant";

export type StreamPosition = Readonly<{
  itemId: string;
  responseIndex?: number;
  outputIndex: number;
  contentIndex: number | null;
  sequenceNumber: number | null;
}>;

export type TextContentPart = Readonly<{
  type: "text";
  text: string;
  streamPosition?: StreamPosition;
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

export type ToolCallContentPart = Readonly<{
  type: "tool_call";
  id?: string;
  name: string;
  status: "started" | "completed";
  providerStatus?: string | null;
  input: string | null;
  output: string | null;
  streamPosition?: StreamPosition;
}>;

export type ReasoningSummaryContentPart = Readonly<{
  type: "reasoning_summary";
  summary: string;
  streamPosition: StreamPosition;
}>;

export type ContentPart =
  | TextContentPart
  | ImageContentPart
  | FileContentPart
  | ToolCallContentPart
  | ReasoningSummaryContentPart;

export type ChatMessage = Readonly<{
  role: ChatRole;
  content: ReadonlyArray<ContentPart>;
}>;

export type LiveSSEEvent =
  | Readonly<{ type: "run_state"; runState: string; sessionId: string }>
  | Readonly<{ type: "assistant_delta"; text: string; cursor: string; itemId: string }>
  | Readonly<{
    type: "assistant_tool_call";
    toolCallId: string;
    name: string;
    status: "started" | "completed";
    input: string | null;
    output: string | null;
    providerStatus?: string | null;
    cursor: string;
    itemId: string;
    outputIndex: number;
  }>
  | Readonly<{
    type: "assistant_reasoning_started";
    reasoningId: string;
    cursor: string;
    itemId: string;
    outputIndex: number;
  }>
  | Readonly<{
    type: "assistant_reasoning_summary";
    reasoningId: string;
    summary: string;
    cursor: string;
    itemId: string;
    outputIndex: number;
  }>
  | Readonly<{
    type: "assistant_reasoning_done";
    reasoningId: string;
    cursor: string;
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
  | Readonly<{ type: "repair_status"; message: string; attempt: number; maxAttempts: number; toolName: string | null }>
  | Readonly<{ type: "error"; message: string }>
  | Readonly<{ type: "stop_ack"; sessionId: string }>
  | Readonly<{ type: "reset_required" }>;

export type ChatStreamEvent =
  | Readonly<{
    type: "delta";
    text: string;
    itemId: string;
    responseIndex?: number;
    outputIndex: number;
    contentIndex: number;
    sequenceNumber: number | null;
  }>
  | Readonly<{
    type: "tool_call";
    id: string;
    itemId: string;
    name: string;
    status: "started" | "completed";
    responseIndex?: number;
    outputIndex: number;
    sequenceNumber: number | null;
    providerStatus?: string;
    input?: string;
    output?: string;
    mainContentInvalidationVersion?: number;
    refreshRoute?: boolean;
  }>
  | Readonly<{
    type: "reasoning_summary";
    itemId: string;
    responseIndex?: number;
    outputIndex: number;
    sequenceNumber: number | null;
    summary: string;
  }>
  | Readonly<{ type: "done" }>
  | Readonly<{ type: "error"; message: string }>;

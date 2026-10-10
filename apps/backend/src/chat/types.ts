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

/** An attachment stored as a session file in `ai.chat_files`; `path` is the virtual path the model sees. */
export type ImageContentPart = Readonly<{
  type: "image";
  fileId: string;
  path: string;
  mediaType: string;
  sizeBytes: number;
}>;

export type FileContentPart = Readonly<{
  type: "file";
  fileId: string;
  path: string;
  mediaType: string;
  sizeBytes: number;
  fileName: string;
}>;

/**
 * An attachment carried as inline base64: what released clients send in `POST /chat`, and what rows
 * written before session files existed still store until their session's next turn converts them.
 */
export type InlineImageContentPart = Readonly<{
  type: "image";
  mediaType: string;
  base64Data: string;
}>;

export type InlineFileContentPart = Readonly<{
  type: "file";
  mediaType: string;
  base64Data: string;
  fileName: string;
}>;

export type InlineAttachmentContentPart = InlineImageContentPart | InlineFileContentPart;

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
  | CardContentPart
  | ToolCallContentPart
  | ReasoningSummaryContentPart;

/** Content as a turn arrives in `POST /chat`, before its inline attachments become session files. */
export type UnconvertedContentPart =
  | Exclude<ContentPart, ImageContentPart | FileContentPart>
  | InlineAttachmentContentPart;

export type ChatMessage = Readonly<{
  role: ChatRole;
  content: ReadonlyArray<ContentPart>;
}>;

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

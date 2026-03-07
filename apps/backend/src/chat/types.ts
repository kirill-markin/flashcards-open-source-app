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

export type ToolCallContentPart = Readonly<{
  type: "tool_call";
  name: string;
  status: "started" | "completed";
  input: string | null;
  output: string | null;
}>;

export type ContentPart = TextContentPart | ImageContentPart | FileContentPart | ToolCallContentPart;

export type ChatMessage = Readonly<{
  role: ChatRole;
  content: ReadonlyArray<ContentPart>;
}>;

export type ChatStreamEvent =
  | Readonly<{ type: "delta"; text: string }>
  | Readonly<{ type: "tool_call"; name: string; status: "started" | "completed"; input?: string; output?: string }>
  | Readonly<{ type: "done" }>
  | Readonly<{ type: "error"; message: string }>;

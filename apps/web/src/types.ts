export type EffortLevel = "fast" | "medium" | "long";

export type DeckPredicate =
  | Readonly<{
    field: "effortLevel";
    operator: "in";
    values: ReadonlyArray<EffortLevel>;
  }>
  | Readonly<{
    field: "tags";
    operator: "containsAny" | "containsAll";
    values: ReadonlyArray<string>;
  }>;

export type DeckFilterDefinition = Readonly<{
  version: 1;
  combineWith: "and" | "or";
  predicates: ReadonlyArray<DeckPredicate>;
}>;

export type SessionInfo = Readonly<{
  userId: string;
  workspaceId: string;
  authTransport: string;
  csrfToken: string | null;
  profile: Readonly<{
    email: string | null;
    locale: string;
  }>;
}>;

export type Card = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
  dueAt: string | null;
  reps: number;
  lapses: number;
  updatedAt: string;
}>;

export type CreateCardInput = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
}>;

export type UpdateCardInput = Readonly<{
  frontText?: string;
  backText?: string;
  tags?: ReadonlyArray<string>;
  effortLevel?: EffortLevel;
}>;

export type Deck = Readonly<{
  deckId: string;
  name: string;
  filterDefinition: DeckFilterDefinition;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateDeckInput = Readonly<{
  name: string;
  filterDefinition: DeckFilterDefinition;
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

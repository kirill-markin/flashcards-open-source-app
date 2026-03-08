/**
 * Web FSRS types mirror the backend scheduler contract and the iOS data model.
 * The web app does not contain a standalone FSRS scheduler implementation in
 * this repository.
 *
 * Keep these FSRS-facing types aligned with:
 * - apps/backend/src/schedule.ts
 * - apps/backend/src/workspaceSchedulerSettings.ts
 * - apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift
 * - docs/fsrs-scheduling-logic.md
 */
export type EffortLevel = "fast" | "medium" | "long";
// Keep in sync with apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::FsrsCardState and apps/backend/src/schedule.ts::FsrsCardState.
export type FsrsCardState = "new" | "learning" | "review" | "relearning";

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

// Keep in sync with apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::Card and apps/backend/src/cards.ts::Card.
export type Card = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
  dueAt: string | null;
  reps: number;
  lapses: number;
  fsrsCardState: FsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: string | null;
  fsrsScheduledDays: number | null;
  updatedAt: string;
}>;

// Keep in sync with apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::WorkspaceSchedulerSettings and apps/backend/src/workspaceSchedulerSettings.ts::WorkspaceSchedulerSettings.
export type WorkspaceSchedulerSettings = Readonly<{
  algorithm: "fsrs-6";
  desiredRetention: number;
  learningStepsMinutes: ReadonlyArray<number>;
  relearningStepsMinutes: ReadonlyArray<number>;
  maximumIntervalDays: number;
  enableFuzz: boolean;
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

export type ChatDiagnosticsStage =
  | "success"
  | "empty_response"
  | "response_not_ok"
  | "missing_reader"
  | "stream_error_event"
  | "fetch_throw"
  | "aborted";

export type ChatDiagnosticsPayload = Readonly<{
  clientRequestId: string;
  responseRequestId: string | null;
  model: string;
  stage: ChatDiagnosticsStage;
  statusCode: number | null;
  responseContentType: string | null;
  responseContentLength: string | null;
  responseContentEncoding: string | null;
  responseCacheControl: string | null;
  responseAmznRequestId: string | null;
  responseApiGatewayId: string | null;
  responseBodyMissing: boolean;
  chunkCount: number;
  bytesReceived: number;
  lineCount: number;
  nonEmptyLineCount: number;
  parseNullCount: number;
  deltaEventCount: number;
  toolCallEventCount: number;
  errorEventCount: number;
  doneEventCount: number;
  receivedContent: boolean;
  streamEnded: boolean;
  readerMissing: boolean;
  aborted: boolean;
  durationMs: number;
  bufferLength: number;
  errorName: string | null;
  lastEventType: string | null;
}>;

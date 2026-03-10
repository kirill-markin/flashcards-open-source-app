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

export type DeckFilterDefinition = Readonly<{
  version: 2;
  effortLevels: ReadonlyArray<EffortLevel>;
  tags: ReadonlyArray<string>;
}>;

export type SessionInfo = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  authTransport: string;
  csrfToken: string | null;
  profile: Readonly<{
    email: string | null;
    locale: string;
  }>;
}>;

export type WorkspaceSummary = Readonly<{
  workspaceId: string;
  name: string;
  createdAt: string;
  isSelected: boolean;
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
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type CardQuerySortKey =
  | "frontText"
  | "backText"
  | "tags"
  | "effortLevel"
  | "dueAt"
  | "reps"
  | "lapses"
  | "updatedAt";

export type CardQuerySortDirection = "asc" | "desc";

export type CardQuerySort = Readonly<{
  key: CardQuerySortKey;
  direction: CardQuerySortDirection;
}>;

export type QueryCardsInput = Readonly<{
  searchText: string | null;
  cursor: string | null;
  limit: number;
  sorts: ReadonlyArray<CardQuerySort>;
}>;

export type QueryCardsPage = Readonly<{
  cards: ReadonlyArray<Card>;
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}>;

// Keep in sync with apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::WorkspaceSchedulerSettings and apps/backend/src/workspaceSchedulerSettings.ts::WorkspaceSchedulerSettings.
export type WorkspaceSchedulerSettings = Readonly<{
  algorithm: "fsrs-6";
  desiredRetention: number;
  learningStepsMinutes: ReadonlyArray<number>;
  relearningStepsMinutes: ReadonlyArray<number>;
  maximumIntervalDays: number;
  enableFuzz: boolean;
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
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
  workspaceId: string;
  name: string;
  filterDefinition: DeckFilterDefinition;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type CreateDeckInput = Readonly<{
  name: string;
  filterDefinition: DeckFilterDefinition;
}>;

export type ReviewEvent = Readonly<{
  reviewEventId: string;
  workspaceId: string;
  cardId: string;
  deviceId: string;
  clientEventId: string;
  rating: 0 | 1 | 2 | 3;
  reviewedAtClient: string;
  reviewedAtServer: string;
}>;

export type SyncEntityType = "card" | "deck" | "workspace_scheduler_settings" | "review_event";
export type SyncAction = "upsert" | "append";

export type SyncPushOperation =
  | Readonly<{
    operationId: string;
    entityType: "card";
    entityId: string;
    action: "upsert";
    clientUpdatedAt: string;
    payload: Readonly<{
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
      deletedAt: string | null;
    }>;
  }>
  | Readonly<{
    operationId: string;
    entityType: "deck";
    entityId: string;
    action: "upsert";
    clientUpdatedAt: string;
    payload: Readonly<{
      deckId: string;
      name: string;
      filterDefinition: DeckFilterDefinition;
      createdAt: string;
      deletedAt: string | null;
    }>;
  }>
  | Readonly<{
    operationId: string;
    entityType: "workspace_scheduler_settings";
    entityId: string;
    action: "upsert";
    clientUpdatedAt: string;
    payload: Readonly<{
      algorithm: "fsrs-6";
      desiredRetention: number;
      learningStepsMinutes: ReadonlyArray<number>;
      relearningStepsMinutes: ReadonlyArray<number>;
      maximumIntervalDays: number;
      enableFuzz: boolean;
    }>;
  }>
  | Readonly<{
    operationId: string;
    entityType: "review_event";
    entityId: string;
    action: "append";
    clientUpdatedAt: string;
    payload: Readonly<{
      reviewEventId: string;
      cardId: string;
      deviceId: string;
      clientEventId: string;
      rating: 0 | 1 | 2 | 3;
      reviewedAtClient: string;
    }>;
  }>;

export type SyncPushResult = Readonly<{
  operations: ReadonlyArray<Readonly<{
    operationId: string;
    entityType: SyncEntityType;
    entityId: string;
    status: "applied" | "ignored" | "duplicate";
    resultingChangeId: number | null;
  }>>;
}>;

export type SyncChange =
  | Readonly<{
    changeId: number;
    entityType: "card";
    entityId: string;
    action: "upsert";
    payload: Card;
  }>
  | Readonly<{
    changeId: number;
    entityType: "deck";
    entityId: string;
    action: "upsert";
    payload: Deck;
  }>
  | Readonly<{
    changeId: number;
    entityType: "workspace_scheduler_settings";
    entityId: string;
    action: "upsert";
    payload: WorkspaceSchedulerSettings;
  }>
  | Readonly<{
    changeId: number;
    entityType: "review_event";
    entityId: string;
    action: "append";
    payload: ReviewEvent;
  }>;

export type SyncPullResult = Readonly<{
  changes: ReadonlyArray<SyncChange>;
  nextChangeId: number;
  hasMore: boolean;
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

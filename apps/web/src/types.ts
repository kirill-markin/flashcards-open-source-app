/**
 * Web FSRS types mirror the backend scheduler contract and the iOS/Android data models.
 * The web app does not contain a standalone FSRS scheduler implementation in
 * this repository.
 * Web review submissions and review-button interval previews reuse the backend
 * scheduler module from `apps/backend/src/schedule.ts`.
 *
 * Keep these FSRS-facing types aligned with:
 * - apps/backend/src/schedule.ts
 * - apps/backend/src/workspaceSchedulerSettings.ts
 * - apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift
 * - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FlashcardsModels.kt
 * - docs/fsrs-scheduling-logic.md
 */
export type EffortLevel = "fast" | "medium" | "long";
// Keep in sync with apps/backend/src/schedule.ts::FsrsCardState, apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::FsrsCardState, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FlashcardsModels.kt::FsrsCardState.
export type FsrsCardState = "new" | "learning" | "review" | "relearning";

export type CardFilter = Readonly<{
  tags: ReadonlyArray<string>;
  effort: ReadonlyArray<EffortLevel>;
}>;

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
    createdAt: string;
  }>;
}>;

export type CloudAccountState = "disconnected" | "linking-ready" | "linked";

export type WorkspaceSummary = Readonly<{
  workspaceId: string;
  name: string;
  createdAt: string;
  isSelected: boolean;
}>;

export type WorkspaceDeletePreview = Readonly<{
  workspaceId: string;
  workspaceName: string;
  activeCardCount: number;
  confirmationText: string;
  isLastAccessibleWorkspace: boolean;
}>;

export type DeleteWorkspaceResponse = Readonly<{
  ok: true;
  deletedWorkspaceId: string;
  deletedCardsCount: number;
  workspace: WorkspaceSummary;
}>;

export type AgentApiKeyConnection = Readonly<{
  connectionId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}>;

export type AgentApiKeyConnectionsResponse = Readonly<{
  connections: ReadonlyArray<AgentApiKeyConnection>;
  instructions: string;
}>;

export type AgentApiKeyRevokeResponse = Readonly<{
  ok: true;
  connection: AgentApiKeyConnection;
  instructions: string;
}>;

export type ChatTranscriptionSource = "ios" | "web";

export type ChatTranscriptionResponse = Readonly<{
  text: string;
  sessionId: string;
}>;

export type ChatSessionHistoryMessage = Readonly<{
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  timestamp: number;
  isError: boolean;
  isStopped: boolean;
}>;

export type ChatConfig = Readonly<{
  provider: Readonly<{
    id: "openai";
    label: string;
  }>;
  model: Readonly<{
    id: string;
    label: string;
    badgeLabel: string;
  }>;
  reasoning: Readonly<{
    effort: "low" | "medium" | "high" | "minimal";
    label: string;
  }>;
  features: Readonly<{
    modelPickerEnabled: boolean;
    dictationEnabled: boolean;
    attachmentsEnabled: boolean;
  }>;
}>;

export type ChatSessionSnapshot = Readonly<{
  sessionId: string;
  runState: "idle" | "running" | "interrupted";
  updatedAt: number;
  mainContentInvalidationVersion: number;
  chatConfig: ChatConfig;
  messages: ReadonlyArray<ChatSessionHistoryMessage>;
}>;

export type StartChatRunRequestBody = Readonly<{
  sessionId?: string;
  clientRequestId: string;
  content: ReadonlyArray<ContentPart>;
  timezone: string;
}>;

export type StartChatRunResponse = Readonly<{
  ok: true;
  sessionId: string;
  runId: string;
  clientRequestId: string;
  runState: "idle" | "running" | "interrupted";
  chatConfig: ChatConfig;
  deduplicated?: boolean;
}>;

export type NewChatSessionResponse = Readonly<{
  ok: true;
  sessionId: string;
  chatConfig: ChatConfig;
}>;

export type StopChatRunResponse = Readonly<{
  ok: true;
  sessionId: string;
  runId: string | null;
  stopped: boolean;
  stillRunning: boolean;
}>;

/** Mirrors the iOS local workspace payload used by local AI tools. */
export type Workspace = Readonly<{
  workspaceId: string;
  name: string;
  createdAt: string;
}>;

/** Mirrors the iOS local user settings payload used by local AI tools. */
export type UserSettings = Readonly<{
  userId: string;
  workspaceId: string;
  email: string | null;
  locale: string;
  createdAt: string;
}>;

/** Mirrors the iOS local cloud-settings payload used by local AI tools. */
export type CloudSettings = Readonly<{
  installationId: string;
  cloudState: CloudAccountState;
  linkedUserId: string | null;
  linkedWorkspaceId: string | null;
  linkedEmail: string | null;
  onboardingCompleted: boolean;
  updatedAt: string;
}>;

/** Mirrors the iOS local home snapshot payload used by local AI tools. */
export type HomeSnapshot = Readonly<{
  deckCount: number;
  totalCards: number;
  dueCount: number;
  newCount: number;
  reviewedCount: number;
}>;

// Keep in sync with apps/backend/src/cards.ts::Card, apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::Card, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FlashcardsModels.kt::CardSummary.
export type Card = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
  dueAt: string | null;
  createdAt: string;
  reps: number;
  lapses: number;
  fsrsCardState: FsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: string | null;
  fsrsScheduledDays: number | null;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
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
  filter: CardFilter | null;
}>;

export type QueryCardsPage = Readonly<{
  cards: ReadonlyArray<Card>;
  nextCursor: string | null;
  totalCount: number;
}>;

export type ReviewCounts = Readonly<{
  dueCount: number;
  totalCount: number;
}>;

export type ReviewQueueSnapshot = Readonly<{
  resolvedReviewFilter: ReviewFilter;
  cards: ReadonlyArray<Card>;
  nextCursor: string | null;
  reviewCounts: ReviewCounts;
}>;

export type ReviewTimelinePage = Readonly<{
  cards: ReadonlyArray<Card>;
  hasMoreCards: boolean;
}>;

export type DeckCardStats = Readonly<{
  totalCards: number;
  dueCards: number;
  newCards: number;
  reviewedCards: number;
}>;

export type DeckSummary = Readonly<{
  deckId: string;
  name: string;
  filterDefinition: DeckFilterDefinition;
  createdAt: string;
  totalCards: number;
  dueCards: number;
  newCards: number;
  reviewedCards: number;
}>;

export type DecksListSnapshot = Readonly<{
  deckSummaries: ReadonlyArray<DeckSummary>;
  allCardsStats: DeckCardStats;
}>;

export type WorkspaceOverviewSnapshot = Readonly<{
  workspaceName: string;
  deckCount: number;
  tagsCount: number;
  totalCards: number;
  dueCount: number;
  newCount: number;
  reviewedCount: number;
}>;

export type WorkspaceTagSummary = Readonly<{
  tag: string;
  cardsCount: number;
}>;

export type WorkspaceTagsSummary = Readonly<{
  tags: ReadonlyArray<WorkspaceTagSummary>;
  totalCards: number;
}>;

export type TagSuggestion =
  | Readonly<{
    tag: string;
    countState: "loading";
  }>
  | Readonly<{
    tag: string;
    countState: "ready";
    cardsCount: number;
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
  lastModifiedByReplicaId: string;
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
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type CreateDeckInput = Readonly<{
  name: string;
  filterDefinition: DeckFilterDefinition;
}>;

export type UpdateDeckInput = Readonly<{
  name: string;
  filterDefinition: DeckFilterDefinition;
}>;

export type ReviewFilter =
  | Readonly<{
    kind: "allCards";
  }>
  | Readonly<{
    kind: "deck";
    deckId: string;
  }>
  | Readonly<{
    kind: "tag";
    tag: string;
  }>;

export type ReviewEvent = Readonly<{
  reviewEventId: string;
  workspaceId: string;
  cardId: string;
  replicaId: string;
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
      createdAt: string;
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
    status: "applied" | "ignored" | "duplicate" | "rejected";
    resultingHotChangeId: number | null;
    error: string | null;
  }>>;
}>;

export type SyncBootstrapEntry =
  | Readonly<{
    entityType: "card";
    entityId: string;
    action: "upsert";
    payload: Card;
  }>
  | Readonly<{
    entityType: "deck";
    entityId: string;
    action: "upsert";
    payload: Deck;
  }>
  | Readonly<{
    entityType: "workspace_scheduler_settings";
    entityId: string;
    action: "upsert";
    payload: WorkspaceSchedulerSettings;
  }>;

export type SyncChange = SyncBootstrapEntry & Readonly<{
  changeId: number;
}>;

export type SyncBootstrapPullResult = Readonly<{
  mode: "pull";
  entries: ReadonlyArray<SyncBootstrapEntry>;
  nextCursor: string | null;
  hasMore: boolean;
  bootstrapHotChangeId: number;
  remoteIsEmpty: boolean;
}>;

export type SyncBootstrapPushResult = Readonly<{
  mode: "push";
  appliedEntriesCount: number;
  bootstrapHotChangeId: number;
}>;

export type SyncPullResult = Readonly<{
  changes: ReadonlyArray<SyncChange>;
  nextHotChangeId: number;
  hasMore: boolean;
}>;

export type SyncReviewHistoryPullResult = Readonly<{
  reviewEvents: ReadonlyArray<ReviewEvent>;
  nextReviewSequenceId: number;
  hasMore: boolean;
}>;

export type SyncReviewHistoryImportResult = Readonly<{
  importedCount: number;
  duplicateCount: number;
  nextReviewSequenceId: number;
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
  id?: string;
  name: string;
  status: "started" | "completed";
  providerStatus?: string | null;
  input: string | null;
  output: string | null;
  streamPosition?: Readonly<{
    itemId: string;
    responseIndex?: number;
    outputIndex: number;
    contentIndex: number | null;
    sequenceNumber: number | null;
  }>;
}>;

export type ReasoningSummaryContentPart = Readonly<{
  type: "reasoning_summary";
  summary: string;
  streamPosition?: Readonly<{
    itemId: string;
    responseIndex?: number;
    outputIndex: number;
    contentIndex: number | null;
    sequenceNumber: number | null;
  }>;
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

export type ChatStreamEvent =
  | Readonly<{ type: "delta"; text: string }>
  | Readonly<{ type: "tool_call"; name: string; status: "started" | "completed"; input?: string; output?: string }>
  | Readonly<{ type: "done" }>
  | Readonly<{ type: "error"; message: string }>;

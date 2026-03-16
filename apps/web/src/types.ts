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
  deviceId: string;
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

// Keep in sync with apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::Card and apps/backend/src/cards.ts::Card.
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
  | "createdAt";

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
  toolCallId: string;
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

export type LocalChatMessage =
  | Readonly<{
    role: "user";
    content: ReadonlyArray<ContentPart>;
  }>
  | Readonly<{
    role: "assistant";
    content: ReadonlyArray<ContentPart>;
  }>
  | Readonly<{
    role: "tool";
    toolCallId: string;
    name: string;
    output: string;
  }>;

/**
 * High-level user facts injected into the system prompt before the model
 * reaches for workspace SQL. Keep this small, factual, and easy to extend.
 */
export type LocalChatUserContext = Readonly<{
  totalCards: number;
}>;

export type LocalChatRequestBody = Readonly<{
  messages: ReadonlyArray<LocalChatMessage>;
  model: string;
  timezone: string;
  devicePlatform: "web";
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

export type LocalChatFailureDiagnosticsPayload = Readonly<{
  kind: "failure";
  clientRequestId: string;
  backendRequestId: string | null;
  stage: string;
  errorKind: string;
  statusCode: number | null;
  eventType: string | null;
  toolName: string | null;
  toolCallId: string | null;
  lineNumber: number | null;
  rawSnippet: string | null;
  decoderSummary: string | null;
  continuationAttempt: number | null;
  continuationToolCallIds: ReadonlyArray<string>;
  selectedModel: string;
  messageCount: number;
  appVersion: string;
  devicePlatform: "web";
}>;

export type LocalChatLatencyResult =
  | "success"
  | "response_not_ok"
  | "missing_reader"
  | "empty_response"
  | "cancelled_before_headers"
  | "cancelled_before_first_sse_line"
  | "cancelled_before_first_delta"
  | "stream_error_before_first_delta";

export type LocalChatLatencyDiagnosticsPayload = Readonly<{
  kind: "latency";
  clientRequestId: string;
  backendRequestId: string | null;
  selectedModel: string;
  messageCount: number;
  appVersion: string;
  devicePlatform: "web";
  result: LocalChatLatencyResult;
  statusCode: number | null;
  firstEventType: string | null;
  didReceiveFirstSseLine: boolean;
  didReceiveFirstDelta: boolean;
  tapToRequestStartMs: number | null;
  requestStartToHeadersMs: number | null;
  headersToFirstSseLineMs: number | null;
  firstSseLineToFirstDeltaMs: number | null;
  requestStartToFirstDeltaMs: number | null;
  tapToFirstDeltaMs: number | null;
  requestStartToTerminalMs: number | null;
  tapToTerminalMs: number | null;
}>;

export type LocalChatDiagnosticsPayload =
  | LocalChatFailureDiagnosticsPayload
  | LocalChatLatencyDiagnosticsPayload;

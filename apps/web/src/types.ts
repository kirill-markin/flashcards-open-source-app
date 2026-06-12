import type { Locale } from "./i18n/types";

/**
 * Web FSRS types mirror the backend scheduler contract and the iOS/Android data models.
 * The web app does not contain a standalone FSRS scheduler implementation in
 * this repository.
 * Web review submissions and review-button interval previews reuse the backend
 * scheduler module from `apps/backend/src/scheduling/index.ts`.
 *
 * Keep these FSRS-facing types aligned with:
 * - apps/backend/src/scheduling/index.ts
 * - apps/backend/src/scheduling/workspaceSettings.ts
 * - apps/ios/Flashcards/Flashcards/Cards/Model/CardDeckTypes.swift
 * - apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsTypes.swift
 * - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/cards/CardModels.kt
 * - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/SchedulingModels.kt
 * - docs/fsrs-scheduling-logic.md
 */
export type EffortLevel = "fast" | "medium" | "long";
// Keep in sync with apps/backend/src/scheduling/index.ts::FsrsCardState, apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsTypes.swift::FsrsCardState, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/SchedulingModels.kt::FsrsCardState.
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

export type AccountPreferences = Readonly<{
  reviewReactionAnimationsEnabled: boolean;
}>;

export type AccountPreferencesEnvelope = Readonly<{
  preferences: AccountPreferences;
}>;

export type CommunityPublicProfile = Readonly<{
  publicProfileId: string;
  anonymousDisplayName: string;
  leaderboardParticipationEnabled: boolean;
  linkedAccountRequiredForLeaderboard: boolean;
}>;

export type CommunityProfilePatch = Readonly<{
  leaderboardParticipationEnabled: boolean;
}>;

export type SessionInfo = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  authTransport: string;
  csrfToken: string | null;
  preferences: AccountPreferences;
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

export const resetWorkspaceProgressConfirmationText: string = "reset all progress for all cards in this workspace";

export type WorkspaceResetProgressPreview = Readonly<{
  workspaceId: string;
  workspaceName: string;
  cardsToResetCount: number;
  confirmationText: string;
}>;

export type ResetWorkspaceProgressResponse = Readonly<{
  ok: true;
  workspaceId: string;
  cardsResetCount: number;
}>;

export type ProgressSeriesInput = Readonly<{
  timeZone: string;
  from: string;
  to: string;
}>;

export type ProgressSummaryInput = Readonly<{
  timeZone: string;
  today: string;
}>;

export type ProgressReviewScheduleInput = Readonly<{
  timeZone: string;
  today: string;
}>;

export type ProgressScopeKey = string;

export type DailyReviewPoint = Readonly<{
  date: string;
  reviewCount: number;
}>;

export type ProgressSummary = Readonly<{
  currentStreakDays: number;
  hasReviewedToday: boolean;
  lastReviewedOn: string | null;
  activeReviewDays: number;
}>;

export type ProgressReviewHistoryWatermark = Readonly<{
  workspaceId: string;
  reviewSequenceId: number;
}>;

export type ReviewProgressBadgeState = Readonly<{
  streakDays: number;
  hasReviewedToday: boolean;
  isInteractive: boolean;
}>;

export type ReviewLeaderboardBadgeState = Readonly<{
  rank: number | null;
  windowKey: ProgressLeaderboardWindowKey | null;
  isInteractive: boolean;
}>;

export type ProgressChartData = Readonly<{
  dailyReviews: ReadonlyArray<DailyReviewPoint>;
}>;

export type ProgressSummaryPayload = Readonly<{
  timeZone: string;
  generatedAt: string | null;
  reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark>;
  summary: ProgressSummary;
}>;

export type ProgressSeries = Readonly<{
  timeZone: string;
  from: string;
  to: string;
  generatedAt: string | null;
  reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark>;
  dailyReviews: ReadonlyArray<DailyReviewPoint>;
}>;

/** Canonical bucket order for the progress chart and the runtime validation set for incoming bucket keys. Reordering or removing entries is a breaking change for the UI. */
export const progressReviewScheduleBucketKeys = [
  "new",
  "today",
  "days1To7",
  "days8To30",
  "days31To90",
  "days91To360",
  "years1To2",
  "later",
] as const;

export type ProgressReviewScheduleBucketKey = typeof progressReviewScheduleBucketKeys[number];

export type ProgressReviewScheduleBucket = Readonly<{
  key: ProgressReviewScheduleBucketKey;
  count: number;
}>;

export type ProgressReviewSchedule = Readonly<{
  timeZone: string;
  generatedAt: string | null;
  reviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark>;
  totalCards: number;
  buckets: ReadonlyArray<ProgressReviewScheduleBucket>;
}>;

export type ProgressSummarySnapshot = ProgressSummaryPayload & Readonly<{
  source: "server" | "local_only";
  isApproximate: boolean;
}>;

export type ProgressSeriesSnapshot = ProgressSeries & Readonly<{
  chartData: ProgressChartData;
  source: "server" | "local_only";
  isApproximate: boolean;
}>;

export type ProgressReviewScheduleSnapshot = ProgressReviewSchedule & Readonly<{
  source: "server" | "local_only";
  isApproximate: boolean;
}>;

/** Canonical leaderboard window order for the period control and the runtime validation set for incoming window keys. Keep in sync with apps/backend/src/community/leaderboard/leaderboardWindows.ts. */
export const progressLeaderboardWindowKeys = [
  "last_24_hours",
  "last_3_days",
  "last_7_days",
  "last_30_days",
  "all_time",
] as const;

export type ProgressLeaderboardWindowKey = typeof progressLeaderboardWindowKeys[number];

/** Rolling window lower bounds in whole hours from the current instant; null means unbounded (all time). Keep in sync with apps/backend/src/community/leaderboard/leaderboardWindows.ts. */
export const progressLeaderboardWindowLowerBoundHours: Readonly<Record<ProgressLeaderboardWindowKey, number | null>> = {
  last_24_hours: 24,
  last_3_days: 72,
  last_7_days: 168,
  last_30_days: 720,
  all_time: null,
};

export const progressLeaderboardStatuses = [
  "ready",
  "linked_account_required",
  "participation_disabled",
  "snapshot_unavailable",
] as const;

export type ProgressLeaderboardStatus = typeof progressLeaderboardStatuses[number];

export type ProgressLeaderboardMetric = Readonly<{
  metricVersion: "qualified_reviews_v1";
  title: string;
  description: string;
}>;

export type ProgressLeaderboardViewer = Readonly<{
  publicProfileId: string;
  displayName: string;
  rank: number;
  qualifiedReviewCount: number;
}>;

export const progressLeaderboardParticipantRowKinds = ["top", "neighbor", "viewer"] as const;

export type ProgressLeaderboardParticipantRowKind = typeof progressLeaderboardParticipantRowKinds[number];

export type ProgressLeaderboardParticipantRow = Readonly<{
  kind: ProgressLeaderboardParticipantRowKind;
  publicProfileId: string;
  anonymousDisplayName: string;
  qualifiedReviewCount: number;
  rank: number;
}>;

export type ProgressLeaderboardGapRow = Readonly<{
  kind: "gap";
}>;

export type ProgressLeaderboardRow = ProgressLeaderboardParticipantRow | ProgressLeaderboardGapRow;

export type ProgressLeaderboardWindow = Readonly<{
  windowKey: ProgressLeaderboardWindowKey;
  snapshotId: string;
  snapshotGeneratedAt: string;
  asOfServerHour: string;
  nextRefreshAfter: string;
  participantCount: number;
  viewer: ProgressLeaderboardViewer;
  rows: ReadonlyArray<ProgressLeaderboardRow>;
}>;

export type ProgressLeaderboard = Readonly<{
  status: ProgressLeaderboardStatus;
  metric: ProgressLeaderboardMetric;
  defaultWindowKey: ProgressLeaderboardWindowKey;
  windows: ReadonlyArray<ProgressLeaderboardWindow>;
}>;

/** Locally counted qualified reviews (rating !== 0) per rolling window, used only to overlay the viewer row count. */
export type ProgressLeaderboardLocalViewerCounts = Readonly<Record<ProgressLeaderboardWindowKey, number>>;

export type ProgressLeaderboardSnapshot = ProgressLeaderboard & Readonly<{
  source: "server";
  isApproximate: boolean;
}>;

export type ProgressRenderedSeriesSummaryContext = Readonly<{
  lowerBoundSummary: ProgressSummary;
  activeDates: ReadonlyArray<string>;
  activeDatesMissingFromServerBase: ReadonlyArray<string>;
  serverBaseReviewHistoryWatermarks: ReadonlyArray<ProgressReviewHistoryWatermark> | null;
}>;

export type ProgressSummarySourceState = Readonly<{
  scopeKey: ProgressScopeKey | null;
  referenceLocalDate: string | null;
  localFallback: ProgressSummarySnapshot | null;
  localFallbackActiveDates: ReadonlyArray<string>;
  serverBase: ProgressSummarySnapshot | null;
  hasPendingLocalReviews: boolean;
  renderedSeriesContext: ProgressRenderedSeriesSummaryContext | null;
  renderedSnapshot: ProgressSummarySnapshot | null;
  isLoading: boolean;
  errorMessage: string;
}>;

export type ProgressSeriesSourceState = Readonly<{
  scopeKey: ProgressScopeKey | null;
  localFallback: ProgressSeriesSnapshot | null;
  serverBase: ProgressSeriesSnapshot | null;
  pendingLocalOverlay: ProgressChartData | null;
  renderedSnapshot: ProgressSeriesSnapshot | null;
  isLoading: boolean;
  errorMessage: string;
}>;

export type ProgressReviewScheduleSourceState = Readonly<{
  scopeKey: ProgressScopeKey | null;
  localFallback: ProgressReviewScheduleSnapshot | null;
  serverBase: ProgressReviewScheduleSnapshot | null;
  progressScheduleLocalVersion: number;
  serverBaseProgressScheduleLocalVersion: number | null;
  serverBaseLocalCardTotalDelta: number;
  hasPendingLocalCardChanges: boolean;
  hasCompleteLocalCardState: boolean;
  pendingLocalCardTotalDelta: number;
  renderedSnapshot: ProgressReviewScheduleSnapshot | null;
  isLoading: boolean;
  errorMessage: string;
}>;

export type ProgressLeaderboardSourceState = Readonly<{
  scopeKey: ProgressScopeKey | null;
  serverBase: ProgressLeaderboardSnapshot | null;
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null;
  renderedSnapshot: ProgressLeaderboardSnapshot | null;
  /** True only while a server leaderboard load is expected; local viewer counts never drive this flag. */
  isLoading: boolean;
  /** Last server leaderboard load failure; empty after a successful or skipped server load. */
  errorMessage: string;
  /** True when `errorMessage` came from a transport-level failure (offline/unreachable) rather than an HTTP error response. */
  isNetworkError: boolean;
  /** Last local viewer-count load failure; kept apart from `errorMessage` so a local-only failure is never rendered as a server or offline state. */
  localViewerCountsErrorMessage: string;
}>;

export type ProgressSourceState = Readonly<{
  summary: ProgressSummarySourceState;
  series: ProgressSeriesSourceState;
  reviewSchedule: ProgressReviewScheduleSourceState;
  leaderboard: ProgressLeaderboardSourceState;
}>;

export type FeedbackTrigger = "settings" | "automatic";

export type FeedbackPlatform = "web";

export type FeedbackPromptEventType = "automatic_prompt_shown" | "automatic_prompt_dismissed";

export type FeedbackState = Readonly<{
  automaticPromptCooldownDays: number;
  lastAutomaticPromptShownAt: string | null;
  lastFeedbackSubmittedAt: string | null;
  nextAutomaticPromptAt: string | null;
}>;

export type FeedbackStateEnvelope = Readonly<{
  feedbackState: FeedbackState;
}>;

export type FeedbackPromptEventRequest = Readonly<{
  feedbackPromptEventId: string;
  workspaceId: string | null;
  installationId: string | null;
  platform: FeedbackPlatform;
  appVersion: string;
  locale: Locale;
  timezone: string;
  eventType: FeedbackPromptEventType;
  createdAtClient: string;
}>;

export type FeedbackPromptEventResponse = FeedbackStateEnvelope & Readonly<{
  ok?: true;
}>;

export type FeedbackSubmissionRequest = Readonly<{
  feedbackSubmissionId: string;
  workspaceId: string | null;
  installationId: string | null;
  platform: FeedbackPlatform;
  appVersion: string;
  locale: Locale;
  timezone: string;
  trigger: FeedbackTrigger;
  message: string;
  createdAtClient: string;
}>;

export type FeedbackSubmissionResponse = FeedbackStateEnvelope & Readonly<{
  ok?: true;
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
  cursor: string | null;
  itemId: string | null;
}>;

export type ChatConfig = Readonly<{
  features: Readonly<{
    dictationEnabled: boolean;
    attachmentsEnabled: boolean;
  }>;
}>;

export type ChatLiveStream = Readonly<{
  url: string;
  authorization: string;
  expiresAt: number;
}>;

export type ChatConversation = Readonly<{
  messages: ReadonlyArray<ChatSessionHistoryMessage>;
  updatedAt: number;
  mainContentInvalidationVersion: number;
  hasOlder?: boolean;
  oldestCursor?: string | null;
}>;

export type ChatActiveRun = Readonly<{
  runId: string;
  status: "running";
  live: Readonly<{
    cursor: string | null;
    stream: ChatLiveStream;
  }>;
  lastHeartbeatAt?: number;
}>;

export type ChatComposerSuggestion = Readonly<{
  id: string;
  text: string;
  source: "initial" | "assistant_follow_up";
  assistantItemId: string | null;
}>;

export type ChatSessionSnapshot = Readonly<{
  sessionId: string;
  conversationScopeId: string;
  conversation: ChatConversation;
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
  chatConfig: ChatConfig;
  activeRun: ChatActiveRun | null;
}>;

export type StartChatRunRequestBody = Readonly<{
  sessionId: string;
  // Optional on the wire until the minimum supported backend and first-party AI
  // client versions are greater than 1.5.0.
  workspaceId?: string;
  clientRequestId: string;
  content: ReadonlyArray<ContentPart>;
  timezone: string;
  // Optional on the wire until the minimum supported backend and first-party AI
  // client versions are greater than 1.5.0.
  uiLocale?: Locale;
}>;

export type StartChatRunResponse = ChatSessionSnapshot & Readonly<{
  accepted: true;
  deduplicated?: boolean;
}>;

export type NewChatSessionRequestBody = Readonly<{
  sessionId: string;
  // Optional on the wire until the minimum supported backend and first-party AI
  // client versions are greater than 1.5.0.
  workspaceId?: string;
  // Optional on the wire until the minimum supported backend and first-party AI
  // client versions are greater than 1.5.0.
  uiLocale?: Locale;
}>;

export type NewChatSessionResponse = Readonly<{
  ok: true;
  sessionId: string;
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
  chatConfig: ChatConfig;
}>;

export type StopChatRunResponse = Readonly<{
  sessionId: string;
  stopped: boolean;
  stillRunning: boolean;
}>;

export type StopChatRunRequestBody = Readonly<{
  sessionId: string;
  // Optional on the wire until the minimum supported backend and first-party AI
  // client versions are greater than 1.5.0.
  workspaceId?: string;
  // TODO: Make runId required once the minimum supported first-party AI client
  // version is greater than 1.5.0. This optional path supports older releases.
  runId?: string;
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

// Keep in sync with apps/backend/src/cards/types.ts::Card, apps/ios/Flashcards/Flashcards/Cards/Model/CardDeckTypes.swift::Card, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/cards/CardModels.kt::CardSummary.
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

// Keep in sync with apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsTypes.swift::WorkspaceSchedulerSettings and apps/backend/src/scheduling/workspaceConfig.ts::WorkspaceSchedulerSettings.
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
    kind: "effort";
    effortLevel: EffortLevel;
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

export type CardContentPart = Readonly<{
  type: "card";
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
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
  reasoningId?: string;
  summary: string;
  status?: "started" | "completed";
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
  | CardContentPart
  | ToolCallContentPart
  | ReasoningSummaryContentPart;

export type ChatMessage = Readonly<{
  role: ChatRole;
  content: ReadonlyArray<ContentPart>;
}>;

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
// Keep in sync with apps/backend/src/scheduling/index.ts::FsrsCardState, apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsTypes.swift::FsrsCardState, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/scheduling/SchedulingModels.kt::FsrsCardState.
export type FsrsCardState = "new" | "learning" | "review" | "relearning";

export type CardFilter = Readonly<{
  tags: ReadonlyArray<string>;
}>;

export type DeckFilterDefinition = Readonly<{
  version: 2;
  tags: ReadonlyArray<string>;
}>;

export type ReviewRating = 0 | 1 | 2 | 3;

// Keep in sync with apps/backend/src/cards/types.ts::Card, apps/ios/Flashcards/Flashcards/Cards/Model/CardDeckTypes.swift::Card, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/cards/CardModels.kt::CardSummary.
export type Card = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
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
}>;

export type UpdateCardInput = Readonly<{
  frontText?: string;
  backText?: string;
  tags?: ReadonlyArray<string>;
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
  rating: ReviewRating;
  reviewedAtClient: string;
  reviewedTimeZone?: string;
  reviewedAtServer: string;
}>;

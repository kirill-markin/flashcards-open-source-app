import type { LwwMetadata } from "../lww";
import type {
  FsrsCardState,
  ReviewRating,
  ReviewableCardScheduleState,
} from "../schedule";

export type TimestampValue = Date | string;

export type EffortLevel = "fast" | "medium" | "long";

export type CardFilter = Readonly<{
  tags: ReadonlyArray<string>;
  effort: ReadonlyArray<EffortLevel>;
}>;

export type CardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  tags: ReadonlyArray<string>;
  effort_level: EffortLevel;
  due_at: TimestampValue | null;
  created_at: TimestampValue;
  reps: number;
  lapses: number;
  fsrs_card_state: FsrsCardState;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: TimestampValue | null;
  fsrs_scheduled_days: number | null;
  client_updated_at: TimestampValue;
  last_modified_by_device_id: string;
  last_operation_id: string;
  updated_at: TimestampValue;
  deleted_at: TimestampValue | null;
}>;

export type ReviewableCardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  due_at: TimestampValue | null;
  reps: number;
  lapses: number;
  fsrs_card_state: FsrsCardState;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: TimestampValue | null;
  fsrs_scheduled_days: number | null;
}>;

export type ReviewHistoryRow = Readonly<{
  review_event_id: string;
  workspace_id: string;
  device_id: string;
  client_event_id: string;
  card_id: string;
  rating: number;
  reviewed_at_client: TimestampValue;
  reviewed_at_server: TimestampValue;
}>;

export type DeckSummaryRow = Readonly<{
  total_cards: string | number;
  due_cards: string | number;
  new_cards: string | number;
  reviewed_cards: string | number;
  total_reps: string | number;
  total_lapses: string | number;
}>;

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

export type WorkspaceTagSummary = Readonly<{
  tag: string;
  cardsCount: number;
}>;

export type WorkspaceTagsSummary = Readonly<{
  tags: ReadonlyArray<WorkspaceTagSummary>;
  totalCards: number;
}>;

export type CardListPage = Readonly<{
  cards: ReadonlyArray<Card>;
  nextCursor: string | null;
}>;

export type CardMutationMetadata = LwwMetadata;

export type CreateCardInput = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
}>;

export type BulkCreateCardItem = Readonly<{
  input: CreateCardInput;
  metadata: CardMutationMetadata;
}>;

export type UpdateCardInput = Readonly<{
  frontText?: string;
  backText?: string;
  tags?: ReadonlyArray<string>;
  effortLevel?: EffortLevel;
}>;

export type BulkUpdateCardItem = Readonly<{
  cardId: string;
  input: UpdateCardInput;
  metadata: CardMutationMetadata;
}>;

export type BulkDeleteCardItem = Readonly<{
  cardId: string;
  metadata: CardMutationMetadata;
}>;

export type SubmitReviewInput = Readonly<{
  cardId: string;
  rating: ReviewRating;
  reviewedAtClient: string;
  reviewEventId?: string;
  clientEventId?: string;
}>;

export type ReviewResult = Readonly<{
  card: Card;
  nextDueAt: string;
}>;

export type ReviewEvent = Readonly<{
  reviewEventId: string;
  workspaceId: string;
  cardId: string;
  deviceId: string;
  clientEventId: string;
  rating: number;
  reviewedAtClient: string;
  reviewedAtServer: string;
}>;

export type ReviewHistoryItem = ReviewEvent;

export type ReviewHistoryPage = Readonly<{
  history: ReadonlyArray<ReviewHistoryItem>;
  nextCursor: string | null;
}>;

export type CardSnapshotInput = Readonly<{
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

export type CardMutationResult = Readonly<{
  card: Card;
  applied: boolean;
  changeId: number | null;
}>;

export type BulkDeleteCardsResult = Readonly<{
  deletedCardIds: ReadonlyArray<string>;
  deletedCount: number;
}>;

export type ReviewEventAppendResult = Readonly<{
  reviewEvent: ReviewEvent;
  applied: boolean;
  changeId: number | null;
}>;

export type DeckSummary = Readonly<{
  totalCards: number;
  dueCards: number;
  newCards: number;
  reviewedCards: number;
  totalReps: number;
  totalLapses: number;
}>;

export type UpdateQueryParts = Readonly<{
  assignments: ReadonlyArray<string>;
  params: ReadonlyArray<string | ReadonlyArray<string>>;
}>;

export type FsrsStateSnapshot = Readonly<{
  due_at: TimestampValue | null;
  reps: number;
  lapses: number;
  fsrs_card_state: FsrsCardState;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: TimestampValue | null;
  fsrs_scheduled_days: number | null;
}>;

export type { ReviewableCardScheduleState };

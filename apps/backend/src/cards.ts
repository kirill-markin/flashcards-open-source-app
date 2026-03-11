/**
 * Card persistence is responsible for enforcing the persisted FSRS invariants
 * described in docs/fsrs-scheduling-logic.md. Card rows and org.workspaces
 * fsrs_* columns are the runtime source of truth for scheduling.
 *
 * This file mirrors the scheduler-entrypoint and persisted-state handling in
 * `apps/ios/Flashcards/Flashcards/LocalDatabase.swift`.
 * If you change scheduler-state validation or review persistence here, make
 * the same change in the iOS mirror and update docs/fsrs-scheduling-logic.md.
 */
export type {
  BulkCreateCardItem,
  BulkDeleteCardItem,
  BulkDeleteCardsResult,
  BulkUpdateCardItem,
  Card,
  CardMutationMetadata,
  CardMutationResult,
  CardListPage,
  CardQuerySort,
  CardQuerySortDirection,
  CardQuerySortKey,
  CardSnapshotInput,
  CreateCardInput,
  DeckSummary,
  QueryCardsInput,
  QueryCardsPage,
  EffortLevel,
  ReviewEvent,
  ReviewEventAppendResult,
  ReviewHistoryItem,
  ReviewHistoryPage,
  ReviewResult,
  SubmitReviewInput,
  UpdateCardInput,
  WorkspaceTagSummary,
  WorkspaceTagsSummary,
} from "./cards/types";

export {
  getInvalidFsrsStateReason,
  validateOrResetCardRowForRead,
} from "./cards/fsrs";

export {
  createCard,
  createCards,
  deleteCard,
  deleteCards,
  updateCard,
  updateCards,
  upsertCardSnapshot,
  upsertCardSnapshotInExecutor,
} from "./cards/mutations";

export {
  getCard,
  getCards,
  listCards,
  listReviewHistoryPage,
  listReviewQueuePage,
  listWorkspaceTagsSummary,
  queryCardsPage,
  listReviewQueue,
  searchCards,
  summarizeDeckState,
} from "./cards/queries";

export {
  appendReviewEventSnapshotInExecutor,
  submitReview,
} from "./cards/reviews";

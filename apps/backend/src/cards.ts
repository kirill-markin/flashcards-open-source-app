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
  Card,
  CardMutationMetadata,
  CardMutationResult,
  CardSnapshotInput,
  CreateCardInput,
  DeckSummary,
  EffortLevel,
  ReviewEvent,
  ReviewEventAppendResult,
  ReviewHistoryItem,
  ReviewResult,
  SubmitReviewInput,
  UpdateCardInput,
} from "./cards/types";

export {
  getInvalidFsrsStateReason,
  validateOrResetCardRowForRead,
} from "./cards/fsrs";

export {
  createCard,
  updateCard,
  upsertCardSnapshot,
  upsertCardSnapshotInExecutor,
} from "./cards/mutations";

export {
  getCard,
  listCards,
  listReviewHistory,
  listReviewQueue,
  searchCards,
  summarizeDeckState,
} from "./cards/queries";

export {
  appendReviewEventSnapshotInExecutor,
  submitReview,
} from "./cards/reviews";

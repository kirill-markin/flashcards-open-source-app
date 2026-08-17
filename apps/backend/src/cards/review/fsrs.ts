import type { FsrsStateSnapshot } from "../types";

function hasNewCardFsrsValues(card: FsrsStateSnapshot): boolean {
  return (
    card.fsrs_step_index !== null
    || card.fsrs_stability !== null
    || card.fsrs_difficulty !== null
    || card.fsrs_last_reviewed_at !== null
    || card.fsrs_scheduled_days !== null
  );
}

function hasMissingReviewStateFsrsValues(card: FsrsStateSnapshot): boolean {
  return (
    card.fsrs_stability === null
    || card.fsrs_difficulty === null
    || card.fsrs_last_reviewed_at === null
    || card.fsrs_scheduled_days === null
  );
}

export function getInvalidFsrsStateReason(card: FsrsStateSnapshot): string | null {
  // Keep in sync with apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsScheduler.swift::getMemoryState(card:) and LocalDatabase persisted-state expectations.
  if (card.fsrs_card_state === "new") {
    if (card.due_at !== null) {
      return "New card must not persist due_at";
    }

    if (hasNewCardFsrsValues(card)) {
      return "New card has persisted FSRS state";
    }

    return null;
  }

  if (hasMissingReviewStateFsrsValues(card)) {
    return "Persisted FSRS card state is incomplete";
  }

  if (card.fsrs_card_state === "review" && card.fsrs_step_index !== null) {
    return "Review card must not persist fsrs_step_index";
  }

  if (
    (card.fsrs_card_state === "learning" || card.fsrs_card_state === "relearning")
    && card.fsrs_step_index === null
  ) {
    return "Learning or relearning card is missing fsrs_step_index";
  }

  return null;
}

export function assertConsistentFsrsState(card: FsrsStateSnapshot): void {
  const invalidReason = getInvalidFsrsStateReason(card);
  if (invalidReason !== null) {
    throw new Error(invalidReason);
  }
}

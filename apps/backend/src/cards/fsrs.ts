import type { DatabaseExecutor } from "../db";
import { HttpError } from "../errors";
import { CARD_COLUMNS, REVIEWABLE_CARD_COLUMNS } from "./shared";
import type { CardRow, FsrsStateSnapshot, ReviewableCardRow } from "./types";

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
  // Keep in sync with apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getMemoryState(card:) and LocalDatabase persisted-state expectations.
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

function logFsrsStateReset(workspaceId: string, cardId: string, reason: string): void {
  console.error(JSON.stringify({
    domain: "cards",
    action: "reset_invalid_fsrs_state",
    workspaceId,
    cardId,
    reason,
    repair: "reset",
  }));
}

async function resetCardRow(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
): Promise<CardRow> {
  const result = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      "SET due_at = NULL, reps = 0, lapses = 0, fsrs_card_state = 'new', fsrs_step_index = NULL,",
      "fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_last_reviewed_at = NULL, fsrs_scheduled_days = NULL,",
      "updated_at = now()",
      "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [workspaceId, cardId],
  );

  const repairedCard = result.rows[0];
  if (repairedCard === undefined) {
    throw new HttpError(404, "Card not found");
  }

  return repairedCard;
}

async function resetReviewableCardRow(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
): Promise<ReviewableCardRow> {
  const result = await executor.query<ReviewableCardRow>(
    [
      "UPDATE content.cards",
      "SET due_at = NULL, reps = 0, lapses = 0, fsrs_card_state = 'new', fsrs_step_index = NULL,",
      "fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_last_reviewed_at = NULL, fsrs_scheduled_days = NULL,",
      "updated_at = now()",
      "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
      "RETURNING",
      REVIEWABLE_CARD_COLUMNS,
    ].join(" "),
    [workspaceId, cardId],
  );

  const repairedCard = result.rows[0];
  if (repairedCard === undefined) {
    throw new HttpError(404, "Card not found");
  }

  return repairedCard;
}

export async function validateOrResetCardRowForRead(
  executor: DatabaseExecutor,
  workspaceId: string,
  card: CardRow,
): Promise<CardRow> {
  const invalidReason = getInvalidFsrsStateReason(card);
  if (invalidReason === null) {
    return card;
  }

  logFsrsStateReset(workspaceId, card.card_id, invalidReason);
  return resetCardRow(executor, workspaceId, card.card_id);
}

export async function validateOrResetReviewableCardRow(
  executor: DatabaseExecutor,
  workspaceId: string,
  card: ReviewableCardRow,
): Promise<ReviewableCardRow> {
  const invalidReason = getInvalidFsrsStateReason(card);
  if (invalidReason === null) {
    return card;
  }

  logFsrsStateReset(workspaceId, card.card_id, invalidReason);
  return resetReviewableCardRow(executor, workspaceId, card.card_id);
}

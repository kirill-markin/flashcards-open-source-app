import { randomUUID } from "node:crypto";
import { transactionWithWorkspaceScope, type DatabaseExecutor } from "../db";
import { HttpError } from "../errors";
import {
  computeReviewSchedule,
  type ReviewableCardScheduleState,
} from "../schedule";
import { getWorkspaceSchedulerConfig } from "../workspaceSchedulerSettings";
import { validateOrResetReviewableCardRow } from "./fsrs";
import {
  CARD_COLUMNS,
  REVIEWABLE_CARD_COLUMNS,
  mapCard,
  mapReviewHistoryItem,
  normalizeCardMutationMetadata,
  recordCardSyncChange,
  toDate,
} from "./shared";
import type {
  CardMutationMetadata,
  CardRow,
  ReviewEvent,
  ReviewEventAppendResult,
  ReviewHistoryRow,
  ReviewResult,
  ReviewableCardRow,
  SubmitReviewInput,
} from "./types";

// Keep in sync with apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::makeReviewableCardScheduleState(card:).
function toReviewableCardScheduleState(
  card: ReviewableCardRow,
): ReviewableCardScheduleState {
  return {
    cardId: card.card_id,
    reps: card.reps,
    lapses: card.lapses,
    fsrsCardState: card.fsrs_card_state,
    fsrsStepIndex: card.fsrs_step_index,
    fsrsStability: card.fsrs_stability,
    fsrsDifficulty: card.fsrs_difficulty,
    fsrsLastReviewedAt: card.fsrs_last_reviewed_at === null
      ? null
      : toDate(card.fsrs_last_reviewed_at),
    fsrsScheduledDays: card.fsrs_scheduled_days,
  };
}

async function loadReviewableCardForUpdate(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
): Promise<ReviewableCardRow> {
  const cardResult = await executor.query<ReviewableCardRow>(
    [
      "SELECT",
      REVIEWABLE_CARD_COLUMNS,
      "FROM content.cards",
      "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, cardId],
  );

  const existingCard = cardResult.rows[0];
  if (existingCard === undefined) {
    throw new HttpError(404, "Card not found");
  }

  return validateOrResetReviewableCardRow(executor, workspaceId, existingCard);
}

export async function appendReviewEventSnapshotInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  reviewEvent: ReviewEvent,
  operationId: string,
): Promise<ReviewEventAppendResult> {
  const insertResult = await executor.query<ReviewHistoryRow>(
    [
      "INSERT INTO content.review_events",
      "(review_event_id, workspace_id, card_id, device_id, client_event_id, rating, reviewed_at_client, reviewed_at_server)",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()))",
      "ON CONFLICT (workspace_id, device_id, client_event_id) DO NOTHING",
      "RETURNING review_event_id, workspace_id, device_id, client_event_id, card_id, rating, reviewed_at_client, reviewed_at_server",
    ].join(" "),
    [
      reviewEvent.reviewEventId,
      workspaceId,
      reviewEvent.cardId,
      reviewEvent.deviceId,
      reviewEvent.clientEventId,
      reviewEvent.rating,
      reviewEvent.reviewedAtClient,
      reviewEvent.reviewedAtServer,
    ],
  );

  const insertedRow = insertResult.rows[0];
  if (insertedRow !== undefined) {
    const insertedReviewEvent = mapReviewHistoryItem(insertedRow);

    return {
      reviewEvent: insertedReviewEvent,
      applied: true,
      changeId: null,
    };
  }

  const existingResult = await executor.query<ReviewHistoryRow>(
    [
      "SELECT review_event_id, workspace_id, device_id, client_event_id, card_id, rating, reviewed_at_client, reviewed_at_server",
      "FROM content.review_events",
      "WHERE workspace_id = $1 AND (review_event_id = $2 OR (device_id = $3 AND client_event_id = $4))",
      "ORDER BY reviewed_at_server DESC",
      "LIMIT 1",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, reviewEvent.reviewEventId, reviewEvent.deviceId, reviewEvent.clientEventId],
  );

  const existingRow = existingResult.rows[0];
  if (existingRow === undefined) {
    throw new Error("Review event insert deduped but no stored review event was found");
  }

  const existingReviewEvent = mapReviewHistoryItem(existingRow);
  return {
    reviewEvent: existingReviewEvent,
    applied: false,
    changeId: null,
  };
}

export async function submitReview(
  userId: string,
  workspaceId: string,
  deviceId: string,
  input: SubmitReviewInput,
  metadata: CardMutationMetadata,
): Promise<ReviewResult> {
  // Keep in sync with apps/ios/Flashcards/Flashcards/LocalDatabase.swift::submitReview(workspaceId:reviewSubmission:).
  const reviewedAtClient = new Date(input.reviewedAtClient);
  if (Number.isNaN(reviewedAtClient.getTime())) {
    throw new HttpError(400, "reviewedAtClient must be a valid ISO timestamp");
  }

  const normalizedMetadata = normalizeCardMutationMetadata(metadata);

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const existingCard = await loadReviewableCardForUpdate(executor, workspaceId, input.cardId);
    const schedulerConfig = await getWorkspaceSchedulerConfig(executor, workspaceId);
    const schedule = computeReviewSchedule(
      toReviewableCardScheduleState(existingCard),
      schedulerConfig,
      input.rating,
      reviewedAtClient,
    );

    await appendReviewEventSnapshotInExecutor(
      executor,
      workspaceId,
      {
        reviewEventId: input.reviewEventId ?? randomUUID(),
        workspaceId,
        cardId: input.cardId,
        deviceId,
        clientEventId: input.clientEventId ?? randomUUID(),
        rating: input.rating,
        reviewedAtClient: reviewedAtClient.toISOString(),
        reviewedAtServer: new Date().toISOString(),
      },
      normalizedMetadata.lastOperationId,
    );

    const updatedCardResult = await executor.query<CardRow>(
      [
        "UPDATE content.cards",
        "SET due_at = $1, reps = $2, lapses = $3, fsrs_card_state = $4, fsrs_step_index = $5,",
        "fsrs_stability = $6, fsrs_difficulty = $7, fsrs_last_reviewed_at = $8, fsrs_scheduled_days = $9,",
        "client_updated_at = $10, last_modified_by_device_id = $11, last_operation_id = $12, updated_at = now()",
        "WHERE workspace_id = $13 AND card_id = $14",
        "RETURNING",
        CARD_COLUMNS,
      ].join(" "),
      [
        schedule.dueAt,
        schedule.reps,
        schedule.lapses,
        schedule.fsrsCardState,
        schedule.fsrsStepIndex,
        schedule.fsrsStability,
        schedule.fsrsDifficulty,
        schedule.fsrsLastReviewedAt,
        schedule.fsrsScheduledDays,
        normalizedMetadata.clientUpdatedAt,
        normalizedMetadata.lastModifiedByDeviceId,
        normalizedMetadata.lastOperationId,
        workspaceId,
        input.cardId,
      ],
    );

    const updatedCard = updatedCardResult.rows[0];
    if (updatedCard === undefined) {
      throw new Error("Card review update did not return a row");
    }

    const mappedCard = mapCard(updatedCard);
    await recordCardSyncChange(executor, workspaceId, mappedCard);

    return {
      card: mappedCard,
      nextDueAt: schedule.dueAt.toISOString(),
    };
  });
}

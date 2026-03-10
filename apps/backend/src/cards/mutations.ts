import { randomUUID } from "node:crypto";
import { query, transaction, type DatabaseExecutor } from "../db";
import { HttpError } from "../errors";
import {
  incomingLwwMetadataWins,
  normalizeIsoTimestamp,
} from "../lww";
import { findLatestSyncChangeId } from "../syncChanges";
import { assertConsistentFsrsState } from "./fsrs";
import {
  CARD_COLUMNS,
  CARD_SELECT,
  mapCard,
  normalizeCardMutationMetadata,
  recordCardSyncChange,
  toCardLwwMetadata,
} from "./shared";
import type {
  BulkCreateCardItem,
  BulkDeleteCardItem,
  BulkDeleteCardsResult,
  BulkUpdateCardItem,
  Card,
  CardMutationMetadata,
  CardMutationResult,
  CardRow,
  CardSnapshotInput,
  CreateCardInput,
  UpdateCardInput,
  UpdateQueryParts,
} from "./types";

const MAX_CARD_BATCH_SIZE = 100;

function normalizeRequiredCardText(value: string, fieldName: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw new HttpError(400, `${fieldName} must not be empty`);
  }

  return normalizedValue;
}

function normalizeOptionalCardText(value: string): string {
  return value.trim();
}

function normalizeCreateCardInput(input: CreateCardInput): CreateCardInput {
  return {
    frontText: normalizeRequiredCardText(input.frontText, "frontText"),
    backText: normalizeOptionalCardText(input.backText),
    tags: input.tags,
    effortLevel: input.effortLevel,
  };
}

function normalizeUpdateCardInput(input: UpdateCardInput): UpdateCardInput {
  return {
    frontText: input.frontText === undefined
      ? undefined
      : normalizeRequiredCardText(input.frontText, "frontText"),
    backText: input.backText === undefined ? undefined : normalizeOptionalCardText(input.backText),
    tags: input.tags,
    effortLevel: input.effortLevel,
  };
}

function buildCardUpdateQueryParts(input: UpdateCardInput): UpdateQueryParts {
  const assignments: Array<string> = [];
  const params: Array<string | ReadonlyArray<string>> = [];

  if (input.frontText !== undefined) {
    assignments.push(`front_text = $${assignments.length + 1}`);
    params.push(input.frontText);
  }

  if (input.backText !== undefined) {
    assignments.push(`back_text = $${assignments.length + 1}`);
    params.push(input.backText);
  }

  if (input.tags !== undefined) {
    assignments.push(`tags = $${assignments.length + 1}`);
    params.push(input.tags);
  }

  if (input.effortLevel !== undefined) {
    assignments.push(`effort_level = $${assignments.length + 1}`);
    params.push(input.effortLevel);
  }

  return { assignments, params };
}

function validateCardBatchCount(count: number): void {
  if (count < 1) {
    throw new HttpError(400, "Card batch must contain at least one item");
  }

  if (count > MAX_CARD_BATCH_SIZE) {
    throw new HttpError(400, `Card batch must contain at most ${MAX_CARD_BATCH_SIZE} items`);
  }
}

function validateUniqueCardIds(cardIds: ReadonlyArray<string>): void {
  const uniqueCardIds = new Set(cardIds);
  if (uniqueCardIds.size !== cardIds.length) {
    throw new HttpError(400, "Card batch must not contain duplicate cardId values");
  }
}

function normalizeCardSnapshotInput(input: CardSnapshotInput): CardSnapshotInput {
  const normalizedSnapshot: CardSnapshotInput = {
    cardId: input.cardId,
    frontText: normalizeRequiredCardText(input.frontText, "frontText"),
    backText: normalizeOptionalCardText(input.backText),
    tags: input.tags,
    effortLevel: input.effortLevel,
    dueAt: input.dueAt === null ? null : normalizeIsoTimestamp(input.dueAt, "dueAt"),
    reps: input.reps,
    lapses: input.lapses,
    fsrsCardState: input.fsrsCardState,
    fsrsStepIndex: input.fsrsStepIndex,
    fsrsStability: input.fsrsStability,
    fsrsDifficulty: input.fsrsDifficulty,
    fsrsLastReviewedAt: input.fsrsLastReviewedAt === null
      ? null
      : normalizeIsoTimestamp(input.fsrsLastReviewedAt, "fsrsLastReviewedAt"),
    fsrsScheduledDays: input.fsrsScheduledDays,
    deletedAt: input.deletedAt === null ? null : normalizeIsoTimestamp(input.deletedAt, "deletedAt"),
  };

  assertConsistentFsrsState({
    due_at: normalizedSnapshot.dueAt,
    reps: normalizedSnapshot.reps,
    lapses: normalizedSnapshot.lapses,
    fsrs_card_state: normalizedSnapshot.fsrsCardState,
    fsrs_step_index: normalizedSnapshot.fsrsStepIndex,
    fsrs_stability: normalizedSnapshot.fsrsStability,
    fsrs_difficulty: normalizedSnapshot.fsrsDifficulty,
    fsrs_last_reviewed_at: normalizedSnapshot.fsrsLastReviewedAt,
    fsrs_scheduled_days: normalizedSnapshot.fsrsScheduledDays,
  });

  return normalizedSnapshot;
}

async function loadCardRowForMutation(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
): Promise<CardRow | undefined> {
  const result = await executor.query<CardRow>(
    [
      CARD_SELECT,
      "WHERE workspace_id = $1 AND card_id = $2",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, cardId],
  );

  return result.rows[0];
}

export async function upsertCardSnapshotInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CardSnapshotInput,
  metadata: CardMutationMetadata,
): Promise<CardMutationResult> {
  const normalizedInput = normalizeCardSnapshotInput(input);
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);

  const existingRow = await loadCardRowForMutation(executor, workspaceId, normalizedInput.cardId);

  if (existingRow === undefined) {
    const insertResult = await executor.query<CardRow>(
      [
        "INSERT INTO content.cards",
        "(",
        "card_id, workspace_id, front_text, back_text, tags, effort_level, due_at, reps, lapses,",
        "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
        "client_updated_at, last_modified_by_device_id, last_operation_id, deleted_at",
        ")",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
        "RETURNING",
        CARD_COLUMNS,
      ].join(" "),
      [
        normalizedInput.cardId,
        workspaceId,
        normalizedInput.frontText,
        normalizedInput.backText,
        normalizedInput.tags,
        normalizedInput.effortLevel,
        normalizedInput.dueAt,
        normalizedInput.reps,
        normalizedInput.lapses,
        normalizedInput.fsrsCardState,
        normalizedInput.fsrsStepIndex,
        normalizedInput.fsrsStability,
        normalizedInput.fsrsDifficulty,
        normalizedInput.fsrsLastReviewedAt,
        normalizedInput.fsrsScheduledDays,
        normalizedMetadata.clientUpdatedAt,
        normalizedMetadata.lastModifiedByDeviceId,
        normalizedMetadata.lastOperationId,
        normalizedInput.deletedAt,
      ],
    );

    const insertedRow = insertResult.rows[0];
    if (insertedRow === undefined) {
      throw new Error("Card insert did not return a row");
    }

    const insertedCard = mapCard(insertedRow);
    const changeId = await recordCardSyncChange(executor, workspaceId, insertedCard);

    return {
      card: insertedCard,
      applied: true,
      changeId,
    };
  }

  const existingCard = mapCard(existingRow);
  if (incomingLwwMetadataWins(normalizedMetadata, toCardLwwMetadata(existingCard)) === false) {
    return {
      card: existingCard,
      applied: false,
      changeId: await findLatestSyncChangeId(executor, workspaceId, "card", existingCard.cardId),
    };
  }

  const updateResult = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      "SET front_text = $1, back_text = $2, tags = $3, effort_level = $4, due_at = $5, reps = $6, lapses = $7,",
      "fsrs_card_state = $8, fsrs_step_index = $9, fsrs_stability = $10, fsrs_difficulty = $11,",
      "fsrs_last_reviewed_at = $12, fsrs_scheduled_days = $13, deleted_at = $14, client_updated_at = $15,",
      "last_modified_by_device_id = $16, last_operation_id = $17, updated_at = now()",
      "WHERE workspace_id = $18 AND card_id = $19",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [
      normalizedInput.frontText,
      normalizedInput.backText,
      normalizedInput.tags,
      normalizedInput.effortLevel,
      normalizedInput.dueAt,
      normalizedInput.reps,
      normalizedInput.lapses,
      normalizedInput.fsrsCardState,
      normalizedInput.fsrsStepIndex,
      normalizedInput.fsrsStability,
      normalizedInput.fsrsDifficulty,
      normalizedInput.fsrsLastReviewedAt,
      normalizedInput.fsrsScheduledDays,
      normalizedInput.deletedAt,
      normalizedMetadata.clientUpdatedAt,
      normalizedMetadata.lastModifiedByDeviceId,
      normalizedMetadata.lastOperationId,
      workspaceId,
      normalizedInput.cardId,
    ],
  );

  const updatedRow = updateResult.rows[0];
  if (updatedRow === undefined) {
    throw new Error("Card update did not return a row");
  }

  const updatedCard = mapCard(updatedRow);
  const changeId = await recordCardSyncChange(executor, workspaceId, updatedCard);

  return {
    card: updatedCard,
    applied: true,
    changeId,
  };
}

export async function upsertCardSnapshot(
  workspaceId: string,
  input: CardSnapshotInput,
  metadata: CardMutationMetadata,
): Promise<CardMutationResult> {
  return transaction(async (executor) => (
    upsertCardSnapshotInExecutor(executor, workspaceId, input, metadata)
  ));
}

async function createCardInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CreateCardInput,
  metadata: CardMutationMetadata,
): Promise<Card> {
  const normalizedInput = normalizeCreateCardInput(input);
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);

  const result = await executor.query<CardRow>(
    [
      "INSERT INTO content.cards",
      "(",
      "card_id, workspace_id, front_text, back_text, tags, effort_level, due_at,",
      "reps, lapses, fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
      "client_updated_at, last_modified_by_device_id, last_operation_id",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, NULL, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, $7, $8, $9)",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [
      randomUUID(),
      workspaceId,
      normalizedInput.frontText,
      normalizedInput.backText,
      normalizedInput.tags,
      normalizedInput.effortLevel,
      normalizedMetadata.clientUpdatedAt,
      normalizedMetadata.lastModifiedByDeviceId,
      normalizedMetadata.lastOperationId,
    ],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Card insert did not return a row");
  }

  const card = mapCard(row);
  await recordCardSyncChange(executor, workspaceId, card);
  return card;
}

export async function createCard(
  workspaceId: string,
  input: CreateCardInput,
  metadata: CardMutationMetadata,
): Promise<Card> {
  return transaction(async (executor) => createCardInExecutor(executor, workspaceId, input, metadata));
}

export async function createCards(
  workspaceId: string,
  items: ReadonlyArray<BulkCreateCardItem>,
): Promise<ReadonlyArray<Card>> {
  validateCardBatchCount(items.length);

  return transaction(async (executor) => {
    const createdCards: Array<Card> = [];
    for (const item of items) {
      createdCards.push(await createCardInExecutor(executor, workspaceId, item.input, item.metadata));
    }

    return createdCards;
  });
}

async function updateCardInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
  input: UpdateCardInput,
  metadata: CardMutationMetadata,
): Promise<Card> {
  const normalizedInput = normalizeUpdateCardInput(input);
  const updateParts = buildCardUpdateQueryParts(normalizedInput);
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);

  if (updateParts.assignments.length === 0) {
    throw new HttpError(400, "At least one editable field must be provided");
  }

  const params = [
    ...updateParts.params,
    normalizedMetadata.clientUpdatedAt,
    normalizedMetadata.lastModifiedByDeviceId,
    normalizedMetadata.lastOperationId,
    workspaceId,
    cardId,
  ];

  const result = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      `SET ${updateParts.assignments.join(", ")}, client_updated_at = $${params.length - 4},`,
      `last_modified_by_device_id = $${params.length - 3}, last_operation_id = $${params.length - 2}, updated_at = now()`,
      `WHERE workspace_id = $${params.length - 1} AND card_id = $${params.length} AND deleted_at IS NULL`,
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    params,
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Card not found");
  }

  const card = mapCard(row);
  await recordCardSyncChange(executor, workspaceId, card);
  return card;
}

export async function updateCard(
  workspaceId: string,
  cardId: string,
  input: UpdateCardInput,
  metadata: CardMutationMetadata,
): Promise<Card> {
  return transaction(async (executor) => updateCardInExecutor(executor, workspaceId, cardId, input, metadata));
}

export async function updateCards(
  workspaceId: string,
  items: ReadonlyArray<BulkUpdateCardItem>,
): Promise<ReadonlyArray<Card>> {
  validateCardBatchCount(items.length);
  validateUniqueCardIds(items.map((item) => item.cardId));

  return transaction(async (executor) => {
    const updatedCards: Array<Card> = [];
    for (const item of items) {
      updatedCards.push(
        await updateCardInExecutor(executor, workspaceId, item.cardId, item.input, item.metadata),
      );
    }

    return updatedCards;
  });
}

async function deleteCardInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
  metadata: CardMutationMetadata,
): Promise<Card> {
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);

  const result = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      "SET deleted_at = $1, client_updated_at = $2, last_modified_by_device_id = $3, last_operation_id = $4, updated_at = now()",
      "WHERE workspace_id = $5 AND card_id = $6 AND deleted_at IS NULL",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [
      normalizedMetadata.clientUpdatedAt,
      normalizedMetadata.clientUpdatedAt,
      normalizedMetadata.lastModifiedByDeviceId,
      normalizedMetadata.lastOperationId,
      workspaceId,
      cardId,
    ],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Card not found");
  }

  const card = mapCard(row);
  await recordCardSyncChange(executor, workspaceId, card);
  return card;
}

export async function deleteCard(
  workspaceId: string,
  cardId: string,
  metadata: CardMutationMetadata,
): Promise<Card> {
  return transaction(async (executor) => deleteCardInExecutor(executor, workspaceId, cardId, metadata));
}

export async function deleteCards(
  workspaceId: string,
  items: ReadonlyArray<BulkDeleteCardItem>,
): Promise<BulkDeleteCardsResult> {
  validateCardBatchCount(items.length);
  validateUniqueCardIds(items.map((item) => item.cardId));

  return transaction(async (executor) => {
    const deletedCardIds: Array<string> = [];
    for (const item of items) {
      const deletedCard = await deleteCardInExecutor(executor, workspaceId, item.cardId, item.metadata);
      deletedCardIds.push(deletedCard.cardId);
    }

    return {
      deletedCardIds,
      deletedCount: deletedCardIds.length,
    };
  });
}

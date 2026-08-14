import { computeReviewSchedule, type ReviewRating } from "../../../../../backend/src/scheduling";
import { loadCardById, putCard } from "../../../localDb/cards/cards";
import { loadCloudSettings } from "../../../localDb/sync/cloudSettings";
import { loadDeckById, putDeck } from "../../../localDb/cards/decks";
import { putOutboxRecord, type PersistedOutboxRecord } from "../../../localDb/sync/outbox";
import { putReviewEvent } from "../../../localDb/reviews/reviews";
import { loadWorkspaceSettings } from "../../../localDb/cards/workspace";
import type {
  Card,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  UpdateCardInput,
  UpdateDeckInput,
} from "../../../types";
import {
  buildCardUpsertOperation,
  buildDeck,
  buildDeckUpsertOperation,
  buildDeletedCard,
  buildDeletedDeck,
  buildInitialCard,
  buildReviewEvent,
  buildReviewEventAppendOperation,
  buildReviewedCard,
  buildUpdatedCard,
  buildUpdatedDeck,
  doesCardMutationAffectReviewSchedule,
  normalizeCreateDeckInput,
  normalizeCreateCardInput,
  normalizeUpdateCardInput,
  normalizeUpdateDeckInput,
  toReviewableCardState,
} from "../../domain";
import {
  loadRequiredCloudInstallationId,
  requireCloudInstallationId,
} from "./syncCloudSettings";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";

export type LocalReviewRating = 0 | 1 | 2 | 3;

export type LocalCardMutationResult = Readonly<{
  card: Card;
  didChangeProgressHistory: boolean;
  didChangeReviewSchedule: boolean;
}>;

export type LocalDeckMutationResult = Readonly<{
  deck: Deck;
}>;

export type CreateCardLocallyInput = Readonly<{
  workspaceId: string;
  input: CreateCardInput;
  clientUpdatedAt: string;
}>;

export type CreateDeckLocallyInput = Readonly<{
  workspaceId: string;
  input: CreateDeckInput;
  clientUpdatedAt: string;
}>;

export type UpdateCardLocallyInput = Readonly<{
  workspaceId: string;
  cardId: string;
  input: UpdateCardInput;
  clientUpdatedAt: string;
}>;

export type UpdateDeckLocallyInput = Readonly<{
  workspaceId: string;
  deckId: string;
  input: UpdateDeckInput;
  clientUpdatedAt: string;
}>;

export type DeleteCardLocallyInput = Readonly<{
  workspaceId: string;
  cardId: string;
  clientUpdatedAt: string;
}>;

export type DeleteDeckLocallyInput = Readonly<{
  workspaceId: string;
  deckId: string;
  clientUpdatedAt: string;
}>;

export type SubmitReviewLocallyInput = Readonly<{
  workspaceId: string;
  cardId: string;
  rating: LocalReviewRating;
  reviewedAtClient: string;
  reviewedTimeZone: string;
}>;

export async function requireCard(workspaceId: string, cardId: string): Promise<Card> {
  const card = await loadCardById(workspaceId, cardId);
  if (card === null) {
    throw new Error(`Card not found: ${cardId}`);
  }

  return card;
}

export async function requireDeck(workspaceId: string, deckId: string): Promise<Deck> {
  const deck = await loadDeckById(workspaceId, deckId);
  if (deck === null) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  return deck;
}

export async function createCardLocally(
  input: CreateCardLocallyInput,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<LocalCardMutationResult> {
  indexedDbOpenRecoveryState.throwIfFailed();
  const normalizedInput = normalizeCreateCardInput(input.input);
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await runRecoveryGuardedSyncLocalOperation(
    loadRequiredCloudInstallationId,
    indexedDbOpenRecoveryState,
  );
  const nextCard = buildInitialCard(normalizedInput, input.clientUpdatedAt, installationId, operationId);
  const didChangeReviewSchedule = doesCardMutationAffectReviewSchedule(null, nextCard);
  const nextOutboxRecord: PersistedOutboxRecord = {
    operationId,
    workspaceId: input.workspaceId,
    createdAt: input.clientUpdatedAt,
    attemptCount: 0,
    lastError: "",
    affectsReviewSchedule: didChangeReviewSchedule,
    operation: buildCardUpsertOperation(nextCard),
  };

  await runRecoveryGuardedSyncLocalOperation(
    () => putCard(input.workspaceId, nextCard),
    indexedDbOpenRecoveryState,
  );
  await runRecoveryGuardedSyncLocalOperation(
    () => putOutboxRecord(nextOutboxRecord),
    indexedDbOpenRecoveryState,
  );
  return {
    card: nextCard,
    didChangeProgressHistory: false,
    didChangeReviewSchedule,
  };
}

export async function createDeckLocally(
  input: CreateDeckLocallyInput,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<LocalDeckMutationResult> {
  indexedDbOpenRecoveryState.throwIfFailed();
  const normalizedInput = normalizeCreateDeckInput(input.input);
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await runRecoveryGuardedSyncLocalOperation(
    loadRequiredCloudInstallationId,
    indexedDbOpenRecoveryState,
  );
  const nextDeck = {
    ...buildDeck(normalizedInput, input.clientUpdatedAt, installationId, operationId),
    workspaceId: input.workspaceId,
  };
  const nextOutboxRecord: PersistedOutboxRecord = {
    operationId,
    workspaceId: input.workspaceId,
    createdAt: input.clientUpdatedAt,
    attemptCount: 0,
    lastError: "",
    operation: buildDeckUpsertOperation(nextDeck),
  };

  await runRecoveryGuardedSyncLocalOperation(
    () => putDeck(nextDeck),
    indexedDbOpenRecoveryState,
  );
  await runRecoveryGuardedSyncLocalOperation(
    () => putOutboxRecord(nextOutboxRecord),
    indexedDbOpenRecoveryState,
  );
  return {
    deck: nextDeck,
  };
}

export async function updateCardLocally(
  input: UpdateCardLocallyInput,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<LocalCardMutationResult> {
  indexedDbOpenRecoveryState.throwIfFailed();
  const existingCard = await runRecoveryGuardedSyncLocalOperation(
    () => requireCard(input.workspaceId, input.cardId),
    indexedDbOpenRecoveryState,
  );
  const normalizedInput = normalizeUpdateCardInput(input.input);
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await runRecoveryGuardedSyncLocalOperation(
    loadRequiredCloudInstallationId,
    indexedDbOpenRecoveryState,
  );
  const nextCard = buildUpdatedCard(existingCard, normalizedInput, input.clientUpdatedAt, installationId, operationId);
  const didChangeReviewSchedule = doesCardMutationAffectReviewSchedule(existingCard, nextCard);
  const nextOutboxRecord: PersistedOutboxRecord = {
    operationId,
    workspaceId: input.workspaceId,
    createdAt: input.clientUpdatedAt,
    attemptCount: 0,
    lastError: "",
    affectsReviewSchedule: didChangeReviewSchedule,
    operation: buildCardUpsertOperation(nextCard),
  };

  await runRecoveryGuardedSyncLocalOperation(
    () => putCard(input.workspaceId, nextCard),
    indexedDbOpenRecoveryState,
  );
  await runRecoveryGuardedSyncLocalOperation(
    () => putOutboxRecord(nextOutboxRecord),
    indexedDbOpenRecoveryState,
  );
  return {
    card: nextCard,
    didChangeProgressHistory: false,
    didChangeReviewSchedule,
  };
}

export async function updateDeckLocally(
  input: UpdateDeckLocallyInput,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<LocalDeckMutationResult> {
  indexedDbOpenRecoveryState.throwIfFailed();
  const existingDeck = await runRecoveryGuardedSyncLocalOperation(
    () => requireDeck(input.workspaceId, input.deckId),
    indexedDbOpenRecoveryState,
  );
  const normalizedInput = normalizeUpdateDeckInput(input.input);
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await runRecoveryGuardedSyncLocalOperation(
    loadRequiredCloudInstallationId,
    indexedDbOpenRecoveryState,
  );
  const nextDeck = buildUpdatedDeck(existingDeck, normalizedInput, input.clientUpdatedAt, installationId, operationId);
  const nextOutboxRecord: PersistedOutboxRecord = {
    operationId,
    workspaceId: input.workspaceId,
    createdAt: input.clientUpdatedAt,
    attemptCount: 0,
    lastError: "",
    operation: buildDeckUpsertOperation(nextDeck),
  };

  await runRecoveryGuardedSyncLocalOperation(
    () => putDeck(nextDeck),
    indexedDbOpenRecoveryState,
  );
  await runRecoveryGuardedSyncLocalOperation(
    () => putOutboxRecord(nextOutboxRecord),
    indexedDbOpenRecoveryState,
  );
  return {
    deck: nextDeck,
  };
}

export async function deleteCardLocally(
  input: DeleteCardLocallyInput,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<LocalCardMutationResult> {
  indexedDbOpenRecoveryState.throwIfFailed();
  const existingCard = await runRecoveryGuardedSyncLocalOperation(
    () => requireCard(input.workspaceId, input.cardId),
    indexedDbOpenRecoveryState,
  );
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await runRecoveryGuardedSyncLocalOperation(
    loadRequiredCloudInstallationId,
    indexedDbOpenRecoveryState,
  );
  const nextCard = buildDeletedCard(existingCard, input.clientUpdatedAt, installationId, operationId);
  const didChangeReviewSchedule = doesCardMutationAffectReviewSchedule(existingCard, nextCard);
  const nextOutboxRecord: PersistedOutboxRecord = {
    operationId,
    workspaceId: input.workspaceId,
    createdAt: input.clientUpdatedAt,
    attemptCount: 0,
    lastError: "",
    affectsReviewSchedule: didChangeReviewSchedule,
    operation: buildCardUpsertOperation(nextCard),
  };

  await runRecoveryGuardedSyncLocalOperation(
    () => putCard(input.workspaceId, nextCard),
    indexedDbOpenRecoveryState,
  );
  await runRecoveryGuardedSyncLocalOperation(
    () => putOutboxRecord(nextOutboxRecord),
    indexedDbOpenRecoveryState,
  );
  return {
    card: nextCard,
    didChangeProgressHistory: false,
    didChangeReviewSchedule,
  };
}

export async function deleteDeckLocally(
  input: DeleteDeckLocallyInput,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<LocalDeckMutationResult> {
  indexedDbOpenRecoveryState.throwIfFailed();
  const existingDeck = await runRecoveryGuardedSyncLocalOperation(
    () => requireDeck(input.workspaceId, input.deckId),
    indexedDbOpenRecoveryState,
  );
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await runRecoveryGuardedSyncLocalOperation(
    loadRequiredCloudInstallationId,
    indexedDbOpenRecoveryState,
  );
  const nextDeck = buildDeletedDeck(existingDeck, input.clientUpdatedAt, installationId, operationId);
  const nextOutboxRecord: PersistedOutboxRecord = {
    operationId,
    workspaceId: input.workspaceId,
    createdAt: input.clientUpdatedAt,
    attemptCount: 0,
    lastError: "",
    operation: buildDeckUpsertOperation(nextDeck),
  };

  await runRecoveryGuardedSyncLocalOperation(
    () => putDeck(nextDeck),
    indexedDbOpenRecoveryState,
  );
  await runRecoveryGuardedSyncLocalOperation(
    () => putOutboxRecord(nextOutboxRecord),
    indexedDbOpenRecoveryState,
  );
  return {
    deck: nextDeck,
  };
}

async function runRecoveryGuardedSyncLocalOperation<ResultType>(
  createOperation: () => Promise<ResultType>,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<ResultType> {
  try {
    indexedDbOpenRecoveryState.throwIfFailed();
    const result = await createOperation();
    indexedDbOpenRecoveryState.throwIfFailed();
    return result;
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    indexedDbOpenRecoveryState.markFailed(error);
    indexedDbOpenRecoveryState.throwIfFailed();
    throw error;
  }
}

export async function submitReviewLocally(
  input: SubmitReviewLocallyInput,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<LocalCardMutationResult> {
  const [existingCard, schedulerSettings, cloudSettings] = await Promise.all([
    runRecoveryGuardedSyncLocalOperation(
      () => requireCard(input.workspaceId, input.cardId),
      indexedDbOpenRecoveryState,
    ),
    runRecoveryGuardedSyncLocalOperation(
      () => loadWorkspaceSettings(input.workspaceId),
      indexedDbOpenRecoveryState,
    ),
    runRecoveryGuardedSyncLocalOperation(loadCloudSettings, indexedDbOpenRecoveryState),
  ]);
  indexedDbOpenRecoveryState.throwIfFailed();
  if (schedulerSettings === null) {
    throw new Error("Workspace scheduler settings are not loaded");
  }

  const reviewEventId = crypto.randomUUID().toLowerCase();
  const clientEventId = crypto.randomUUID().toLowerCase();
  const cardOperationId = crypto.randomUUID().toLowerCase();
  const installationId = requireCloudInstallationId(cloudSettings);
  const schedule = computeReviewSchedule(
    toReviewableCardState(existingCard),
    {
      algorithm: schedulerSettings.algorithm,
      desiredRetention: schedulerSettings.desiredRetention,
      learningStepsMinutes: schedulerSettings.learningStepsMinutes,
      relearningStepsMinutes: schedulerSettings.relearningStepsMinutes,
      maximumIntervalDays: schedulerSettings.maximumIntervalDays,
      enableFuzz: schedulerSettings.enableFuzz,
    },
    input.rating as ReviewRating,
    new Date(input.reviewedAtClient),
  );

  const nextCard = buildReviewedCard(existingCard, schedule, input.reviewedAtClient, installationId, cardOperationId);
  const nextReviewEvent = buildReviewEvent(
    input.workspaceId,
    input.cardId,
    installationId,
    input.rating,
    input.reviewedAtClient,
    input.reviewedTimeZone,
    reviewEventId,
    clientEventId,
  );

  const reviewEventOutboxRecord: PersistedOutboxRecord = {
    operationId: reviewEventId,
    workspaceId: input.workspaceId,
    createdAt: input.reviewedAtClient,
    attemptCount: 0,
    lastError: "",
    operation: buildReviewEventAppendOperation(nextReviewEvent),
  };
  const didChangeReviewSchedule = doesCardMutationAffectReviewSchedule(existingCard, nextCard);
  const cardOutboxRecord: PersistedOutboxRecord = {
    operationId: cardOperationId,
    workspaceId: input.workspaceId,
    createdAt: input.reviewedAtClient,
    attemptCount: 0,
    lastError: "",
    affectsReviewSchedule: didChangeReviewSchedule,
    operation: buildCardUpsertOperation(nextCard),
  };

  await putReviewEvent(nextReviewEvent);
  indexedDbOpenRecoveryState.throwIfFailed();
  await putCard(input.workspaceId, nextCard);
  indexedDbOpenRecoveryState.throwIfFailed();
  await putOutboxRecord(reviewEventOutboxRecord);
  indexedDbOpenRecoveryState.throwIfFailed();
  await putOutboxRecord(cardOutboxRecord);
  indexedDbOpenRecoveryState.throwIfFailed();
  return {
    card: nextCard,
    didChangeProgressHistory: true,
    didChangeReviewSchedule,
  };
}

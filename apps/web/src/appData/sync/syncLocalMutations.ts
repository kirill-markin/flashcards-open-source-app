import { computeReviewSchedule, type ReviewRating } from "../../../../backend/src/schedule";
import { loadCardById, putCard } from "../../localDb/cards";
import { loadCloudSettings } from "../../localDb/cloudSettings";
import { loadDeckById, putDeck } from "../../localDb/decks";
import { putOutboxRecord, type PersistedOutboxRecord } from "../../localDb/outbox";
import { putReviewEvent } from "../../localDb/reviews";
import { loadWorkspaceSettings } from "../../localDb/workspace";
import type {
  Card,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  UpdateCardInput,
  UpdateDeckInput,
} from "../../types";
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
  normalizeCreateCardInput,
  normalizeCreateDeckInput,
  normalizeUpdateCardInput,
  normalizeUpdateDeckInput,
  toReviewableCardState,
} from "../domain";
import {
  loadRequiredCloudInstallationId,
  requireCloudInstallationId,
} from "./syncCloudSettings";

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

export async function createCardLocally(input: CreateCardLocallyInput): Promise<LocalCardMutationResult> {
  const normalizedInput = normalizeCreateCardInput(input.input);
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await loadRequiredCloudInstallationId();
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

  await putCard(input.workspaceId, nextCard);
  await putOutboxRecord(nextOutboxRecord);
  return {
    card: nextCard,
    didChangeProgressHistory: false,
    didChangeReviewSchedule,
  };
}

export async function createDeckLocally(input: CreateDeckLocallyInput): Promise<LocalDeckMutationResult> {
  const normalizedInput = normalizeCreateDeckInput(input.input);
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await loadRequiredCloudInstallationId();
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

  await putDeck(nextDeck);
  await putOutboxRecord(nextOutboxRecord);
  return {
    deck: nextDeck,
  };
}

export async function updateCardLocally(input: UpdateCardLocallyInput): Promise<LocalCardMutationResult> {
  const existingCard = await requireCard(input.workspaceId, input.cardId);
  const normalizedInput = normalizeUpdateCardInput(input.input);
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await loadRequiredCloudInstallationId();
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

  await putCard(input.workspaceId, nextCard);
  await putOutboxRecord(nextOutboxRecord);
  return {
    card: nextCard,
    didChangeProgressHistory: false,
    didChangeReviewSchedule,
  };
}

export async function updateDeckLocally(input: UpdateDeckLocallyInput): Promise<LocalDeckMutationResult> {
  const existingDeck = await requireDeck(input.workspaceId, input.deckId);
  const normalizedInput = normalizeUpdateDeckInput(input.input);
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await loadRequiredCloudInstallationId();
  const nextDeck = buildUpdatedDeck(existingDeck, normalizedInput, input.clientUpdatedAt, installationId, operationId);
  const nextOutboxRecord: PersistedOutboxRecord = {
    operationId,
    workspaceId: input.workspaceId,
    createdAt: input.clientUpdatedAt,
    attemptCount: 0,
    lastError: "",
    operation: buildDeckUpsertOperation(nextDeck),
  };

  await putDeck(nextDeck);
  await putOutboxRecord(nextOutboxRecord);
  return {
    deck: nextDeck,
  };
}

export async function deleteCardLocally(input: DeleteCardLocallyInput): Promise<LocalCardMutationResult> {
  const existingCard = await requireCard(input.workspaceId, input.cardId);
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await loadRequiredCloudInstallationId();
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

  await putCard(input.workspaceId, nextCard);
  await putOutboxRecord(nextOutboxRecord);
  return {
    card: nextCard,
    didChangeProgressHistory: false,
    didChangeReviewSchedule,
  };
}

export async function deleteDeckLocally(input: DeleteDeckLocallyInput): Promise<LocalDeckMutationResult> {
  const existingDeck = await requireDeck(input.workspaceId, input.deckId);
  const operationId = crypto.randomUUID().toLowerCase();
  const installationId = await loadRequiredCloudInstallationId();
  const nextDeck = buildDeletedDeck(existingDeck, input.clientUpdatedAt, installationId, operationId);
  const nextOutboxRecord: PersistedOutboxRecord = {
    operationId,
    workspaceId: input.workspaceId,
    createdAt: input.clientUpdatedAt,
    attemptCount: 0,
    lastError: "",
    operation: buildDeckUpsertOperation(nextDeck),
  };

  await putDeck(nextDeck);
  await putOutboxRecord(nextOutboxRecord);
  return {
    deck: nextDeck,
  };
}

export async function submitReviewLocally(input: SubmitReviewLocallyInput): Promise<LocalCardMutationResult> {
  const [existingCard, schedulerSettings, cloudSettings] = await Promise.all([
    requireCard(input.workspaceId, input.cardId),
    loadWorkspaceSettings(input.workspaceId),
    loadCloudSettings(),
  ]);
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
  await putCard(input.workspaceId, nextCard);
  await putOutboxRecord(reviewEventOutboxRecord);
  await putOutboxRecord(cardOutboxRecord);
  return {
    card: nextCard,
    didChangeProgressHistory: true,
    didChangeReviewSchedule,
  };
}

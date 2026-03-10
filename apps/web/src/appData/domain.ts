import type {
  ReviewableCardScheduleState,
} from "../../../backend/src/schedule";
import type {
  Card,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  ReviewEvent,
  SyncPushOperation,
  UpdateCardInput,
  WorkspaceSummary,
} from "../types";

type LastWriteWinsRecord = Readonly<{
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
}>;

type ReviewScheduleResult = Readonly<{
  dueAt: Date;
  reps: number;
  lapses: number;
  fsrsCardState: Card["fsrsCardState"];
  fsrsStepIndex: Card["fsrsStepIndex"];
  fsrsStability: Card["fsrsStability"];
  fsrsDifficulty: Card["fsrsDifficulty"];
  fsrsLastReviewedAt: Date;
  fsrsScheduledDays: Card["fsrsScheduledDays"];
}>;

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isCardDue(card: Card, nowTimestamp: number): boolean {
  if (card.deletedAt !== null) {
    return false;
  }

  if (card.dueAt === null) {
    return true;
  }

  const dueAtTimestamp = new Date(card.dueAt).getTime();
  if (Number.isNaN(dueAtTimestamp)) {
    return false;
  }

  return dueAtTimestamp <= nowTimestamp;
}

export function deriveActiveCards(cards: ReadonlyArray<Card>): ReadonlyArray<Card> {
  return cards.filter((card) => card.deletedAt === null);
}

export function deriveActiveDecks(decks: ReadonlyArray<Deck>): ReadonlyArray<Deck> {
  return decks.filter((deck) => deck.deletedAt === null);
}

function getReviewOrderDueTimestamp(card: Card): number {
  if (card.dueAt === null) {
    return Number.NEGATIVE_INFINITY;
  }

  const dueAtTimestamp = new Date(card.dueAt).getTime();
  if (Number.isNaN(dueAtTimestamp)) {
    return Number.POSITIVE_INFINITY;
  }

  return dueAtTimestamp;
}

export function compareCardsForReviewOrder(leftCard: Card, rightCard: Card, nowTimestamp: number): number {
  const leftIsDue = isCardDue(leftCard, nowTimestamp);
  const rightIsDue = isCardDue(rightCard, nowTimestamp);

  if (leftIsDue !== rightIsDue) {
    return leftIsDue ? -1 : 1;
  }

  const leftDueTimestamp = getReviewOrderDueTimestamp(leftCard);
  const rightDueTimestamp = getReviewOrderDueTimestamp(rightCard);
  if (leftDueTimestamp !== rightDueTimestamp) {
    return leftDueTimestamp - rightDueTimestamp;
  }

  return new Date(rightCard.updatedAt).getTime() - new Date(leftCard.updatedAt).getTime();
}

export function deriveReviewTimeline(cards: ReadonlyArray<Card>): ReadonlyArray<Card> {
  const nowTimestamp = Date.now();
  return cards
    .filter((card) => card.deletedAt === null)
    .sort((leftCard, rightCard) => compareCardsForReviewOrder(leftCard, rightCard, nowTimestamp));
}

export function deriveReviewQueue(cards: ReadonlyArray<Card>): ReadonlyArray<Card> {
  const nowTimestamp = Date.now();
  return deriveReviewTimeline(cards).filter((card) => isCardDue(card, nowTimestamp));
}

export function selectReviewCard(reviewQueue: ReadonlyArray<Card>, selectedCardId: string): Card | null {
  return reviewQueue.find((card) => card.cardId === selectedCardId) ?? reviewQueue[0] ?? null;
}

export function compareLww(left: LastWriteWinsRecord, right: LastWriteWinsRecord): number {
  const timestampDifference = left.clientUpdatedAt.localeCompare(right.clientUpdatedAt);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  const deviceDifference = left.lastModifiedByDeviceId.localeCompare(right.lastModifiedByDeviceId);
  if (deviceDifference !== 0) {
    return deviceDifference;
  }

  return left.lastOperationId.localeCompare(right.lastOperationId);
}

export function upsertCard(cards: ReadonlyArray<Card>, nextCard: Card): Array<Card> {
  const nextCards = cards.filter((card) => card.cardId !== nextCard.cardId);
  return [nextCard, ...nextCards];
}

export function upsertDeck(decks: ReadonlyArray<Deck>, nextDeck: Deck): Array<Deck> {
  const nextDecks = decks.filter((deck) => deck.deckId !== nextDeck.deckId);
  return [nextDeck, ...nextDecks];
}

export function upsertReviewEvent(
  reviewEvents: ReadonlyArray<ReviewEvent>,
  nextReviewEvent: ReviewEvent,
): Array<ReviewEvent> {
  const nextReviewEvents = reviewEvents.filter((reviewEvent) => reviewEvent.reviewEventId !== nextReviewEvent.reviewEventId);
  return [nextReviewEvent, ...nextReviewEvents];
}

export function markSelectedWorkspaces(
  workspaces: ReadonlyArray<WorkspaceSummary>,
  selectedWorkspaceId: string,
): Array<WorkspaceSummary> {
  return workspaces.map((workspace) => ({
    ...workspace,
    isSelected: workspace.workspaceId === selectedWorkspaceId,
  }));
}

export function upsertWorkspaceSummary(
  workspaces: ReadonlyArray<WorkspaceSummary>,
  workspace: WorkspaceSummary,
): Array<WorkspaceSummary> {
  return [...workspaces.filter((item) => item.workspaceId !== workspace.workspaceId), workspace];
}

export function buildInitialCard(
  input: CreateCardInput,
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): Card {
  return {
    cardId: crypto.randomUUID().toLowerCase(),
    frontText: input.frontText,
    backText: input.backText,
    tags: input.tags,
    effortLevel: input.effortLevel,
    dueAt: null,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
    deletedAt: null,
  };
}

export function normalizeRequiredCardText(value: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw new Error("Card front text must not be empty");
  }

  return normalizedValue;
}

export function normalizeOptionalCardText(value: string): string {
  return value.trim();
}

export function normalizeCreateCardInput(input: CreateCardInput): CreateCardInput {
  return {
    frontText: normalizeRequiredCardText(input.frontText),
    backText: normalizeOptionalCardText(input.backText),
    tags: input.tags,
    effortLevel: input.effortLevel,
  };
}

export function normalizeUpdateCardInput(input: UpdateCardInput): UpdateCardInput {
  return {
    frontText: input.frontText === undefined ? undefined : normalizeRequiredCardText(input.frontText),
    backText: input.backText === undefined ? undefined : normalizeOptionalCardText(input.backText),
    tags: input.tags,
    effortLevel: input.effortLevel,
  };
}

export function buildUpdatedCard(
  card: Card,
  input: UpdateCardInput,
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): Card {
  return {
    ...card,
    frontText: input.frontText ?? card.frontText,
    backText: input.backText ?? card.backText,
    tags: input.tags ?? card.tags,
    effortLevel: input.effortLevel ?? card.effortLevel,
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
  };
}

export function buildDeletedCard(
  card: Card,
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): Card {
  return {
    ...card,
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
    deletedAt: clientUpdatedAt,
  };
}

export function buildDeck(
  input: CreateDeckInput,
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): Deck {
  return {
    deckId: crypto.randomUUID().toLowerCase(),
    workspaceId: "",
    name: input.name,
    filterDefinition: input.filterDefinition,
    createdAt: clientUpdatedAt,
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
    deletedAt: null,
  };
}

export function toReviewableCardState(card: Card): ReviewableCardScheduleState {
  return {
    cardId: card.cardId,
    reps: card.reps,
    lapses: card.lapses,
    fsrsCardState: card.fsrsCardState,
    fsrsStepIndex: card.fsrsStepIndex,
    fsrsStability: card.fsrsStability,
    fsrsDifficulty: card.fsrsDifficulty,
    fsrsLastReviewedAt: card.fsrsLastReviewedAt === null ? null : new Date(card.fsrsLastReviewedAt),
    fsrsScheduledDays: card.fsrsScheduledDays,
  };
}

export function buildReviewedCard(
  card: Card,
  schedule: ReviewScheduleResult,
  reviewedAtClient: string,
  deviceId: string,
  operationId: string,
): Card {
  return {
    ...card,
    dueAt: schedule.dueAt.toISOString(),
    reps: schedule.reps,
    lapses: schedule.lapses,
    fsrsCardState: schedule.fsrsCardState,
    fsrsStepIndex: schedule.fsrsStepIndex,
    fsrsStability: schedule.fsrsStability,
    fsrsDifficulty: schedule.fsrsDifficulty,
    fsrsLastReviewedAt: schedule.fsrsLastReviewedAt.toISOString(),
    fsrsScheduledDays: schedule.fsrsScheduledDays,
    clientUpdatedAt: reviewedAtClient,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: reviewedAtClient,
  };
}

export function buildReviewEvent(
  workspaceId: string,
  cardId: string,
  deviceId: string,
  rating: 0 | 1 | 2 | 3,
  reviewedAtClient: string,
  reviewEventId: string,
  clientEventId: string,
): ReviewEvent {
  return {
    reviewEventId,
    workspaceId,
    cardId,
    deviceId,
    clientEventId,
    rating,
    reviewedAtClient,
    reviewedAtServer: reviewedAtClient,
  };
}

export function buildCardUpsertOperation(card: Card): SyncPushOperation {
  return {
    operationId: card.lastOperationId,
    entityType: "card",
    entityId: card.cardId,
    action: "upsert",
    clientUpdatedAt: card.clientUpdatedAt,
    payload: {
      cardId: card.cardId,
      frontText: card.frontText,
      backText: card.backText,
      tags: card.tags,
      effortLevel: card.effortLevel,
      dueAt: card.dueAt,
      reps: card.reps,
      lapses: card.lapses,
      fsrsCardState: card.fsrsCardState,
      fsrsStepIndex: card.fsrsStepIndex,
      fsrsStability: card.fsrsStability,
      fsrsDifficulty: card.fsrsDifficulty,
      fsrsLastReviewedAt: card.fsrsLastReviewedAt,
      fsrsScheduledDays: card.fsrsScheduledDays,
      deletedAt: card.deletedAt,
    },
  };
}

export function buildDeckUpsertOperation(deck: Deck): SyncPushOperation {
  return {
    operationId: deck.lastOperationId,
    entityType: "deck",
    entityId: deck.deckId,
    action: "upsert",
    clientUpdatedAt: deck.clientUpdatedAt,
    payload: {
      deckId: deck.deckId,
      name: deck.name,
      filterDefinition: deck.filterDefinition,
      createdAt: deck.createdAt,
      deletedAt: deck.deletedAt,
    },
  };
}

export function buildReviewEventAppendOperation(reviewEvent: ReviewEvent): SyncPushOperation {
  return {
    operationId: reviewEvent.reviewEventId,
    entityType: "review_event",
    entityId: reviewEvent.reviewEventId,
    action: "append",
    clientUpdatedAt: reviewEvent.reviewedAtClient,
    payload: {
      reviewEventId: reviewEvent.reviewEventId,
      cardId: reviewEvent.cardId,
      deviceId: reviewEvent.deviceId,
      clientEventId: reviewEvent.clientEventId,
      rating: reviewEvent.rating,
      reviewedAtClient: reviewEvent.reviewedAtClient,
    },
  };
}

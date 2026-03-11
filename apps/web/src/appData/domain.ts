import type {
  ReviewableCardScheduleState,
} from "../../../backend/src/schedule";
import type {
  Card,
  CardFilter,
  CreateCardInput,
  CreateDeckInput,
  DeckFilterDefinition,
  Deck,
  ReviewFilter,
  ReviewEvent,
  SyncPushOperation,
  UpdateCardInput,
  UpdateDeckInput,
  WorkspaceTagSummary,
  WorkspaceTagsSummary,
  WorkspaceSummary,
} from "../types";
import { ALL_CARDS_DECK_LABEL } from "../deckFilters";

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

/** Aggregate counts rendered by deck cards on the web deck list. */
export type DeckCardStats = Readonly<{
  totalCards: number;
  dueCards: number;
  newCards: number;
  reviewedCards: number;
}>;

/** Shared singleton review filter for the virtual deck that targets all active cards. */
export const ALL_CARDS_REVIEW_FILTER: ReviewFilter = {
  kind: "allCards",
};

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

export function isCardNew(card: Card): boolean {
  return card.reps === 0 && card.lapses === 0;
}

export function isCardReviewed(card: Card): boolean {
  return card.reps > 0 || card.lapses > 0;
}

export function deriveActiveCards(cards: ReadonlyArray<Card>): ReadonlyArray<Card> {
  return cards.filter((card) => card.deletedAt === null);
}

export function deriveActiveDecks(decks: ReadonlyArray<Deck>): ReadonlyArray<Deck> {
  return decks.filter((deck) => deck.deletedAt === null);
}

export function isReviewFilterEqual(left: ReviewFilter, right: ReviewFilter): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "allCards" && right.kind === "allCards") {
    return true;
  }

  if (left.kind === "deck" && right.kind === "deck") {
    return left.deckId === right.deckId;
  }

  return false;
}

/** Mirrors iOS deck matching semantics: effort is inclusive and tags use subset matching. */
export function matchesDeckFilterDefinition(filterDefinition: DeckFilterDefinition, card: Card): boolean {
  if (filterDefinition.effortLevels.length > 0 && filterDefinition.effortLevels.includes(card.effortLevel) === false) {
    return false;
  }

  if (filterDefinition.tags.length === 0) {
    return true;
  }

  const cardTags = new Set(card.tags);
  return filterDefinition.tags.every((tag) => cardTags.has(tag));
}

export function matchesCardFilter(filter: CardFilter, card: Card): boolean {
  if (filter.effort.length > 0 && filter.effort.includes(card.effortLevel) === false) {
    return false;
  }

  if (filter.tags.length === 0) {
    return true;
  }

  const cardTags = new Set(card.tags);
  return filter.tags.every((tag) => cardTags.has(tag));
}

/** Returns only active cards that belong to the provided persisted deck. */
export function cardsMatchingDeck(deck: Deck, cards: ReadonlyArray<Card>): ReadonlyArray<Card> {
  return deriveActiveCards(cards).filter((card) => matchesDeckFilterDefinition(deck.filterDefinition, card));
}

/** Builds the deck counters used by both persisted decks and the synthetic All cards deck. */
export function makeDeckCardStats(cards: ReadonlyArray<Card>, nowTimestamp: number): DeckCardStats {
  return {
    totalCards: cards.length,
    dueCards: cards.filter((card) => isCardDue(card, nowTimestamp)).length,
    newCards: cards.filter((card) => isCardNew(card)).length,
    reviewedCards: cards.filter((card) => isCardReviewed(card)).length,
  };
}

export function makeWorkspaceTagsSummary(cards: ReadonlyArray<Card>): WorkspaceTagsSummary {
  const activeCards = deriveActiveCards(cards);
  const counts = activeCards.reduce((result, card) => {
    for (const tag of card.tags) {
      result.set(tag, (result.get(tag) ?? 0) + 1);
    }

    return result;
  }, new Map<string, number>());

  const tags: ReadonlyArray<WorkspaceTagSummary> = [...counts.entries()]
    .map(([tag, cardsCount]) => ({
      tag,
      cardsCount,
    }))
    .sort((leftTag, rightTag) => {
      if (leftTag.cardsCount !== rightTag.cardsCount) {
        return rightTag.cardsCount - leftTag.cardsCount;
      }

      return leftTag.tag.localeCompare(rightTag.tag, undefined, { sensitivity: "base" });
    });

  return {
    tags,
    totalCards: activeCards.length,
  };
}

export function resolveReviewFilter(reviewFilter: ReviewFilter, decks: ReadonlyArray<Deck>): ReviewFilter {
  if (reviewFilter.kind === "allCards") {
    return ALL_CARDS_REVIEW_FILTER;
  }

  const activeDeck = deriveActiveDecks(decks).find((deck) => deck.deckId === reviewFilter.deckId);
  if (activeDeck === undefined) {
    return ALL_CARDS_REVIEW_FILTER;
  }

  return reviewFilter;
}

export function cardsMatchingReviewFilter(
  reviewFilter: ReviewFilter,
  decks: ReadonlyArray<Deck>,
  cards: ReadonlyArray<Card>,
): ReadonlyArray<Card> {
  const resolvedReviewFilter = resolveReviewFilter(reviewFilter, decks);
  if (resolvedReviewFilter.kind === "allCards") {
    return deriveActiveCards(cards);
  }

  const deck = deriveActiveDecks(decks).find((candidateDeck) => candidateDeck.deckId === resolvedReviewFilter.deckId);
  if (deck === undefined) {
    return [];
  }

  return cardsMatchingDeck(deck, cards);
}

export function reviewFilterTitle(reviewFilter: ReviewFilter, decks: ReadonlyArray<Deck>): string {
  const resolvedReviewFilter = resolveReviewFilter(reviewFilter, decks);
  if (resolvedReviewFilter.kind === "allCards") {
    return ALL_CARDS_DECK_LABEL;
  }

  const deck = deriveActiveDecks(decks).find((candidateDeck) => candidateDeck.deckId === resolvedReviewFilter.deckId);
  return deck?.name ?? ALL_CARDS_DECK_LABEL;
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

export function makeReviewTimeline(
  reviewFilter: ReviewFilter,
  decks: ReadonlyArray<Deck>,
  cards: ReadonlyArray<Card>,
): ReadonlyArray<Card> {
  return deriveReviewTimeline(cardsMatchingReviewFilter(reviewFilter, decks, cards));
}

export function makeReviewQueue(
  reviewFilter: ReviewFilter,
  decks: ReadonlyArray<Deck>,
  cards: ReadonlyArray<Card>,
): ReadonlyArray<Card> {
  return deriveReviewQueue(cardsMatchingReviewFilter(reviewFilter, decks, cards));
}

export function currentReviewCard(reviewQueue: ReadonlyArray<Card>): Card | null {
  return reviewQueue[0] ?? null;
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

export function findWorkspaceById(
  workspaces: ReadonlyArray<WorkspaceSummary>,
  workspaceId: string | null,
): WorkspaceSummary | null {
  if (workspaceId === null) {
    return null;
  }

  return workspaces.find((workspace) => workspace.workspaceId === workspaceId) ?? null;
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

export function normalizeRequiredDeckName(value: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw new Error("Deck name must not be empty");
  }

  return normalizedValue;
}

function normalizeDeckFilterDefinition(filterDefinition: DeckFilterDefinition): DeckFilterDefinition {
  return {
    version: 2,
    effortLevels: [...new Set(filterDefinition.effortLevels)],
    tags: [...new Set(filterDefinition.tags.map((tag) => tag.trim()).filter((tag) => tag !== ""))],
  };
}

export function normalizeCreateDeckInput(input: CreateDeckInput): CreateDeckInput {
  return {
    name: normalizeRequiredDeckName(input.name),
    filterDefinition: normalizeDeckFilterDefinition(input.filterDefinition),
  };
}

export function normalizeUpdateDeckInput(input: UpdateDeckInput): UpdateDeckInput {
  return {
    name: normalizeRequiredDeckName(input.name),
    filterDefinition: normalizeDeckFilterDefinition(input.filterDefinition),
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

export function buildUpdatedDeck(
  deck: Deck,
  input: UpdateDeckInput,
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): Deck {
  return {
    ...deck,
    name: input.name,
    filterDefinition: input.filterDefinition,
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
  };
}

export function buildDeletedDeck(
  deck: Deck,
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): Deck {
  return {
    ...deck,
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
    deletedAt: clientUpdatedAt,
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

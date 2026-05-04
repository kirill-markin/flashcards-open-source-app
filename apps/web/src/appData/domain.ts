import type {
  ReviewableCardScheduleState,
} from "../../../backend/src/schedule";
import { canonicalizeDueAtForSync, parseDueAtMillis } from "./dueAt";
import type {
  Card,
  CardFilter,
  CreateCardInput,
  CreateDeckInput,
  DeckFilterDefinition,
  Deck,
  EffortLevel,
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
  lastModifiedByReplicaId: string;
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

export const recentDuePriorityWindow: number = 60 * 60 * 1000;

type ReviewOrderBucket = "recentDue" | "oldDue" | "newNull" | "future" | "malformed";

const reviewOrderBucketRanks: Readonly<Record<ReviewOrderBucket, number>> = {
  recentDue: 0,
  oldDue: 1,
  newNull: 2,
  future: 3,
  malformed: 4,
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

  const dueAtTimestamp = parseDueAtMillis(card.dueAt);
  if (dueAtTimestamp === null) {
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

  if (left.kind === "effort" && right.kind === "effort") {
    return left.effortLevel === right.effortLevel;
  }

  if (left.kind === "tag" && right.kind === "tag") {
    return left.tag === right.tag;
  }

  return false;
}

export function normalizeTagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

function hasMatchingTag(tags: ReadonlyArray<string>, requestedTag: string): boolean {
  const requestedTagKey = normalizeTagKey(requestedTag);
  return tags.some((tag) => normalizeTagKey(tag) === requestedTagKey);
}

function findMatchingTag(tags: ReadonlyArray<string>, requestedTag: string): string | null {
  const requestedTagKey = normalizeTagKey(requestedTag);
  return tags.find((tag) => normalizeTagKey(tag) === requestedTagKey)?.trim() ?? null;
}

/** Keep deck matching semantics aligned with apps/ios/Flashcards/Flashcards/CardFilterSupport.swift and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FilterSupport.kt: effort is inclusive and tags match on any overlap. */
export function matchesDeckFilterDefinition(filterDefinition: DeckFilterDefinition, card: Card): boolean {
  if (filterDefinition.effortLevels.length > 0 && filterDefinition.effortLevels.includes(card.effortLevel) === false) {
    return false;
  }

  if (filterDefinition.tags.length === 0) {
    return true;
  }

  const cardTagKeys = new Set(card.tags.map((tag) => normalizeTagKey(tag)));
  return filterDefinition.tags.some((tag) => cardTagKeys.has(normalizeTagKey(tag)));
}

export function matchesCardFilter(filter: CardFilter, card: Card): boolean {
  if (filter.effort.length > 0 && filter.effort.includes(card.effortLevel) === false) {
    return false;
  }

  if (filter.tags.length === 0) {
    return true;
  }

  const cardTagKeys = new Set(card.tags.map((tag) => normalizeTagKey(tag)));
  return filter.tags.some((tag) => cardTagKeys.has(normalizeTagKey(tag)));
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

function findActiveTag(tag: string, cards: ReadonlyArray<Card>): string | null {
  for (const card of deriveActiveCards(cards)) {
    const matchingTag = findMatchingTag(card.tags, tag);
    if (matchingTag !== null) {
      return matchingTag;
    }
  }

  return null;
}

export function formatEffortLevelTitle(effortLevel: EffortLevel): string {
  return effortLevel.charAt(0).toUpperCase() + effortLevel.slice(1);
}

export function resolveReviewFilter(
  reviewFilter: ReviewFilter,
  decks: ReadonlyArray<Deck>,
  cards: ReadonlyArray<Card>,
): ReviewFilter {
  if (reviewFilter.kind === "allCards") {
    return ALL_CARDS_REVIEW_FILTER;
  }

  if (reviewFilter.kind === "deck") {
    const activeDeck = deriveActiveDecks(decks).find((deck) => deck.deckId === reviewFilter.deckId);
    if (activeDeck === undefined) {
      return ALL_CARDS_REVIEW_FILTER;
    }

    return reviewFilter;
  }

  if (reviewFilter.kind === "effort") {
    return reviewFilter;
  }

  const matchingTag = findActiveTag(reviewFilter.tag, cards);
  if (matchingTag === null) {
    return ALL_CARDS_REVIEW_FILTER;
  }

  return {
    kind: "tag",
    tag: matchingTag,
  };
}

export function cardsMatchingReviewFilter(
  reviewFilter: ReviewFilter,
  decks: ReadonlyArray<Deck>,
  cards: ReadonlyArray<Card>,
): ReadonlyArray<Card> {
  const resolvedReviewFilter = resolveReviewFilter(reviewFilter, decks, cards);
  if (resolvedReviewFilter.kind === "allCards") {
    return deriveActiveCards(cards);
  }

  if (resolvedReviewFilter.kind === "deck") {
    const deck = deriveActiveDecks(decks).find((candidateDeck) => candidateDeck.deckId === resolvedReviewFilter.deckId);
    if (deck === undefined) {
      return [];
    }

    return cardsMatchingDeck(deck, cards);
  }

  if (resolvedReviewFilter.kind === "effort") {
    return deriveActiveCards(cards).filter((card) => card.effortLevel === resolvedReviewFilter.effortLevel);
  }

  return deriveActiveCards(cards).filter((card) => hasMatchingTag(card.tags, resolvedReviewFilter.tag));
}

export function reviewFilterTitle(
  reviewFilter: ReviewFilter,
  decks: ReadonlyArray<Deck>,
  cards: ReadonlyArray<Card>,
): string {
  const resolvedReviewFilter = resolveReviewFilter(reviewFilter, decks, cards);
  if (resolvedReviewFilter.kind === "allCards") {
    return ALL_CARDS_DECK_LABEL;
  }

  if (resolvedReviewFilter.kind === "deck") {
    const deck = deriveActiveDecks(decks).find((candidateDeck) => candidateDeck.deckId === resolvedReviewFilter.deckId);
    return deck?.name ?? ALL_CARDS_DECK_LABEL;
  }

  if (resolvedReviewFilter.kind === "effort") {
    return formatEffortLevelTitle(resolvedReviewFilter.effortLevel);
  }

  return resolvedReviewFilter.tag;
}

export function shouldShowSwitchToAllCardsReviewAction(
  reviewFilter: ReviewFilter,
  decks: ReadonlyArray<Deck>,
  cards: ReadonlyArray<Card>,
): boolean {
  const resolvedReviewFilter = resolveReviewFilter(reviewFilter, decks, cards);

  return resolvedReviewFilter.kind !== "allCards";
}

function getReviewOrderDueTimestamp(card: Card): number {
  if (card.dueAt === null) {
    return Number.POSITIVE_INFINITY;
  }

  const dueAtTimestamp = parseDueAtMillis(card.dueAt);
  if (dueAtTimestamp === null) {
    return Number.POSITIVE_INFINITY;
  }

  return dueAtTimestamp;
}

function getReviewOrderCreatedTimestamp(card: Card): number {
  const createdAtTimestamp = new Date(card.createdAt).getTime();
  if (Number.isNaN(createdAtTimestamp)) {
    return Number.POSITIVE_INFINITY;
  }

  return createdAtTimestamp;
}

/**
 * Keep review queue ordering aligned with:
 * - apps/ios/Flashcards/Flashcards/Review/ReviewQuerySupport.swift::compareCardsForReviewOrder
 * - apps/ios/Flashcards/Flashcards/Database/CardStore+ReadSQL.swift review queue ORDER BY
 * - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/ReviewSupport.kt::sortCardsForReviewQueue
 * Ordering contract: recent due cards in the inclusive 1-hour window first, then old due,
 * then null-due/new cards, then future cards, then malformed dueAt cards.
 * Active queues include only recent due, old due, and null-due/new cards.
 * Within each bucket, earlier dueAt comes first, then newer createdAt, then cardId ascending.
 * If this changes, mirror the same change across all three clients in the same change.
 */
export function compareCardsForReviewOrder(leftCard: Card, rightCard: Card, nowTimestamp: number): number {
  const leftOrderRank = reviewOrderBucketRanks[getReviewOrderBucket(leftCard, nowTimestamp)];
  const rightOrderRank = reviewOrderBucketRanks[getReviewOrderBucket(rightCard, nowTimestamp)];

  if (leftOrderRank !== rightOrderRank) {
    return leftOrderRank - rightOrderRank;
  }

  const leftDueTimestamp = getReviewOrderDueTimestamp(leftCard);
  const rightDueTimestamp = getReviewOrderDueTimestamp(rightCard);
  if (leftDueTimestamp !== rightDueTimestamp) {
    return leftDueTimestamp - rightDueTimestamp;
  }

  const leftCreatedAtTimestamp = getReviewOrderCreatedTimestamp(leftCard);
  const rightCreatedAtTimestamp = getReviewOrderCreatedTimestamp(rightCard);
  if (leftCreatedAtTimestamp !== rightCreatedAtTimestamp) {
    return rightCreatedAtTimestamp - leftCreatedAtTimestamp;
  }

  return leftCard.cardId.localeCompare(rightCard.cardId);
}

function getReviewOrderBucket(card: Card, nowTimestamp: number): ReviewOrderBucket {
  if (card.dueAt === null) {
    return "newNull";
  }

  const dueAtTimestamp = parseDueAtMillis(card.dueAt);
  if (dueAtTimestamp === null) {
    return "malformed";
  }

  if (dueAtTimestamp > nowTimestamp) {
    return "future";
  }

  return dueAtTimestamp >= nowTimestamp - recentDuePriorityWindow ? "recentDue" : "oldDue";
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

  const deviceDifference = left.lastModifiedByReplicaId.localeCompare(right.lastModifiedByReplicaId);
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
  installationId: string,
  operationId: string,
): Card {
  return {
    cardId: crypto.randomUUID().toLowerCase(),
    frontText: input.frontText,
    backText: input.backText,
    tags: input.tags,
    effortLevel: input.effortLevel,
    dueAt: null,
    createdAt: clientUpdatedAt,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt,
    lastModifiedByReplicaId: installationId,
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
  const normalizedTags = filterDefinition.tags.reduce<Array<string>>((result, tag) => {
    const normalizedTag = tag.trim();
    const normalizedTagKey = normalizeTagKey(normalizedTag);
    if (normalizedTag === "" || result.some((existingTag) => normalizeTagKey(existingTag) === normalizedTagKey)) {
      return result;
    }

    result.push(normalizedTag);
    return result;
  }, []);

  return {
    version: 2,
    effortLevels: [...new Set(filterDefinition.effortLevels)],
    tags: normalizedTags,
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
  installationId: string,
  operationId: string,
): Card {
  return {
    ...card,
    frontText: input.frontText ?? card.frontText,
    backText: input.backText ?? card.backText,
    tags: input.tags ?? card.tags,
    effortLevel: input.effortLevel ?? card.effortLevel,
    clientUpdatedAt,
    lastModifiedByReplicaId: installationId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
  };
}

export function buildDeletedCard(
  card: Card,
  clientUpdatedAt: string,
  installationId: string,
  operationId: string,
): Card {
  return {
    ...card,
    clientUpdatedAt,
    lastModifiedByReplicaId: installationId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
    deletedAt: clientUpdatedAt,
  };
}

export function buildDeck(
  input: CreateDeckInput,
  clientUpdatedAt: string,
  installationId: string,
  operationId: string,
): Deck {
  return {
    deckId: crypto.randomUUID().toLowerCase(),
    workspaceId: "",
    name: input.name,
    filterDefinition: input.filterDefinition,
    createdAt: clientUpdatedAt,
    clientUpdatedAt,
    lastModifiedByReplicaId: installationId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
    deletedAt: null,
  };
}

export function buildUpdatedDeck(
  deck: Deck,
  input: UpdateDeckInput,
  clientUpdatedAt: string,
  installationId: string,
  operationId: string,
): Deck {
  return {
    ...deck,
    name: input.name,
    filterDefinition: input.filterDefinition,
    clientUpdatedAt,
    lastModifiedByReplicaId: installationId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
  };
}

export function buildDeletedDeck(
  deck: Deck,
  clientUpdatedAt: string,
  installationId: string,
  operationId: string,
): Deck {
  return {
    ...deck,
    clientUpdatedAt,
    lastModifiedByReplicaId: installationId,
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
  installationId: string,
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
    lastModifiedByReplicaId: installationId,
    lastOperationId: operationId,
    updatedAt: reviewedAtClient,
  };
}

export function buildReviewEvent(
  workspaceId: string,
  cardId: string,
  replicaId: string,
  rating: 0 | 1 | 2 | 3,
  reviewedAtClient: string,
  reviewEventId: string,
  clientEventId: string,
): ReviewEvent {
  return {
    reviewEventId,
    workspaceId,
    cardId,
    replicaId,
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
      dueAt: canonicalizeDueAtForSync(card.cardId, card.dueAt),
      createdAt: card.createdAt,
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
      clientEventId: reviewEvent.clientEventId,
      rating: reviewEvent.rating,
      reviewedAtClient: reviewEvent.reviewedAtClient,
    },
  };
}

import {
  isCardDue,
  isReviewFilterEqual,
  matchesDeckFilterDefinition,
  normalizeTagKey,
} from "../../../appData/domain";
import type {
  Card,
  DeckSummary,
  ReviewCounts,
  ReviewFilter,
  TagSuggestion,
  WorkspaceTagSummary,
} from "../../../types";

export type PendingReviewSnapshot = Readonly<{
  card: Card;
}>;

type ReviewSessionCardSignature = Readonly<{
  cardId: string;
  updatedAt: string;
}>;

export type ReviewSessionSignature = Readonly<{
  activeQueue: ReadonlyArray<ReviewSessionCardSignature>;
  queueCards: ReadonlyArray<ReviewSessionCardSignature>;
  selectedReviewFilterKey: string;
}>;

export type ReviewSubmissionContext = Readonly<{
  cardId: string;
  deckSummaries: ReadonlyArray<DeckSummary>;
  reviewSessionGeneration: number;
  resolvedReviewFilter: ReviewFilter;
  selectedReviewFilterKey: string;
  workspaceId: string | null;
}>;

export function createEmptyReviewCounts(): ReviewCounts {
  return {
    dueCount: 0,
    totalCount: 0,
  };
}

export function toTagSuggestions(reviewTagSummaries: ReadonlyArray<WorkspaceTagSummary>): ReadonlyArray<TagSuggestion> {
  return reviewTagSummaries.map((tagSummary) => ({
    tag: tagSummary.tag,
    countState: "ready",
    cardsCount: tagSummary.cardsCount,
  }));
}

export function resolveReviewFilterTitle(
  reviewFilter: ReviewFilter,
  deckSummaries: ReadonlyArray<DeckSummary>,
  allCardsLabel: string,
  formatEffortLabel: (effortLevel: "fast" | "medium" | "long") => string,
): string {
  if (reviewFilter.kind === "allCards") {
    return allCardsLabel;
  }

  if (reviewFilter.kind === "effort") {
    return formatEffortLabel(reviewFilter.effortLevel);
  }

  if (reviewFilter.kind === "tag") {
    return reviewFilter.tag;
  }

  return deckSummaries.find((deck) => deck.deckId === reviewFilter.deckId)?.name ?? allCardsLabel;
}

export function buildDisplayedReviewQueue(
  canonicalReviewQueue: ReadonlyArray<Card>,
  presentedCard: Card | null,
): ReadonlyArray<Card> {
  if (presentedCard === null) {
    return canonicalReviewQueue;
  }

  return [
    presentedCard,
    ...canonicalReviewQueue.filter((card) => card.cardId !== presentedCard.cardId),
  ];
}

export function buildDisplayedReviewTimeline(
  reviewTimeline: ReadonlyArray<Card>,
  displayedReviewQueue: ReadonlyArray<Card>,
): ReadonlyArray<Card> {
  const displayedCurrentCard = displayedReviewQueue[0];
  if (displayedCurrentCard === undefined) {
    return reviewTimeline;
  }

  return [
    displayedCurrentCard,
    ...reviewTimeline.filter((card) => card.cardId !== displayedCurrentCard.cardId),
  ];
}

export function resolveCanonicalPresentedCard(
  canonicalReviewQueue: ReadonlyArray<Card>,
  previousPresentedCard: Card | null,
): Card | null {
  if (previousPresentedCard !== null) {
    const canonicalPreviousPresentedCard = canonicalReviewQueue.find((card) => card.cardId === previousPresentedCard.cardId);
    if (canonicalPreviousPresentedCard !== undefined) {
      return canonicalPreviousPresentedCard;
    }
  }

  return canonicalReviewQueue[0] ?? null;
}

function matchesResolvedReviewFilterForPreservation(
  card: Card,
  resolvedReviewFilter: ReviewFilter,
  deckSummaries: ReadonlyArray<DeckSummary>,
): boolean {
  if (resolvedReviewFilter.kind === "allCards") {
    return true;
  }

  if (resolvedReviewFilter.kind === "deck") {
    const deckSummary = deckSummaries.find((deck) => deck.deckId === resolvedReviewFilter.deckId);
    return deckSummary === undefined ? false : matchesDeckFilterDefinition(deckSummary.filterDefinition, card);
  }

  if (resolvedReviewFilter.kind === "effort") {
    return card.effortLevel === resolvedReviewFilter.effortLevel;
  }

  const requestedTagKey = normalizeTagKey(resolvedReviewFilter.tag);
  return card.tags.some((tag) => normalizeTagKey(tag) === requestedTagKey);
}

export function isPreservablePresentedCard(
  card: Card,
  resolvedReviewFilter: ReviewFilter,
  deckSummaries: ReadonlyArray<DeckSummary>,
  nowTimestamp: number,
): boolean {
  return isCardDue(card, nowTimestamp) && matchesResolvedReviewFilterForPreservation(card, resolvedReviewFilter, deckSummaries);
}

function isStringSetEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort((leftValue, rightValue) => leftValue.localeCompare(rightValue));
  const sortedRight = [...right].sort((leftValue, rightValue) => leftValue.localeCompare(rightValue));
  return sortedLeft.every((leftValue, index) => leftValue === sortedRight[index]);
}

function isDeckFilterDefinitionEqual(
  left: DeckSummary["filterDefinition"],
  right: DeckSummary["filterDefinition"],
): boolean {
  return isStringSetEqual(left.effortLevels, right.effortLevels)
    && isStringSetEqual(left.tags, right.tags);
}

function findDeckSummaryByReviewFilter(
  reviewFilter: ReviewFilter,
  deckSummaries: ReadonlyArray<DeckSummary>,
): DeckSummary | null {
  if (reviewFilter.kind !== "deck") {
    return null;
  }

  return deckSummaries.find((deckSummary) => deckSummary.deckId === reviewFilter.deckId) ?? null;
}

function buildReviewSessionCardSignature(card: Card): ReviewSessionCardSignature {
  return {
    cardId: card.cardId,
    updatedAt: card.updatedAt,
  };
}

export function buildReviewSessionSignature(
  selectedReviewFilterKey: string,
  activeReviewQueue: ReadonlyArray<Card>,
  queueCards: ReadonlyArray<Card>,
): ReviewSessionSignature {
  return {
    activeQueue: activeReviewQueue.map(buildReviewSessionCardSignature),
    queueCards: queueCards.map(buildReviewSessionCardSignature),
    selectedReviewFilterKey,
  };
}

function isReviewSessionCardSignatureEqual(
  left: ReviewSessionCardSignature,
  right: ReviewSessionCardSignature,
): boolean {
  return left.cardId === right.cardId && left.updatedAt === right.updatedAt;
}

function isReviewSessionCardSignatureListEqual(
  left: ReadonlyArray<ReviewSessionCardSignature>,
  right: ReadonlyArray<ReviewSessionCardSignature>,
): boolean {
  return left.length === right.length
    && left.every((leftCardSignature, index) => {
      const rightCardSignature = right[index];
      return rightCardSignature !== undefined
        && isReviewSessionCardSignatureEqual(leftCardSignature, rightCardSignature);
    });
}

export function isReviewSessionSignatureEqual(
  left: ReviewSessionSignature,
  right: ReviewSessionSignature,
): boolean {
  return left.selectedReviewFilterKey === right.selectedReviewFilterKey
    && isReviewSessionCardSignatureListEqual(left.activeQueue, right.activeQueue)
    && isReviewSessionCardSignatureListEqual(left.queueCards, right.queueCards);
}

function filterReviewSessionCardSignatures(
  cardSignatures: ReadonlyArray<ReviewSessionCardSignature>,
  excludedCardIds: ReadonlySet<string>,
): ReadonlyArray<ReviewSessionCardSignature> {
  if (excludedCardIds.size === 0) {
    return cardSignatures;
  }

  return cardSignatures.filter((cardSignature) => excludedCardIds.has(cardSignature.cardId) === false);
}

function isReviewSessionCardSignaturePrefix(
  prefix: ReadonlyArray<ReviewSessionCardSignature>,
  cardSignatures: ReadonlyArray<ReviewSessionCardSignature>,
): boolean {
  if (prefix.length > cardSignatures.length) {
    return false;
  }

  return prefix.every((prefixCardSignature, index) => {
    const cardSignature = cardSignatures[index];
    return cardSignature !== undefined
      && isReviewSessionCardSignatureEqual(prefixCardSignature, cardSignature);
  });
}

export function isReviewSessionSignatureCompatible(
  previousSignature: ReviewSessionSignature,
  nextSignature: ReviewSessionSignature,
  pendingReviewSnapshots: ReadonlyMap<string, PendingReviewSnapshot>,
): boolean {
  if (previousSignature.selectedReviewFilterKey !== nextSignature.selectedReviewFilterKey) {
    return false;
  }

  const pendingCardIds: ReadonlySet<string> = new Set(pendingReviewSnapshots.keys());
  const comparablePreviousActiveQueue = filterReviewSessionCardSignatures(previousSignature.activeQueue, pendingCardIds);
  const comparablePreviousQueueCards = filterReviewSessionCardSignatures(previousSignature.queueCards, pendingCardIds);

  return isReviewSessionCardSignaturePrefix(comparablePreviousActiveQueue, nextSignature.activeQueue)
    && isReviewSessionCardSignaturePrefix(comparablePreviousQueueCards, nextSignature.queueCards);
}

export function isReviewSubmissionContextCurrent(
  submissionContext: ReviewSubmissionContext,
  activeWorkspaceId: string | null,
  selectedReviewFilterKey: string,
  reviewSessionGeneration: number,
  resolvedReviewFilter: ReviewFilter,
  deckSummaries: ReadonlyArray<DeckSummary>,
): boolean {
  if (activeWorkspaceId !== submissionContext.workspaceId) {
    return false;
  }

  if (selectedReviewFilterKey !== submissionContext.selectedReviewFilterKey) {
    return false;
  }

  if (reviewSessionGeneration !== submissionContext.reviewSessionGeneration) {
    return false;
  }

  if (isReviewFilterEqual(resolvedReviewFilter, submissionContext.resolvedReviewFilter) === false) {
    return false;
  }

  if (submissionContext.resolvedReviewFilter.kind !== "deck") {
    return true;
  }

  const submittedDeckSummary = findDeckSummaryByReviewFilter(
    submissionContext.resolvedReviewFilter,
    submissionContext.deckSummaries,
  );
  const currentDeckSummary = findDeckSummaryByReviewFilter(resolvedReviewFilter, deckSummaries);
  return submittedDeckSummary !== null
    && currentDeckSummary !== null
    && isDeckFilterDefinitionEqual(submittedDeckSummary.filterDefinition, currentDeckSummary.filterDefinition);
}

function isMissingPresentedCardError(error: unknown, cardId: string): boolean {
  return error instanceof Error && error.message === `Card not found: ${cardId}`;
}

export function toReviewErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildSubmitFailureMessage(
  originalSubmitErrorMessage: string,
  rollbackLookupErrorMessage: string | null,
): string {
  if (rollbackLookupErrorMessage === null) {
    return originalSubmitErrorMessage;
  }

  return `${originalSubmitErrorMessage}\nRollback lookup failed: ${rollbackLookupErrorMessage}`;
}

export function buildChunkReplenishmentFailureMessage(chunkLoadErrorMessage: string): string {
  return `Failed to load more cards after submit: ${chunkLoadErrorMessage}`;
}

export function removeCardFromReviewQueue(cards: ReadonlyArray<Card>, cardId: string): ReadonlyArray<Card> {
  return cards.filter((card) => card.cardId !== cardId);
}

export function addPendingReviewSnapshot(
  pendingReviewSnapshots: ReadonlyMap<string, PendingReviewSnapshot>,
  card: Card,
): ReadonlyMap<string, PendingReviewSnapshot> {
  return new Map([
    ...pendingReviewSnapshots,
    [card.cardId, { card }],
  ]);
}

export function removePendingReviewSnapshot(
  pendingReviewSnapshots: ReadonlyMap<string, PendingReviewSnapshot>,
  cardId: string,
): ReadonlyMap<string, PendingReviewSnapshot> {
  return new Map([...pendingReviewSnapshots].filter(([pendingCardId]) => pendingCardId !== cardId));
}

export function filterPendingReviewCards(
  cards: ReadonlyArray<Card>,
  pendingReviewSnapshots: ReadonlyMap<string, PendingReviewSnapshot>,
): ReadonlyArray<Card> {
  if (pendingReviewSnapshots.size === 0) {
    return cards;
  }

  return cards.filter((card) => pendingReviewSnapshots.has(card.cardId) === false);
}

export function filterExcludedReviewCards(
  cards: ReadonlyArray<Card>,
  pendingReviewSnapshots: ReadonlyMap<string, PendingReviewSnapshot>,
  explicitCardIds: ReadonlySet<string>,
): ReadonlyArray<Card> {
  if (pendingReviewSnapshots.size === 0 && explicitCardIds.size === 0) {
    return cards;
  }

  return cards.filter((card) => (
    pendingReviewSnapshots.has(card.cardId) === false
    && explicitCardIds.has(card.cardId) === false
  ));
}

function getCanonicalCardById(cards: ReadonlyArray<Card>, cardId: string): Card | null {
  return cards.find((card) => card.cardId === cardId) ?? null;
}

export function resolveFilteredPresentedCard(
  canonicalReviewQueue: ReadonlyArray<Card>,
  candidatePresentedCard: Card | null,
  pendingReviewSnapshots: ReadonlyMap<string, PendingReviewSnapshot>,
  explicitCardIds: ReadonlySet<string>,
): Card | null {
  if (candidatePresentedCard === null) {
    return canonicalReviewQueue[0] ?? null;
  }

  if (
    pendingReviewSnapshots.has(candidatePresentedCard.cardId)
    || explicitCardIds.has(candidatePresentedCard.cardId)
  ) {
    return canonicalReviewQueue[0] ?? null;
  }

  return getCanonicalCardById(canonicalReviewQueue, candidatePresentedCard.cardId) ?? candidatePresentedCard;
}

export function buildReviewQueueChunkExcludedCardIds(
  canonicalReviewQueue: ReadonlyArray<Card>,
  presentedCard: Card | null,
  pendingReviewSnapshots: ReadonlyMap<string, PendingReviewSnapshot>,
  explicitCardIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const excludedCardIds: Set<string> = new Set(canonicalReviewQueue.map((queuedCard) => queuedCard.cardId));

  if (presentedCard !== null) {
    excludedCardIds.add(presentedCard.cardId);
  }

  for (const pendingCardId of pendingReviewSnapshots.keys()) {
    excludedCardIds.add(pendingCardId);
  }

  for (const explicitCardId of explicitCardIds) {
    excludedCardIds.add(explicitCardId);
  }

  return excludedCardIds;
}

export async function loadPresentedCardForPreservation(
  cardId: string,
  getCardById: (cardId: string) => Promise<Card>,
): Promise<Card | null> {
  try {
    return await getCardById(cardId);
  } catch (error) {
    if (isMissingPresentedCardError(error, cardId)) {
      return null;
    }

    throw error;
  }
}

export async function resolvePresentedCard(
  canonicalReviewQueue: ReadonlyArray<Card>,
  previousPresentedCard: Card | null,
  resolvedReviewFilter: ReviewFilter,
  deckSummaries: ReadonlyArray<DeckSummary>,
  getCardById: (cardId: string) => Promise<Card>,
): Promise<Card | null> {
  if (previousPresentedCard === null) {
    return canonicalReviewQueue[0] ?? null;
  }

  const canonicalPresentedCard = canonicalReviewQueue.find((card) => card.cardId === previousPresentedCard.cardId);
  if (canonicalPresentedCard !== undefined) {
    return canonicalPresentedCard;
  }

  const loadedPresentedCard = await loadPresentedCardForPreservation(previousPresentedCard.cardId, getCardById);
  return loadedPresentedCard !== null && isPreservablePresentedCard(loadedPresentedCard, resolvedReviewFilter, deckSummaries, Date.now())
    ? loadedPresentedCard
    : canonicalReviewQueue[0] ?? null;
}

import { useEffect, useRef, useState } from "react";
import {
  ALL_CARDS_REVIEW_FILTER,
  isCardDue,
  isReviewFilterEqual,
  matchesDeckFilterDefinition,
  normalizeTagKey,
} from "../../appData/domain";
import { useI18n } from "../../i18n";
import { loadDecksListSnapshot } from "../../localDb/decks";
import {
  loadReviewQueueChunk,
  loadReviewQueueSnapshot,
  loadReviewTimelinePage,
} from "../../localDb/reviews";
import { loadWorkspaceTagsSummary } from "../../localDb/workspace";
import type {
  Card,
  DeckSummary,
  ReviewCounts,
  ReviewFilter,
  TagSuggestion,
  WorkspaceTagSummary,
} from "../../types";
import {
  buildReviewLoadingCardPreview,
  readReviewLoadingSnapshot,
  serializeReviewFilterKey,
  type ReviewLoadingSnapshot,
  writeReviewLoadingSnapshot,
} from "../shared/loadingSnapshots";
import { formatEffortLevelLabel } from "../shared/featureFormatting";

type UseReviewScreenDataParams = Readonly<{
  activeWorkspaceId: string | null;
  getCardById: (cardId: string) => Promise<Card>;
  localReadVersion: number;
  selectedReviewFilter: ReviewFilter;
  setErrorMessage: (message: string) => void;
  submitReviewItem: (cardId: string, rating: 0 | 1 | 2 | 3) => Promise<Card>;
}>;

type PendingReviewSnapshot = Readonly<{
  card: Card;
}>;

type ReviewSessionCardSignature = Readonly<{
  cardId: string;
  updatedAt: string;
}>;

type ReviewSessionSignature = Readonly<{
  activeQueue: ReadonlyArray<ReviewSessionCardSignature>;
  queueCards: ReadonlyArray<ReviewSessionCardSignature>;
  selectedReviewFilterKey: string;
}>;

type ReviewSubmissionContext = Readonly<{
  cardId: string;
  deckSummaries: ReadonlyArray<DeckSummary>;
  reviewSessionGeneration: number;
  resolvedReviewFilter: ReviewFilter;
  selectedReviewFilterKey: string;
  workspaceId: string | null;
}>;

export type ReviewSubmissionOutcome = "saved" | "failed" | "stale";

export type UseReviewScreenDataResult = Readonly<{
  activeReviewQueue: ReadonlyArray<Card>;
  deckSummaries: ReadonlyArray<DeckSummary>;
  handleReview: (card: Card, rating: 0 | 1 | 2 | 3) => Promise<ReviewSubmissionOutcome>;
  hasLoadedReviewData: boolean;
  isInitialReviewLoad: boolean;
  isReviewLoading: boolean;
  queueCards: ReadonlyArray<Card>;
  resolvedReviewFilter: ReviewFilter;
  reviewCounts: ReviewCounts;
  reviewLoadErrorMessage: string;
  reviewLoadingSnapshot: ReviewLoadingSnapshot | null;
  reviewTagSummaries: ReadonlyArray<WorkspaceTagSummary>;
  selectedReviewFilterTitle: string;
  tagSuggestions: ReadonlyArray<TagSuggestion>;
}>;

function createEmptyReviewCounts(): ReviewCounts {
  return {
    dueCount: 0,
    totalCount: 0,
  };
}

function toTagSuggestions(reviewTagSummaries: ReadonlyArray<WorkspaceTagSummary>): ReadonlyArray<TagSuggestion> {
  return reviewTagSummaries.map((tagSummary) => ({
    tag: tagSummary.tag,
    countState: "ready",
    cardsCount: tagSummary.cardsCount,
  }));
}

function resolveReviewFilterTitle(
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

function buildDisplayedReviewQueue(
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

function buildDisplayedReviewTimeline(
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

function resolveCanonicalPresentedCard(
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

function isPreservablePresentedCard(
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

function buildReviewSessionSignature(
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

function isReviewSessionSignatureEqual(
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

function isReviewSessionSignatureCompatible(
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

function isReviewSubmissionContextCurrent(
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

function toReviewErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildSubmitFailureMessage(
  originalSubmitErrorMessage: string,
  rollbackLookupErrorMessage: string | null,
): string {
  if (rollbackLookupErrorMessage === null) {
    return originalSubmitErrorMessage;
  }

  return `${originalSubmitErrorMessage}\nRollback lookup failed: ${rollbackLookupErrorMessage}`;
}

function buildChunkReplenishmentFailureMessage(chunkLoadErrorMessage: string): string {
  return `Failed to load more cards after submit: ${chunkLoadErrorMessage}`;
}

function removeCardFromReviewQueue(cards: ReadonlyArray<Card>, cardId: string): ReadonlyArray<Card> {
  return cards.filter((card) => card.cardId !== cardId);
}

function addPendingReviewSnapshot(
  pendingReviewSnapshots: ReadonlyMap<string, PendingReviewSnapshot>,
  card: Card,
): ReadonlyMap<string, PendingReviewSnapshot> {
  return new Map([
    ...pendingReviewSnapshots,
    [card.cardId, { card }],
  ]);
}

function removePendingReviewSnapshot(
  pendingReviewSnapshots: ReadonlyMap<string, PendingReviewSnapshot>,
  cardId: string,
): ReadonlyMap<string, PendingReviewSnapshot> {
  return new Map([...pendingReviewSnapshots].filter(([pendingCardId]) => pendingCardId !== cardId));
}

function filterPendingReviewCards(
  cards: ReadonlyArray<Card>,
  pendingReviewSnapshots: ReadonlyMap<string, PendingReviewSnapshot>,
): ReadonlyArray<Card> {
  if (pendingReviewSnapshots.size === 0) {
    return cards;
  }

  return cards.filter((card) => pendingReviewSnapshots.has(card.cardId) === false);
}

function filterExcludedReviewCards(
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

function resolveFilteredPresentedCard(
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

function buildReviewQueueChunkExcludedCardIds(
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

async function loadPresentedCardForPreservation(
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

async function resolvePresentedCard(
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

export function useReviewScreenData(params: UseReviewScreenDataParams): UseReviewScreenDataResult {
  const {
    activeWorkspaceId,
    getCardById,
    localReadVersion,
    selectedReviewFilter,
    setErrorMessage,
    submitReviewItem,
  } = params;
  const { t } = useI18n();
  const [canonicalReviewQueue, setCanonicalReviewQueue] = useState<ReadonlyArray<Card>>([]);
  const [queueCards, setQueueCards] = useState<ReadonlyArray<Card>>([]);
  const [reviewCounts, setReviewCounts] = useState<ReviewCounts>(createEmptyReviewCounts);
  const [reviewQueueCursor, setReviewQueueCursor] = useState<string | null>(null);
  const [reviewTagSummaries, setReviewTagSummaries] = useState<ReadonlyArray<WorkspaceTagSummary>>([]);
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [deckSummaries, setDeckSummaries] = useState<ReadonlyArray<DeckSummary>>([]);
  const [resolvedReviewFilter, setResolvedReviewFilter] = useState<ReviewFilter>(ALL_CARDS_REVIEW_FILTER);
  const [selectedReviewFilterTitle, setSelectedReviewFilterTitle] = useState<string>(t("filters.allCards"));
  const [isReviewLoading, setIsReviewLoading] = useState<boolean>(true);
  const [reviewLoadErrorMessage, setReviewLoadErrorMessage] = useState<string>("");
  const [hasLoadedReviewData, setHasLoadedReviewData] = useState<boolean>(false);
  const [presentedCard, setPresentedCard] = useState<Card | null>(null);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const previousReviewFilterRef = useRef<ReviewFilter | null>(null);
  const canonicalReviewQueueRef = useRef<ReadonlyArray<Card>>([]);
  const deckSummariesRef = useRef<ReadonlyArray<DeckSummary>>([]);
  const pendingReviewSnapshotsRef = useRef<ReadonlyMap<string, PendingReviewSnapshot>>(new Map());
  const presentedCardRef = useRef<Card | null>(null);
  const queueCardsRef = useRef<ReadonlyArray<Card>>([]);
  const resolvedReviewFilterRef = useRef<ReviewFilter>(ALL_CARDS_REVIEW_FILTER);
  const reviewQueueCursorRef = useRef<string | null>(null);
  const reviewSessionGenerationRef = useRef<number>(0);
  const reviewSessionSignatureRef = useRef<ReviewSessionSignature | null>(null);
  const selectedReviewFilterKey = serializeReviewFilterKey(selectedReviewFilter);
  const selectedReviewFilterKeyRef = useRef<string>(selectedReviewFilterKey);
  const reviewLoadingSnapshot = activeWorkspaceId === null
    ? null
    : readReviewLoadingSnapshot(activeWorkspaceId, selectedReviewFilter);
  const isInitialReviewLoad = isReviewLoading && hasLoadedReviewData === false;
  const activeReviewQueue = buildDisplayedReviewQueue(canonicalReviewQueue, presentedCard);

  function setCanonicalReviewQueueState(nextCanonicalReviewQueue: ReadonlyArray<Card>): void {
    canonicalReviewQueueRef.current = nextCanonicalReviewQueue;
    setCanonicalReviewQueue(nextCanonicalReviewQueue);
  }

  function setDeckSummariesState(nextDeckSummaries: ReadonlyArray<DeckSummary>): void {
    deckSummariesRef.current = nextDeckSummaries;
    setDeckSummaries(nextDeckSummaries);
  }

  function setPresentedCardState(nextPresentedCard: Card | null): void {
    presentedCardRef.current = nextPresentedCard;
    setPresentedCard(nextPresentedCard);
  }

  function setQueueCardsState(nextQueueCards: ReadonlyArray<Card>): void {
    queueCardsRef.current = nextQueueCards;
    setQueueCards(nextQueueCards);
  }

  function setResolvedReviewFilterState(nextResolvedReviewFilter: ReviewFilter): void {
    resolvedReviewFilterRef.current = nextResolvedReviewFilter;
    setResolvedReviewFilter(nextResolvedReviewFilter);
  }

  function setReviewQueueCursorState(nextReviewQueueCursor: string | null): void {
    reviewQueueCursorRef.current = nextReviewQueueCursor;
    setReviewQueueCursor(nextReviewQueueCursor);
  }

  useEffect((): void => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
    selectedReviewFilterKeyRef.current = selectedReviewFilterKey;
  }, [activeWorkspaceId, selectedReviewFilterKey]);

  function applyFreshReviewSessionSignature(nextReviewSessionSignature: ReviewSessionSignature): void {
    const previousReviewSessionSignature = reviewSessionSignatureRef.current;
    if (
      previousReviewSessionSignature !== null
      && isReviewSessionSignatureEqual(previousReviewSessionSignature, nextReviewSessionSignature) === false
      && isReviewSessionSignatureCompatible(
        previousReviewSessionSignature,
        nextReviewSessionSignature,
        pendingReviewSnapshotsRef.current,
      ) === false
    ) {
      reviewSessionGenerationRef.current += 1;
    }

    reviewSessionSignatureRef.current = nextReviewSessionSignature;
  }

  function setCurrentReviewSessionSignature(
    activeQueue: ReadonlyArray<Card>,
    visibleQueueCards: ReadonlyArray<Card>,
  ): void {
    reviewSessionSignatureRef.current = buildReviewSessionSignature(
      selectedReviewFilterKeyRef.current,
      activeQueue,
      visibleQueueCards,
    );
  }

  useEffect(() => {
    let isCancelled = false;
    const previousReviewFilter = previousReviewFilterRef.current;
    const shouldShowBlockingLoader = previousReviewFilter === null
      || isReviewFilterEqual(previousReviewFilter, selectedReviewFilter) === false;
    previousReviewFilterRef.current = selectedReviewFilter;

    async function loadReviewData(): Promise<void> {
      if (shouldShowBlockingLoader) {
        setIsReviewLoading(true);
      }
      setReviewLoadErrorMessage("");

      try {
        if (activeWorkspaceId === null) {
          throw new Error("Workspace is unavailable");
        }

        const [
          reviewQueueSnapshot,
          reviewTimelinePage,
          tagsSummary,
          decksSnapshot,
        ] = await Promise.all([
          loadReviewQueueSnapshot(activeWorkspaceId, selectedReviewFilter, 8),
          loadReviewTimelinePage(activeWorkspaceId, selectedReviewFilter, 200, 0),
          loadWorkspaceTagsSummary(activeWorkspaceId),
          loadDecksListSnapshot(activeWorkspaceId),
        ]);
        if (isCancelled) {
          return;
        }

        const pendingReviewSnapshotsBeforePresentation = pendingReviewSnapshotsRef.current;
        const canonicalReviewQueueBeforePresentation = filterPendingReviewCards(
          reviewQueueSnapshot.cards,
          pendingReviewSnapshotsBeforePresentation,
        );
        const nextResolvedReviewFilter = reviewQueueSnapshot.resolvedReviewFilter;
        const nextSelectedReviewFilterTitle = resolveReviewFilterTitle(
          nextResolvedReviewFilter,
          decksSnapshot.deckSummaries,
          t("filters.allCards"),
          (effortLevel) => formatEffortLevelLabel(t, effortLevel),
        );
        const previousPresentedCard = shouldShowBlockingLoader ? null : presentedCardRef.current;
        const resolvedPresentedCard = await resolvePresentedCard(
          canonicalReviewQueueBeforePresentation,
          previousPresentedCard,
          nextResolvedReviewFilter,
          decksSnapshot.deckSummaries,
          getCardById,
        );
        if (isCancelled) {
          return;
        }
        const pendingReviewSnapshotsAfterPresentation = pendingReviewSnapshotsRef.current;
        const currentPresentedCard = presentedCardRef.current;
        // Drop the previously presented card if a concurrent handleReview already advanced past it,
        // so this snapshot completion does not undo a submit that landed while we were resolving.
        const stalePresentedCardIds: ReadonlySet<string> = previousPresentedCard !== null
          && currentPresentedCard?.cardId !== previousPresentedCard.cardId
          ? new Set([previousPresentedCard.cardId])
          : new Set();
        const nextCanonicalReviewQueue = filterExcludedReviewCards(
          reviewQueueSnapshot.cards,
          pendingReviewSnapshotsAfterPresentation,
          stalePresentedCardIds,
        );
        const nextReviewTimelineCards = filterExcludedReviewCards(
          reviewTimelinePage.cards,
          pendingReviewSnapshotsAfterPresentation,
          stalePresentedCardIds,
        );
        const nextPresentedCard = resolveFilteredPresentedCard(
          nextCanonicalReviewQueue,
          stalePresentedCardIds.size === 0 ? resolvedPresentedCard : currentPresentedCard,
          pendingReviewSnapshotsAfterPresentation,
          stalePresentedCardIds,
        );
        const nextActiveReviewQueue = buildDisplayedReviewQueue(nextCanonicalReviewQueue, nextPresentedCard);
        const nextQueueCards = buildDisplayedReviewTimeline(nextReviewTimelineCards, nextActiveReviewQueue);
        applyFreshReviewSessionSignature(buildReviewSessionSignature(
          selectedReviewFilterKey,
          nextActiveReviewQueue,
          nextQueueCards,
        ));

        setResolvedReviewFilterState(nextResolvedReviewFilter);
        setSelectedReviewFilterTitle(nextSelectedReviewFilterTitle);
        setCanonicalReviewQueueState(nextCanonicalReviewQueue);
        setPresentedCardState(nextPresentedCard);
        setReviewCounts(reviewQueueSnapshot.reviewCounts);
        setReviewQueueCursorState(reviewQueueSnapshot.nextCursor);
        setQueueCardsState(nextQueueCards);
        setReviewTagSummaries(tagsSummary.tags);
        setTagSuggestions(toTagSuggestions(tagsSummary.tags));
        setDeckSummariesState(decksSnapshot.deckSummaries);
        writeReviewLoadingSnapshot({
          version: 1,
          workspaceId: activeWorkspaceId,
          selectedReviewFilterKey: serializeReviewFilterKey(selectedReviewFilter),
          resolvedReviewFilterTitle: nextSelectedReviewFilterTitle,
          reviewCounts: reviewQueueSnapshot.reviewCounts,
          currentCard: nextActiveReviewQueue[0] === undefined ? null : buildReviewLoadingCardPreview(nextActiveReviewQueue[0]),
          queuePreview: nextQueueCards
            .slice(0, 6)
            .map((card) => buildReviewLoadingCardPreview(card)),
          savedAt: new Date().toISOString(),
        });
        setHasLoadedReviewData(true);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setReviewLoadErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!isCancelled && shouldShowBlockingLoader) {
          setIsReviewLoading(false);
        }
      }
    }

    void loadReviewData();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspaceId, getCardById, localReadVersion, selectedReviewFilter]);

  async function handleReview(card: Card, rating: 0 | 1 | 2 | 3): Promise<ReviewSubmissionOutcome> {
    const submissionContext: ReviewSubmissionContext = {
      cardId: card.cardId,
      deckSummaries: deckSummariesRef.current,
      reviewSessionGeneration: reviewSessionGenerationRef.current,
      resolvedReviewFilter: resolvedReviewFilterRef.current,
      selectedReviewFilterKey: selectedReviewFilterKeyRef.current,
      workspaceId: activeWorkspaceIdRef.current,
    };

    setErrorMessage("");
    pendingReviewSnapshotsRef.current = addPendingReviewSnapshot(pendingReviewSnapshotsRef.current, card);

    const optimisticCanonicalReviewQueue = removeCardFromReviewQueue(canonicalReviewQueueRef.current, submissionContext.cardId);
    const optimisticPresentedCard = resolveCanonicalPresentedCard(optimisticCanonicalReviewQueue, null);
    const optimisticActiveReviewQueue = buildDisplayedReviewQueue(optimisticCanonicalReviewQueue, optimisticPresentedCard);
    const optimisticQueueCards = buildDisplayedReviewTimeline(
      removeCardFromReviewQueue(queueCardsRef.current, submissionContext.cardId),
      optimisticActiveReviewQueue,
    );

    setCanonicalReviewQueueState(optimisticCanonicalReviewQueue);
    setPresentedCardState(optimisticPresentedCard);
    setQueueCardsState(optimisticQueueCards);
    setCurrentReviewSessionSignature(optimisticActiveReviewQueue, optimisticQueueCards);

    try {
      await submitReviewItem(submissionContext.cardId, rating);
    } catch (error) {
      const originalSubmitErrorMessage = toReviewErrorMessage(error);
      pendingReviewSnapshotsRef.current = removePendingReviewSnapshot(
        pendingReviewSnapshotsRef.current,
        submissionContext.cardId,
      );
      if (
        isReviewSubmissionContextCurrent(
          submissionContext,
          activeWorkspaceIdRef.current,
          selectedReviewFilterKeyRef.current,
          reviewSessionGenerationRef.current,
          resolvedReviewFilterRef.current,
          deckSummariesRef.current,
        ) === false
      ) {
        return "stale";
      }

      let freshRollbackCard: Card | null = null;
      let rollbackLookupErrorMessage: string | null = null;
      try {
        freshRollbackCard = await loadPresentedCardForPreservation(submissionContext.cardId, getCardById);
      } catch (lookupError) {
        rollbackLookupErrorMessage = toReviewErrorMessage(lookupError);
      }
      const currentResolvedReviewFilter = resolvedReviewFilterRef.current;
      const currentDeckSummaries = deckSummariesRef.current;
      if (
        isReviewSubmissionContextCurrent(
          submissionContext,
          activeWorkspaceIdRef.current,
          selectedReviewFilterKeyRef.current,
          reviewSessionGenerationRef.current,
          currentResolvedReviewFilter,
          currentDeckSummaries,
        ) === false
      ) {
        return "stale";
      }

      const isFreshRollbackCardPreservable = freshRollbackCard !== null
        && isPreservablePresentedCard(freshRollbackCard, currentResolvedReviewFilter, currentDeckSummaries, Date.now());
      const rollbackCanonicalReviewQueue = removeCardFromReviewQueue(
        canonicalReviewQueueRef.current,
        submissionContext.cardId,
      );
      const rollbackPresentedCard = isFreshRollbackCardPreservable
        ? freshRollbackCard
        : resolveCanonicalPresentedCard(rollbackCanonicalReviewQueue, null);
      const rollbackActiveReviewQueue = buildDisplayedReviewQueue(rollbackCanonicalReviewQueue, rollbackPresentedCard);
      const rollbackQueueCards = buildDisplayedReviewTimeline(
        removeCardFromReviewQueue(queueCardsRef.current, submissionContext.cardId),
        rollbackActiveReviewQueue,
      );

      setCanonicalReviewQueueState(rollbackCanonicalReviewQueue);
      setPresentedCardState(rollbackPresentedCard);
      setQueueCardsState(rollbackQueueCards);
      setCurrentReviewSessionSignature(rollbackActiveReviewQueue, rollbackQueueCards);
      setErrorMessage(buildSubmitFailureMessage(originalSubmitErrorMessage, rollbackLookupErrorMessage));
      return "failed";
    }

    if (
      isReviewSubmissionContextCurrent(
        submissionContext,
        activeWorkspaceIdRef.current,
        selectedReviewFilterKeyRef.current,
        reviewSessionGenerationRef.current,
        resolvedReviewFilterRef.current,
        deckSummariesRef.current,
      ) === false
    ) {
      pendingReviewSnapshotsRef.current = removePendingReviewSnapshot(
        pendingReviewSnapshotsRef.current,
        submissionContext.cardId,
      );
      return "stale";
    }

    const pendingReviewSnapshotsBeforeClear = pendingReviewSnapshotsRef.current;
    pendingReviewSnapshotsRef.current = removePendingReviewSnapshot(pendingReviewSnapshotsRef.current, submissionContext.cardId);
    const nextCanonicalReviewQueue = removeCardFromReviewQueue(canonicalReviewQueueRef.current, submissionContext.cardId);
    const nextPresentedCard = presentedCardRef.current?.cardId === submissionContext.cardId
      ? resolveCanonicalPresentedCard(nextCanonicalReviewQueue, null)
      : presentedCardRef.current;
    const nextActiveReviewQueue = buildDisplayedReviewQueue(nextCanonicalReviewQueue, nextPresentedCard);
    const nextQueueCards = buildDisplayedReviewTimeline(
      removeCardFromReviewQueue(queueCardsRef.current, submissionContext.cardId),
      nextActiveReviewQueue,
    );

    setCanonicalReviewQueueState(nextCanonicalReviewQueue);
    setPresentedCardState(nextPresentedCard);
    setQueueCardsState(nextQueueCards);
    setCurrentReviewSessionSignature(nextActiveReviewQueue, nextQueueCards);
    setReviewCounts((currentCounts) => ({
      dueCount: Math.max(0, currentCounts.dueCount - 1),
      totalCount: currentCounts.totalCount,
    }));

    if (nextCanonicalReviewQueue.length <= 4 && reviewQueueCursorRef.current !== null) {
      try {
        const currentWorkspaceId = activeWorkspaceIdRef.current;
        const requestedReviewQueueCursor = reviewQueueCursorRef.current;
        if (currentWorkspaceId === null) {
          throw new Error("Workspace is unavailable");
        }

        const excludedCardIds = buildReviewQueueChunkExcludedCardIds(
          nextCanonicalReviewQueue,
          nextPresentedCard,
          pendingReviewSnapshotsBeforeClear,
          new Set([submissionContext.cardId]),
        );
        const nextChunk = await loadReviewQueueChunk(
          currentWorkspaceId,
          resolvedReviewFilterRef.current,
          requestedReviewQueueCursor,
          8 - nextCanonicalReviewQueue.length,
          excludedCardIds,
        );
        if (
          isReviewSubmissionContextCurrent(
            submissionContext,
            activeWorkspaceIdRef.current,
            selectedReviewFilterKeyRef.current,
            reviewSessionGenerationRef.current,
            resolvedReviewFilterRef.current,
            deckSummariesRef.current,
          ) === false
        ) {
          return "stale";
        }

        const refreshedCanonicalReviewQueue = removeCardFromReviewQueue(
          canonicalReviewQueueRef.current,
          submissionContext.cardId,
        );
        const refreshedPresentedCard = presentedCardRef.current?.cardId === submissionContext.cardId
          ? resolveCanonicalPresentedCard(refreshedCanonicalReviewQueue, null)
          : presentedCardRef.current;
        const refreshedPendingReviewSnapshots = pendingReviewSnapshotsRef.current;
        const refreshedExcludedCardIds = buildReviewQueueChunkExcludedCardIds(
          refreshedCanonicalReviewQueue,
          refreshedPresentedCard,
          refreshedPendingReviewSnapshots,
          new Set([submissionContext.cardId]),
        );
        const remainingCapacity = Math.max(0, 8 - refreshedCanonicalReviewQueue.length);
        const eligibleChunkCards = nextChunk.cards.filter((chunkCard) => refreshedExcludedCardIds.has(chunkCard.cardId) === false);
        const chunkCards = eligibleChunkCards.slice(0, remainingCapacity);
        const nextReviewQueueCursor = chunkCards.length < eligibleChunkCards.length
          ? requestedReviewQueueCursor
          : nextChunk.nextCursor;
        const replenishedCanonicalReviewQueue = [...refreshedCanonicalReviewQueue, ...chunkCards];
        const replenishedActiveReviewQueue = buildDisplayedReviewQueue(replenishedCanonicalReviewQueue, refreshedPresentedCard);
        const replenishedQueueCards = buildDisplayedReviewTimeline(
          removeCardFromReviewQueue(queueCardsRef.current, submissionContext.cardId),
          replenishedActiveReviewQueue,
        );

        setCanonicalReviewQueueState(replenishedCanonicalReviewQueue);
        setPresentedCardState(refreshedPresentedCard);
        setReviewQueueCursorState(nextReviewQueueCursor);
        setQueueCardsState(replenishedQueueCards);
        setCurrentReviewSessionSignature(replenishedActiveReviewQueue, replenishedQueueCards);
      } catch (error) {
        if (
          isReviewSubmissionContextCurrent(
            submissionContext,
            activeWorkspaceIdRef.current,
            selectedReviewFilterKeyRef.current,
            reviewSessionGenerationRef.current,
            resolvedReviewFilterRef.current,
            deckSummariesRef.current,
          ) === false
        ) {
          return "stale";
        }

        setErrorMessage(buildChunkReplenishmentFailureMessage(toReviewErrorMessage(error)));
        return "saved";
      }
    }

    return "saved";
  }

  return {
    activeReviewQueue,
    deckSummaries,
    handleReview,
    hasLoadedReviewData,
    isInitialReviewLoad,
    isReviewLoading,
    queueCards,
    resolvedReviewFilter,
    reviewCounts,
    reviewLoadErrorMessage,
    reviewLoadingSnapshot,
    reviewTagSummaries,
    selectedReviewFilterTitle,
    tagSuggestions,
  };
}

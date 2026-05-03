import { useEffect, useRef, useState } from "react";
import {
  ALL_CARDS_REVIEW_FILTER,
  isCardDue,
  isReviewFilterEqual,
  matchesDeckFilterDefinition,
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

export type UseReviewScreenDataResult = Readonly<{
  activeReviewQueue: ReadonlyArray<Card>;
  deckSummaries: ReadonlyArray<DeckSummary>;
  handleReview: (card: Card, rating: 0 | 1 | 2 | 3) => Promise<boolean>;
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

  const canonicalPresentedCard = canonicalReviewQueue.find((card) => card.cardId === presentedCard.cardId);
  const displayedPresentedCard = canonicalPresentedCard ?? presentedCard;

  return [
    displayedPresentedCard,
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

  return card.tags.includes(resolvedReviewFilter.tag);
}

function isPreservablePresentedCard(
  card: Card,
  resolvedReviewFilter: ReviewFilter,
  deckSummaries: ReadonlyArray<DeckSummary>,
  nowTimestamp: number,
): boolean {
  return isCardDue(card, nowTimestamp) && matchesResolvedReviewFilterForPreservation(card, resolvedReviewFilter, deckSummaries);
}

function isMissingPresentedCardError(error: unknown, cardId: string): boolean {
  return error instanceof Error && error.message === `Card not found: ${cardId}`;
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
  const previousReviewFilterRef = useRef<ReviewFilter | null>(null);
  const presentedCardRef = useRef<Card | null>(null);
  const reviewLoadingSnapshot = activeWorkspaceId === null
    ? null
    : readReviewLoadingSnapshot(activeWorkspaceId, selectedReviewFilter);
  const isInitialReviewLoad = isReviewLoading && hasLoadedReviewData === false;
  const activeReviewQueue = buildDisplayedReviewQueue(canonicalReviewQueue, presentedCard);

  useEffect(() => {
    presentedCardRef.current = presentedCard;
  }, [presentedCard]);

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

        const nextResolvedReviewFilter = reviewQueueSnapshot.resolvedReviewFilter;
        const nextSelectedReviewFilterTitle = resolveReviewFilterTitle(
          nextResolvedReviewFilter,
          decksSnapshot.deckSummaries,
          t("filters.allCards"),
          (effortLevel) => formatEffortLevelLabel(t, effortLevel),
        );
        const nextPresentedCard = await resolvePresentedCard(
          reviewQueueSnapshot.cards,
          shouldShowBlockingLoader ? null : presentedCardRef.current,
          nextResolvedReviewFilter,
          decksSnapshot.deckSummaries,
          getCardById,
        );
        if (isCancelled) {
          return;
        }
        const nextActiveReviewQueue = buildDisplayedReviewQueue(reviewQueueSnapshot.cards, nextPresentedCard);

        setResolvedReviewFilter(nextResolvedReviewFilter);
        setSelectedReviewFilterTitle(nextSelectedReviewFilterTitle);
        setCanonicalReviewQueue(reviewQueueSnapshot.cards);
        setPresentedCard(nextPresentedCard);
        setReviewCounts(reviewQueueSnapshot.reviewCounts);
        setReviewQueueCursor(reviewQueueSnapshot.nextCursor);
        setQueueCards(buildDisplayedReviewTimeline(reviewTimelinePage.cards, nextActiveReviewQueue));
        setReviewTagSummaries(tagsSummary.tags);
        setTagSuggestions(toTagSuggestions(tagsSummary.tags));
        setDeckSummaries(decksSnapshot.deckSummaries);
        writeReviewLoadingSnapshot({
          version: 1,
          workspaceId: activeWorkspaceId,
          selectedReviewFilterKey: serializeReviewFilterKey(selectedReviewFilter),
          resolvedReviewFilterTitle: nextSelectedReviewFilterTitle,
          reviewCounts: reviewQueueSnapshot.reviewCounts,
          currentCard: nextActiveReviewQueue[0] === undefined ? null : buildReviewLoadingCardPreview(nextActiveReviewQueue[0]),
          queuePreview: buildDisplayedReviewTimeline(reviewTimelinePage.cards, nextActiveReviewQueue)
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

  async function handleReview(card: Card, rating: 0 | 1 | 2 | 3): Promise<boolean> {
    setErrorMessage("");

    try {
      await submitReviewItem(card.cardId, rating);
      const nextCanonicalReviewQueue = canonicalReviewQueue.filter((queuedCard) => queuedCard.cardId !== card.cardId);
      const nextPresentedCard = resolveCanonicalPresentedCard(nextCanonicalReviewQueue, null);
      const nextActiveReviewQueue = buildDisplayedReviewQueue(nextCanonicalReviewQueue, nextPresentedCard);

      setCanonicalReviewQueue(nextCanonicalReviewQueue);
      setPresentedCard(nextPresentedCard);
      setQueueCards((currentCards) => buildDisplayedReviewTimeline(
        currentCards.filter((queuedCard) => queuedCard.cardId !== card.cardId),
        nextActiveReviewQueue,
      ));
      setReviewCounts((currentCounts) => ({
        dueCount: Math.max(0, currentCounts.dueCount - 1),
        totalCount: Math.max(0, currentCounts.totalCount - 1),
      }));

      if (nextCanonicalReviewQueue.length <= 4 && reviewQueueCursor !== null) {
        if (activeWorkspaceId === null) {
          throw new Error("Workspace is unavailable");
        }

        const nextChunk = await loadReviewQueueChunk(
          activeWorkspaceId,
          resolvedReviewFilter,
          reviewQueueCursor,
          8 - nextCanonicalReviewQueue.length,
          new Set(nextCanonicalReviewQueue.map((queuedCard) => queuedCard.cardId)),
        );
        const replenishedCanonicalReviewQueue = [...nextCanonicalReviewQueue, ...nextChunk.cards];
        setCanonicalReviewQueue(replenishedCanonicalReviewQueue);
        setReviewQueueCursor(nextChunk.nextCursor);
      }

      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
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

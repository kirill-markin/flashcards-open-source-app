import { useEffect, useRef, useState } from "react";
import { ALL_CARDS_REVIEW_FILTER, formatEffortLevelTitle, isReviewFilterEqual } from "../appData/domain";
import { loadDecksListSnapshot } from "../localDb/decks";
import {
  loadReviewQueueChunk,
  loadReviewQueueSnapshot,
  loadReviewTimelinePage,
} from "../localDb/reviews";
import { loadWorkspaceTagsSummary } from "../localDb/workspace";
import type {
  Card,
  DeckSummary,
  ReviewCounts,
  ReviewFilter,
  TagSuggestion,
  WorkspaceTagSummary,
} from "../types";
import {
  buildReviewLoadingCardPreview,
  readReviewLoadingSnapshot,
  serializeReviewFilterKey,
  type ReviewLoadingSnapshot,
  writeReviewLoadingSnapshot,
} from "./loadingSnapshots";

type UseReviewScreenDataParams = Readonly<{
  activeWorkspaceId: string | null;
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
): string {
  if (reviewFilter.kind === "allCards") {
    return "All cards";
  }

  if (reviewFilter.kind === "effort") {
    return formatEffortLevelTitle(reviewFilter.effortLevel);
  }

  if (reviewFilter.kind === "tag") {
    return reviewFilter.tag;
  }

  return deckSummaries.find((deck) => deck.deckId === reviewFilter.deckId)?.name ?? "All cards";
}

function buildDisplayedReviewQueue(
  canonicalReviewQueue: ReadonlyArray<Card>,
  presentedCardId: string | null,
): ReadonlyArray<Card> {
  if (presentedCardId === null) {
    return canonicalReviewQueue;
  }

  const presentedCard = canonicalReviewQueue.find((card) => card.cardId === presentedCardId);
  if (presentedCard === undefined) {
    return canonicalReviewQueue;
  }

  return [
    presentedCard,
    ...canonicalReviewQueue.filter((card) => card.cardId !== presentedCardId),
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

function resolvePresentedCardId(
  canonicalReviewQueue: ReadonlyArray<Card>,
  previousPresentedCardId: string | null,
): string | null {
  if (previousPresentedCardId !== null) {
    const previousPresentedCard = canonicalReviewQueue.find((card) => card.cardId === previousPresentedCardId);
    if (previousPresentedCard !== undefined) {
      return previousPresentedCard.cardId;
    }
  }

  return canonicalReviewQueue[0]?.cardId ?? null;
}

export function useReviewScreenData(params: UseReviewScreenDataParams): UseReviewScreenDataResult {
  const {
    activeWorkspaceId,
    localReadVersion,
    selectedReviewFilter,
    setErrorMessage,
    submitReviewItem,
  } = params;
  const [canonicalReviewQueue, setCanonicalReviewQueue] = useState<ReadonlyArray<Card>>([]);
  const [queueCards, setQueueCards] = useState<ReadonlyArray<Card>>([]);
  const [reviewCounts, setReviewCounts] = useState<ReviewCounts>(createEmptyReviewCounts);
  const [reviewQueueCursor, setReviewQueueCursor] = useState<string | null>(null);
  const [reviewTagSummaries, setReviewTagSummaries] = useState<ReadonlyArray<WorkspaceTagSummary>>([]);
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [deckSummaries, setDeckSummaries] = useState<ReadonlyArray<DeckSummary>>([]);
  const [resolvedReviewFilter, setResolvedReviewFilter] = useState<ReviewFilter>(ALL_CARDS_REVIEW_FILTER);
  const [selectedReviewFilterTitle, setSelectedReviewFilterTitle] = useState<string>("All cards");
  const [isReviewLoading, setIsReviewLoading] = useState<boolean>(true);
  const [reviewLoadErrorMessage, setReviewLoadErrorMessage] = useState<string>("");
  const [hasLoadedReviewData, setHasLoadedReviewData] = useState<boolean>(false);
  const [presentedCardId, setPresentedCardId] = useState<string | null>(null);
  const previousReviewFilterRef = useRef<ReviewFilter | null>(null);
  const presentedCardIdRef = useRef<string | null>(null);
  const reviewLoadingSnapshot = activeWorkspaceId === null
    ? null
    : readReviewLoadingSnapshot(activeWorkspaceId, selectedReviewFilter);
  const isInitialReviewLoad = isReviewLoading && hasLoadedReviewData === false;
  const activeReviewQueue = buildDisplayedReviewQueue(canonicalReviewQueue, presentedCardId);

  useEffect(() => {
    presentedCardIdRef.current = presentedCardId;
  }, [presentedCardId]);

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
        );
        const nextPresentedCardId = shouldShowBlockingLoader
          ? resolvePresentedCardId(reviewQueueSnapshot.cards, null)
          : resolvePresentedCardId(reviewQueueSnapshot.cards, presentedCardIdRef.current);
        const nextActiveReviewQueue = buildDisplayedReviewQueue(reviewQueueSnapshot.cards, nextPresentedCardId);

        setResolvedReviewFilter(nextResolvedReviewFilter);
        setSelectedReviewFilterTitle(nextSelectedReviewFilterTitle);
        setCanonicalReviewQueue(reviewQueueSnapshot.cards);
        setPresentedCardId(nextPresentedCardId);
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
  }, [activeWorkspaceId, localReadVersion, selectedReviewFilter]);

  async function handleReview(card: Card, rating: 0 | 1 | 2 | 3): Promise<boolean> {
    setErrorMessage("");

    try {
      await submitReviewItem(card.cardId, rating);
      const nextCanonicalReviewQueue = canonicalReviewQueue.filter((queuedCard) => queuedCard.cardId !== card.cardId);
      const nextPresentedCardId = resolvePresentedCardId(nextCanonicalReviewQueue, null);
      const nextActiveReviewQueue = buildDisplayedReviewQueue(nextCanonicalReviewQueue, nextPresentedCardId);

      setCanonicalReviewQueue(nextCanonicalReviewQueue);
      setPresentedCardId(nextPresentedCardId);
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

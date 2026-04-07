import { useEffect, useRef, useState } from "react";
import { ALL_CARDS_REVIEW_FILTER, isReviewFilterEqual } from "../appData/domain";
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

  if (reviewFilter.kind === "tag") {
    return reviewFilter.tag;
  }

  return deckSummaries.find((deck) => deck.deckId === reviewFilter.deckId)?.name ?? "All cards";
}

export function useReviewScreenData(params: UseReviewScreenDataParams): UseReviewScreenDataResult {
  const {
    activeWorkspaceId,
    localReadVersion,
    selectedReviewFilter,
    setErrorMessage,
    submitReviewItem,
  } = params;
  const [activeReviewQueue, setActiveReviewQueue] = useState<ReadonlyArray<Card>>([]);
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
  const previousReviewFilterRef = useRef<ReviewFilter | null>(null);
  const reviewLoadingSnapshot = activeWorkspaceId === null
    ? null
    : readReviewLoadingSnapshot(activeWorkspaceId, selectedReviewFilter);
  const isInitialReviewLoad = isReviewLoading && hasLoadedReviewData === false;

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

        setResolvedReviewFilter(nextResolvedReviewFilter);
        setSelectedReviewFilterTitle(nextSelectedReviewFilterTitle);
        setActiveReviewQueue(reviewQueueSnapshot.cards);
        setReviewCounts(reviewQueueSnapshot.reviewCounts);
        setReviewQueueCursor(reviewQueueSnapshot.nextCursor);
        setQueueCards(reviewTimelinePage.cards);
        setReviewTagSummaries(tagsSummary.tags);
        setTagSuggestions(toTagSuggestions(tagsSummary.tags));
        setDeckSummaries(decksSnapshot.deckSummaries);
        writeReviewLoadingSnapshot({
          version: 1,
          workspaceId: activeWorkspaceId,
          selectedReviewFilterKey: serializeReviewFilterKey(selectedReviewFilter),
          resolvedReviewFilterTitle: nextSelectedReviewFilterTitle,
          reviewCounts: reviewQueueSnapshot.reviewCounts,
          currentCard: reviewQueueSnapshot.cards[0] === undefined ? null : buildReviewLoadingCardPreview(reviewQueueSnapshot.cards[0]),
          queuePreview: reviewTimelinePage.cards.slice(0, 6).map((card) => buildReviewLoadingCardPreview(card)),
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
      const nextReviewQueue = activeReviewQueue.filter((queuedCard) => queuedCard.cardId !== card.cardId);
      setActiveReviewQueue(nextReviewQueue);
      setQueueCards((currentCards) => currentCards.filter((queuedCard) => queuedCard.cardId !== card.cardId));
      setReviewCounts((currentCounts) => ({
        dueCount: Math.max(0, currentCounts.dueCount - 1),
        totalCount: Math.max(0, currentCounts.totalCount - 1),
      }));

      if (nextReviewQueue.length <= 4 && reviewQueueCursor !== null) {
        if (activeWorkspaceId === null) {
          throw new Error("Workspace is unavailable");
        }

        const nextChunk = await loadReviewQueueChunk(
          activeWorkspaceId,
          resolvedReviewFilter,
          reviewQueueCursor,
          8 - nextReviewQueue.length,
          new Set(nextReviewQueue.map((queuedCard) => queuedCard.cardId)),
        );
        setActiveReviewQueue([...nextReviewQueue, ...nextChunk.cards]);
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

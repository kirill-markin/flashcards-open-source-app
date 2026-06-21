import { useEffect, useRef, useState } from "react";
import {
  ALL_CARDS_REVIEW_FILTER,
  isReviewFilterEqual,
} from "../../../appData/domain";
import { useAppErrorDialog } from "../../../appError/AppErrorContext";
import { useI18n } from "../../../i18n";
import { loadDecksListSnapshot } from "../../../localDb/cards/decks";
import {
  loadReviewQueueChunk,
  loadReviewQueueSnapshot,
  loadReviewTimelinePage,
} from "../../../localDb/reviews/reviews";
import { hasHydratedHotState, loadWorkspaceTagsSummary } from "../../../localDb/cards/workspace";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import type {
  Card,
  DeckSummary,
  ReviewCounts,
  ReviewFilter,
  TagSuggestion,
  WorkspaceTagSummary,
} from "../../../types";
import {
  buildReviewLoadingCardPreview,
  readReviewLoadingSnapshot,
  serializeReviewFilterKey,
  type ReviewLoadingSnapshot,
  writeReviewLoadingSnapshot,
} from "../../shared/loadingSnapshots";
import { getExpectedCardMutationInlineErrorMessage } from "../../cards/cardMutationErrors";
import {
  addPendingReviewSnapshot,
  buildDisplayedReviewQueue,
  buildDisplayedReviewTimeline,
  buildReviewQueueChunkExcludedCardIds,
  buildReviewSessionSignature,
  createEmptyReviewCounts,
  filterExcludedReviewCards,
  filterPendingReviewCards,
  isPreservablePresentedCard,
  isReviewSessionSignatureCompatible,
  isReviewSessionSignatureEqual,
  isReviewSubmissionContextCurrent,
  loadPresentedCardForPreservation,
  removeCardFromReviewQueue,
  removePendingReviewSnapshot,
  resolveCanonicalPresentedCard,
  resolveFilteredPresentedCard,
  resolvePresentedCard,
  resolveReviewFilterTitle,
  toTagSuggestions,
  type PendingReviewSnapshot,
  type ReviewSessionSignature,
  type ReviewSubmissionContext,
} from "./reviewScreenDataState";

type UseReviewScreenDataParams = Readonly<{
  activeWorkspaceId: string | null;
  appErrorMessage: string;
  getCardById: (cardId: string) => Promise<Card>;
  installationId: string | null;
  isSyncing: boolean;
  localReadVersion: number;
  selectedReviewFilter: ReviewFilter;
  setErrorMessage: (message: string) => void;
  submitReviewItem: (cardId: string, rating: 0 | 1 | 2 | 3) => Promise<Card>;
  userId: string | null;
}>;

type LocalHotStateStatus = "loading" | "hydrated" | "unhydrated";

export type ReviewSubmissionOutcome = "saved" | "failed" | "stale";

const workspaceUnavailableErrorMessage = "Workspace is unavailable";

function isWorkspaceUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message === workspaceUnavailableErrorMessage;
}

export type UseReviewScreenDataResult = Readonly<{
  activeReviewQueue: ReadonlyArray<Card>;
  deckSummaries: ReadonlyArray<DeckSummary>;
  handleReview: (card: Card, rating: 0 | 1 | 2 | 3) => Promise<ReviewSubmissionOutcome>;
  hasLoadedReviewData: boolean;
  isInitialReviewLoad: boolean;
  isReviewLoading: boolean;
  localWorkspaceCardCount: number;
  queueCards: ReadonlyArray<Card>;
  resolvedReviewFilter: ReviewFilter;
  reviewCounts: ReviewCounts;
  reviewLoadErrorMessage: string;
  reviewLoadingSnapshot: ReviewLoadingSnapshot | null;
  reviewTagSummaries: ReadonlyArray<WorkspaceTagSummary>;
  selectedReviewFilterTitle: string;
  tagSuggestions: ReadonlyArray<TagSuggestion>;
}>;

export function useReviewScreenData(params: UseReviewScreenDataParams): UseReviewScreenDataResult {
  const {
    activeWorkspaceId,
    appErrorMessage,
    getCardById,
    installationId,
    isSyncing,
    localReadVersion,
    selectedReviewFilter,
    setErrorMessage,
    submitReviewItem,
    userId,
  } = params;
  const { t } = useI18n();
  const { showCapturedTechnicalError } = useAppErrorDialog();
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
  const [localHotStateStatus, setLocalHotStateStatus] = useState<LocalHotStateStatus>("loading");
  const [localWorkspaceCardCount, setLocalWorkspaceCardCount] = useState<number>(0);
  const [reviewLoadErrorMessage, setReviewLoadErrorMessage] = useState<string>("");
  const [hasLoadedReviewData, setHasLoadedReviewData] = useState<boolean>(false);
  const [presentedCard, setPresentedCard] = useState<Card | null>(null);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const loadedWorkspaceIdRef = useRef<string | null>(null);
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
  const observationIdentityRef = useRef<Readonly<{
    userId: string | null;
    installationId: string | null;
  }>>({
    userId: null,
    installationId: null,
  });
  const reviewLoadingSnapshot = activeWorkspaceId === null
    ? null
    : readReviewLoadingSnapshot(activeWorkspaceId, selectedReviewFilter);
  const hasColdEmptyLocalHotState = localHotStateStatus !== "hydrated" && localWorkspaceCardCount === 0;
  const hasColdEmptyRestoreFailure = hasColdEmptyLocalHotState && isSyncing === false && appErrorMessage !== "";
  const visibleHasLoadedReviewData = hasColdEmptyRestoreFailure ? false : hasLoadedReviewData;
  const visibleReviewLoadErrorMessage = reviewLoadErrorMessage !== ""
    ? reviewLoadErrorMessage
    : hasColdEmptyRestoreFailure
      ? t("appError.technicalError.message")
      : "";
  const isLocalEmptyHotStateRestoring = hasColdEmptyLocalHotState && hasColdEmptyRestoreFailure === false;
  const isInitialReviewLoad = (isReviewLoading && visibleHasLoadedReviewData === false) || isLocalEmptyHotStateRestoring;
  const activeReviewQueue = buildDisplayedReviewQueue(canonicalReviewQueue, presentedCard);
  observationIdentityRef.current = {
    userId,
    installationId,
  };

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
      if (loadedWorkspaceIdRef.current !== activeWorkspaceId) {
        setLocalHotStateStatus("loading");
        setLocalWorkspaceCardCount(0);
      }
      setReviewLoadErrorMessage("");

      try {
        if (activeWorkspaceId === null) {
          throw new Error(workspaceUnavailableErrorMessage);
        }

        const [
          reviewQueueSnapshot,
          reviewTimelinePage,
          tagsSummary,
          decksSnapshot,
          isHotStateHydrated,
        ] = await Promise.all([
          loadReviewQueueSnapshot(activeWorkspaceId, selectedReviewFilter, 8),
          loadReviewTimelinePage(activeWorkspaceId, selectedReviewFilter, 200, 0),
          loadWorkspaceTagsSummary(activeWorkspaceId),
          loadDecksListSnapshot(activeWorkspaceId),
          hasHydratedHotState(activeWorkspaceId),
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
        setLocalWorkspaceCardCount(tagsSummary.totalCards);
        setLocalHotStateStatus(isHotStateHydrated ? "hydrated" : "unhydrated");
        loadedWorkspaceIdRef.current = activeWorkspaceId;
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

        if (isWorkspaceUnavailableError(error)) {
          setReviewLoadErrorMessage(workspaceUnavailableErrorMessage);
          return;
        }

        const observationIdentity = observationIdentityRef.current;
        captureAppOperationError(error, {
          feature: "review",
          operation: "review_data_load",
          userId: observationIdentity.userId,
          workspaceId: activeWorkspaceId,
          installationId: observationIdentity.installationId,
          entityId: null,
        });
        showCapturedTechnicalError(error);
        setReviewLoadErrorMessage(t("appError.technicalError.message"));
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
      const observationIdentity = observationIdentityRef.current;
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
      try {
        freshRollbackCard = await loadPresentedCardForPreservation(submissionContext.cardId, getCardById);
      } catch {
        // The submit failure owns the visible technical report; rollback lookup is only UI preservation.
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

      const expectedSubmitErrorMessage = getExpectedCardMutationInlineErrorMessage(
        error,
        t("reviewEditor.errors.cardNotFound"),
      );
      if (expectedSubmitErrorMessage === null) {
        captureAppOperationError(error, {
          feature: "review",
          operation: "review_submit",
          userId: observationIdentity.userId,
          workspaceId: submissionContext.workspaceId,
          installationId: observationIdentity.installationId,
          entityId: submissionContext.cardId,
        });
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
      if (expectedSubmitErrorMessage !== null) {
        setErrorMessage(expectedSubmitErrorMessage);
      } else {
        showCapturedTechnicalError(error);
        setErrorMessage(t("appError.technicalError.message"));
      }
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
          throw new Error(workspaceUnavailableErrorMessage);
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

        if (isWorkspaceUnavailableError(error)) {
          setErrorMessage(workspaceUnavailableErrorMessage);
          return "saved";
        }

        const observationIdentity = observationIdentityRef.current;
        captureAppOperationError(error, {
          feature: "review",
          operation: "review_replenish",
          userId: observationIdentity.userId,
          workspaceId: submissionContext.workspaceId,
          installationId: observationIdentity.installationId,
          entityId: submissionContext.cardId,
        });
        showCapturedTechnicalError(error);
        setErrorMessage(t("appError.technicalError.message"));
        return "saved";
      }
    }

    return "saved";
  }

  return {
    activeReviewQueue,
    deckSummaries,
    handleReview,
    hasLoadedReviewData: visibleHasLoadedReviewData,
    isInitialReviewLoad,
    isReviewLoading,
    localWorkspaceCardCount,
    queueCards,
    resolvedReviewFilter,
    reviewCounts,
    reviewLoadErrorMessage: visibleReviewLoadErrorMessage,
    reviewLoadingSnapshot,
    reviewTagSummaries,
    selectedReviewFilterTitle,
    tagSuggestions,
  };
}

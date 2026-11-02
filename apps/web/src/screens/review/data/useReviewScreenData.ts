import { useEffect, useRef, useState } from "react";
import { toAnalyticsReviewAnswerFailureReason, track } from "../../../analytics";
import { BrowserGuestSessionInvalidatedError } from "../../../api/transport/transport";
import { ALL_CARDS_REVIEW_FILTER } from "../../../appData/domain";
import {
  delayUntilNextDueMillis,
  dueCountAfterLocalReview,
  reviewCountsRepairDelay,
} from "../../../appData/review/localReviewSchedule";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
  useAppErrorDialog,
} from "../../../appError/AppErrorContext";
import { useI18n } from "../../../i18n";
import { loadDecksListSnapshot } from "../../../localDb/cards/decks";
import {
  loadReviewQueueChunk,
  loadReviewQueueSnapshot,
  loadReviewTimelinePage,
} from "../../../localDb/reviews/reviews";
import { hasHydratedHotState, loadWorkspaceTagsSummary } from "../../../localDb/cards/workspace";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import {
  finishReviewAfterRatingWorkSpan,
  startReviewAfterRatingWorkSpan,
  type ReviewTimingSpan,
} from "../../../observability/reviewTimingSpans";
import {
  collectReviewImageMediaAssetIds,
  prepareReviewImages,
  releasePreparedImagesExcept,
} from "../components/card/managedMedia/reviewPreparedImages";
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
  collectCardsRatedAfter,
  createEmptyReviewCounts,
  filterExcludedReviewCards,
  filterPendingReviewCards,
  findNextReviewDueAtMillis,
  insertReviewedCardIntoTimeline,
  isPreservablePresentedCard,
  isReviewSessionSignatureCompatible,
  isReviewSessionSignatureEqual,
  isReviewSubmissionContextCurrent,
  keepPreparedNextCard,
  loadPresentedCardForPreservation,
  loadReviewCardIfStillInReview,
  removeCardFromReviewQueue,
  removePendingReviewSnapshot,
  resolveCanonicalPresentedCard,
  resolveFilteredPresentedCard,
  resolveReviewDataRebuildReason,
  resolveReviewFilterTitle,
  reviewLongAbsenceThreshold,
  reviewSafetyRebuildInterval,
  selectPreparedNextCard,
  startsNewReviewSession,
  toTagSuggestions,
  type LocallyRatedCard,
  type PendingReviewSnapshot,
  type ReviewDataRebuildReason,
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
  selectReviewFilter: (reviewFilter: ReviewFilter) => void;
  selectedReviewFilter: ReviewFilter;
  setErrorMessage: (message: string) => void;
  submitReviewItem: (cardId: string, rating: 0 | 1 | 2 | 3) => Promise<Card>;
  userId: string | null;
}>;

type LocalHotStateStatus = "loading" | "hydrated" | "unhydrated";

type ReviewDataRebuildRequest = Readonly<{
  reason: ReviewDataRebuildReason;
  sequence: number;
}>;

type NextDueRefresh = Readonly<{
  dueAtMillis: number;
}>;

type CarriedReviewDataContext = Readonly<{
  contextKey: string;
  localReadVersion: number;
  rebuildSequence: number;
}>;

export type ReviewSubmissionOutcome = "saved" | "failed" | "stale" | "cancelled";

type PendingReviewAfterRatingWork = Readonly<{
  span: ReviewTimingSpan;
  fullRebuildCount: number;
}>;

const workspaceUnavailableErrorMessage = "Workspace is unavailable";

async function waitForRecoveryGuardedReviewPhase<ResultType>(
  phase: Promise<ResultType>,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<ResultType> {
  try {
    const result = await phase;
    indexedDbOpenRecoveryState.throwIfFailed();
    return result;
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    indexedDbOpenRecoveryState.markFailed(error);
    indexedDbOpenRecoveryState.throwIfFailed();
    throw error;
  }
}

function isWorkspaceUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message === workspaceUnavailableErrorMessage;
}

function buildReviewDataContextKey(workspaceId: string | null, reviewFilterKey: string): string {
  return JSON.stringify([workspaceId, reviewFilterKey]);
}

function toLocalDateKey(timestamp: number): string {
  return new Date(timestamp).toDateString();
}

// A new object re-arms the timer even for an unchanged due time, such as after a clamped timeout.
function nextDueRefreshFrom(reviewTimeline: ReadonlyArray<Card>, fromTimestamp: number): NextDueRefresh | null {
  const dueAtMillis = findNextReviewDueAtMillis(reviewTimeline, fromTimestamp);
  return dueAtMillis === null ? null : { dueAtMillis };
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
    selectReviewFilter,
    selectedReviewFilter,
    setErrorMessage,
    submitReviewItem,
    userId,
  } = params;
  const { formatCount, messages, t } = useI18n();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const [canonicalReviewQueue, setCanonicalReviewQueue] = useState<ReadonlyArray<Card>>([]);
  const [queueCards, setQueueCards] = useState<ReadonlyArray<Card>>([]);
  const [reviewCounts, setReviewCounts] = useState<ReviewCounts>(createEmptyReviewCounts);
  const [reviewQueueCursor, setReviewQueueCursor] = useState<string | null>(null);
  const [reviewTagSummaries, setReviewTagSummaries] = useState<ReadonlyArray<WorkspaceTagSummary>>([]);
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [deckSummaries, setDeckSummaries] = useState<ReadonlyArray<DeckSummary>>([]);
  const [resolvedReviewFilter, setResolvedReviewFilter] = useState<ReviewFilter>(ALL_CARDS_REVIEW_FILTER);
  const [selectedReviewFilterTitle, setSelectedReviewFilterTitle] = useState<string>(t("filters.allCards"));
  const [localHotStateStatus, setLocalHotStateStatus] = useState<LocalHotStateStatus>("loading");
  const [localWorkspaceCardCount, setLocalWorkspaceCardCount] = useState<number>(0);
  const [reviewLoadErrorMessage, setReviewLoadErrorMessage] = useState<string>("");
  const [hasLoadedReviewData, setHasLoadedReviewData] = useState<boolean>(false);
  const [loadedReviewDataContextKey, setLoadedReviewDataContextKey] = useState<string | null>(null);
  const [presentedCard, setPresentedCard] = useState<Card | null>(null);
  const [nextDueRefresh, setNextDueRefresh] = useState<NextDueRefresh | null>(null);
  const [reviewDataRebuildRequest, setReviewDataRebuildRequest] = useState<ReviewDataRebuildRequest>({
    reason: "initialLoad",
    sequence: 0,
  });
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const loadedWorkspaceIdRef = useRef<string | null>(null);
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
  const selectedReviewFilterRef = useRef<ReviewFilter>(selectedReviewFilter);
  const getCardByIdRef = useRef<(cardId: string) => Promise<Card>>(getCardById);
  const selectReviewFilterRef = useRef<(reviewFilter: ReviewFilter) => void>(selectReviewFilter);
  const reviewDataContextKey = buildReviewDataContextKey(activeWorkspaceId, selectedReviewFilterKey);
  const reviewDataContextKeyRef = useRef<string>(reviewDataContextKey);
  const loadedReviewDataContextKeyRef = useRef<string | null>(null);
  const carriedReviewDataContextRef = useRef<CarriedReviewDataContext | null>(null);
  const afterRatingWorkRef = useRef<PendingReviewAfterRatingWork | null>(null);
  const observedLocalReadVersionRef = useRef<number>(localReadVersion);
  const reviewDataLoadGenerationRef = useRef<number>(0);
  const ratingSequenceRef = useRef<number>(0);
  const locallyRatedCardsRef = useRef<ReadonlyMap<string, LocallyRatedCard>>(new Map());
  const isCountsRefreshAfterRatingsNeededRef = useRef<boolean>(false);
  const countsRepairTimeoutIdRef = useRef<number | null>(null);
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
  const isCurrentReviewDataContextLoaded = loadedReviewDataContextKey === reviewDataContextKey;
  const isCurrentWorkspaceLoaded = loadedWorkspaceIdRef.current === activeWorkspaceId;
  const isExplicitEmptyTagsFilter = selectedReviewFilter.kind === "tags" && selectedReviewFilter.tags.length === 0;
  const visibleLocalWorkspaceCardCount = isCurrentWorkspaceLoaded ? localWorkspaceCardCount : 0;
  const hasColdEmptyLocalHotState = localHotStateStatus !== "hydrated" && visibleLocalWorkspaceCardCount === 0;
  const hasColdEmptyRestoreFailure = hasColdEmptyLocalHotState && isSyncing === false && appErrorMessage !== "";
  const visibleHasLoadedReviewData = hasColdEmptyRestoreFailure
    ? false
    : isCurrentReviewDataContextLoaded
      ? hasLoadedReviewData
      : isExplicitEmptyTagsFilter;
  const visibleReviewLoadErrorMessage = reviewLoadErrorMessage !== ""
    ? reviewLoadErrorMessage
    : hasColdEmptyRestoreFailure
      ? t("appError.technicalError.message")
      : "";
  const isLocalEmptyHotStateRestoring = hasColdEmptyLocalHotState && hasColdEmptyRestoreFailure === false;
  const isInitialReviewLoad = isExplicitEmptyTagsFilter
    ? false
    : isCurrentReviewDataContextLoaded === false
      || isLocalEmptyHotStateRestoring;
  const activeReviewQueue = isCurrentReviewDataContextLoaded
    ? buildDisplayedReviewQueue(canonicalReviewQueue, presentedCard)
    : [];
  const visibleDeckSummaries = isCurrentWorkspaceLoaded ? deckSummaries : [];
  const visibleSelectedReviewFilterTitle = isCurrentReviewDataContextLoaded
    ? selectedReviewFilterTitle
    : resolveReviewFilterTitle(
      selectedReviewFilter,
      visibleDeckSummaries,
      t("filters.allCards"),
      t("reviewFilterMenu.noTags"),
      formatCount(
        selectedReviewFilter.kind === "tags" ? selectedReviewFilter.tags.length : 0,
        messages.common.countLabels.tag,
      ),
    );
  const preparedImagesCurrentCard = activeReviewQueue[0] ?? null;
  const preparedImagesNextCard = activeReviewQueue[1] ?? null;
  const preparedImagesCurrentFrontText = preparedImagesCurrentCard?.frontText ?? "";
  const preparedImagesCurrentBackText = preparedImagesCurrentCard?.backText ?? "";
  const preparedImagesNextFrontText = preparedImagesNextCard?.frontText ?? "";
  const preparedImagesNextBackText = preparedImagesNextCard?.backText ?? "";
  activeWorkspaceIdRef.current = activeWorkspaceId;
  selectedReviewFilterKeyRef.current = selectedReviewFilterKey;
  selectedReviewFilterRef.current = selectedReviewFilter;
  getCardByIdRef.current = getCardById;
  selectReviewFilterRef.current = selectReviewFilter;
  reviewDataContextKeyRef.current = reviewDataContextKey;
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

  // The only entry point for a full rebuild besides a workspace, filter or local card change:
  // docs/fsrs-scheduling-logic.md#non-blocking-review
  function rebuildReviewData(reason: ReviewDataRebuildReason): void {
    setReviewDataRebuildRequest((currentRequest) => ({
      reason,
      sequence: currentRequest.sequence + 1,
    }));
  }

  // Updates only the rated card, the queue, the counts and the next due time in memory; a rating never
  // rescans the workspace: docs/fsrs-scheduling-logic.md#non-blocking-review
  function applyRatedCardLocally(reviewedCard: Card): Readonly<{
    canonicalReviewQueue: ReadonlyArray<Card>;
    presentedCard: Card | null;
  }> {
    const nowTimestamp = Date.now();
    const nextCanonicalReviewQueue = removeCardFromReviewQueue(canonicalReviewQueueRef.current, reviewedCard.cardId);
    const nextPresentedCard = presentedCardRef.current?.cardId === reviewedCard.cardId
      ? resolveCanonicalPresentedCard(nextCanonicalReviewQueue, null)
      : presentedCardRef.current;
    const nextActiveReviewQueue = buildDisplayedReviewQueue(nextCanonicalReviewQueue, nextPresentedCard);
    const nextQueueCards = buildDisplayedReviewTimeline(
      insertReviewedCardIntoTimeline(queueCardsRef.current, reviewedCard, nowTimestamp),
      nextActiveReviewQueue,
    );

    setCanonicalReviewQueueState(nextCanonicalReviewQueue);
    setPresentedCardState(nextPresentedCard);
    setQueueCardsState(nextQueueCards);
    setCurrentReviewSessionSignature(nextActiveReviewQueue, nextQueueCards);
    setReviewCounts((currentCounts) => ({
      dueCount: dueCountAfterLocalReview(currentCounts.dueCount),
      totalCount: currentCounts.totalCount,
    }));
    // A timer still pending for a card that is already due must keep running; the rated card cannot be due sooner.
    setNextDueRefresh((currentRefresh) => currentRefresh !== null && currentRefresh.dueAtMillis <= nowTimestamp
      ? currentRefresh
      : nextDueRefreshFrom(nextQueueCards, nowTimestamp));
    return {
      canonicalReviewQueue: nextCanonicalReviewQueue,
      presentedCard: nextPresentedCard,
    };
  }

  // Lets loads that read before this rating was written drop the card's stale due state.
  function recordLocallyRatedCard(reviewedCard: Card): void {
    ratingSequenceRef.current += 1;
    locallyRatedCardsRef.current = new Map([
      ...locallyRatedCardsRef.current,
      [reviewedCard.cardId, { ratingSequence: ratingSequenceRef.current, reviewedCard }],
    ]);
  }

  // One timer at the earliest due time after `fromTimestamp`; it refreshes only the bounded queue window and
  // the counts: docs/fsrs-scheduling-logic.md#non-blocking-review
  // A load passes its start time, so a card that fell due while it ran re-arms the timer at once.
  function scheduleNextDueRefresh(reviewTimeline: ReadonlyArray<Card>, fromTimestamp: number): void {
    setNextDueRefresh(nextDueRefreshFrom(reviewTimeline, fromTimestamp));
  }

  // Counts read while a rating was in flight or saved may miss or double-count it. Only an applied load
  // decides: one that overlapped no rating read fresh counts, so it also settles an earlier repair; a
  // dropped load leaves the need to the load that replaced it.
  function refreshCountsIfLoadOverlappedRating(ratingSequenceAtStart: number): void {
    isCountsRefreshAfterRatingsNeededRef.current = ratingSequenceRef.current !== ratingSequenceAtStart
      || pendingReviewSnapshotsRef.current.size > 0;
    restartCountsRepairTimer();
  }

  function clearCountsRepairTimer(): void {
    if (countsRepairTimeoutIdRef.current !== null) {
      window.clearTimeout(countsRepairTimeoutIdRef.current);
      countsRepairTimeoutIdRef.current = null;
    }
  }

  // One queue window refresh repairs the counts once ratings pause; each settled rating restarts the wait.
  function restartCountsRepairTimer(): void {
    clearCountsRepairTimer();
    if (isCountsRefreshAfterRatingsNeededRef.current === false) {
      return;
    }

    countsRepairTimeoutIdRef.current = window.setTimeout(() => {
      countsRepairTimeoutIdRef.current = null;
      // A rating still in flight restarts the wait when it settles.
      if (isCountsRefreshAfterRatingsNeededRef.current === false || pendingReviewSnapshotsRef.current.size > 0) {
        return;
      }

      void refreshReviewQueueWindow();
    }, reviewCountsRepairDelay);
  }

  // Refreshes only the bounded queue window and the counts when the next card falls due, keeping the
  // shown and prepared next cards: docs/fsrs-scheduling-logic.md#non-blocking-review
  async function refreshReviewQueueWindow(): Promise<void> {
    const workspaceId = activeWorkspaceIdRef.current;
    const contextKey = reviewDataContextKeyRef.current;
    if (
      workspaceId === null
      || loadedReviewDataContextKeyRef.current !== contextKey
      || indexedDbOpenRecoveryState.hasFailed()
    ) {
      return;
    }

    const loadGeneration = reviewDataLoadGenerationRef.current;
    const ratingSequenceAtStart = ratingSequenceRef.current;
    const refreshStartTimestamp = Date.now();
    const reviewFilter = resolvedReviewFilterRef.current;
    try {
      const [reviewQueueSnapshot, reviewTimelinePage] = await waitForRecoveryGuardedReviewPhase(Promise.all([
        waitForRecoveryGuardedReviewPhase(
          loadReviewQueueSnapshot(workspaceId, reviewFilter, 8),
          indexedDbOpenRecoveryState,
        ),
        waitForRecoveryGuardedReviewPhase(
          loadReviewTimelinePage(workspaceId, reviewFilter, 200, 0),
          indexedDbOpenRecoveryState,
        ),
      ]), indexedDbOpenRecoveryState);
      if (
        indexedDbOpenRecoveryState.hasFailed()
        || loadGeneration !== reviewDataLoadGenerationRef.current
        || contextKey !== reviewDataContextKeyRef.current
      ) {
        return;
      }

      const pendingReviewSnapshots = pendingReviewSnapshotsRef.current;
      const cardsRatedDuringRefresh = collectCardsRatedAfter(locallyRatedCardsRef.current, ratingSequenceAtStart);
      const ratedCardIds: ReadonlySet<string> = new Set(cardsRatedDuringRefresh.map((card) => card.cardId));
      const freshCanonicalReviewQueue = filterExcludedReviewCards(reviewQueueSnapshot.cards, pendingReviewSnapshots, ratedCardIds);
      const currentPresentedCard = presentedCardRef.current;
      const nextPresentedCard = resolveFilteredPresentedCard(
        freshCanonicalReviewQueue,
        currentPresentedCard,
        pendingReviewSnapshots,
        ratedCardIds,
      );
      // Only time passed since the last load, so a prepared card outside the fresh window is still due.
      const currentPreparedNextCard = selectPreparedNextCard(
        buildDisplayedReviewQueue(canonicalReviewQueueRef.current, currentPresentedCard),
      );
      const nextPreparedNextCard = currentPreparedNextCard === null
        || pendingReviewSnapshots.has(currentPreparedNextCard.cardId)
        || ratedCardIds.has(currentPreparedNextCard.cardId)
        ? null
        : freshCanonicalReviewQueue.find((card) => card.cardId === currentPreparedNextCard.cardId) ?? currentPreparedNextCard;
      const nextCanonicalReviewQueue = keepPreparedNextCard(freshCanonicalReviewQueue, nextPresentedCard, nextPreparedNextCard);
      const nextActiveReviewQueue = buildDisplayedReviewQueue(nextCanonicalReviewQueue, nextPresentedCard);
      const nextQueueCards = buildDisplayedReviewTimeline(
        cardsRatedDuringRefresh.reduce(
          (timeline, reviewedCard) => insertReviewedCardIntoTimeline(timeline, reviewedCard, Date.now()),
          filterExcludedReviewCards(reviewTimelinePage.cards, pendingReviewSnapshots, ratedCardIds),
        ),
        nextActiveReviewQueue,
      );

      setCanonicalReviewQueueState(nextCanonicalReviewQueue);
      setPresentedCardState(nextPresentedCard);
      setReviewQueueCursorState(reviewQueueSnapshot.nextCursor);
      setQueueCardsState(nextQueueCards);
      setCurrentReviewSessionSignature(nextActiveReviewQueue, nextQueueCards);
      setReviewCounts(reviewQueueSnapshot.reviewCounts);
      scheduleNextDueRefresh(nextQueueCards, refreshStartTimestamp);
      refreshCountsIfLoadOverlappedRating(ratingSequenceAtStart);
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (contextKey !== reviewDataContextKeyRef.current) {
        return;
      }

      const observationIdentity = observationIdentityRef.current;
      captureAppOperationError(error, {
        feature: "review",
        operation: "review_queue_refresh",
        userId: observationIdentity.userId,
        workspaceId,
        installationId: observationIdentity.installationId,
        entityId: null,
      });
      showCapturedTechnicalError(error);
      setErrorMessage(t("appError.technicalError.message"));
    }
  }

  useEffect(() => {
    if (nextDueRefresh === null) {
      return undefined;
    }

    const nextDueTimeoutId = window.setTimeout(() => {
      // Marks the timer as no longer pending; the refresh schedules the next one.
      setNextDueRefresh(null);
      void refreshReviewQueueWindow();
    }, delayUntilNextDueMillis(nextDueRefresh.dueAtMillis, Date.now()));
    return () => {
      window.clearTimeout(nextDueTimeoutId);
    };
    // Re-armed only when nextDueRefresh changes; the refresh reads everything else through refs.
  }, [nextDueRefresh]);

  useEffect(() => {
    let safetyIntervalId: number | null = null;
    let hiddenAtTimestamp: number | null = null;
    let observedDateKey = toLocalDateKey(Date.now());

    function rebuildForElapsedTime(reasonWithoutDateChange: ReviewDataRebuildReason): void {
      const dateKey = toLocalDateKey(Date.now());
      const reason = dateKey === observedDateKey ? reasonWithoutDateChange : "dateChanged";
      observedDateKey = dateKey;
      rebuildReviewData(reason);
    }

    function startSafetyInterval(): void {
      if (safetyIntervalId === null) {
        safetyIntervalId = window.setInterval(() => {
          rebuildForElapsedTime("safetyInterval");
        }, reviewSafetyRebuildInterval);
      }
    }

    function stopSafetyInterval(): void {
      if (safetyIntervalId !== null) {
        window.clearInterval(safetyIntervalId);
        safetyIntervalId = null;
      }
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState !== "visible") {
        hiddenAtTimestamp = hiddenAtTimestamp ?? Date.now();
        stopSafetyInterval();
        return;
      }

      startSafetyInterval();
      const hiddenDurationMs = hiddenAtTimestamp === null ? 0 : Date.now() - hiddenAtTimestamp;
      hiddenAtTimestamp = null;
      if (hiddenDurationMs >= reviewLongAbsenceThreshold) {
        rebuildForElapsedTime("returnedAfterLongAbsence");
      } else if (toLocalDateKey(Date.now()) !== observedDateKey) {
        rebuildForElapsedTime("dateChanged");
      }
    }

    if (document.visibilityState === "visible") {
      startSafetyInterval();
    } else {
      hiddenAtTimestamp = Date.now();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopSafetyInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // rebuildReviewData only calls a stable state setter.
  }, []);

  // Keeps the current and next card images decoded so a rating or reveal never waits for them:
  // docs/fsrs-scheduling-logic.md#non-blocking-review
  useEffect(() => {
    if (activeWorkspaceId === null) {
      releasePreparedImagesExcept(null, []);
      return undefined;
    }

    // The current front is already on screen and loads through its own card side.
    const preparedMediaAssetIds = collectReviewImageMediaAssetIds([
      preparedImagesCurrentBackText,
      preparedImagesNextFrontText,
      preparedImagesNextBackText,
    ]);
    releasePreparedImagesExcept(activeWorkspaceId, [
      ...collectReviewImageMediaAssetIds([preparedImagesCurrentFrontText]),
      ...preparedMediaAssetIds,
    ]);
    const abortController = new AbortController();
    void prepareReviewImages(
      activeWorkspaceId,
      preparedMediaAssetIds,
      indexedDbOpenRecoveryState,
      abortController.signal,
    );

    return () => {
      abortController.abort();
    };
  }, [
    activeWorkspaceId,
    indexedDbOpenRecoveryState,
    preparedImagesCurrentBackText,
    preparedImagesCurrentFrontText,
    preparedImagesNextBackText,
    preparedImagesNextFrontText,
  ]);

  useEffect(() => {
    return () => {
      releasePreparedImagesExcept(null, []);
      clearCountsRepairTimer();
    };
    // The cleanup reads the timer through a ref.
  }, []);

  useEffect(() => {
    const carriedReviewDataContext = carriedReviewDataContextRef.current;
    if (
      carriedReviewDataContext?.contextKey === reviewDataContextKey
      && carriedReviewDataContext.localReadVersion === localReadVersion
      && carriedReviewDataContext.rebuildSequence === reviewDataRebuildRequest.sequence
    ) {
      carriedReviewDataContextRef.current = null;
      // A repair that fired before the promoted filter became current bailed on the context check.
      restartCountsRepairTimer();
      return;
    }
    carriedReviewDataContextRef.current = null;

    let isCancelled = false;
    // Read through refs: a new callback or filter object identity alone is not a rebuild reason.
    const requestedReviewFilter = selectedReviewFilterRef.current;
    const loadCardById = getCardByIdRef.current;
    const promoteReviewFilter = selectReviewFilterRef.current;
    const rebuildReason = resolveReviewDataRebuildReason({
      loadedReviewDataContextKey: loadedReviewDataContextKeyRef.current,
      loadedWorkspaceId: loadedWorkspaceIdRef.current,
      reviewDataContextKey,
      activeWorkspaceId,
      hasLocalReadVersionChanged: observedLocalReadVersionRef.current !== localReadVersion,
      requestedReason: reviewDataRebuildRequest.reason,
    });
    observedLocalReadVersionRef.current = localReadVersion;
    const isNewReviewSession = startsNewReviewSession(rebuildReason);
    reviewDataLoadGenerationRef.current += 1;
    const ratingSequenceAtStart = ratingSequenceRef.current;
    const loadStartTimestamp = Date.now();

    async function loadReviewData(): Promise<void> {
      try {
        indexedDbOpenRecoveryState.throwIfFailed();
        if (loadedWorkspaceIdRef.current !== activeWorkspaceId) {
          setLocalHotStateStatus("loading");
          setLocalWorkspaceCardCount(0);
        }
        setReviewLoadErrorMessage("");

        if (activeWorkspaceId === null) {
          throw new Error(workspaceUnavailableErrorMessage);
        }

        const [
          reviewQueueSnapshot,
          reviewTimelinePage,
          tagsSummary,
          decksSnapshot,
          isHotStateHydrated,
        ] = await waitForRecoveryGuardedReviewPhase(Promise.all([
          waitForRecoveryGuardedReviewPhase(
            loadReviewQueueSnapshot(activeWorkspaceId, requestedReviewFilter, 8),
            indexedDbOpenRecoveryState,
          ),
          waitForRecoveryGuardedReviewPhase(
            loadReviewTimelinePage(activeWorkspaceId, requestedReviewFilter, 200, 0),
            indexedDbOpenRecoveryState,
          ),
          waitForRecoveryGuardedReviewPhase(
            loadWorkspaceTagsSummary(activeWorkspaceId),
            indexedDbOpenRecoveryState,
          ),
          waitForRecoveryGuardedReviewPhase(
            loadDecksListSnapshot(activeWorkspaceId),
            indexedDbOpenRecoveryState,
          ),
          waitForRecoveryGuardedReviewPhase(
            hasHydratedHotState(activeWorkspaceId),
            indexedDbOpenRecoveryState,
          ),
        ]), indexedDbOpenRecoveryState);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }
        if (isCancelled) {
          return;
        }

        const pendingReviewSnapshotsBeforePresentation = pendingReviewSnapshotsRef.current;
        const canonicalReviewQueueBeforePresentation = filterPendingReviewCards(
          reviewQueueSnapshot.cards,
          pendingReviewSnapshotsBeforePresentation,
        );
        const nextResolvedReviewFilter = reviewQueueSnapshot.resolvedReviewFilter;
        const shouldPromoteResolvedReviewFilter = requestedReviewFilter.kind === "tags"
          && requestedReviewFilter.tags.length > 0
          && nextResolvedReviewFilter.kind === "allCards";
        const loadedSelectedReviewFilter = shouldPromoteResolvedReviewFilter
          ? nextResolvedReviewFilter
          : requestedReviewFilter;
        const loadedSelectedReviewFilterKey = serializeReviewFilterKey(loadedSelectedReviewFilter);
        const loadedReviewDataContextKey = buildReviewDataContextKey(
          activeWorkspaceId,
          loadedSelectedReviewFilterKey,
        );
        const nextSelectedReviewFilterTitle = resolveReviewFilterTitle(
          nextResolvedReviewFilter,
          decksSnapshot.deckSummaries,
          t("filters.allCards"),
          t("reviewFilterMenu.noTags"),
          formatCount(
            nextResolvedReviewFilter.kind === "tags" ? nextResolvedReviewFilter.tags.length : 0,
            messages.common.countLabels.tag,
          ),
        );
        const previousPresentedCard = isNewReviewSession ? null : presentedCardRef.current;
        const previousPreparedNextCard = isNewReviewSession
          ? null
          : selectPreparedNextCard(buildDisplayedReviewQueue(canonicalReviewQueueRef.current, previousPresentedCard));
        const [stillReviewedPresentedCard, stillReviewedPreparedNextCard] = await waitForRecoveryGuardedReviewPhase(
          Promise.all([previousPresentedCard, previousPreparedNextCard].map((card) => loadReviewCardIfStillInReview(
            canonicalReviewQueueBeforePresentation,
            card,
            nextResolvedReviewFilter,
            decksSnapshot.deckSummaries,
            loadCardById,
          ))),
          indexedDbOpenRecoveryState,
        );
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }
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
        const cardsRatedDuringLoad = collectCardsRatedAfter(locallyRatedCardsRef.current, ratingSequenceAtStart);
        const excludedCardIds: ReadonlySet<string> = new Set([
          ...stalePresentedCardIds,
          ...cardsRatedDuringLoad.map((card) => card.cardId),
        ]);
        const freshCanonicalReviewQueue = filterExcludedReviewCards(
          reviewQueueSnapshot.cards,
          pendingReviewSnapshotsAfterPresentation,
          excludedCardIds,
        );
        const nextReviewTimelineCards = cardsRatedDuringLoad.reduce(
          (timeline, reviewedCard) => insertReviewedCardIntoTimeline(timeline, reviewedCard, Date.now()),
          filterExcludedReviewCards(
            reviewTimelinePage.cards,
            pendingReviewSnapshotsAfterPresentation,
            excludedCardIds,
          ),
        );
        // The shown card stays while still in review; if it left, the prepared next card takes its place:
        // docs/fsrs-scheduling-logic.md#non-blocking-review
        // A rating during the lookup showed the prepared next card, so its lookup decides whether it stays.
        const nextPresentedCard = resolveFilteredPresentedCard(
          freshCanonicalReviewQueue,
          stalePresentedCardIds.size === 0
            ? stillReviewedPresentedCard ?? stillReviewedPreparedNextCard
            : currentPresentedCard !== null && currentPresentedCard.cardId === previousPreparedNextCard?.cardId
              ? stillReviewedPreparedNextCard
              : currentPresentedCard,
          pendingReviewSnapshotsAfterPresentation,
          excludedCardIds,
        );
        // The prepared next card stays while still in review; one that left, or was promoted, is re-prepared.
        // A card prepared by a rating during this load was not looked up, so it stays only inside the window.
        const currentPreparedNextCard = isNewReviewSession
          ? null
          : selectPreparedNextCard(buildDisplayedReviewQueue(canonicalReviewQueueRef.current, currentPresentedCard));
        const nextPreparedNextCard = currentPreparedNextCard === null
          || currentPreparedNextCard.cardId === nextPresentedCard?.cardId
          || excludedCardIds.has(currentPreparedNextCard.cardId)
          ? null
          : freshCanonicalReviewQueue.find((card) => card.cardId === currentPreparedNextCard.cardId)
            ?? (stillReviewedPreparedNextCard?.cardId === currentPreparedNextCard.cardId ? stillReviewedPreparedNextCard : null);
        const nextCanonicalReviewQueue = keepPreparedNextCard(freshCanonicalReviewQueue, nextPresentedCard, nextPreparedNextCard);
        const nextActiveReviewQueue = buildDisplayedReviewQueue(nextCanonicalReviewQueue, nextPresentedCard);
        const nextQueueCards = buildDisplayedReviewTimeline(nextReviewTimelineCards, nextActiveReviewQueue);
        const nextReviewSessionSignature = buildReviewSessionSignature(
          loadedSelectedReviewFilterKey,
          nextActiveReviewQueue,
          nextQueueCards,
        );
        // While a background rebuild keeps the shown card, a reordered window behind it (or a prepared card
        // kept from outside the window) must not mark in-flight ratings stale.
        const keepsPresentedCard = currentPresentedCard !== null && nextPresentedCard?.cardId === currentPresentedCard.cardId;
        if (isNewReviewSession || shouldPromoteResolvedReviewFilter || keepsPresentedCard === false) {
          applyFreshReviewSessionSignature(nextReviewSessionSignature);
        } else {
          reviewSessionSignatureRef.current = nextReviewSessionSignature;
        }

        setResolvedReviewFilterState(nextResolvedReviewFilter);
        setSelectedReviewFilterTitle(nextSelectedReviewFilterTitle);
        setCanonicalReviewQueueState(nextCanonicalReviewQueue);
        setPresentedCardState(nextPresentedCard);
        setReviewCounts(reviewQueueSnapshot.reviewCounts);
        scheduleNextDueRefresh(nextQueueCards, loadStartTimestamp);
        setReviewQueueCursorState(reviewQueueSnapshot.nextCursor);
        setQueueCardsState(nextQueueCards);
        setReviewTagSummaries(tagsSummary.tags);
        setLocalWorkspaceCardCount(tagsSummary.totalCards);
        setLocalHotStateStatus(isHotStateHydrated ? "hydrated" : "unhydrated");
        loadedWorkspaceIdRef.current = activeWorkspaceId;
        loadedReviewDataContextKeyRef.current = loadedReviewDataContextKey;
        setLoadedReviewDataContextKey(loadedReviewDataContextKey);
        setTagSuggestions(toTagSuggestions(tagsSummary.tags));
        setDeckSummariesState(decksSnapshot.deckSummaries);
        writeReviewLoadingSnapshot({
          version: 1,
          workspaceId: activeWorkspaceId,
          selectedReviewFilterKey: loadedSelectedReviewFilterKey,
          resolvedReviewFilterTitle: nextSelectedReviewFilterTitle,
          reviewCounts: reviewQueueSnapshot.reviewCounts,
          currentCard: nextActiveReviewQueue[0] === undefined ? null : buildReviewLoadingCardPreview(nextActiveReviewQueue[0]),
          queuePreview: nextQueueCards
            .slice(0, 6)
            .map((card) => buildReviewLoadingCardPreview(card)),
          savedAt: new Date().toISOString(),
        });
        setHasLoadedReviewData(true);
        refreshCountsIfLoadOverlappedRating(ratingSequenceAtStart);
        if (shouldPromoteResolvedReviewFilter) {
          carriedReviewDataContextRef.current = {
            contextKey: loadedReviewDataContextKey,
            localReadVersion,
            rebuildSequence: reviewDataRebuildRequest.sequence,
          };
          promoteReviewFilter(nextResolvedReviewFilter);
        }
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }
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
      }
    }

    const afterRatingWork = afterRatingWorkRef.current;
    if (afterRatingWork !== null) {
      afterRatingWorkRef.current = { ...afterRatingWork, fullRebuildCount: afterRatingWork.fullRebuildCount + 1 };
    }

    void loadReviewData();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspaceId, indexedDbOpenRecoveryState, localReadVersion, reviewDataContextKey, reviewDataRebuildRequest]);

  async function handleReview(card: Card, rating: 0 | 1 | 2 | 3): Promise<ReviewSubmissionOutcome> {
    // Rating until its submission and in-memory update settle; non-blocking review plans read it as
    // their before/after number. A newer rating replaces an unsettled one, which is never sent.
    const afterRatingWorkSpan = startReviewAfterRatingWorkSpan();
    afterRatingWorkRef.current = {
      span: afterRatingWorkSpan,
      fullRebuildCount: 0,
    };
    try {
      return await submitReview(card, rating);
    } finally {
      const afterRatingWork = afterRatingWorkRef.current;
      if (afterRatingWork?.span === afterRatingWorkSpan) {
        afterRatingWorkRef.current = null;
        finishReviewAfterRatingWorkSpan(afterRatingWork.span, afterRatingWork.fullRebuildCount);
      }
      restartCountsRepairTimer();
    }
  }

  async function submitReview(card: Card, rating: 0 | 1 | 2 | 3): Promise<ReviewSubmissionOutcome> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return "cancelled";
    }

    if (loadedReviewDataContextKeyRef.current !== reviewDataContextKeyRef.current) {
      return "stale";
    }

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
    // The card shown after a rating is the already prepared next card, so its images are decoded:
    // docs/fsrs-scheduling-logic.md#non-blocking-review
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

    let reviewedCard: Card;
    try {
      reviewedCard = await waitForRecoveryGuardedReviewPhase(
        submitReviewItem(submissionContext.cardId, rating),
        indexedDbOpenRecoveryState,
      );
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return "cancelled";
      }
      recordLocallyRatedCard(reviewedCard);
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return "cancelled";
      }
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
        freshRollbackCard = await waitForRecoveryGuardedReviewPhase(
          loadPresentedCardForPreservation(submissionContext.cardId, getCardById),
          indexedDbOpenRecoveryState,
        );
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return "cancelled";
        }
      } catch (rollbackError) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, rollbackError)) {
          return "cancelled";
        }
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

      const expectedSubmitErrorMessage = error instanceof BrowserGuestSessionInvalidatedError
        ? t("app.sessionRestoringActionLocked")
        : getExpectedCardMutationInlineErrorMessage(
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
      track({
        name: "review_answer_failed",
        reason: toAnalyticsReviewAnswerFailureReason(error),
      });
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
    const {
      canonicalReviewQueue: nextCanonicalReviewQueue,
      presentedCard: nextPresentedCard,
    } = applyRatedCardLocally(reviewedCard);

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
        const nextChunk = await waitForRecoveryGuardedReviewPhase(
          loadReviewQueueChunk(
            currentWorkspaceId,
            resolvedReviewFilterRef.current,
            requestedReviewQueueCursor,
            8 - nextCanonicalReviewQueue.length,
            excludedCardIds,
          ),
          indexedDbOpenRecoveryState,
        );
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return "cancelled";
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
        const replenishedQueueCards = buildDisplayedReviewTimeline(queueCardsRef.current, replenishedActiveReviewQueue);

        setCanonicalReviewQueueState(replenishedCanonicalReviewQueue);
        setPresentedCardState(refreshedPresentedCard);
        setReviewQueueCursorState(nextReviewQueueCursor);
        setQueueCardsState(replenishedQueueCards);
        setCurrentReviewSessionSignature(replenishedActiveReviewQueue, replenishedQueueCards);
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return "cancelled";
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
    deckSummaries: visibleDeckSummaries,
    handleReview,
    hasLoadedReviewData: visibleHasLoadedReviewData,
    isInitialReviewLoad,
    isReviewLoading: isExplicitEmptyTagsFilter === false && isCurrentReviewDataContextLoaded === false,
    localWorkspaceCardCount: visibleLocalWorkspaceCardCount,
    queueCards: isCurrentReviewDataContextLoaded ? queueCards : [],
    resolvedReviewFilter: isCurrentReviewDataContextLoaded ? resolvedReviewFilter : selectedReviewFilter,
    reviewCounts: isCurrentReviewDataContextLoaded ? reviewCounts : createEmptyReviewCounts(),
    reviewLoadErrorMessage: visibleReviewLoadErrorMessage,
    reviewLoadingSnapshot,
    reviewTagSummaries: isCurrentWorkspaceLoaded ? reviewTagSummaries : [],
    selectedReviewFilterTitle: visibleSelectedReviewFilterTitle,
    tagSuggestions: isCurrentWorkspaceLoaded ? tagSuggestions : [],
  };
}

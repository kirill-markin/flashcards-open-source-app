import { useEffect, useRef, useState } from "react";
import type { ReviewRating } from "../../../../backend/src/scheduling";
import { useAppData, useReviewLeaderboardBadge, useReviewProgressBadge } from "../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { ALL_CARDS_REVIEW_FILTER, currentReviewCard } from "../../appData/domain";
import type { FeedbackDialogProps } from "../../feedback/FeedbackDialog";
import { useI18n } from "../../i18n";
import { normalizeCaughtError } from "../../observability/webObservability";
import { useAiCardHandoff } from "../../chat/handoff/useAiCardHandoff";
import { useTransientMessage } from "../../useTransientMessage";
import type { Card } from "../../types";
import { handleRefreshLocalDataError } from "../shared/refreshLocalDataError";
import { isCardFormStateDirty } from "../cards/form/CardForm";
import type { ReviewEditorModalProps } from "./components/card/ReviewEditorModal";
import type { ReviewPaneProps } from "./components/ReviewPane";
import type { ReviewQueuePanelProps } from "./components/ReviewQueuePanel";
import type { ReviewScreenHeaderProps } from "./components/ReviewScreenHeader";
import { buildReviewButtonOptions, type ReviewButtonOption } from "./components/reviewRatingOptions";
import { type LastSubmittedReview, type ReviewSubmitState } from "./components/reviewScreenTypes";
import { useReviewCardEditor } from "./components/card/useReviewCardEditor";
import { useReviewScreenData, type ReviewSubmissionOutcome } from "./data/useReviewScreenData";
import { resolveReviewFilterTitle } from "./data/reviewScreenDataState";
import { useReviewFilterMenu } from "./filters/useReviewFilterMenu";
import type { ReviewHardReminderDialogProps } from "./hardReminder/ReviewHardReminderDialog";
import {
  appendRecentReviewRatings,
  loadReviewHardReminderLastShownAt,
  saveReviewHardReminderLastShownAt,
  shouldShowReviewHardReminder,
} from "./hardReminder/reviewHardReminder";
import { useReviewKeyboardShortcuts } from "./input/useReviewKeyboardShortcuts";
import type { MobileAppPromotionDialogProps } from "./mobileAppPromo/MobileAppPromotionDialog";
import { usePostReviewPrompts } from "./usePostReviewPrompts";
import { useReviewRatingReactions, type UseReviewRatingReactionsResult } from "./reactions/useReviewRatingReactions";
import { makeReviewSpeakableText, useReviewSpeech } from "./speech/reviewSpeech";

export type UseReviewScreenControllerResult = Readonly<{
  dismissReviewReactions: UseReviewRatingReactionsResult["dismissReactions"];
  editorModalProps: ReviewEditorModalProps;
  feedbackDialogProps: FeedbackDialogProps;
  hardReminderDialogProps: ReviewHardReminderDialogProps;
  headerProps: ReviewScreenHeaderProps;
  mobileAppPromotionDialogProps: MobileAppPromotionDialogProps;
  paneProps: ReviewPaneProps;
  queuePanelProps: ReviewQueuePanelProps;
  reviewReactionFallbackHandler: UseReviewRatingReactionsResult["handleReactionEventFallback"];
  reviewReactionEvents: UseReviewRatingReactionsResult["events"];
}>;

export type UseReviewScreenControllerParams = Readonly<{
  reviewReactionAnimationsEnabled: boolean;
}>;

export function useReviewScreenController(
  params: UseReviewScreenControllerParams,
): UseReviewScreenControllerResult {
  const { reviewReactionAnimationsEnabled } = params;
  const {
    activeWorkspace,
    cloudSettings,
    errorMessage,
    selectedReviewFilter,
    workspaceSettings,
    isSyncing,
    localReadVersion,
    getCardById,
    refreshLocalData,
    runMediaUploadTransfers,
    selectReviewFilter,
    session,
    submitReviewItem,
    updateCardItem,
    deleteCardItem,
    setErrorMessage,
  } = useAppData();
  const reviewLeaderboardBadge = useReviewLeaderboardBadge();
  const reviewProgressBadge = useReviewProgressBadge();
  const { formatCount, locale, messages, t } = useI18n();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError, showTechnicalError } = useAppErrorDialog();
  const [isAnswerVisible, setIsAnswerVisible] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [reviewSubmitState, setReviewSubmitState] = useState<ReviewSubmitState>("idle");
  const [lastSubmittedReview, setLastSubmittedReview] = useState<LastSubmittedReview | null>(null);
  const [isHardReminderVisible, setIsHardReminderVisible] = useState<boolean>(false);
  const [isReviewQueuePanelOpen, setIsReviewQueuePanelOpen] = useState<boolean>(false);
  const [hardReminderLastShownAt, setHardReminderLastShownAt] = useState<number | null>(() => loadReviewHardReminderLastShownAt());
  const recentReviewRatingsRef = useRef<Array<ReviewRating>>([]);
  const lastCapturedReviewButtonErrorKeyRef = useRef<string>("");
  const { message: reviewSpeechMessage, showMessage: showReviewSpeechMessage } = useTransientMessage(3000);
  const { message: reviewFeedbackMessage, showMessage: showReviewFeedbackMessage } = useTransientMessage(3000);
  const {
    dismissReactions: dismissReviewReactions,
    emitReaction: emitReviewReaction,
    events: reviewReactionEvents,
    handleReactionEventFallback: handleReviewReactionEventFallback,
  } = useReviewRatingReactions({
    reviewReactionAnimationsEnabled,
  });
  const {
    activeReviewQueue,
    deckSummaries,
    handleReview: handleReviewData,
    hasLoadedReviewData,
    isInitialReviewLoad,
    isReviewLoading,
    localWorkspaceCardCount,
    queueCards,
    resolvedReviewFilter,
    reviewCounts,
    reviewLoadErrorMessage,
    reviewLoadingSnapshot,
    reviewTagSummaries,
    selectedReviewFilterTitle,
    tagSuggestions,
  } = useReviewScreenData({
    activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
    appErrorMessage: errorMessage,
    getCardById,
    installationId: cloudSettings?.installationId ?? null,
    isSyncing,
    localReadVersion,
    selectReviewFilter,
    selectedReviewFilter,
    setErrorMessage,
    submitReviewItem,
    userId: session?.userId ?? null,
  });
  const selectedCard = currentReviewCard(activeReviewQueue);
  const {
    activeSide: activeSpeechSide,
    stopSpeech,
    toggleSpeech,
  } = useReviewSpeech({
    locale,
    showMessage: showReviewSpeechMessage,
    speechUnavailableMessage: t("reviewScreen.speechUnavailable"),
  });
  const {
    activeReviewFilterOptionId,
    activeReviewFilterOptionKey,
    getReviewFilterOptionId,
    handleCloseMenu,
    handleReviewFilterComboboxKeyDown,
    handleReviewFilterListboxKeyDown,
    handleReviewFilterMenuToggle,
    handleReviewFilterSelect,
    hasVisibleReviewFilterChoices,
    isReviewFilterMenuOpen,
    reviewDeckSearchInputRef,
    reviewDeckSearchText,
    reviewFilterListboxId,
    reviewFilterListboxRef,
    reviewFilterMenuRef,
    reviewFilterMenuItems,
    reviewFilterTriggerRef,
    setReviewDeckSearchText,
    shouldShowReviewDeckSearch,
    visibleReviewDeckFilterMenuItems,
    visibleReviewTagFilterMenuItems,
  } = useReviewFilterMenu({
    deckSummaries,
    onSelectReviewFilter: selectReviewFilter,
    reviewTagSummaries,
    selectedReviewFilter,
    workspaceId: activeWorkspace?.workspaceId ?? null,
  });
  const {
    captureEditorPresentationToken,
    editorErrorMessage,
    editingCard,
    editorFormState,
    handleEditorDelete,
    handleEditorSaveForAiHandoff,
    handleRetryMediaUploadTransfer,
    handleEditorSave,
    handlePrepareImageMedia,
    handleOpenEditor,
    handleCloseEditor,
    handleCloseEditorIfCurrent,
    isEditorPresented,
    isEditorSaving,
    isEditorSubmissionAllowed,
    isEditorSubmissionBlocked,
    managedMediaState,
    setEditorFormState,
  } = useReviewCardEditor({
    deleteCardItem,
    installationId: cloudSettings?.installationId ?? null,
    localReadVersion,
    queueCards,
    runMediaUploadTransfers,
    selectedCard,
    setErrorMessage,
    t,
    updateCardItem,
    userId: session?.userId ?? null,
    workspaceId: activeWorkspace?.workspaceId ?? null,
  });
  const handoffCardToAi = useAiCardHandoff();
  const {
    feedbackDialogProps,
    isFeedbackDialogOpen,
    isMobileAppPromotionDialogOpen,
    maybeOpenPostReviewPrompt,
    mobileAppPromotionDialogProps,
  } = usePostReviewPrompts({
    indexedDbOpenRecoveryState,
    installationId: cloudSettings?.installationId ?? null,
    isEditorPresented,
    isHardReminderVisible,
    isReviewFilterMenuOpen,
    linkedUserId: cloudSettings?.linkedUserId ?? null,
    locale,
    onFeedbackSubmitted: showReviewFeedbackMessage,
    userId: session?.userId ?? null,
    workspaceId: activeWorkspace?.workspaceId ?? null,
  });
  const nowTimestamp = Date.now();
  const selectedFrontSpeakableText = selectedCard === null ? "" : makeReviewSpeakableText(selectedCard.frontText);
  const selectedBackSpeakableText = selectedCard === null ? "" : makeReviewSpeakableText(selectedCard.backText);
  const hasCards = localWorkspaceCardCount > 0;
  const shouldShowSwitchToAllCardsAction = resolvedReviewFilter.kind !== "allCards";
  const loadingReviewCurrentCard = reviewLoadingSnapshot?.currentCard ?? reviewLoadingSnapshot?.queuePreview[0] ?? null;
  const requestedReviewFilterTitle = resolveReviewFilterTitle(
    selectedReviewFilter,
    deckSummaries,
    t("filters.allCards"),
    t("reviewFilterMenu.noTags"),
    formatCount(
      selectedReviewFilter.kind === "tags" ? selectedReviewFilter.tags.length : 0,
      messages.common.countLabels.tag,
    ),
  );
  const visibleSelectedReviewFilterTitle = isInitialReviewLoad && reviewLoadingSnapshot !== null
    ? reviewLoadingSnapshot.resolvedReviewFilterTitle
    : isReviewLoading
      ? requestedReviewFilterTitle
      : selectedReviewFilterTitle;
  const visibleQueueCardsCount = isInitialReviewLoad && reviewLoadingSnapshot !== null
    ? reviewLoadingSnapshot.queuePreview.length
    : queueCards.length;
  const reviewButtonsNow = new Date();
  let reviewButtonOptions: Array<ReviewButtonOption> = [];
  let reviewButtonErrorMessage: string = "";
  let reviewButtonScheduleError: Error | null = null;

  function markIndexedDbOpenRecoveryFailure(error: unknown): boolean {
    return markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error);
  }

  function handleReviewQueueShortcutClick(): void {
    setIsReviewQueuePanelOpen((currentIsReviewQueuePanelOpen) => !currentIsReviewQueuePanelOpen);
  }

  function handleReviewQueuePanelClose(): void {
    setIsReviewQueuePanelOpen(false);
  }

  async function handleReview(card: Card, rating: ReviewRating): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    emitReviewReaction(rating);
    setIsSubmitting(true);
    setReviewSubmitState("submitting");
    setLastSubmittedReview({
      cardId: card.cardId,
      rating,
    });
    let reviewSubmissionOutcome: ReviewSubmissionOutcome = "failed";

    try {
      reviewSubmissionOutcome = await handleReviewData(card, rating);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        reviewSubmissionOutcome = "cancelled";
        return;
      }
      if (reviewSubmissionOutcome !== "saved") {
        return;
      }

      const nextRecentReviewRatings = appendRecentReviewRatings(recentReviewRatingsRef.current, rating);
      recentReviewRatingsRef.current = nextRecentReviewRatings;

      let didShowHardReminder = false;
      if (rating === 1) {
        const nowMillis = Date.now();
        if (shouldShowReviewHardReminder(nextRecentReviewRatings, hardReminderLastShownAt, nowMillis)) {
          setHardReminderLastShownAt(nowMillis);
          saveReviewHardReminderLastShownAt(nowMillis);
          setIsHardReminderVisible(true);
          didShowHardReminder = true;
        }
      }

      if (didShowHardReminder === false) {
        void maybeOpenPostReviewPrompt();
      }
    } finally {
      if (reviewSubmissionOutcome !== "cancelled" && indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsSubmitting(false);
        if (reviewSubmissionOutcome === "stale") {
          setLastSubmittedReview(null);
          setReviewSubmitState("idle");
        } else {
          setReviewSubmitState(reviewSubmissionOutcome === "saved" ? "settled" : "failed");
        }
      }
    }
  }

  async function handleEditorAiHandoff(): Promise<void> {
    if (
      indexedDbOpenRecoveryState.hasFailed()
      || editingCard === null
      || isEditorSubmissionAllowed() === false
    ) {
      return;
    }

    const presentationToken = captureEditorPresentationToken();
    if (presentationToken === null) {
      return;
    }
    const cardForHandoff = isCardFormStateDirty(editingCard, editorFormState)
      ? await handleEditorSaveForAiHandoff()
      : editingCard;
    if (cardForHandoff === null || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const didHandoff = await handleReviewPaneAiHandoff(cardForHandoff);
    if (didHandoff && indexedDbOpenRecoveryState.hasFailed() === false) {
      handleCloseEditorIfCurrent(presentationToken);
    }
  }

  async function handleReviewPaneAiHandoff(card: Card): Promise<boolean> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return false;
    }

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const didHandoff = await handoffCardToAi(card);
      indexedDbOpenRecoveryState.throwIfFailed();
      return didHandoff;
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailure(error)) {
        return false;
      }
      throw error;
    }
  }

  function handleDismissHardReminder(): void {
    setIsHardReminderVisible(false);
  }

  function handleRevealAnswer(): void {
    setIsAnswerVisible(true);
  }

  async function handleRetryReviewLoad(): Promise<void> {
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      await refreshLocalData();
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailure(error)) {
        return;
      }
      handleRefreshLocalDataError({
        error,
        context: {
          feature: "sync",
          operation: "refresh_local_metadata",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          entityId: activeWorkspace?.workspaceId ?? null,
        },
        setErrorMessage,
        showCapturedTechnicalError,
        technicalErrorMessage: t("appError.technicalError.message"),
      });
    }
  }

  function handleSwitchToAllCards(): void {
    selectReviewFilter(ALL_CARDS_REVIEW_FILTER);
  }

  useEffect(() => {
    setIsAnswerVisible(false);
    stopSpeech();
  }, [selectedCard?.cardId, stopSpeech]);

  useEffect(() => {
    if (indexedDbOpenRecoveryState.isFailed === false) {
      return;
    }

    stopSpeech();
    dismissReviewReactions();
  }, [dismissReviewReactions, indexedDbOpenRecoveryState.isFailed, stopSpeech]);

  useEffect(() => {
    recentReviewRatingsRef.current = [];
    setIsHardReminderVisible(false);
  }, [activeWorkspace?.workspaceId]);

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, [stopSpeech]);

  useReviewKeyboardShortcuts({
    handleReview: async (card, rating) => {
      await handleReview(card, rating);
    },
    isAnswerVisible,
    isEditorPresented,
    isFeedbackDialogOpen,
    isHardReminderVisible,
    isMobileAppPromotionDialogOpen,
    isReviewFilterMenuOpen,
    isSubmitting,
    onShortcutInputStart: dismissReviewReactions,
    selectedCard,
    setIsAnswerVisible: (value) => {
      setIsAnswerVisible(value);
    },
  });

  if (isAnswerVisible && selectedCard !== null && workspaceSettings !== null) {
    try {
      reviewButtonOptions = buildReviewButtonOptions(selectedCard, workspaceSettings, reviewButtonsNow, t, formatCount);
    } catch (error) {
      reviewButtonScheduleError = normalizeCaughtError(error);
      reviewButtonErrorMessage = t("appError.technicalError.message");
    }
  } else if (isAnswerVisible && selectedCard !== null) {
    reviewButtonErrorMessage = t("reviewScreen.errors.schedulerUnavailable");
  }

  const reviewButtonErrorCaptureKey = reviewButtonScheduleError === null || selectedCard === null || workspaceSettings === null
    ? ""
    : [
      selectedCard.cardId,
      selectedCard.updatedAt,
      workspaceSettings.algorithm,
      reviewButtonScheduleError.name,
      reviewButtonScheduleError.message,
    ].join(":");

  useEffect(() => {
    if (
      reviewButtonScheduleError === null
      || selectedCard === null
      || reviewButtonErrorCaptureKey === ""
      || lastCapturedReviewButtonErrorKeyRef.current === reviewButtonErrorCaptureKey
      || indexedDbOpenRecoveryState.hasFailed()
    ) {
      return;
    }

    lastCapturedReviewButtonErrorKeyRef.current = reviewButtonErrorCaptureKey;
    showTechnicalError(reviewButtonScheduleError, {
      feature: "review",
      operation: "review_schedule_preview",
      userId: session?.userId ?? null,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      installationId: cloudSettings?.installationId ?? null,
      entityId: selectedCard.cardId,
    });
  }, [
    activeWorkspace?.workspaceId,
    cloudSettings?.installationId,
    indexedDbOpenRecoveryState,
    reviewButtonErrorCaptureKey,
    reviewButtonScheduleError,
    selectedCard,
    showTechnicalError,
    session?.userId,
  ]);

  return {
    dismissReviewReactions,
    editorModalProps: {
      editingCard,
      editorErrorMessage,
      formState: editorFormState,
      isEditorPresented,
      isEditorSaving,
      isSubmissionBlocked: isEditorSubmissionBlocked,
      localReadVersion,
      managedMediaState,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      onEditWithAi: handleEditorAiHandoff,
      onChange: setEditorFormState,
      onClose: handleCloseEditor,
      onDelete: handleEditorDelete,
      onPrepareImageMedia: handlePrepareImageMedia,
      onRetryMediaUploadTransfer: handleRetryMediaUploadTransfer,
      onSave: handleEditorSave,
      tagSuggestions,
    },
    feedbackDialogProps,
    hardReminderDialogProps: {
      isOpen: isHardReminderVisible,
      onDismiss: handleDismissHardReminder,
    },
    mobileAppPromotionDialogProps,
    headerProps: {
      filterMenuProps: {
        activeReviewFilterOptionId,
        activeReviewFilterOptionKey,
        getReviewFilterOptionId,
        handleCloseMenu,
        handleReviewFilterComboboxKeyDown,
        handleReviewFilterListboxKeyDown,
        handleReviewFilterMenuToggle,
        handleReviewFilterSelect,
        hasVisibleReviewFilterChoices,
        isReviewFilterMenuOpen,
        reviewDeckSearchInputRef,
        reviewDeckSearchText,
        reviewFilterListboxId,
        reviewFilterListboxRef,
        reviewFilterMenuRef,
        reviewFilterMenuItems,
        reviewFilterTriggerRef,
        selectedReviewFilterTitle: visibleSelectedReviewFilterTitle,
        setReviewDeckSearchText,
        shouldShowReviewDeckSearch,
        visibleReviewDeckFilterMenuItems,
        visibleReviewTagFilterMenuItems,
      },
      hasLoadedReviewData,
      isReviewQueuePanelOpen,
      onRetry: handleRetryReviewLoad,
      onReviewQueueShortcutClick: handleReviewQueueShortcutClick,
      reviewQueueTotalCount: isInitialReviewLoad && reviewLoadingSnapshot !== null
        ? reviewLoadingSnapshot.reviewCounts.totalCount
        : reviewCounts.totalCount,
      reviewLoadErrorMessage,
      reviewLeaderboardBadge,
      reviewProgressBadge,
      reviewSpeechMessage: reviewFeedbackMessage !== "" ? reviewFeedbackMessage : reviewSpeechMessage,
    },
    paneProps: {
      activeSpeechSide,
      hasCards,
      isAnswerVisible,
      isInitialReviewLoad,
      isSubmitting,
      lastSubmittedReview,
      localReadVersion,
      loadingReviewCurrentCard,
      onAiHandoff: handleReviewPaneAiHandoff,
      onEditCard: handleOpenEditor,
      onRevealAnswer: handleRevealAnswer,
      onReview: handleReview,
      onSwitchToAllCards: handleSwitchToAllCards,
      onToggleSpeech: toggleSpeech,
      reviewButtonErrorMessage,
      reviewButtonOptions,
      reviewLoadingSnapshot,
      reviewSubmitState,
      selectedBackSpeakableText,
      selectedCard,
      selectedFrontSpeakableText,
      shouldShowSwitchToAllCardsAction,
      workspaceId: activeWorkspace?.workspaceId ?? null,
    },
    queuePanelProps: {
      isInitialReviewLoad,
      isReviewQueuePanelOpen,
      loadingReviewCurrentCard,
      nowTimestamp,
      onClose: handleReviewQueuePanelClose,
      queueCards,
      reviewLoadingSnapshot,
      selectedCardId: selectedCard?.cardId ?? null,
      visibleQueueCardsCount,
    },
    reviewReactionFallbackHandler: handleReviewReactionEventFallback,
    reviewReactionEvents,
  };
}

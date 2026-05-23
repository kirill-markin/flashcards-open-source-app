import { useEffect, useRef, useState } from "react";
import type { ReviewRating } from "../../../../backend/src/scheduling";
import { useAppData, useReviewProgressBadge } from "../../appData";
import { ALL_CARDS_REVIEW_FILTER, currentReviewCard } from "../../appData/domain";
import { useI18n } from "../../i18n";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import { normalizeCaughtError } from "../../observability/webObservability";
import { useAiCardHandoff } from "../../chat/handoff/useAiCardHandoff";
import { useTransientMessage } from "../../useTransientMessage";
import type { Card } from "../../types";
import { isCardFormStateDirty } from "../cards/CardForm";
import type { ReviewEditorModalProps } from "./components/ReviewEditorModal";
import type { ReviewPaneProps } from "./components/ReviewPane";
import type { ReviewQueuePanelProps } from "./components/ReviewQueuePanel";
import type { ReviewScreenHeaderProps } from "./components/ReviewScreenHeader";
import { buildReviewButtonOptions, type ReviewButtonOption } from "./components/reviewRatingOptions";
import { type LastSubmittedReview, type ReviewSubmitState } from "./components/reviewScreenTypes";
import { useReviewCardEditor } from "./components/useReviewCardEditor";
import { useReviewScreenData, type ReviewSubmissionOutcome } from "./data/useReviewScreenData";
import { useReviewFilterMenu } from "./filters/useReviewFilterMenu";
import type { ReviewHardReminderDialogProps } from "./hardReminder/ReviewHardReminderDialog";
import {
  appendRecentReviewRatings,
  loadReviewHardReminderLastShownAt,
  saveReviewHardReminderLastShownAt,
  shouldShowReviewHardReminder,
} from "./hardReminder/reviewHardReminder";
import { useReviewKeyboardShortcuts } from "./input/useReviewKeyboardShortcuts";
import { useReviewRatingReactions, type UseReviewRatingReactionsResult } from "./reactions/useReviewRatingReactions";
import { makeReviewSpeakableText, useReviewSpeech } from "./speech/reviewSpeech";

export type UseReviewScreenControllerResult = Readonly<{
  editorModalProps: ReviewEditorModalProps;
  hardReminderDialogProps: ReviewHardReminderDialogProps;
  headerProps: ReviewScreenHeaderProps;
  paneProps: ReviewPaneProps;
  queuePanelProps: ReviewQueuePanelProps;
  reviewReactionEvents: UseReviewRatingReactionsResult["events"];
}>;

export function useReviewScreenController(): UseReviewScreenControllerResult {
  const {
    activeWorkspace,
    cloudSettings,
    selectedReviewFilter,
    workspaceSettings,
    localReadVersion,
    localCardCount,
    getCardById,
    refreshLocalData,
    selectReviewFilter,
    session,
    submitReviewItem,
    updateCardItem,
    deleteCardItem,
    setErrorMessage,
  } = useAppData();
  const reviewProgressBadge = useReviewProgressBadge();
  const { locale, t, formatCount } = useI18n();
  const [isAnswerVisible, setIsAnswerVisible] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [reviewSubmitState, setReviewSubmitState] = useState<ReviewSubmitState>("idle");
  const [lastSubmittedReview, setLastSubmittedReview] = useState<LastSubmittedReview | null>(null);
  const [isHardReminderVisible, setIsHardReminderVisible] = useState<boolean>(false);
  const [hardReminderLastShownAt, setHardReminderLastShownAt] = useState<number | null>(() => loadReviewHardReminderLastShownAt());
  const recentReviewRatingsRef = useRef<Array<ReviewRating>>([]);
  const lastCapturedReviewButtonErrorKeyRef = useRef<string>("");
  const { message: reviewSpeechMessage, showMessage: showReviewSpeechMessage } = useTransientMessage(3000);
  const {
    emitReaction: emitReviewReaction,
    events: reviewReactionEvents,
  } = useReviewRatingReactions();
  const {
    activeReviewQueue,
    deckSummaries,
    handleReview: handleReviewData,
    hasLoadedReviewData,
    isInitialReviewLoad,
    queueCards,
    resolvedReviewFilter,
    reviewLoadErrorMessage,
    reviewLoadingSnapshot,
    reviewTagSummaries,
    selectedReviewFilterTitle,
    tagSuggestions,
  } = useReviewScreenData({
    activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
    getCardById,
    installationId: cloudSettings?.installationId ?? null,
    localReadVersion,
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
    handleCloseMenu,
    handleReviewFilterMenuToggle,
    handleReviewFilterSelect,
    hasVisibleReviewFilterChoices,
    isReviewFilterMenuOpen,
    reviewDeckSearchInputRef,
    reviewDeckSearchText,
    reviewFilterMenuItems,
    reviewFilterMenuWrapRef,
    reviewFilterTriggerRef,
    setReviewDeckSearchText,
    shouldShowReviewDeckSearch,
    visibleReviewDeckFilterMenuItems,
    visibleReviewEffortFilterMenuItems,
    visibleReviewTagFilterMenuItems,
  } = useReviewFilterMenu({
    deckSummaries,
    onSelectReviewFilter: selectReviewFilter,
    reviewTagSummaries,
    selectedReviewFilter: resolvedReviewFilter,
  });
  const {
    editorErrorMessage,
    editingCard,
    editorFormState,
    handleEditorDelete,
    handleEditorSaveForAiHandoff,
    handleEditorSave,
    handleOpenEditor,
    isEditorPresented,
    isEditorSaving,
    setEditorFormState,
    setIsEditorPresented,
  } = useReviewCardEditor({
    deleteCardItem,
    installationId: cloudSettings?.installationId ?? null,
    queueCards,
    selectedCard,
    setErrorMessage,
    t,
    updateCardItem,
    userId: session?.userId ?? null,
    workspaceId: activeWorkspace?.workspaceId ?? null,
  });
  const handoffCardToAi = useAiCardHandoff();
  const nowTimestamp = Date.now();
  const selectedFrontSpeakableText = selectedCard === null ? "" : makeReviewSpeakableText(selectedCard.frontText);
  const selectedBackSpeakableText = selectedCard === null ? "" : makeReviewSpeakableText(selectedCard.backText);
  const hasCards = localCardCount > 0;
  const shouldShowSwitchToAllCardsAction = resolvedReviewFilter.kind !== "allCards";
  const loadingReviewCurrentCard = reviewLoadingSnapshot?.currentCard ?? reviewLoadingSnapshot?.queuePreview[0] ?? null;
  const visibleSelectedReviewFilterTitle = isInitialReviewLoad && reviewLoadingSnapshot !== null
    ? reviewLoadingSnapshot.resolvedReviewFilterTitle
    : selectedReviewFilterTitle;
  const visibleQueueCardsCount = isInitialReviewLoad && reviewLoadingSnapshot !== null
    ? reviewLoadingSnapshot.queuePreview.length
    : queueCards.length;
  const reviewButtonsNow = new Date();
  let reviewButtonOptions: Array<ReviewButtonOption> = [];
  let reviewButtonErrorMessage: string = "";
  let reviewButtonScheduleError: Error | null = null;

  async function handleReview(card: Card, rating: ReviewRating): Promise<void> {
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
      if (reviewSubmissionOutcome !== "saved") {
        return;
      }

      const nextRecentReviewRatings = appendRecentReviewRatings(recentReviewRatingsRef.current, rating);
      recentReviewRatingsRef.current = nextRecentReviewRatings;
      if (rating !== 1) {
        return;
      }

      const nowMillis = Date.now();
      if (shouldShowReviewHardReminder(nextRecentReviewRatings, hardReminderLastShownAt, nowMillis)) {
        setHardReminderLastShownAt(nowMillis);
        saveReviewHardReminderLastShownAt(nowMillis);
        setIsHardReminderVisible(true);
      }
    } finally {
      setIsSubmitting(false);
      if (reviewSubmissionOutcome === "stale") {
        setLastSubmittedReview(null);
        setReviewSubmitState("idle");
      } else {
        setReviewSubmitState(reviewSubmissionOutcome === "saved" ? "settled" : "failed");
      }
    }
  }

  async function handleEditorAiHandoff(): Promise<void> {
    if (editingCard === null) {
      return;
    }

    const cardForHandoff = isCardFormStateDirty(editingCard, editorFormState)
      ? await handleEditorSaveForAiHandoff()
      : editingCard;
    if (cardForHandoff === null) {
      return;
    }

    const didHandoff = await handoffCardToAi(cardForHandoff);
    if (didHandoff) {
      setIsEditorPresented(false);
    }
  }

  function handleCloseEditor(): void {
    setIsEditorPresented(false);
  }

  function handleDismissHardReminder(): void {
    setIsHardReminderVisible(false);
  }

  function handleRevealAnswer(): void {
    setIsAnswerVisible(true);
  }

  function handleRetryReviewLoad(): void {
    void refreshLocalData();
  }

  function handleSwitchToAllCards(): void {
    selectReviewFilter(ALL_CARDS_REVIEW_FILTER);
  }

  useEffect(() => {
    setIsAnswerVisible(false);
    stopSpeech();
  }, [selectedCard?.cardId, stopSpeech]);

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
    isHardReminderVisible,
    isReviewFilterMenuOpen,
    isSubmitting,
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
      reviewButtonErrorMessage = reviewButtonScheduleError.message;
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
    ) {
      return;
    }

    lastCapturedReviewButtonErrorKeyRef.current = reviewButtonErrorCaptureKey;
    captureAppOperationError(reviewButtonScheduleError, {
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
    reviewButtonErrorCaptureKey,
    reviewButtonScheduleError,
    selectedCard,
    session?.userId,
  ]);

  return {
    editorModalProps: {
      editingCard,
      editorErrorMessage,
      formState: editorFormState,
      isEditorPresented,
      isEditorSaving,
      onEditWithAi: handleEditorAiHandoff,
      onChange: setEditorFormState,
      onClose: handleCloseEditor,
      onDelete: handleEditorDelete,
      onSave: handleEditorSave,
      tagSuggestions,
    },
    hardReminderDialogProps: {
      isOpen: isHardReminderVisible,
      onDismiss: handleDismissHardReminder,
    },
    headerProps: {
      filterMenuProps: {
        handleCloseMenu,
        handleReviewFilterMenuToggle,
        handleReviewFilterSelect,
        hasVisibleReviewFilterChoices,
        isReviewFilterMenuOpen,
        reviewDeckSearchInputRef,
        reviewDeckSearchText,
        reviewFilterMenuItems,
        reviewFilterMenuWrapRef,
        reviewFilterTriggerRef,
        selectedReviewFilterTitle: visibleSelectedReviewFilterTitle,
        setReviewDeckSearchText,
        shouldShowReviewDeckSearch,
        visibleReviewDeckFilterMenuItems,
        visibleReviewEffortFilterMenuItems,
        visibleReviewTagFilterMenuItems,
      },
      hasLoadedReviewData,
      onRetry: handleRetryReviewLoad,
      reviewLoadErrorMessage,
      reviewProgressBadge,
      reviewSpeechMessage,
    },
    paneProps: {
      activeSpeechSide,
      hasCards,
      isAnswerVisible,
      isInitialReviewLoad,
      isSubmitting,
      lastSubmittedReview,
      loadingReviewCurrentCard,
      onAiHandoff: handoffCardToAi,
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
    },
    queuePanelProps: {
      isInitialReviewLoad,
      loadingReviewCurrentCard,
      nowTimestamp,
      queueCards,
      reviewLoadingSnapshot,
      selectedCardId: selectedCard?.cardId ?? null,
      visibleQueueCardsCount,
    },
    reviewReactionEvents,
  };
}

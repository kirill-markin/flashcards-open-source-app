import { useEffect, useRef, useState } from "react";
import type { ReviewRating } from "../../../../backend/src/scheduling";
import {
  loadFeedbackState,
  recordFeedbackPromptEvent,
  submitFeedback,
} from "../../api";
import { useAppData, useReviewProgressBadge } from "../../appData";
import { ALL_CARDS_REVIEW_FILTER, currentReviewCard } from "../../appData/domain";
import {
  buildNextAutomaticFeedbackPromptAt,
  evaluateAutomaticFeedbackPromptEligibility,
  loadAutomaticFeedbackPromptReviewActivity,
  shouldRequestAutomaticFeedbackState,
  type AutomaticFeedbackPromptReviewActivity,
} from "../../feedback/automaticFeedbackPrompt";
import type { FeedbackDialogProps } from "../../feedback/FeedbackDialog";
import {
  buildFeedbackPromptEventRequest,
  buildFeedbackSubmissionRequest,
  feedbackMaximumMessageLength,
  normalizeFeedbackMessage,
} from "../../feedback/feedbackSubmission";
import { useI18n } from "../../i18n";
import {
  buildFeedbackPromptIdentityKey,
  loadFeedbackPromptState,
  storeAutomaticFeedbackPromptShownAt,
  storeFeedbackSubmittedAt,
  storeFetchedFeedbackState,
  type FeedbackPromptState,
} from "../../localDb/feedback/feedback";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import { normalizeCaughtError } from "../../observability/webObservability";
import { useAiCardHandoff } from "../../chat/handoff/useAiCardHandoff";
import { useTransientMessage } from "../../useTransientMessage";
import type { Card, FeedbackPromptEventType, FeedbackSubmissionRequest } from "../../types";
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
  dismissReviewReactions: UseReviewRatingReactionsResult["dismissReactions"];
  editorModalProps: ReviewEditorModalProps;
  feedbackDialogProps: FeedbackDialogProps;
  hardReminderDialogProps: ReviewHardReminderDialogProps;
  headerProps: ReviewScreenHeaderProps;
  paneProps: ReviewPaneProps;
  queuePanelProps: ReviewQueuePanelProps;
  reviewReactionFallbackHandler: UseReviewRatingReactionsResult["handleReactionEventFallback"];
  reviewReactionEvents: UseReviewRatingReactionsResult["events"];
}>;

export type UseReviewScreenControllerParams = Readonly<{
  reviewReactionAnimationsEnabled: boolean;
}>;

type AutomaticFeedbackPromptUiState = Readonly<{
  isEditorPresented: boolean;
  isFeedbackDialogOpen: boolean;
  isHardReminderVisible: boolean;
  isReviewFilterMenuOpen: boolean;
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
  const [isFeedbackDialogOpen, setIsFeedbackDialogOpen] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");
  const [feedbackErrorMessage, setFeedbackErrorMessage] = useState<string>("");
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState<boolean>(false);
  const [hardReminderLastShownAt, setHardReminderLastShownAt] = useState<number | null>(() => loadReviewHardReminderLastShownAt());
  const automaticFeedbackPromptUiStateRef = useRef<AutomaticFeedbackPromptUiState>({
    isEditorPresented: false,
    isFeedbackDialogOpen: false,
    isHardReminderVisible: false,
    isReviewFilterMenuOpen: false,
  });
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
    localWorkspaceCardCount,
    queueCards,
    resolvedReviewFilter,
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
  automaticFeedbackPromptUiStateRef.current = {
    isEditorPresented,
    isFeedbackDialogOpen,
    isHardReminderVisible,
    isReviewFilterMenuOpen,
  };
  const nowTimestamp = Date.now();
  const selectedFrontSpeakableText = selectedCard === null ? "" : makeReviewSpeakableText(selectedCard.frontText);
  const selectedBackSpeakableText = selectedCard === null ? "" : makeReviewSpeakableText(selectedCard.backText);
  const hasCards = localWorkspaceCardCount > 0;
  const shouldShowSwitchToAllCardsAction = resolvedReviewFilter.kind !== "allCards";
  const feedbackPromptIdentityKey = buildFeedbackPromptIdentityKey({
    sessionUserId: session?.userId ?? null,
    linkedUserId: cloudSettings?.linkedUserId ?? null,
  });
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

  function captureFeedbackOperationError(
    error: unknown,
    operation: "feedback_activity_load" | "feedback_state_load" | "feedback_prompt_event" | "feedback_submit",
    entityId: string | null,
  ): void {
    captureAppOperationError(error, {
      feature: "feedback",
      operation,
      userId: session?.userId ?? null,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      installationId: cloudSettings?.installationId ?? null,
      entityId,
    });
  }

  function isAutomaticFeedbackPromptUiBlocked(): boolean {
    const uiState = automaticFeedbackPromptUiStateRef.current;
    return uiState.isEditorPresented
      || uiState.isFeedbackDialogOpen
      || uiState.isHardReminderVisible
      || uiState.isReviewFilterMenuOpen;
  }

  async function postAutomaticFeedbackPromptEvent(eventType: FeedbackPromptEventType): Promise<void> {
    try {
      const now = new Date();
      const feedbackState = await recordFeedbackPromptEvent(buildFeedbackPromptEventRequest({
        workspaceId: activeWorkspace?.workspaceId ?? null,
        locale,
        eventType,
        now,
      }));
      await storeFetchedFeedbackState({
        identityKey: feedbackPromptIdentityKey,
        feedbackState,
        fetchedAt: now.toISOString(),
      });
    } catch (error) {
      captureFeedbackOperationError(error, "feedback_prompt_event", eventType);
    }
  }

  async function maybeOpenAutomaticFeedbackPrompt(): Promise<void> {
    const workspaceId = activeWorkspace?.workspaceId ?? null;
    if (workspaceId === null || isAutomaticFeedbackPromptUiBlocked()) {
      return;
    }

    try {
      const now = new Date();
      const nowMillis = now.getTime();
      let reviewActivity: AutomaticFeedbackPromptReviewActivity;
      try {
        reviewActivity = await loadAutomaticFeedbackPromptReviewActivity(workspaceId, now);
      } catch (error) {
        captureFeedbackOperationError(error, "feedback_activity_load", null);
        return;
      }

      let promptState: FeedbackPromptState;
      try {
        promptState = await loadFeedbackPromptState(feedbackPromptIdentityKey);
      } catch (error) {
        captureFeedbackOperationError(error, "feedback_state_load", null);
        return;
      }

      let decisionInput = {
        reviewActivity,
        promptState,
        nowMillis,
      };
      if (shouldRequestAutomaticFeedbackState(decisionInput)) {
        try {
          const feedbackState = await loadFeedbackState();
          promptState = await storeFetchedFeedbackState({
            identityKey: feedbackPromptIdentityKey,
            feedbackState,
            fetchedAt: new Date().toISOString(),
          });
          decisionInput = {
            reviewActivity,
            promptState,
            nowMillis: Date.now(),
          };
        } catch (error) {
          captureFeedbackOperationError(error, "feedback_state_load", null);
          return;
        }
      }

      if (evaluateAutomaticFeedbackPromptEligibility(decisionInput).isEligible === false) {
        return;
      }

      if (isAutomaticFeedbackPromptUiBlocked()) {
        return;
      }

      const shownAt = new Date();
      await storeAutomaticFeedbackPromptShownAt({
        identityKey: feedbackPromptIdentityKey,
        shownAt: shownAt.toISOString(),
        nextAutomaticFeedbackPromptAt: buildNextAutomaticFeedbackPromptAt(shownAt),
      });
      setFeedbackMessage("");
      setFeedbackErrorMessage("");
      setIsFeedbackSubmitting(false);
      setIsFeedbackDialogOpen(true);
      void postAutomaticFeedbackPromptEvent("automatic_prompt_shown");
    } catch (error) {
      captureFeedbackOperationError(error, "feedback_state_load", null);
    }
  }

  function closeFeedbackDialog(): void {
    setIsFeedbackDialogOpen(false);
    setFeedbackMessage("");
    setFeedbackErrorMessage("");
  }

  function dismissAutomaticFeedbackDialog(): void {
    closeFeedbackDialog();
    void postAutomaticFeedbackPromptEvent("automatic_prompt_dismissed");
  }

  async function submitAutomaticFeedback(): Promise<void> {
    const normalizedMessage = normalizeFeedbackMessage(feedbackMessage);
    if (normalizedMessage === "") {
      setFeedbackErrorMessage(t("feedback.emptyError"));
      return;
    }

    if (normalizedMessage.length > feedbackMaximumMessageLength) {
      setFeedbackErrorMessage(t("feedback.tooLongError"));
      return;
    }

    let submissionRequest: FeedbackSubmissionRequest;
    try {
      submissionRequest = buildFeedbackSubmissionRequest({
        workspaceId: activeWorkspace?.workspaceId ?? null,
        locale,
        trigger: "automatic",
        message: normalizedMessage,
        now: new Date(),
      });
    } catch (error) {
      captureFeedbackOperationError(error, "feedback_submit", null);
      setFeedbackErrorMessage(t("feedback.submitError"));
      return;
    }

    setIsFeedbackSubmitting(true);
    setFeedbackErrorMessage("");
    try {
      const feedbackState = await submitFeedback(submissionRequest);
      await storeFeedbackSubmittedAt({
        identityKey: feedbackPromptIdentityKey,
        feedbackState,
        submittedAt: submissionRequest.createdAtClient,
      });
      closeFeedbackDialog();
      showReviewFeedbackMessage(t("feedback.success"));
    } catch (error) {
      captureFeedbackOperationError(error, "feedback_submit", submissionRequest.feedbackSubmissionId);
      setFeedbackErrorMessage(t("feedback.submitError"));
    } finally {
      setIsFeedbackSubmitting(false);
    }
  }

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
        void maybeOpenAutomaticFeedbackPrompt();
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
    setIsFeedbackDialogOpen(false);
    setFeedbackMessage("");
    setFeedbackErrorMessage("");
    setIsFeedbackSubmitting(false);
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
    dismissReviewReactions,
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
    feedbackDialogProps: {
      isOpen: isFeedbackDialogOpen,
      message: feedbackMessage,
      errorMessage: feedbackErrorMessage,
      isSubmitting: isFeedbackSubmitting,
      onMessageChange: setFeedbackMessage,
      onSubmit: submitAutomaticFeedback,
      onDismiss: dismissAutomaticFeedbackDialog,
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
      reviewSpeechMessage: reviewFeedbackMessage !== "" ? reviewFeedbackMessage : reviewSpeechMessage,
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
    reviewReactionFallbackHandler: handleReviewReactionEventFallback,
    reviewReactionEvents,
  };
}

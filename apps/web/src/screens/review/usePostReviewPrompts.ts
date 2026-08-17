import { useEffect, useRef, useState } from "react";
import {
  loadFeedbackState,
  loadReviewPlatformSummary,
  recordFeedbackPromptEvent,
  submitFeedback,
} from "../../api";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
} from "../../appError/AppErrorContext";
import { webReviewMobilePromptStoreLinks } from "../../appPlatformLinks";
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
import { type Locale, useI18n } from "../../i18n";
import {
  buildFeedbackPromptIdentityKey,
  loadFeedbackPromptState,
  storeAutomaticFeedbackPromptShownAt,
  storeFeedbackSubmittedAt,
  storeFetchedFeedbackState,
  type FeedbackPromptState,
} from "../../localDb/feedback/feedback";
import {
  clearMobileAppPromotionPromptShownIfCurrent,
  loadMobileAppPromotionState,
  storeKnownMobileReviewEvent,
  storeMobileAppPromotionPromptShown,
  type MobileAppPromotionState,
} from "../../localDb/mobileAppPromotion/mobileAppPromotion";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import type { FeedbackPromptEventType, FeedbackSubmissionRequest } from "../../types";
import {
  evaluateMobileAppPromotionEligibility,
  loadMobileAppPromotionReviewActivity,
  mobileAppPromotionMinimumReviewCount,
  type MobileAppPromotionReviewActivity,
} from "./mobileAppPromo/mobileAppPromotionEligibility";
import type { MobileAppPromotionDialogProps } from "./mobileAppPromo/MobileAppPromotionDialog";

type PostReviewPromptUiState = Readonly<{
  isEditorPresented: boolean;
  isFeedbackDialogOpen: boolean;
  isHardReminderVisible: boolean;
  isMobileAppPromotionDialogOpen: boolean;
  isReviewFilterMenuOpen: boolean;
}>;

type PostReviewPromptContext = Readonly<{
  generation: number;
  identityKey: string;
  isMounted: boolean;
  workspaceId: string | null;
}>;

type MobileAppPromotionPromptDecision = Readonly<{
  kind: "cancelled" | "opened" | "skipped";
}>;

type MobileAppPromotionInFlightCheck = Readonly<{
  context: PostReviewPromptContext;
  promise: Promise<MobileAppPromotionPromptDecision>;
}>;

export type UsePostReviewPromptsParams = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  installationId: string | null;
  isEditorPresented: boolean;
  isHardReminderVisible: boolean;
  isReviewFilterMenuOpen: boolean;
  linkedUserId: string | null;
  locale: Locale;
  onFeedbackSubmitted: (message: string) => void;
  userId: string | null;
  workspaceId: string | null;
}>;

export type UsePostReviewPromptsResult = Readonly<{
  feedbackDialogProps: FeedbackDialogProps;
  isFeedbackDialogOpen: boolean;
  isMobileAppPromotionDialogOpen: boolean;
  maybeOpenPostReviewPrompt: () => Promise<void>;
  mobileAppPromotionDialogProps: MobileAppPromotionDialogProps;
}>;

export function usePostReviewPrompts(params: UsePostReviewPromptsParams): UsePostReviewPromptsResult {
  const {
    indexedDbOpenRecoveryState,
    installationId,
    isEditorPresented,
    isHardReminderVisible,
    isReviewFilterMenuOpen,
    linkedUserId,
    locale,
    onFeedbackSubmitted,
    userId,
    workspaceId,
  } = params;
  const { t } = useI18n();
  const [isFeedbackDialogOpen, setIsFeedbackDialogOpen] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");
  const [feedbackErrorMessage, setFeedbackErrorMessage] = useState<string>("");
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState<boolean>(false);
  const [isMobileAppPromotionDialogOpen, setIsMobileAppPromotionDialogOpen] = useState<boolean>(false);
  const promptUiStateRef = useRef<PostReviewPromptUiState>({
    isEditorPresented: false,
    isFeedbackDialogOpen: false,
    isHardReminderVisible: false,
    isMobileAppPromotionDialogOpen: false,
    isReviewFilterMenuOpen: false,
  });
  const promptContextRef = useRef<PostReviewPromptContext>({
    generation: 0,
    identityKey: "",
    isMounted: true,
    workspaceId: null,
  });
  const mobileAppPromotionCheckInFlightRef = useRef<MobileAppPromotionInFlightCheck | null>(null);
  const feedbackPromptIdentityKey = buildFeedbackPromptIdentityKey({
    sessionUserId: userId,
    linkedUserId,
  });

  promptUiStateRef.current = {
    isEditorPresented,
    isFeedbackDialogOpen,
    isHardReminderVisible,
    isMobileAppPromotionDialogOpen,
    isReviewFilterMenuOpen,
  };

  const currentPromptContext = promptContextRef.current;
  if (
    currentPromptContext.workspaceId !== workspaceId
    || currentPromptContext.identityKey !== feedbackPromptIdentityKey
  ) {
    promptContextRef.current = {
      generation: currentPromptContext.generation + 1,
      identityKey: feedbackPromptIdentityKey,
      isMounted: true,
      workspaceId,
    };
  }

  function markIndexedDbOpenRecoveryFailure(error: unknown): boolean {
    return markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error);
  }

  function captureFeedbackOperationError(
    error: unknown,
    operation: "feedback_activity_load" | "feedback_state_load" | "feedback_prompt_event" | "feedback_submit",
    entityId: string | null,
  ): void {
    captureAppOperationError(error, {
      feature: "feedback",
      operation,
      userId,
      workspaceId,
      installationId,
      entityId,
    });
  }

  function captureMobileAppPromotionOperationError(
    error: unknown,
    operation:
      | "mobile_app_promo_activity_load"
      | "mobile_app_promo_state_load"
      | "mobile_app_promo_status_load"
      | "mobile_app_promo_state_save",
    entityId: string | null,
  ): void {
    captureAppOperationError(error, {
      feature: "mobile_app_promo",
      operation,
      userId,
      workspaceId,
      installationId,
      entityId,
    });
  }

  function isReviewPromptUiBlocked(): boolean {
    const uiState = promptUiStateRef.current;
    return uiState.isEditorPresented
      || uiState.isFeedbackDialogOpen
      || uiState.isHardReminderVisible
      || uiState.isMobileAppPromotionDialogOpen
      || uiState.isReviewFilterMenuOpen;
  }

  function isPromptContextCurrent(context: PostReviewPromptContext): boolean {
    const currentContext = promptContextRef.current;
    return currentContext.isMounted
      && currentContext.generation === context.generation
      && currentContext.workspaceId === context.workspaceId
      && currentContext.identityKey === context.identityKey;
  }

  function isSamePromptContext(
    leftContext: PostReviewPromptContext,
    rightContext: PostReviewPromptContext,
  ): boolean {
    return leftContext.generation === rightContext.generation
      && leftContext.workspaceId === rightContext.workspaceId
      && leftContext.identityKey === rightContext.identityKey;
  }

  function buildSkippedMobileAppPromotionDecision(
    promptContext: PostReviewPromptContext,
  ): MobileAppPromotionPromptDecision {
    return isPromptContextCurrent(promptContext)
      ? { kind: "skipped" }
      : { kind: "cancelled" };
  }

  async function postAutomaticFeedbackPromptEvent(eventType: FeedbackPromptEventType): Promise<void> {
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const now = new Date();
      const feedbackState = await recordFeedbackPromptEvent(buildFeedbackPromptEventRequest({
        workspaceId,
        locale,
        eventType,
        now,
      }));
      indexedDbOpenRecoveryState.throwIfFailed();
      await storeFetchedFeedbackState({
        identityKey: feedbackPromptIdentityKey,
        feedbackState,
        fetchedAt: now.toISOString(),
      }, indexedDbOpenRecoveryState.throwIfFailed);
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailure(error)) {
        return;
      }
      captureFeedbackOperationError(error, "feedback_prompt_event", eventType);
    }
  }

  async function maybeOpenAutomaticFeedbackPrompt(): Promise<void> {
    if (workspaceId === null || isReviewPromptUiBlocked()) {
      return;
    }

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const now = new Date();
      const nowMillis = now.getTime();
      let reviewActivity: AutomaticFeedbackPromptReviewActivity;
      try {
        reviewActivity = await loadAutomaticFeedbackPromptReviewActivity(
          workspaceId,
          now,
          indexedDbOpenRecoveryState,
        );
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailure(error)) {
          return;
        }
        captureFeedbackOperationError(error, "feedback_activity_load", null);
        return;
      }

      let promptState: FeedbackPromptState;
      try {
        promptState = await loadFeedbackPromptState(feedbackPromptIdentityKey);
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailure(error)) {
          return;
        }
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
          indexedDbOpenRecoveryState.throwIfFailed();
          promptState = await storeFetchedFeedbackState({
            identityKey: feedbackPromptIdentityKey,
            feedbackState,
            fetchedAt: new Date().toISOString(),
          }, indexedDbOpenRecoveryState.throwIfFailed);
          indexedDbOpenRecoveryState.throwIfFailed();
          decisionInput = {
            reviewActivity,
            promptState,
            nowMillis: Date.now(),
          };
        } catch (error) {
          if (markIndexedDbOpenRecoveryFailure(error)) {
            return;
          }
          captureFeedbackOperationError(error, "feedback_state_load", null);
          return;
        }
      }

      if (evaluateAutomaticFeedbackPromptEligibility(decisionInput).isEligible === false) {
        return;
      }

      if (isReviewPromptUiBlocked()) {
        return;
      }

      const shownAt = new Date();
      await storeAutomaticFeedbackPromptShownAt({
        identityKey: feedbackPromptIdentityKey,
        shownAt: shownAt.toISOString(),
        nextAutomaticFeedbackPromptAt: buildNextAutomaticFeedbackPromptAt(shownAt),
      }, indexedDbOpenRecoveryState.throwIfFailed);
      indexedDbOpenRecoveryState.throwIfFailed();
      setFeedbackMessage("");
      setFeedbackErrorMessage("");
      setIsFeedbackSubmitting(false);
      setIsFeedbackDialogOpen(true);
      void postAutomaticFeedbackPromptEvent("automatic_prompt_shown");
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailure(error)) {
        return;
      }
      captureFeedbackOperationError(error, "feedback_state_load", null);
    }
  }

  async function runMobileAppPromotionCheck(
    promptContext: PostReviewPromptContext,
  ): Promise<MobileAppPromotionPromptDecision> {
    const contextWorkspaceId = promptContext.workspaceId;
    if (contextWorkspaceId === null || isReviewPromptUiBlocked()) {
      return { kind: "skipped" };
    }

    if (isPromptContextCurrent(promptContext) === false) {
      return { kind: "cancelled" };
    }

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const now = new Date();
      let reviewActivity: MobileAppPromotionReviewActivity;
      try {
        reviewActivity = await loadMobileAppPromotionReviewActivity(contextWorkspaceId, now);
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailure(error)) {
          return { kind: "cancelled" };
        }
        captureMobileAppPromotionOperationError(error, "mobile_app_promo_activity_load", null);
        return buildSkippedMobileAppPromotionDecision(promptContext);
      }

      if (isPromptContextCurrent(promptContext) === false) {
        return { kind: "cancelled" };
      }

      if (reviewActivity.todayReviewCount < mobileAppPromotionMinimumReviewCount) {
        return { kind: "skipped" };
      }

      if (isPromptContextCurrent(promptContext) === false) {
        return { kind: "cancelled" };
      }

      let promptState: MobileAppPromotionState;
      try {
        promptState = await loadMobileAppPromotionState(promptContext.identityKey);
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailure(error)) {
          return { kind: "cancelled" };
        }
        captureMobileAppPromotionOperationError(error, "mobile_app_promo_state_load", null);
        return buildSkippedMobileAppPromotionDecision(promptContext);
      }

      if (isPromptContextCurrent(promptContext) === false) {
        return { kind: "cancelled" };
      }

      const localEligibility = evaluateMobileAppPromotionEligibility({
        reviewActivity,
        promptState,
        hasMobileReviewEvent: false,
      });
      if (localEligibility.isEligible === false) {
        return { kind: "skipped" };
      }

      let hasMobileReviewEvent: boolean;
      try {
        hasMobileReviewEvent = (await loadReviewPlatformSummary()).hasMobileReviewEvent;
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailure(error)) {
          return { kind: "cancelled" };
        }
        captureMobileAppPromotionOperationError(error, "mobile_app_promo_status_load", null);
        return buildSkippedMobileAppPromotionDecision(promptContext);
      }

      if (isPromptContextCurrent(promptContext) === false) {
        return { kind: "cancelled" };
      }

      if (hasMobileReviewEvent) {
        try {
          await storeKnownMobileReviewEvent({
            identityKey: promptContext.identityKey,
          }, indexedDbOpenRecoveryState.throwIfFailed);
          indexedDbOpenRecoveryState.throwIfFailed();
        } catch (error) {
          if (markIndexedDbOpenRecoveryFailure(error)) {
            return { kind: "cancelled" };
          }
          captureMobileAppPromotionOperationError(error, "mobile_app_promo_state_save", null);
        }
        return buildSkippedMobileAppPromotionDecision(promptContext);
      }

      try {
        promptState = await loadMobileAppPromotionState(promptContext.identityKey);
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailure(error)) {
          return { kind: "cancelled" };
        }
        captureMobileAppPromotionOperationError(error, "mobile_app_promo_state_load", null);
        return buildSkippedMobileAppPromotionDecision(promptContext);
      }

      if (isPromptContextCurrent(promptContext) === false) {
        return { kind: "cancelled" };
      }

      const remoteEligibility = evaluateMobileAppPromotionEligibility({
        reviewActivity,
        promptState,
        hasMobileReviewEvent,
      });
      if (remoteEligibility.isEligible === false || isReviewPromptUiBlocked()) {
        return { kind: "skipped" };
      }

      if (isPromptContextCurrent(promptContext) === false) {
        return { kind: "cancelled" };
      }

      const shownAt = new Date();
      const shownAtIso = shownAt.toISOString();
      try {
        await storeMobileAppPromotionPromptShown({
          identityKey: promptContext.identityKey,
          localDate: reviewActivity.today,
          shownAt: shownAtIso,
        }, indexedDbOpenRecoveryState.throwIfFailed);
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailure(error)) {
          return { kind: "cancelled" };
        }
        captureMobileAppPromotionOperationError(error, "mobile_app_promo_state_save", null);
        return buildSkippedMobileAppPromotionDecision(promptContext);
      }

      const isStaleAfterSave = isPromptContextCurrent(promptContext) === false;
      if (isReviewPromptUiBlocked() || isStaleAfterSave) {
        try {
          await clearMobileAppPromotionPromptShownIfCurrent({
            identityKey: promptContext.identityKey,
            localDate: reviewActivity.today,
            shownAt: shownAtIso,
          }, indexedDbOpenRecoveryState.throwIfFailed);
          indexedDbOpenRecoveryState.throwIfFailed();
        } catch (error) {
          if (markIndexedDbOpenRecoveryFailure(error)) {
            return { kind: "cancelled" };
          }
          captureMobileAppPromotionOperationError(error, "mobile_app_promo_state_save", null);
        }
        return buildSkippedMobileAppPromotionDecision(promptContext);
      }

      setIsMobileAppPromotionDialogOpen(true);
      return { kind: "opened" };
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailure(error)) {
        return { kind: "cancelled" };
      }
      captureMobileAppPromotionOperationError(error, "mobile_app_promo_state_load", null);
      return buildSkippedMobileAppPromotionDecision(promptContext);
    }
  }

  async function maybeOpenMobileAppPromotion(
    promptContext: PostReviewPromptContext,
  ): Promise<MobileAppPromotionPromptDecision> {
    const currentCheck = mobileAppPromotionCheckInFlightRef.current;
    if (
      currentCheck !== null
      && isSamePromptContext(currentCheck.context, promptContext)
      && isPromptContextCurrent(currentCheck.context)
    ) {
      return currentCheck.promise;
    }

    const nextPromise = runMobileAppPromotionCheck(promptContext);
    const nextCheck: MobileAppPromotionInFlightCheck = {
      context: promptContext,
      promise: nextPromise,
    };
    mobileAppPromotionCheckInFlightRef.current = nextCheck;
    try {
      return await nextPromise;
    } finally {
      if (mobileAppPromotionCheckInFlightRef.current === nextCheck) {
        mobileAppPromotionCheckInFlightRef.current = null;
      }
    }
  }

  async function maybeOpenPostReviewPrompt(): Promise<void> {
    const promptContext = promptContextRef.current;
    const mobileAppPromotionDecision = await maybeOpenMobileAppPromotion(promptContext);
    if (
      mobileAppPromotionDecision.kind === "cancelled"
      || indexedDbOpenRecoveryState.hasFailed()
    ) {
      return;
    }

    if (
      mobileAppPromotionDecision.kind === "skipped"
      && isPromptContextCurrent(promptContext)
    ) {
      await maybeOpenAutomaticFeedbackPrompt();
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

  function dismissMobileAppPromotionDialog(): void {
    setIsMobileAppPromotionDialogOpen(false);
  }

  async function submitAutomaticFeedback(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

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
        workspaceId,
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
      indexedDbOpenRecoveryState.throwIfFailed();
      const feedbackState = await submitFeedback(submissionRequest);
      indexedDbOpenRecoveryState.throwIfFailed();
      await storeFeedbackSubmittedAt({
        identityKey: feedbackPromptIdentityKey,
        feedbackState,
        submittedAt: submissionRequest.createdAtClient,
      }, indexedDbOpenRecoveryState.throwIfFailed);
      indexedDbOpenRecoveryState.throwIfFailed();
      closeFeedbackDialog();
      onFeedbackSubmitted(t("feedback.success"));
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailure(error)) {
        return;
      }
      captureFeedbackOperationError(error, "feedback_submit", submissionRequest.feedbackSubmissionId);
      setFeedbackErrorMessage(t("feedback.submitError"));
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsFeedbackSubmitting(false);
      }
    }
  }

  useEffect(() => {
    if (indexedDbOpenRecoveryState.isFailed === false) {
      return;
    }

    const currentContext = promptContextRef.current;
    promptContextRef.current = {
      ...currentContext,
      generation: currentContext.generation + 1,
    };
    mobileAppPromotionCheckInFlightRef.current = null;
  }, [indexedDbOpenRecoveryState.isFailed]);

  useEffect(() => {
    setIsFeedbackDialogOpen(false);
    setFeedbackMessage("");
    setFeedbackErrorMessage("");
    setIsFeedbackSubmitting(false);
    setIsMobileAppPromotionDialogOpen(false);
  }, [workspaceId]);

  useEffect(() => {
    return () => {
      const currentContext = promptContextRef.current;
      promptContextRef.current = {
        ...currentContext,
        generation: currentContext.generation + 1,
        isMounted: false,
      };
    };
  }, []);

  return {
    feedbackDialogProps: {
      isOpen: isFeedbackDialogOpen,
      message: feedbackMessage,
      errorMessage: feedbackErrorMessage,
      isSubmitting: isFeedbackSubmitting,
      onMessageChange: setFeedbackMessage,
      onSubmit: submitAutomaticFeedback,
      onDismiss: dismissAutomaticFeedbackDialog,
    },
    isFeedbackDialogOpen,
    isMobileAppPromotionDialogOpen,
    maybeOpenPostReviewPrompt,
    mobileAppPromotionDialogProps: {
      isOpen: isMobileAppPromotionDialogOpen,
      onDismiss: dismissMobileAppPromotionDialog,
      storeLinks: webReviewMobilePromptStoreLinks,
    },
  };
}

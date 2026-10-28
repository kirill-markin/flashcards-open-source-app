import { useEffect, useRef, useState } from "react";
import {
  reviewPromptConfig,
  type ReviewPromptSettings,
} from "../../../../backend/src/reviewPrompts/reviewPromptConfig";
import type { ReviewRating } from "../../../../backend/src/scheduling";
import {
  restoreCurrentAnalyticsSurface,
  track,
  trackReviewPromptScreenViewed,
  trackScreenViewedOnDismiss,
} from "../../analytics";
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
import { readPendingGuestConversion } from "../../appData/session/guest/browserGuestStorage";
import { webReviewMobilePromptStoreLinks } from "../../appPlatformLinks";
import {
  isAutomaticFeedbackPromptEligible,
  shouldRequestAutomaticFeedbackState,
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
  restoreAutomaticFeedbackPromptShownIfCurrent,
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
import { readEntitlementSnapshot } from "../../premium/entitlementStore";
import { useReviewPaywallPresenter } from "../../premium/PremiumProvider";
import {
  dueReviewPaywall,
  isKnownFreeEntitlement,
  type ReviewPaywallPromptId,
} from "../../premium/reviewPaywall/schedule";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import type { FeedbackPromptEventType, FeedbackSubmissionRequest } from "../../types";
import type { GuestSignInAfterReviewPromptProps } from "./guest/GuestSignInAfterReviewPrompt";
import {
  loadGuestSignInAfterReviewLastShownAt,
  saveGuestSignInAfterReviewLastShownAt,
} from "./guest/guestSignInAfterReviewStorage";
import type { ReviewHardReminderDialogProps } from "./hardReminder/ReviewHardReminderDialog";
import {
  loadReviewHardReminderLastShownAt,
  saveReviewHardReminderLastShownAt,
  shouldShowReviewHardReminder,
} from "./hardReminder/reviewHardReminder";
import { evaluateMobileAppPromotionEligibility } from "./mobileAppPromo/mobileAppPromotionEligibility";
import type { MobileAppPromotionDialogProps } from "./mobileAppPromo/MobileAppPromotionDialog";
import { loadReviewPromptCounters } from "./prompts/reviewPromptCounters";
import {
  getReviewPromptDayLimit,
  hasReviewPromptCounterConditions,
  isReviewPromptCooldownElapsed,
  listWebReviewPromptOrder,
  passesReviewPromptCounterConditions,
  type ReviewPromptCounters,
  type WebReviewPromptId,
} from "./prompts/reviewPromptRules";

type PostReviewPromptUiState = Readonly<{
  isEditorPresented: boolean;
  isFeedbackDialogOpen: boolean;
  isGuestSignInPromptVisible: boolean;
  isHardReminderVisible: boolean;
  isMobileAppPromotionDialogOpen: boolean;
  isReviewFilterMenuOpen: boolean;
  isReviewMoreActionsMenuOpen: boolean;
  isTagFilterDialogOpen: boolean;
  isTextSelectionDialogOpen: boolean;
}>;

type PostReviewPromptContext = Readonly<{
  generation: number;
  identityKey: string;
  isMounted: boolean;
  workspaceId: string | null;
}>;

// `skipped` moves on to the next prompt in the config order; `opened` and `cancelled` end the walk.
type ReviewPromptDecision = Readonly<{
  kind: "cancelled" | "opened" | "skipped";
}>;

type MobileAppPromotionInFlightCheck = Readonly<{
  context: PostReviewPromptContext;
  promise: Promise<ReviewPromptDecision>;
}>;

export type UsePostReviewPromptsParams = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  installationId: string | null;
  isEditorPresented: boolean;
  isGuest: boolean;
  isReviewFilterMenuOpen: boolean;
  isReviewMoreActionsMenuOpen: boolean;
  isSessionVerified: boolean;
  isTagFilterDialogOpen: boolean;
  isTextSelectionDialogOpen: boolean;
  linkedUserId: string | null;
  locale: Locale;
  onFeedbackSubmitted: (message: string) => void;
  reviewWorkspaceIds: ReadonlyArray<string>;
  userId: string | null;
  workspaceId: string | null;
}>;

export type UsePostReviewPromptsResult = Readonly<{
  beginSavedReviewPromptOpportunity: () => void;
  feedbackDialogProps: FeedbackDialogProps;
  guestSignInPromptProps: GuestSignInAfterReviewPromptProps;
  hardReminderDialogProps: ReviewHardReminderDialogProps;
  isFeedbackDialogOpen: boolean;
  isGuestSignInPromptVisible: boolean;
  isHardReminderVisible: boolean;
  isMobileAppPromotionDialogOpen: boolean;
  maybeOpenPostReviewPrompt: (recentReviewRatings: ReadonlyArray<ReviewRating>) => Promise<void>;
  mobileAppPromotionDialogProps: MobileAppPromotionDialogProps;
}>;

export function usePostReviewPrompts(params: UsePostReviewPromptsParams): UsePostReviewPromptsResult {
  const {
    indexedDbOpenRecoveryState,
    installationId,
    isEditorPresented,
    isGuest,
    isReviewFilterMenuOpen,
    isReviewMoreActionsMenuOpen,
    isSessionVerified,
    isTagFilterDialogOpen,
    isTextSelectionDialogOpen,
    linkedUserId,
    locale,
    onFeedbackSubmitted,
    reviewWorkspaceIds,
    userId,
    workspaceId,
  } = params;
  const { t } = useI18n();
  const reviewPaywall = useReviewPaywallPresenter();
  const [isFeedbackDialogOpen, setIsFeedbackDialogOpen] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");
  const [feedbackErrorMessage, setFeedbackErrorMessage] = useState<string>("");
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState<boolean>(false);
  const [isMobileAppPromotionDialogOpen, setIsMobileAppPromotionDialogOpen] = useState<boolean>(false);
  const [isHardReminderVisible, setIsHardReminderVisible] = useState<boolean>(false);
  const [isGuestSignInPromptOpen, setIsGuestSignInPromptOpen] = useState<boolean>(false);
  // The prompt asks a verified guest to sign in; it hides once the person is no longer one.
  const isGuestSignInPromptVisible = isGuestSignInPromptOpen && isGuest && isSessionVerified;
  // One `prompt_answered` per showing: the first store-link click accepts, and only a close
  // without one dismisses.
  const isMobileAppPromotionAnsweredRef = useRef<boolean>(false);
  // One `prompt_answered` per showing, recorded on the sign-in press as iOS and Android do.
  const isGuestSignInPromptAnsweredRef = useRef<boolean>(false);
  const promptUiStateRef = useRef<PostReviewPromptUiState>({
    isEditorPresented: false,
    isFeedbackDialogOpen: false,
    isGuestSignInPromptVisible: false,
    isHardReminderVisible: false,
    isMobileAppPromotionDialogOpen: false,
    isReviewFilterMenuOpen: false,
    isReviewMoreActionsMenuOpen: false,
    isTagFilterDialogOpen: false,
    isTextSelectionDialogOpen: false,
  });
  const promptContextRef = useRef<PostReviewPromptContext>({
    generation: 0,
    identityKey: "",
    isMounted: true,
    workspaceId: null,
  });
  const mobileAppPromotionCheckInFlightRef = useRef<MobileAppPromotionInFlightCheck | null>(null);
  const postReviewCheckInFlightRef = useRef<boolean>(false);
  const wasUiBlockedRef = useRef<boolean>(false);
  const feedbackPromptIdentityKey = buildFeedbackPromptIdentityKey({
    sessionUserId: userId,
    linkedUserId,
  });

  promptUiStateRef.current = {
    isEditorPresented,
    isFeedbackDialogOpen,
    isGuestSignInPromptVisible,
    isHardReminderVisible,
    isMobileAppPromotionDialogOpen,
    isReviewFilterMenuOpen,
    isReviewMoreActionsMenuOpen,
    isTagFilterDialogOpen,
    isTextSelectionDialogOpen,
  };

  const isUiBlocked = isReviewPromptUiBlocked();
  const currentPromptContext = promptContextRef.current;
  if (
    currentPromptContext.workspaceId !== workspaceId
    || currentPromptContext.identityKey !== feedbackPromptIdentityKey
    || (isUiBlocked && !wasUiBlockedRef.current)
  ) {
    promptContextRef.current = {
      generation: currentPromptContext.generation + 1,
      identityKey: feedbackPromptIdentityKey,
      isMounted: true,
      workspaceId,
    };
  }

  wasUiBlockedRef.current = isUiBlocked;

  function markIndexedDbOpenRecoveryFailure(error: unknown): boolean {
    return markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error);
  }

  function captureFeedbackOperationError(
    error: unknown,
    operation: "feedback_state_load" | "feedback_prompt_event" | "feedback_submit",
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

  function captureReviewPromptOperationError(
    error: unknown,
    operation: "paywall_state_sync" | "review_prompt_activity_load" | "review_prompt_state_load" | "review_prompt_state_save",
    entityId: string | null,
  ): void {
    captureAppOperationError(error, {
      feature: "review",
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
      || uiState.isGuestSignInPromptVisible
      || uiState.isHardReminderVisible
      || uiState.isMobileAppPromotionDialogOpen
      || uiState.isReviewFilterMenuOpen
      || uiState.isReviewMoreActionsMenuOpen
      || uiState.isTagFilterDialogOpen
      || uiState.isTextSelectionDialogOpen
      || reviewPaywall?.isBusy() === true;
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
  ): ReviewPromptDecision {
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

  async function maybeOpenAutomaticFeedbackPrompt(
    settings: ReviewPromptSettings,
    promptContext: PostReviewPromptContext,
  ): Promise<ReviewPromptDecision> {
    if (workspaceId === null) {
      return { kind: "skipped" };
    }

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      let promptState: FeedbackPromptState;
      try {
        promptState = await loadFeedbackPromptState(feedbackPromptIdentityKey);
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailure(error)) {
          return { kind: "cancelled" };
        }
        captureFeedbackOperationError(error, "feedback_state_load", null);
        return { kind: "cancelled" };
      }

      let eligibilityInput = {
        settings,
        promptState,
        nowMillis: Date.now(),
      };
      if (shouldRequestAutomaticFeedbackState(eligibilityInput)) {
        try {
          const feedbackState = await loadFeedbackState();
          indexedDbOpenRecoveryState.throwIfFailed();
          promptState = await storeFetchedFeedbackState({
            identityKey: feedbackPromptIdentityKey,
            feedbackState,
            fetchedAt: new Date().toISOString(),
          }, indexedDbOpenRecoveryState.throwIfFailed);
          indexedDbOpenRecoveryState.throwIfFailed();
          eligibilityInput = {
            settings,
            promptState,
            nowMillis: Date.now(),
          };
        } catch (error) {
          if (markIndexedDbOpenRecoveryFailure(error)) {
            return { kind: "cancelled" };
          }
          captureFeedbackOperationError(error, "feedback_state_load", null);
          return { kind: "cancelled" };
        }
      }

      if (isAutomaticFeedbackPromptEligible(eligibilityInput) === false) {
        return { kind: "skipped" };
      }

      if (isReviewPromptUiBlocked() || !isPromptContextCurrent(promptContext)) {
        return { kind: "cancelled" };
      }

      const shownChange = await storeAutomaticFeedbackPromptShownAt({
        identityKey: feedbackPromptIdentityKey,
        shownAt: new Date().toISOString(),
        // Eligibility reads only the shown time; null leaves the stored next-prompt time unchanged.
        nextAutomaticFeedbackPromptAt: null,
      }, indexedDbOpenRecoveryState.throwIfFailed);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (isReviewPromptUiBlocked() || !isPromptContextCurrent(promptContext)) {
        await restoreAutomaticFeedbackPromptShownIfCurrent(
          feedbackPromptIdentityKey,
          shownChange,
          indexedDbOpenRecoveryState.throwIfFailed,
        );
        indexedDbOpenRecoveryState.throwIfFailed();
        return { kind: "cancelled" };
      }
      setFeedbackMessage("");
      setFeedbackErrorMessage("");
      setIsFeedbackSubmitting(false);
      setIsFeedbackDialogOpen(true);
      void postAutomaticFeedbackPromptEvent("automatic_prompt_shown");
      return { kind: "opened" };
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailure(error)) {
        return { kind: "cancelled" };
      }
      captureFeedbackOperationError(error, "feedback_state_load", null);
      return { kind: "cancelled" };
    }
  }

  async function runMobileAppPromotionCheck(
    settings: ReviewPromptSettings,
    promptContext: PostReviewPromptContext,
  ): Promise<ReviewPromptDecision> {
    if (promptContext.workspaceId === null || isReviewPromptUiBlocked()) {
      return { kind: "skipped" };
    }

    if (isPromptContextCurrent(promptContext) === false) {
      return { kind: "cancelled" };
    }

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
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
        settings,
        promptState,
        hasMobileReviewEvent: false,
        nowMillis: Date.now(),
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
        settings,
        promptState,
        hasMobileReviewEvent,
        nowMillis: Date.now(),
      });
      if (remoteEligibility.isEligible === false || isReviewPromptUiBlocked()) {
        return { kind: "skipped" };
      }

      if (isPromptContextCurrent(promptContext) === false) {
        return { kind: "cancelled" };
      }

      const shownAtIso = new Date().toISOString();
      try {
        await storeMobileAppPromotionPromptShown({
          identityKey: promptContext.identityKey,
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

      isMobileAppPromotionAnsweredRef.current = false;
      trackReviewPromptScreenViewed("mobile_app_prompt", reviewPromptConfig.version);
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
    settings: ReviewPromptSettings,
    promptContext: PostReviewPromptContext,
  ): Promise<ReviewPromptDecision> {
    const currentCheck = mobileAppPromotionCheckInFlightRef.current;
    if (
      currentCheck !== null
      && isSamePromptContext(currentCheck.context, promptContext)
      && isPromptContextCurrent(currentCheck.context)
    ) {
      return currentCheck.promise;
    }

    const nextPromise = runMobileAppPromotionCheck(settings, promptContext);
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

  function maybeOpenReviewPaywall(
    promptId: ReviewPaywallPromptId,
    settings: ReviewPromptSettings,
  ): ReviewPromptDecision {
    if (isGuest || reviewPaywall === null || !isKnownFreeEntitlement(readEntitlementSnapshot(userId))) {
      return { kind: "skipped" };
    }

    try {
      const state = reviewPaywall.readState();
      if (state === null) {
        return { kind: "skipped" };
      }
      const trigger = dueReviewPaywall(promptId, settings, state, Date.now());
      if (trigger === null) {
        return { kind: "skipped" };
      }
      // A due offer owns this saved review even if its presenter just became unavailable.
      reviewPaywall.present(trigger);
      return { kind: "opened" };
    } catch (error) {
      captureReviewPromptOperationError(error, "paywall_state_sync", promptId);
      return { kind: "cancelled" };
    }
  }

  function maybeOpenHardReminder(
    settings: ReviewPromptSettings,
    recentReviewRatings: ReadonlyArray<ReviewRating>,
  ): ReviewPromptDecision {
    const nowMillis = Date.now();
    if (
      shouldShowReviewHardReminder(recentReviewRatings) === false
      || isReviewPromptCooldownElapsed(settings, loadReviewHardReminderLastShownAt(), nowMillis) === false
    ) {
      return { kind: "skipped" };
    }

    saveReviewHardReminderLastShownAt(nowMillis);
    trackReviewPromptScreenViewed("review_hard_reminder", reviewPromptConfig.version);
    setIsHardReminderVisible(true);
    return { kind: "opened" };
  }

  function maybeOpenGuestSignInPrompt(settings: ReviewPromptSettings): ReviewPromptDecision {
    if (
      userId === null
      || isGuest === false
      || isSessionVerified === false
      || readPendingGuestConversion() !== null
      || document.querySelector('dialog[open], [aria-modal="true"]') !== null
    ) {
      return { kind: "skipped" };
    }

    let lastShownAtMillis: number | null;
    try {
      lastShownAtMillis = loadGuestSignInAfterReviewLastShownAt(userId);
    } catch (error) {
      captureReviewPromptOperationError(error, "review_prompt_state_load", "guest-sign-in");
      return { kind: "cancelled" };
    }

    const nowMillis = Date.now();
    if (isReviewPromptCooldownElapsed(settings, lastShownAtMillis, nowMillis) === false) {
      return { kind: "skipped" };
    }

    try {
      saveGuestSignInAfterReviewLastShownAt(userId, nowMillis);
    } catch (error) {
      captureReviewPromptOperationError(error, "review_prompt_state_save", "guest-sign-in");
      return { kind: "cancelled" };
    }

    isGuestSignInPromptAnsweredRef.current = false;
    trackReviewPromptScreenViewed("signin_after_review_prompt", reviewPromptConfig.version);
    setIsGuestSignInPromptOpen(true);
    return { kind: "opened" };
  }

  async function openReviewPrompt(
    promptId: WebReviewPromptId,
    settings: ReviewPromptSettings,
    promptContext: PostReviewPromptContext,
    recentReviewRatings: ReadonlyArray<ReviewRating>,
  ): Promise<ReviewPromptDecision> {
    switch (promptId) {
      case "hard-reminder":
        return maybeOpenHardReminder(settings, recentReviewRatings);
      case "paywall-initial":
      case "paywall-second":
      case "paywall-periodic":
        return maybeOpenReviewPaywall(promptId, settings);
      case "web-mobile-app-promo":
        return maybeOpenMobileAppPromotion(settings, promptContext);
      case "guest-sign-in":
        return maybeOpenGuestSignInPrompt(settings);
      case "automatic-feedback":
        return maybeOpenAutomaticFeedbackPrompt(settings, promptContext);
    }
  }

  async function loadPromptCounters(): Promise<ReviewPromptCounters | null> {
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const counters = await loadReviewPromptCounters(
        reviewWorkspaceIds,
        new Date(),
        getReviewPromptDayLimit(reviewPromptConfig),
      );
      indexedDbOpenRecoveryState.throwIfFailed();
      return counters;
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailure(error) === false) {
        captureReviewPromptOperationError(error, "review_prompt_activity_load", null);
      }
      return null;
    }
  }

  function beginSavedReviewPromptOpportunity(): void {
    const currentContext = promptContextRef.current;
    promptContextRef.current = { ...currentContext, generation: currentContext.generation + 1 };
  }

  /**
   * Shows at most one prompt after a saved review: the first in the config order that is enabled and
   * passes its config conditions and fixed rules. Counters are read only once a prompt needs them.
   */
  async function maybeOpenPostReviewPrompt(recentReviewRatings: ReadonlyArray<ReviewRating>): Promise<void> {
    if (postReviewCheckInFlightRef.current || isReviewPromptUiBlocked()) return;
    const promptContext = promptContextRef.current;
    postReviewCheckInFlightRef.current = true;
    try {
      let counters: ReviewPromptCounters | null = null;
      for (const promptId of listWebReviewPromptOrder(reviewPromptConfig)) {
        const settings = reviewPromptConfig.prompts[promptId];
        if (settings.enabled === false) continue;
        if (hasReviewPromptCounterConditions(settings)) {
          if (counters === null) {
            counters = await loadPromptCounters();
            if (counters === null || !isPromptContextCurrent(promptContext) || isReviewPromptUiBlocked()) return;
          }
          if (passesReviewPromptCounterConditions(settings, counters) === false) continue;
        }
        const decision = await openReviewPrompt(promptId, settings, promptContext, recentReviewRatings);
        if (
          decision.kind !== "skipped"
          || indexedDbOpenRecoveryState.hasFailed()
          || !isPromptContextCurrent(promptContext)
          || isReviewPromptUiBlocked()
        ) return;
      }
    } finally {
      postReviewCheckInFlightRef.current = false;
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

  function answerMobileAppPromotion(outcome: "accepted" | "dismissed"): void {
    if (isMobileAppPromotionAnsweredRef.current) {
      return;
    }

    isMobileAppPromotionAnsweredRef.current = true;
    track({ name: "prompt_answered", prompt: "mobile_app_prompt", outcome });
  }

  function acceptMobileAppPromotion(): void {
    answerMobileAppPromotion("accepted");
  }

  function dismissMobileAppPromotionDialog(): void {
    answerMobileAppPromotion("dismissed");
    trackScreenViewedOnDismiss({ dismissed: "mobile_app_prompt", restored: "review" });
    setIsMobileAppPromotionDialogOpen(false);
  }

  function dismissHardReminder(): void {
    trackScreenViewedOnDismiss({ dismissed: "review_hard_reminder", restored: "review" });
    setIsHardReminderVisible(false);
  }

  function answerGuestSignInPrompt(outcome: "accepted" | "snoozed"): void {
    if (isGuestSignInPromptAnsweredRef.current) {
      return;
    }

    isGuestSignInPromptAnsweredRef.current = true;
    track({ name: "prompt_answered", prompt: "signin_after_review_prompt", outcome });
  }

  function postponeGuestSignIn(): void {
    answerGuestSignInPrompt("snoozed");
    trackScreenViewedOnDismiss({ dismissed: "signin_after_review_prompt", restored: "review" });
    setIsGuestSignInPromptOpen(false);
  }

  function acceptGuestSignIn(): void {
    // Before sign-in's first await: starting it unverifies the session, which hides the prompt.
    answerGuestSignInPrompt("accepted");
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
    trackScreenViewedOnDismiss({ dismissed: "mobile_app_prompt", restored: "review" });
    setIsMobileAppPromotionDialogOpen(false);
    trackScreenViewedOnDismiss({ dismissed: "review_hard_reminder", restored: "review" });
    setIsHardReminderVisible(false);
    trackScreenViewedOnDismiss({ dismissed: "signin_after_review_prompt", restored: "review" });
    setIsGuestSignInPromptOpen(false);
  }, [workspaceId]);

  useEffect(() => {
    if (isGuestSignInPromptOpen === false || (isGuest && isSessionVerified)) {
      return;
    }

    // Sign-in hides the prompt on its way out of the app, so the surface goes back without a view.
    restoreCurrentAnalyticsSurface({ dismissed: "signin_after_review_prompt", restored: "review" });
    setIsGuestSignInPromptOpen(false);
  }, [isGuest, isGuestSignInPromptOpen, isSessionVerified]);

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
    beginSavedReviewPromptOpportunity,
    feedbackDialogProps: {
      isOpen: isFeedbackDialogOpen,
      message: feedbackMessage,
      errorMessage: feedbackErrorMessage,
      isSubmitting: isFeedbackSubmitting,
      onMessageChange: setFeedbackMessage,
      onSubmit: submitAutomaticFeedback,
      onDismiss: dismissAutomaticFeedbackDialog,
    },
    guestSignInPromptProps: {
      isOpen: isGuestSignInPromptVisible,
      onLater: postponeGuestSignIn,
      onSignInPressed: acceptGuestSignIn,
    },
    hardReminderDialogProps: {
      isOpen: isHardReminderVisible,
      onDismiss: dismissHardReminder,
    },
    isFeedbackDialogOpen,
    isGuestSignInPromptVisible,
    isHardReminderVisible,
    isMobileAppPromotionDialogOpen,
    maybeOpenPostReviewPrompt,
    mobileAppPromotionDialogProps: {
      isOpen: isMobileAppPromotionDialogOpen,
      onDismiss: dismissMobileAppPromotionDialog,
      onStoreLinkClick: acceptMobileAppPromotion,
      storeLinks: webReviewMobilePromptStoreLinks,
    },
  };
}

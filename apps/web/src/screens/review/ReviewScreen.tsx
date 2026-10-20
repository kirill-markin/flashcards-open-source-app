import { useEffect, useState, type ReactElement } from "react";
import { useAppErrorDialog } from "../../appError/AppErrorContext";
import { FeedbackDialog } from "../../feedback/FeedbackDialog";
import { useEffectiveReviewReactionAnimationsEnabled } from "../../premium/styleSettings";
import { ReviewEditorModal } from "./components/card/ReviewEditorModal";
import { ReviewTextSelectionDialog } from "./components/card/ReviewTextSelectionDialog";
import { ReviewPane } from "./components/ReviewPane";
import { ReviewQueuePanel } from "./components/ReviewQueuePanel";
import { ReviewScreenHeader } from "./components/ReviewScreenHeader";
import { ReviewHardReminderDialog } from "./hardReminder/ReviewHardReminderDialog";
import { MobileAppPromotionDialog } from "./mobileAppPromo/MobileAppPromotionDialog";
import { ReviewRatingReactionLayer } from "./reactions/ReviewRatingReactionLayer";
import { startReviewReactionLottiePrewarm } from "./reactions/lottie/reviewReactionLottie";
import { ReviewTagFilterDialog } from "./tagFilter/ReviewTagFilterDialog";
import { GuestSignInAfterReviewPrompt } from "./guest/GuestSignInAfterReviewPrompt";
import { useReviewScreenController } from "./useReviewScreenController";

export { normalizeReviewMarkdownForWeb } from "./components/card/ReviewCardSide";

export function ReviewScreen(): ReactElement {
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const [isGuestSignInPromptVisible, setIsGuestSignInPromptVisible] = useState(false);
  const reviewReactionAnimationsEnabled = useEffectiveReviewReactionAnimationsEnabled();
  const {
    dismissReviewReactions,
    editorModalProps,
    feedbackDialogProps,
    hardReminderDialogProps,
    headerProps,
    mobileAppPromotionDialogProps,
    paneProps,
    queuePanelProps,
    reviewReactionFallbackHandler,
    reviewReactionEvents,
    tagFilterDialogProps,
    textSelectionDialogProps,
  } = useReviewScreenController({
    reviewReactionAnimationsEnabled,
    isGuestSignInPromptVisible,
  });

  useEffect(() => {
    if (reviewReactionAnimationsEnabled) {
      return startReviewReactionLottiePrewarm(indexedDbOpenRecoveryState.signal);
    }

    dismissReviewReactions();
  }, [dismissReviewReactions, indexedDbOpenRecoveryState.signal, reviewReactionAnimationsEnabled]);

  const reviewLayoutClassName = queuePanelProps.isReviewQueuePanelOpen
    ? "review-layout review-layout-queue-open"
    : "review-layout";

  return (
    <main className="container" data-testid="review-screen" onPointerDownCapture={dismissReviewReactions}>
      <section className="panel review-screen-panel">
        <ReviewScreenHeader {...headerProps} />

        <div className={reviewLayoutClassName}>
          <div className="review-pane-reaction-frame">
            <ReviewPane {...paneProps} />
            <ReviewRatingReactionLayer
              events={reviewReactionEvents}
              onReactionEventFallback={reviewReactionFallbackHandler}
            />
          </div>
          {queuePanelProps.isReviewQueuePanelOpen ? <ReviewQueuePanel {...queuePanelProps} /> : null}
        </div>
      </section>

      <GuestSignInAfterReviewPrompt onVisibilityChange={setIsGuestSignInPromptVisible} blocked={editorModalProps.isEditorPresented || feedbackDialogProps.isOpen
        || hardReminderDialogProps.isOpen || mobileAppPromotionDialogProps.isOpen
        || tagFilterDialogProps.request !== null || textSelectionDialogProps.request !== null
        || headerProps.filterMenuProps.isReviewFilterMenuOpen || headerProps.isReviewMoreActionsMenuOpen} />
      <ReviewEditorModal {...editorModalProps} />
      <FeedbackDialog {...feedbackDialogProps} />
      <ReviewHardReminderDialog {...hardReminderDialogProps} />
      <MobileAppPromotionDialog {...mobileAppPromotionDialogProps} />
      <ReviewTagFilterDialog {...tagFilterDialogProps} />
      <ReviewTextSelectionDialog {...textSelectionDialogProps} />
    </main>
  );
}

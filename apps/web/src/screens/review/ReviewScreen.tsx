import { useEffect, type ReactElement } from "react";
import { useAppData } from "../../appData";
import { FeedbackDialog } from "../../feedback/FeedbackDialog";
import { ReviewEditorModal } from "./components/ReviewEditorModal";
import { ReviewPane } from "./components/ReviewPane";
import { ReviewQueuePanel } from "./components/ReviewQueuePanel";
import { ReviewScreenHeader } from "./components/ReviewScreenHeader";
import { ReviewHardReminderDialog } from "./hardReminder/ReviewHardReminderDialog";
import { ReviewRatingReactionLayer } from "./reactions/ReviewRatingReactionLayer";
import { startReviewReactionLottiePrewarm } from "./reactions/reviewReactionLottie";
import { useReviewScreenController } from "./useReviewScreenController";

export { normalizeReviewMarkdownForWeb } from "./components/ReviewCardSide";

export function ReviewScreen(): ReactElement {
  const { session } = useAppData();
  const reviewReactionAnimationsEnabled = session?.preferences.reviewReactionAnimationsEnabled !== false;
  const {
    dismissReviewReactions,
    editorModalProps,
    feedbackDialogProps,
    hardReminderDialogProps,
    headerProps,
    paneProps,
    queuePanelProps,
    reviewReactionFallbackHandler,
    reviewReactionEvents,
  } = useReviewScreenController({
    reviewReactionAnimationsEnabled,
  });

  useEffect(() => {
    if (reviewReactionAnimationsEnabled) {
      startReviewReactionLottiePrewarm();
      return;
    }

    dismissReviewReactions();
  }, [dismissReviewReactions, reviewReactionAnimationsEnabled]);

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

      <ReviewEditorModal {...editorModalProps} />
      <FeedbackDialog {...feedbackDialogProps} />
      <ReviewHardReminderDialog {...hardReminderDialogProps} />
    </main>
  );
}

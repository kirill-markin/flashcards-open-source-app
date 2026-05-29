import { useEffect, type ReactElement } from "react";
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
  const {
    dismissReviewReactions,
    editorModalProps,
    hardReminderDialogProps,
    headerProps,
    paneProps,
    queuePanelProps,
    reviewReactionFallbackHandler,
    reviewReactionEvents,
  } = useReviewScreenController();

  useEffect(() => {
    startReviewReactionLottiePrewarm();
  }, []);

  return (
    <main className="container" data-testid="review-screen" onPointerDownCapture={dismissReviewReactions}>
      <section className="panel review-screen-panel">
        <ReviewScreenHeader {...headerProps} />

        <div className="review-layout">
          <ReviewPane {...paneProps} />
          <ReviewQueuePanel {...queuePanelProps} />
        </div>

        <ReviewRatingReactionLayer
          events={reviewReactionEvents}
          onReactionEventFallback={reviewReactionFallbackHandler}
        />
      </section>

      <ReviewEditorModal {...editorModalProps} />
      <ReviewHardReminderDialog {...hardReminderDialogProps} />
    </main>
  );
}

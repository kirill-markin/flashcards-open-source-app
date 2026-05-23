import type { ReactElement } from "react";
import { ReviewEditorModal } from "./components/ReviewEditorModal";
import { ReviewPane } from "./components/ReviewPane";
import { ReviewQueuePanel } from "./components/ReviewQueuePanel";
import { ReviewScreenHeader } from "./components/ReviewScreenHeader";
import { ReviewHardReminderDialog } from "./hardReminder/ReviewHardReminderDialog";
import { ReviewRatingReactionLayer } from "./reactions/ReviewRatingReactionLayer";
import { useReviewScreenController } from "./useReviewScreenController";

export { normalizeReviewMarkdownForWeb } from "./components/ReviewCardSide";

export function ReviewScreen(): ReactElement {
  const {
    editorModalProps,
    hardReminderDialogProps,
    headerProps,
    paneProps,
    queuePanelProps,
    reviewReactionEvents,
  } = useReviewScreenController();

  return (
    <main className="container" data-testid="review-screen">
      <section className="panel review-screen-panel">
        <ReviewScreenHeader {...headerProps} />

        <div className="review-layout">
          <ReviewPane {...paneProps} />
          <ReviewQueuePanel {...queuePanelProps} />
        </div>

        <ReviewRatingReactionLayer events={reviewReactionEvents} />
      </section>

      <ReviewEditorModal {...editorModalProps} />
      <ReviewHardReminderDialog {...hardReminderDialogProps} />
    </main>
  );
}

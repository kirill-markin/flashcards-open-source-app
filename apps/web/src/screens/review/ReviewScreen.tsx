import type { ReactElement } from "react";
import { ReviewEditorModal } from "./ReviewEditorModal";
import { ReviewHardReminderDialog } from "./ReviewHardReminderDialog";
import { ReviewPane } from "./ReviewPane";
import { ReviewQueuePanel } from "./ReviewQueuePanel";
import { ReviewRatingReactionLayer } from "./ReviewRatingReactionLayer";
import { ReviewScreenHeader } from "./ReviewScreenHeader";
import { useReviewScreenController } from "./useReviewScreenController";

export { normalizeReviewMarkdownForWeb } from "./ReviewCardSide";

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

import * as Sentry from "@sentry/react";
import type { Span } from "@sentry/react";
import { parseManagedImageMarkdownReferences } from "../media/managedMediaMarkdown";

/*
 * Diagnostics-only review timing spans. The non-blocking review plans read their durations as the
 * before/after numbers: docs/fsrs-scheduling-logic.md#non-blocking-review
 */
const REVIEW_NEXT_CARD_VISIBLE_SPAN_NAME = "review.next_card_visible";
const REVIEW_AFTER_RATING_WORK_SPAN_NAME = "review.after_rating_work";
const REVIEW_TIMING_SPAN_OP = "ui.review";
const REVIEW_TIMING_PLATFORM = "web";

export type ReviewTimingSpan = Span;

type PendingReviewNextCardVisible = Readonly<{
  span: Span;
  ratedCardId: string;
}>;

// One rating is on screen at a time; a newer rating replaces an unfinished span, which is then never sent.
let pendingReviewNextCardVisible: PendingReviewNextCardVisible | null = null;

function startReviewTimingSpan(name: string): Span {
  return Sentry.startInactiveSpan({
    name,
    op: REVIEW_TIMING_SPAN_OP,
    parentSpan: null,
    attributes: { platform: REVIEW_TIMING_PLATFORM },
  });
}

export function startReviewNextCardVisibleSpan(ratedCardId: string): void {
  pendingReviewNextCardVisible = {
    span: startReviewTimingSpan(REVIEW_NEXT_CARD_VISIBLE_SPAN_NAME),
    ratedCardId,
  };
}

export function finishReviewNextCardVisibleSpan(shownCardId: string, shownFrontText: string): void {
  const pending = pendingReviewNextCardVisible;
  if (pending === null || pending.ratedCardId === shownCardId) {
    return;
  }

  pendingReviewNextCardVisible = null;
  // The animation frame runs just before the paint; the timeout runs after it.
  requestAnimationFrame(() => {
    setTimeout(() => {
      // Parsed after the paint so the span adds no work ahead of the next card.
      const hasImages = parseManagedImageMarkdownReferences(shownFrontText).length > 0;
      pending.span.setAttributes({
        has_images: hasImages,
        // Nothing tracks image decoding yet, so a shown image always counts as not ready.
        images_ready: hasImages === false,
      });
      pending.span.end();
    }, 0);
  });
}

/** An empty review screen has no next card to measure. */
export function discardReviewNextCardVisibleSpan(): void {
  pendingReviewNextCardVisible = null;
}

export function startReviewAfterRatingWorkSpan(): ReviewTimingSpan {
  return startReviewTimingSpan(REVIEW_AFTER_RATING_WORK_SPAN_NAME);
}

export function finishReviewAfterRatingWorkSpan(span: ReviewTimingSpan, fullRebuildCount: number): void {
  span.setAttribute("full_rebuild_count", fullRebuildCount);
  span.end();
}

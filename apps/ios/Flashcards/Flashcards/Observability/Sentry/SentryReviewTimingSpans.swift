import Foundation
import Sentry

// Diagnostics-only review timing spans. The non-blocking review plans read their durations as the
// before/after numbers: docs/fsrs-scheduling-logic.md#non-blocking-review
private let reviewNextCardVisibleSpanName: String = "review.next_card_visible"
private let reviewAfterRatingWorkSpanName: String = "review.after_rating_work"
private let reviewTimingSpanOperation: String = "ui.review"
private let reviewTimingPlatform: String = "ios"

struct ReviewTimingSpan {
    fileprivate let span: any Span
}

private struct PendingReviewNextCardVisible {
    let span: any Span
    let ratedCardId: String
}

// One rating is on screen at a time; a newer rating replaces an unfinished span, which is then never sent.
@MainActor
private var pendingReviewNextCardVisible: PendingReviewNextCardVisible? = nil

extension SentryObservabilityAdapter {
    @MainActor
    static func startReviewNextCardVisibleSpan(ratedCardId: String, reactionPlayed: Bool) {
        let span = self.startReviewTimingSpan(name: reviewNextCardVisibleSpanName)
        span.setData(value: reactionPlayed, key: "reaction_played")
        pendingReviewNextCardVisible = PendingReviewNextCardVisible(span: span, ratedCardId: ratedCardId)
    }

    /// Called from the next card's `onAppear`, which runs before its frame is committed; the span ends at the
    /// following display refresh, when that frame is on screen.
    @MainActor
    static func finishReviewNextCardVisibleSpan(shownCardId: String, hasImages: Bool) {
        guard let pending = pendingReviewNextCardVisible, pending.ratedCardId != shownCardId else {
            return
        }

        pendingReviewNextCardVisible = nil
        pending.span.setData(value: hasImages, key: "has_images")
        // Nothing tracks image decoding yet, so a shown image always counts as not ready.
        pending.span.setData(value: hasImages == false, key: "images_ready")
        performOnNextDisplayRefresh {
            pending.span.finish()
        }
    }

    @MainActor
    static func discardReviewNextCardVisibleSpan() {
        pendingReviewNextCardVisible = nil
    }

    static func startReviewAfterRatingWorkSpan(ratedAt: Date) -> ReviewTimingSpan {
        let span = self.startReviewTimingSpan(name: reviewAfterRatingWorkSpanName)
        span.startTimestamp = ratedAt
        return ReviewTimingSpan(span: span)
    }

    static func finishReviewAfterRatingWorkSpan(_ span: ReviewTimingSpan) {
        span.span.finish()
    }

    private static func startReviewTimingSpan(name: String) -> any Span {
        let span = SentrySDK.startTransaction(name: name, operation: reviewTimingSpanOperation)
        span.setData(value: reviewTimingPlatform, key: "platform")
        return span
    }
}

import CoreGraphics
import Foundation
import Observation

enum ReviewCardSide {
    case question
    case answer
}

struct ReviewCardScrollOffset {
    let cardId: String
    let y: CGFloat
}

/// Review screen state that outlives `ReviewView`, so a recreated Review shows the same card,
/// answer visibility, prepared next card, images, and scroll offset without a loader.
/// Created once per app; see docs/fsrs-scheduling-logic.md#non-blocking-review.
@MainActor
@Observable
final class ReviewScreenModel {
    private(set) var isAnswerVisible: Bool = false
    private(set) var widgetAnswerScrollRequest: UUID? = nil
    var lastPresentedReviewCardId: String? = nil
    var lastPresentedReviewWorkspaceId: String? = nil
    /// The filter and reset revision this state was last reset for, so a change made while
    /// Review was off screen still resets it when Review is recreated.
    var presentedReviewFilter: ReviewFilter? = nil
    var presentedReviewPresentationResetRevision: Int? = nil
    var preparedRevealState: PreparedReviewRevealState? = nil
    var preparedNextRevealState: PreparedReviewRevealState? = nil
    let preparedImageCache: ReviewPreparedImageCache = ReviewPreparedImageCache()
    /// Written on every scroll frame, so it stays out of observation.
    @ObservationIgnored var cardScrollOffset: ReviewCardScrollOffset? = nil

    /// Returns whether this widget tap revealed a previously hidden answer.
    func presentWidgetCard(
        card: Card,
        reviewFilter: ReviewFilter,
        resetRevision: Int,
        initialSide: ReviewCardSide
    ) -> Bool {
        if initialSide == .question
            || self.lastPresentedReviewCardId != card.cardId
            || self.lastPresentedReviewWorkspaceId != card.workspaceId
            || self.presentedReviewFilter != reviewFilter
            || self.presentedReviewPresentationResetRevision != resetRevision {
            self.endPresentation()
        }

        self.lastPresentedReviewCardId = card.cardId
        self.lastPresentedReviewWorkspaceId = card.workspaceId
        self.presentedReviewFilter = reviewFilter
        self.presentedReviewPresentationResetRevision = resetRevision
        guard initialSide == .answer else { return false }

        let didRevealAnswer = self.isAnswerVisible == false
        self.isAnswerVisible = true
        self.cardScrollOffset = nil
        self.widgetAnswerScrollRequest = UUID()
        return didRevealAnswer
    }

    func consumeWidgetAnswerScrollRequest(_ request: UUID, cardId: String) -> Bool {
        guard self.widgetAnswerScrollRequest == request, self.lastPresentedReviewCardId == cardId else {
            return false
        }
        self.widgetAnswerScrollRequest = nil
        return true
    }

    /// Records one event per explicit reveal. Ending the presentation lets the same card be revealed again.
    func revealAnswer() {
        guard self.isAnswerVisible == false else { return }
        self.isAnswerVisible = true
        Analytics.track(.reviewCardRevealed)
    }

    /// Ends the shown card's presentation: its answer hides and its scroll offset is forgotten,
    /// so the card's next presentation starts at the front.
    func endPresentation() {
        self.isAnswerVisible = false
        self.cardScrollOffset = nil
        self.widgetAnswerScrollRequest = nil
    }
}

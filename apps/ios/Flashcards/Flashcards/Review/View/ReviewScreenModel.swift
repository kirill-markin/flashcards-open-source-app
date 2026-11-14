import CoreGraphics
import Observation

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
    var isAnswerVisible: Bool = false
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

    /// Ends the shown card's presentation: its answer hides and its scroll offset is forgotten,
    /// so the card's next presentation starts at the front.
    func endPresentation() {
        self.isAnswerVisible = false
        self.cardScrollOffset = nil
    }
}

import Foundation

@MainActor
extension FlashcardsStore {
    var reviewTotalCount: Int {
        self.reviewCounts.totalCount
    }

    var displayedReviewDueCount: Int {
        max(0, self.reviewCounts.dueCount - self.pendingReviewCardIds.count)
    }

    var effectiveReviewQueue: [Card] {
        self.reviewRuntime.effectiveReviewQueue(publishedState: self.currentReviewPublishedState())
    }
}

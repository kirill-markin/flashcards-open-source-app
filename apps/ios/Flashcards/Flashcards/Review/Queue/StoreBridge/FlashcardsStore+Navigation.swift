import Foundation

@MainActor
extension FlashcardsStore {
    var reviewTotalCount: Int {
        self.reviewCounts.totalCount
    }

    var displayedReviewDueCount: Int {
        let pendingCount = self.reviewRuntime.pendingReviewCount(
            publishedState: self.currentReviewPublishedState(),
            cards: self.cards,
            decks: self.decks
        )
        return max(0, self.reviewCounts.dueCount - pendingCount)
    }

    var effectiveReviewQueue: [Card] {
        self.reviewRuntime.effectiveReviewQueue(publishedState: self.currentReviewPublishedState())
    }
}

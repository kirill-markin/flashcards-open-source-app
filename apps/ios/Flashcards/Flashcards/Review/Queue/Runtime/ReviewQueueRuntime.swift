import Foundation

struct ReviewQueuePublishedState: Hashable {
    let selectedReviewFilter: ReviewFilter
    let reviewQueue: [Card]
    let presentedReviewCard: Card?
    let reviewCounts: ReviewCounts
    let isReviewHeadLoading: Bool
    let isReviewCountsLoading: Bool
    let isReviewQueueChunkLoading: Bool
    let pendingReviewCardIds: Set<String>
    let reviewSubmissionFailure: ReviewSubmissionFailure?
}

struct ReviewQueueRuntimeState {
    var activeReviewLoadTask: Task<Void, Never>?
    var activeReviewLoadRequestId: String?
    var activeReviewCountsTask: Task<Void, Never>?
    var activeReviewCountsRequestId: String?
    var activeReviewQueueChunkTask: Task<Void, Never>?
    var activeReviewQueueChunkRequestId: String?
    var activeReviewProcessorTask: Task<Void, Never>?
    var pendingReviewRequests: [ReviewSubmissionRequest]
    var isReviewProcessorRunning: Bool
    var reviewSourceVersion: Int
    var reviewReconciliationGeneration: Int
    var hasMoreReviewQueueCards: Bool
}

struct ReviewQueueRuntime {
    let reviewSeedQueueSize: Int
    let reviewQueueReplenishmentThreshold: Int
    var state: ReviewQueueRuntimeState

    init(
        reviewSeedQueueSize: Int,
        reviewQueueReplenishmentThreshold: Int
    ) {
        self.reviewSeedQueueSize = reviewSeedQueueSize
        self.reviewQueueReplenishmentThreshold = reviewQueueReplenishmentThreshold
        self.state = ReviewQueueRuntimeState(
            activeReviewLoadTask: nil,
            activeReviewLoadRequestId: nil,
            activeReviewCountsTask: nil,
            activeReviewCountsRequestId: nil,
            activeReviewQueueChunkTask: nil,
            activeReviewQueueChunkRequestId: nil,
            activeReviewProcessorTask: nil,
            pendingReviewRequests: [],
            isReviewProcessorRunning: false,
            reviewSourceVersion: 0,
            reviewReconciliationGeneration: 0,
            hasMoreReviewQueueCards: false
        )
    }

    static func makeInitialPublishedState(selectedReviewFilter: ReviewFilter) -> ReviewQueuePublishedState {
        ReviewQueuePublishedState(
            selectedReviewFilter: selectedReviewFilter,
            reviewQueue: [],
            presentedReviewCard: nil,
            reviewCounts: ReviewCounts(dueCount: 0, totalCount: 0),
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: [],
            reviewSubmissionFailure: nil
        )
    }

    func effectiveReviewQueue(publishedState: ReviewQueuePublishedState) -> [Card] {
        let visibleReviewQueue = self.visibleReviewQueue(publishedState: publishedState)
        guard let presentedReviewCard = self.resolvePresentedReviewCard(
            reviewQueue: publishedState.reviewQueue,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            preferredPresentedReviewCard: publishedState.presentedReviewCard
        ) else {
            return visibleReviewQueue
        }

        return [presentedReviewCard] + visibleReviewQueue.filter { card in
            card.cardId != presentedReviewCard.cardId
        }
    }

    func pendingReviewCount(
        publishedState: ReviewQueuePublishedState,
        cards: [Card],
        decks: [Deck]
    ) -> Int {
        publishedState.pendingReviewCardIds.reduce(into: 0) { count, cardId in
            guard let card = cards.first(where: { $0.cardId == cardId }),
                  cardMatchesResolvedReviewFilter(reviewFilter: publishedState.selectedReviewFilter, decks: decks, card: card) else {
                return
            }
            count += 1
        }
    }

    func visibleReviewQueue(publishedState: ReviewQueuePublishedState) -> [Card] {
        publishedState.reviewQueue.filter { card in
            publishedState.pendingReviewCardIds.contains(card.cardId) == false
        }
    }

    func resolvePresentedReviewCard(
        reviewQueue: [Card],
        pendingReviewCardIds: Set<String>,
        preferredPresentedReviewCard: Card?
    ) -> Card? {
        let visibleReviewQueue = reviewQueue.filter { card in
            pendingReviewCardIds.contains(card.cardId) == false
        }
        guard let preferredPresentedReviewCard else {
            return visibleReviewQueue.first
        }
        guard pendingReviewCardIds.contains(preferredPresentedReviewCard.cardId) == false else {
            return visibleReviewQueue.first
        }
        if let canonicalPresentedReviewCard = visibleReviewQueue.first(where: { card in
            card.cardId == preferredPresentedReviewCard.cardId
        }) {
            return canonicalPresentedReviewCard
        }

        return preferredPresentedReviewCard
    }
}

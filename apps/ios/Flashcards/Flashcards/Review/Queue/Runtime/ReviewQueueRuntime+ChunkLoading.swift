import Foundation

struct ReviewQueueChunkLoadRequest {
    let requestId: String
    let sourceVersion: Int
    let databaseURL: URL
    let workspaceId: String
    let reviewQueryDefinition: ReviewQueryDefinition
    let excludedCardIds: Set<String>
    let now: Date
    let chunkSize: Int
}

extension ReviewQueueRuntime {
    mutating func makeReviewQueueChunkLoadRequestIfNeeded(
        publishedState: ReviewQueuePublishedState,
        databaseURL: URL,
        workspaceId: String,
        reviewQueryDefinition: ReviewQueryDefinition,
        now: Date
    ) -> ReviewQueueChunkLoadRequest? {
        guard publishedState.isReviewHeadLoading == false else {
            return nil
        }
        guard publishedState.isReviewQueueChunkLoading == false else {
            return nil
        }
        guard self.state.hasMoreReviewQueueCards else {
            return nil
        }
        let visibleReviewQueue = self.visibleReviewQueue(publishedState: publishedState)
        guard visibleReviewQueue.count <= self.reviewQueueReplenishmentThreshold else {
            return nil
        }
        let remainingCapacity = self.reviewSeedQueueSize - visibleReviewQueue.count
        guard remainingCapacity > 0 else {
            return nil
        }

        let requestId = UUID().uuidString.lowercased()
        let sourceVersion = self.state.reviewSourceVersion
        self.state.activeReviewQueueChunkRequestId = requestId

        return ReviewQueueChunkLoadRequest(
            requestId: requestId,
            sourceVersion: sourceVersion,
            databaseURL: databaseURL,
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            excludedCardIds: self.makeExcludedReviewCardIds(publishedState: publishedState),
            now: now,
            chunkSize: remainingCapacity
        )
    }

    mutating func markReviewQueueChunkLoading(
        publishedState: ReviewQueuePublishedState,
        requestId: String
    ) -> ReviewQueuePublishedState {
        self.state.activeReviewQueueChunkRequestId = requestId
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: true,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func setActiveReviewQueueChunkTask(task: Task<Void, Never>, requestId: String) {
        self.state.activeReviewQueueChunkTask = task
        self.state.activeReviewQueueChunkRequestId = requestId
    }

    mutating func applyReviewQueueChunkLoadSuccess(
        publishedState: ReviewQueuePublishedState,
        queueChunkLoadState: ReviewQueueChunkLoadState,
        requestId: String,
        sourceVersion: Int
    ) -> ReviewQueuePublishedState? {
        guard self.shouldApplyReviewQueueChunkResult(requestId: requestId, sourceVersion: sourceVersion) else {
            return nil
        }

        self.clearActiveReviewQueueChunkLoad(requestId: requestId)

        let currentVisibleReviewQueue = Array(
            self.visibleReviewQueue(publishedState: publishedState).prefix(self.reviewSeedQueueSize)
        )
        let remainingCapacity = max(0, self.reviewSeedQueueSize - currentVisibleReviewQueue.count)
        let excludedCardIds = self.makeExcludedReviewCardIds(publishedState: publishedState)
        var acceptedCardIds = excludedCardIds
        let appendableChunk = queueChunkLoadState.reviewQueueChunk.filter { card in
            guard acceptedCardIds.contains(card.cardId) == false else {
                return false
            }
            acceptedCardIds.insert(card.cardId)
            return true
        }
        let appendedChunk = Array(appendableChunk.prefix(remainingCapacity))
        let didDropAppendableCardsForCapacity = appendableChunk.count > appendedChunk.count
        self.state.hasMoreReviewQueueCards = queueChunkLoadState.hasMoreCards || didDropAppendableCardsForCapacity
        let visibleNextReviewQueue = Array((currentVisibleReviewQueue + appendedChunk).prefix(self.reviewSeedQueueSize))
        // Preserve pending-but-still-canonical cards so an in-flight submission can be
        // rescued on failure. They stay hidden from the effective queue via
        // visibleReviewQueue at read time, so the visible window still respects the seed
        // queue size limit.
        let pendingCanonicalReviewCards = publishedState.reviewQueue.filter { card in
            publishedState.pendingReviewCardIds.contains(card.cardId)
        }
        let nextReviewQueue = pendingCanonicalReviewCards + visibleNextReviewQueue

        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: nextReviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: nextReviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func applyReviewQueueChunkLoadFailure(
        publishedState: ReviewQueuePublishedState,
        requestId: String,
        sourceVersion: Int
    ) -> ReviewQueuePublishedState? {
        guard self.shouldApplyReviewQueueChunkResult(requestId: requestId, sourceVersion: sourceVersion) else {
            return nil
        }

        self.clearActiveReviewQueueChunkLoad(requestId: requestId)
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    private func makeExcludedReviewCardIds(publishedState: ReviewQueuePublishedState) -> Set<String> {
        var reviewQueueCardIds = Set(publishedState.reviewQueue.map(\.cardId))
        if let presentedReviewCard = publishedState.presentedReviewCard {
            reviewQueueCardIds.insert(presentedReviewCard.cardId)
        }
        let pendingSnapshotCardIds = Set(self.state.pendingReviewRequests.map(\.cardId))

        return reviewQueueCardIds
            .union(publishedState.pendingReviewCardIds)
            .union(pendingSnapshotCardIds)
    }
}

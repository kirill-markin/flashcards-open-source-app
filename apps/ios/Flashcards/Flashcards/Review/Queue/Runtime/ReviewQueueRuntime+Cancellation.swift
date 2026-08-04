import Foundation

extension ReviewQueueRuntime {
    mutating func invalidateReviewSource() {
        self.state.reviewSourceVersion += 1
        self.invalidateReviewReconciliation()
    }

    func currentReviewSourceVersion() -> Int {
        self.state.reviewSourceVersion
    }

    func reviewSourceVersionMatches(sourceVersion: Int) -> Bool {
        self.state.reviewSourceVersion == sourceVersion
    }

    mutating func settleInvalidatedReviewLoads(
        publishedState: ReviewQueuePublishedState
    ) -> ReviewQueuePublishedState {
        self.cancelActiveReviewLoads()
        self.state.hasMoreReviewQueueCards = false
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func beginReviewReconciliation() -> Int {
        self.state.reviewReconciliationGeneration += 1
        return self.state.reviewReconciliationGeneration
    }

    mutating func invalidateReviewReconciliation() {
        self.state.reviewReconciliationGeneration += 1
    }

    func shouldApplyReviewReconciliation(generation: Int) -> Bool {
        guard Task.isCancelled == false else {
            return false
        }
        return self.state.reviewReconciliationGeneration == generation
    }

    mutating func cancelForAccountDeletion() {
        self.invalidateReviewReconciliation()
        self.cancelActiveReviewLoads()
        self.state.activeReviewProcessorTask?.cancel()
        self.state.activeReviewProcessorTask = nil
        self.state.pendingReviewRequests = []
        self.state.isReviewProcessorRunning = false
        self.state.hasMoreReviewQueueCards = false
    }

    func shouldApplyReviewLoadResult(requestId: String, sourceVersion: Int) -> Bool {
        guard Task.isCancelled == false else {
            return false
        }
        guard self.state.activeReviewLoadRequestId == requestId else {
            return false
        }

        return self.state.reviewSourceVersion == sourceVersion
    }

    func shouldApplyReviewCountsResult(requestId: String, sourceVersion: Int) -> Bool {
        guard Task.isCancelled == false else {
            return false
        }
        guard self.state.activeReviewCountsRequestId == requestId else {
            return false
        }

        return self.state.reviewSourceVersion == sourceVersion
    }

    func shouldApplyReviewQueueChunkResult(requestId: String, sourceVersion: Int) -> Bool {
        guard Task.isCancelled == false else {
            return false
        }
        guard self.state.activeReviewQueueChunkRequestId == requestId else {
            return false
        }

        return self.state.reviewSourceVersion == sourceVersion
    }

    mutating func cancelActiveReviewLoad() {
        self.state.activeReviewLoadTask?.cancel()
        self.state.activeReviewLoadTask = nil
        self.state.activeReviewLoadRequestId = nil
    }

    mutating func cancelActiveReviewCountsLoad() {
        self.state.activeReviewCountsTask?.cancel()
        self.state.activeReviewCountsTask = nil
        self.state.activeReviewCountsRequestId = nil
    }

    mutating func cancelActiveReviewQueueChunkLoad() {
        self.state.activeReviewQueueChunkTask?.cancel()
        self.state.activeReviewQueueChunkTask = nil
        self.state.activeReviewQueueChunkRequestId = nil
    }

    mutating func cancelActiveReviewLoads() {
        self.cancelActiveReviewLoad()
        self.cancelActiveReviewCountsLoad()
        self.cancelActiveReviewQueueChunkLoad()
    }

    mutating func clearActiveReviewLoad(requestId: String) {
        guard self.state.activeReviewLoadRequestId == requestId else {
            return
        }

        self.state.activeReviewLoadTask = nil
        self.state.activeReviewLoadRequestId = nil
    }

    mutating func clearActiveReviewCountsLoad(requestId: String) {
        guard self.state.activeReviewCountsRequestId == requestId else {
            return
        }

        self.state.activeReviewCountsTask = nil
        self.state.activeReviewCountsRequestId = nil
    }

    mutating func clearActiveReviewQueueChunkLoad(requestId: String) {
        guard self.state.activeReviewQueueChunkRequestId == requestId else {
            return
        }

        self.state.activeReviewQueueChunkTask = nil
        self.state.activeReviewQueueChunkRequestId = nil
    }
}

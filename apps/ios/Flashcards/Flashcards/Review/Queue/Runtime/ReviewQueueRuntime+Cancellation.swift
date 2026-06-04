import Foundation

extension ReviewQueueRuntime {
    mutating func cancelForAccountDeletion() {
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

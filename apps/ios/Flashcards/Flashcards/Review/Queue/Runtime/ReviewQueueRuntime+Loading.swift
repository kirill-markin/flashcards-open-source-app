import Foundation

struct ReviewHeadLoadRequest {
    let requestId: String
    let sourceVersion: Int
    let databaseURL: URL
    let workspaceId: String
    let resolvedReviewFilter: ReviewFilter
    let reviewQueryDefinition: ReviewQueryDefinition
    let now: Date
    let seedQueueSize: Int
}

struct ReviewLoadPlan {
    let publishedState: ReviewQueuePublishedState
    let headRequest: ReviewHeadLoadRequest
    let countsRequest: ReviewCountsLoadRequest
}

extension ReviewQueueRuntime {
    mutating func startReviewLoad(
        publishedState: ReviewQueuePublishedState,
        resolvedReviewQuery: ResolvedReviewQuery,
        workspaceId: String,
        databaseURL: URL,
        now: Date
    ) -> ReviewLoadPlan {
        self.cancelActiveReviewLoads()

        let requestId = UUID().uuidString.lowercased()
        let sourceVersion = self.state.reviewSourceVersion

        let nextPublishedState = ReviewQueuePublishedState(
            selectedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewQueue: [],
            presentedReviewCard: nil,
            reviewCounts: ReviewCounts(dueCount: 0, totalCount: 0),
            isReviewHeadLoading: true,
            isReviewCountsLoading: true,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: nil
        )
        self.state.activeReviewLoadRequestId = requestId
        self.state.hasMoreReviewQueueCards = false

        let headRequest = ReviewHeadLoadRequest(
            requestId: requestId,
            sourceVersion: sourceVersion,
            databaseURL: databaseURL,
            workspaceId: workspaceId,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
            now: now,
            seedQueueSize: self.reviewSeedQueueSize
        )

        let countsRequest = ReviewCountsLoadRequest(
            databaseURL: databaseURL,
            workspaceId: workspaceId,
            reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
            now: now,
            requestId: requestId,
            sourceVersion: sourceVersion
        )

        return ReviewLoadPlan(
            publishedState: nextPublishedState,
            headRequest: headRequest,
            countsRequest: countsRequest
        )
    }

    mutating func setActiveReviewLoadTask(task: Task<Void, Never>, requestId: String) {
        self.state.activeReviewLoadTask = task
        self.state.activeReviewLoadRequestId = requestId
    }

    mutating func applyReviewHeadLoadSuccess(
        publishedState: ReviewQueuePublishedState,
        reviewHeadState: ReviewHeadLoadState,
        requestId: String,
        sourceVersion: Int
    ) -> ReviewQueuePublishedState? {
        guard self.shouldApplyReviewLoadResult(requestId: requestId, sourceVersion: sourceVersion) else {
            return nil
        }

        self.state.hasMoreReviewQueueCards = reviewHeadState.hasMoreCards
        self.clearActiveReviewLoad(requestId: requestId)

        return ReviewQueuePublishedState(
            selectedReviewFilter: reviewHeadState.resolvedReviewFilter,
            reviewQueue: reviewHeadState.seedReviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: reviewHeadState.seedReviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: false,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func applyReviewHeadLoadFailure(
        publishedState: ReviewQueuePublishedState,
        requestId: String,
        sourceVersion: Int
    ) -> ReviewQueuePublishedState? {
        guard self.shouldApplyReviewLoadResult(requestId: requestId, sourceVersion: sourceVersion) else {
            return nil
        }

        self.clearActiveReviewLoad(requestId: requestId)
        self.cancelActiveReviewCountsLoad()

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
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func applyBackgroundReviewRefresh(
        publishedState: ReviewQueuePublishedState,
        selectedReviewFilter: ReviewFilter,
        reviewCounts: ReviewCounts,
        reviewQueue: [Card],
        presentedReviewCard: Card?,
        hasMoreCards: Bool
    ) -> ReviewQueuePublishedState {
        self.state.hasMoreReviewQueueCards = hasMoreCards

        return ReviewQueuePublishedState(
            selectedReviewFilter: selectedReviewFilter,
            reviewQueue: reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: reviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: presentedReviewCard
            ),
            reviewCounts: reviewCounts,
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }
}

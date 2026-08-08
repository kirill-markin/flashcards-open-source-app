import Foundation
import XCTest
@testable import Flashcards

extension ProgressStoreTestCase {
    @MainActor
    func makeReviewStoreForIdentityTest(
        database: LocalDatabase,
        userDefaults: UserDefaults,
        credentialStore: CloudCredentialStore,
        guestCredentialStore: GuestCloudCredentialStore,
        reviewSubmissionExecutor: (any ReviewSubmissionExecuting)?,
        reviewHeadLoader: @escaping ReviewHeadLoader,
        reviewCountsLoader: @escaping ReviewCountsLoader,
        reviewQueueChunkLoader: @escaping ReviewQueueChunkLoader,
        reviewQueueWindowLoader: @escaping ReviewQueueWindowLoader,
        reviewTimelinePageLoader: @escaping ReviewTimelinePageLoader
    ) -> FlashcardsStore {
        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: nil,
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate(),
            reviewSubmissionExecutor: reviewSubmissionExecutor,
            reviewHeadLoader: reviewHeadLoader,
            reviewCountsLoader: reviewCountsLoader,
            reviewQueueChunkLoader: reviewQueueChunkLoader,
            reviewQueueWindowLoader: reviewQueueWindowLoader,
            reviewTimelinePageLoader: reviewTimelinePageLoader,
            initialGlobalErrorMessage: "Test state is configured after initialization"
        )
        store.globalErrorMessage = ""
        return store
    }

    @MainActor
    func prepareReviewReloadFailureState(
        store: FlashcardsStore,
        card: Card,
        reviewFilter: ReviewFilter
    ) -> ReviewQueuePublishedState {
        let publishedState = ReviewQueuePublishedState(
            selectedReviewFilter: reviewFilter,
            reviewQueue: [card],
            presentedReviewCard: card,
            reviewCounts: ReviewCounts(dueCount: 7, totalCount: 9),
            isReviewHeadLoading: true,
            isReviewCountsLoading: true,
            isReviewQueueChunkLoading: true,
            pendingReviewCardIds: [],
            reviewSubmissionFailure: ReviewSubmissionFailure(
                id: "existing-review-failure",
                message: "Existing review failure"
            )
        )
        store.applyReviewPublishedState(reviewState: publishedState)
        store.reviewRuntime.state.activeReviewLoadTask = Task {}
        store.reviewRuntime.state.activeReviewLoadRequestId = "head-request"
        store.reviewRuntime.state.activeReviewCountsTask = Task {}
        store.reviewRuntime.state.activeReviewCountsRequestId = "counts-request"
        store.reviewRuntime.state.activeReviewQueueChunkTask = Task {}
        store.reviewRuntime.state.activeReviewQueueChunkRequestId = "chunk-request"
        store.reviewRuntime.state.hasMoreReviewQueueCards = true
        return publishedState
    }

    @MainActor
    func assertSettledReviewReloadFailure(
        store: FlashcardsStore,
        publishedState: ReviewQueuePublishedState,
        errorFragment: String
    ) {
        XCTAssertEqual(store.selectedReviewFilter, publishedState.selectedReviewFilter)
        XCTAssertEqual(store.reviewQueue, publishedState.reviewQueue)
        XCTAssertEqual(store.presentedReviewCard, publishedState.presentedReviewCard)
        XCTAssertEqual(store.reviewCounts, publishedState.reviewCounts)
        XCTAssertEqual(store.pendingReviewCardIds, publishedState.pendingReviewCardIds)
        XCTAssertEqual(store.reviewSubmissionFailure, publishedState.reviewSubmissionFailure)
        XCTAssertFalse(store.isReviewHeadLoading)
        XCTAssertFalse(store.isReviewCountsLoading)
        XCTAssertFalse(store.isReviewQueueChunkLoading)
        XCTAssertNil(store.reviewRuntime.state.activeReviewLoadTask)
        XCTAssertNil(store.reviewRuntime.state.activeReviewLoadRequestId)
        XCTAssertNil(store.reviewRuntime.state.activeReviewCountsTask)
        XCTAssertNil(store.reviewRuntime.state.activeReviewCountsRequestId)
        XCTAssertNil(store.reviewRuntime.state.activeReviewQueueChunkTask)
        XCTAssertNil(store.reviewRuntime.state.activeReviewQueueChunkRequestId)
        XCTAssertFalse(store.reviewRuntime.state.hasMoreReviewQueueCards)
        XCTAssertTrue(store.globalErrorMessage.contains(errorFragment))
    }
}

actor ReviewReconcileAsyncGate {
    private var hasEntered: Bool = false
    private var isReleased: Bool = false
    private var entryContinuation: CheckedContinuation<Void, Never>?
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    func wait() async {
        self.hasEntered = true
        self.entryContinuation?.resume()
        self.entryContinuation = nil
        if self.isReleased {
            return
        }

        await withCheckedContinuation { continuation in
            self.releaseContinuation = continuation
        }
    }

    func waitUntilEntered() async {
        if self.hasEntered {
            return
        }

        await withCheckedContinuation { continuation in
            self.entryContinuation = continuation
        }
    }

    func release() {
        self.isReleased = true
        self.releaseContinuation?.resume()
        self.releaseContinuation = nil
    }
}


func makePinnedRefreshCard(cardId: String, dueAt: String, updatedAt: String) -> Card {
    FsrsSchedulerTestSupport.makeTestCard(
        cardId: cardId,
        tags: [],
        dueAt: dueAt,
        updatedAt: updatedAt
    )
}


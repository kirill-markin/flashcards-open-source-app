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


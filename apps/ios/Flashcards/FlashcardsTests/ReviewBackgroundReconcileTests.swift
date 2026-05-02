import Foundation
import XCTest
@testable import Flashcards

final class ReviewBackgroundReconcileTests: ProgressStoreTestCase {
    @MainActor
    func testBackgroundReviewReconcileReplacesLoadedWindowWhenSeedChanges() async throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-reconcile-\(UUID().uuidString.lowercased())"
        let userDefaults = UserDefaults(suiteName: suiteName)!
        let credentialStore = CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth")
        let guestCredentialStore = GuestCloudCredentialStore(
            service: "tests-\(suiteName)-guest-auth",
            bundle: .main,
            userDefaults: userDefaults
        )
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
            try? credentialStore.clearCredentials()
            try? guestCredentialStore.clearGuestSession()
        }

        let currentQueue = [
            makeReviewCardForReconcileTest(cardId: "card-a", updatedAt: "2026-04-18T08:00:00.000Z"),
            makeReviewCardForReconcileTest(cardId: "card-b", updatedAt: "2026-04-18T08:01:00.000Z"),
            makeReviewCardForReconcileTest(cardId: "card-c", updatedAt: "2026-04-18T08:02:00.000Z"),
            makeReviewCardForReconcileTest(cardId: "card-d", updatedAt: "2026-04-18T08:03:00.000Z"),
            makeReviewCardForReconcileTest(cardId: "card-e", updatedAt: "2026-04-18T08:04:00.000Z"),
            makeReviewCardForReconcileTest(cardId: "card-f", updatedAt: "2026-04-18T08:05:00.000Z"),
            makeReviewCardForReconcileTest(cardId: "card-g", updatedAt: "2026-04-18T08:06:00.000Z"),
            makeReviewCardForReconcileTest(cardId: "card-h", updatedAt: "2026-04-18T08:07:00.000Z"),
            makeReviewCardForReconcileTest(cardId: "card-i", updatedAt: "2026-04-18T08:08:00.000Z")
        ]
        let refreshedWindow = [
            currentQueue[0],
            makeReviewCardForReconcileTest(cardId: "card-x", updatedAt: "2026-04-18T09:00:00.000Z"),
            currentQueue[2],
            currentQueue[3],
            currentQueue[4],
            currentQueue[5],
            currentQueue[6],
            currentQueue[7],
            currentQueue[8]
        ]
        let expectedCounts = ReviewCounts(
            dueCount: refreshedWindow.count,
            totalCount: refreshedWindow.count + 1
        )
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
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: { _, _, _, _ in
                expectedCounts
            },
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: { _, _, _, _, limit in
                XCTAssertEqual(currentQueue.count, limit)
                return ReviewQueueWindowLoadState(
                    reviewQueue: refreshedWindow,
                    hasMoreCards: true
                )
            },
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: .allCards,
                reviewQueue: currentQueue,
                presentedCardId: currentQueue[3].cardId,
                reviewCounts: ReviewCounts(dueCount: currentQueue.count, totalCount: currentQueue.count),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [],
                reviewSubmissionFailure: nil
            )
        )

        let didRefresh = try await store.refreshReviewState(
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:00:00.000Z")),
            mode: .backgroundReconcileSilently
        )

        XCTAssertTrue(didRefresh)
        XCTAssertEqual(store.reviewQueue.map(\.cardId), refreshedWindow.map(\.cardId))
        XCTAssertEqual(store.reviewQueue.count, currentQueue.count)
        XCTAssertEqual(store.presentedReviewCardId, currentQueue[3].cardId)
        XCTAssertEqual(store.reviewCounts, expectedCounts)
        XCTAssertFalse(store.isReviewQueueChunkLoading)
    }
}

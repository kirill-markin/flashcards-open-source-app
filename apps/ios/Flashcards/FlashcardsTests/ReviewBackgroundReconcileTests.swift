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
                reviewQueueCanonicalCount: currentQueue.count,
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

    @MainActor
    func testBackgroundReviewReconcilePreservesPresentedCardMissingFromBoundedWindow() async throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-reconcile-pin-\(UUID().uuidString.lowercased())"
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

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:00:00.000Z"))
        let presentedCard = makePinnedRefreshCard(
            cardId: "old-presented",
            dueAt: "2026-04-18T07:00:00.000Z",
            updatedAt: "2026-04-18T08:00:00.000Z"
        )
        let currentQueue = [presentedCard] + (1...7).map { index in
            makePinnedRefreshCard(
                cardId: "old-tail-\(index)",
                dueAt: "2026-04-18T07:0\(index):00.000Z",
                updatedAt: "2026-04-18T08:0\(index):00.000Z"
            )
        }
        let refreshedWindow = (1...8).map { index in
            makePinnedRefreshCard(
                cardId: "recent-\(index)",
                dueAt: String(format: "2026-04-18T09:%02d:00.000Z", 10 + index),
                updatedAt: String(format: "2026-04-18T09:%02d:00.000Z", 10 + index)
            )
        }
        let expectedCounts = ReviewCounts(
            dueCount: refreshedWindow.count + 1,
            totalCount: refreshedWindow.count + 1
        )
        let windowLimitRecorder = ReviewWindowLimitRecorder()
        let store = self.makeStoreForBackgroundReconcileTest(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            reviewCounts: expectedCounts,
            expectedWindowLimit: currentQueue.count,
            windowLimitRecorder: windowLimitRecorder,
            refreshedWindow: refreshedWindow,
            hasMoreCards: true
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = refreshedWindow + currentQueue
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: .allCards,
                reviewQueue: currentQueue,
                reviewQueueCanonicalCount: currentQueue.count,
                presentedCardId: presentedCard.cardId,
                reviewCounts: ReviewCounts(dueCount: currentQueue.count, totalCount: currentQueue.count),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [],
                reviewSubmissionFailure: nil
            )
        )

        let didRefresh = try await store.refreshReviewState(now: now, mode: .backgroundReconcileSilently)
        let didRefreshAgain = try await store.refreshReviewState(now: now, mode: .backgroundReconcileSilently)

        let expectedStoredQueue = refreshedWindow + [presentedCard]
        XCTAssertTrue(didRefresh)
        XCTAssertFalse(didRefreshAgain)
        XCTAssertEqual(store.reviewQueue.map(\.cardId), expectedStoredQueue.map(\.cardId))
        XCTAssertEqual(store.reviewQueueCanonicalCount, refreshedWindow.count)
        XCTAssertEqual(store.presentedReviewCardId, presentedCard.cardId)
        XCTAssertEqual(store.effectiveReviewQueue.first?.cardId, presentedCard.cardId)
        XCTAssertEqual(store.effectiveReviewQueue.dropFirst().first?.cardId, refreshedWindow[0].cardId)
        XCTAssertEqual(store.reviewCounts, expectedCounts)
        XCTAssertFalse(store.isReviewQueueChunkLoading)
        let recordedWindowLimits = await windowLimitRecorder.snapshot()
        XCTAssertEqual(recordedWindowLimits, [currentQueue.count, currentQueue.count])
    }

    @MainActor
    func testBackgroundReviewReconcileDoesNotPreservePresentedCardMissingFromLatestCards() async throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-reconcile-pin-missing-\(UUID().uuidString.lowercased())"
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

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:00:00.000Z"))
        let presentedCard = makePinnedRefreshCard(
            cardId: "missing-presented",
            dueAt: "2026-04-18T07:00:00.000Z",
            updatedAt: "2026-04-18T08:00:00.000Z"
        )
        let currentQueue = [
            presentedCard,
            makePinnedRefreshCard(
                cardId: "old-tail",
                dueAt: "2026-04-18T07:01:00.000Z",
                updatedAt: "2026-04-18T08:01:00.000Z"
            )
        ]
        let refreshedWindow = (1...8).map { index in
            makePinnedRefreshCard(
                cardId: "latest-\(index)",
                dueAt: String(format: "2026-04-18T09:%02d:00.000Z", 20 + index),
                updatedAt: String(format: "2026-04-18T09:%02d:00.000Z", 20 + index)
            )
        }
        let expectedCounts = ReviewCounts(
            dueCount: refreshedWindow.count,
            totalCount: refreshedWindow.count
        )
        let store = self.makeStoreForBackgroundReconcileTest(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            reviewCounts: expectedCounts,
            expectedWindowLimit: reviewSeedQueueSize,
            windowLimitRecorder: nil,
            refreshedWindow: refreshedWindow,
            hasMoreCards: false
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = refreshedWindow
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: .allCards,
                reviewQueue: currentQueue,
                reviewQueueCanonicalCount: currentQueue.count,
                presentedCardId: presentedCard.cardId,
                reviewCounts: ReviewCounts(dueCount: currentQueue.count, totalCount: currentQueue.count),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [],
                reviewSubmissionFailure: nil
            )
        )

        let didRefresh = try await store.refreshReviewState(now: now, mode: .backgroundReconcileSilently)

        XCTAssertTrue(didRefresh)
        XCTAssertEqual(store.reviewQueue.map(\.cardId), refreshedWindow.map(\.cardId))
        XCTAssertEqual(store.presentedReviewCardId, refreshedWindow[0].cardId)
        XCTAssertEqual(store.effectiveReviewQueue.first?.cardId, refreshedWindow[0].cardId)
        XCTAssertEqual(store.reviewCounts, expectedCounts)
        XCTAssertFalse(store.isReviewQueueChunkLoading)
    }

    @MainActor
    private func makeStoreForBackgroundReconcileTest(
        database: LocalDatabase,
        userDefaults: UserDefaults,
        credentialStore: CloudCredentialStore,
        guestCredentialStore: GuestCloudCredentialStore,
        reviewCounts: ReviewCounts,
        expectedWindowLimit: Int,
        windowLimitRecorder: ReviewWindowLimitRecorder?,
        refreshedWindow: [Card],
        hasMoreCards: Bool
    ) -> FlashcardsStore {
        FlashcardsStore(
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
                reviewCounts
            },
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: { _, _, _, _, limit in
                await windowLimitRecorder?.record(limit: limit)
                XCTAssertEqual(expectedWindowLimit, limit)
                return ReviewQueueWindowLoadState(
                    reviewQueue: refreshedWindow,
                    hasMoreCards: hasMoreCards
                )
            },
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
    }
}

private actor ReviewWindowLimitRecorder {
    private var limits: [Int] = []

    func record(limit: Int) {
        self.limits.append(limit)
    }

    func snapshot() -> [Int] {
        self.limits
    }
}

private func makePinnedRefreshCard(cardId: String, dueAt: String, updatedAt: String) -> Card {
    FsrsSchedulerTestSupport.makeTestCard(
        cardId: cardId,
        tags: [],
        effortLevel: .fast,
        dueAt: dueAt,
        updatedAt: updatedAt
    )
}

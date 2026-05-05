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
                presentedReviewCard: currentQueue[3],
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
        XCTAssertEqual(store.presentedReviewCard?.cardId, currentQueue[3].cardId)
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
                presentedReviewCard: presentedCard,
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

        XCTAssertTrue(didRefresh)
        XCTAssertFalse(didRefreshAgain)
        XCTAssertEqual(store.reviewQueue.map(\.cardId), refreshedWindow.map(\.cardId))
        XCTAssertEqual(store.presentedReviewCard?.cardId, presentedCard.cardId)
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
                presentedReviewCard: presentedCard,
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
        XCTAssertEqual(store.presentedReviewCard?.cardId, refreshedWindow[0].cardId)
        XCTAssertEqual(store.effectiveReviewQueue.first?.cardId, refreshedWindow[0].cardId)
        XCTAssertEqual(store.reviewCounts, expectedCounts)
        XCTAssertFalse(store.isReviewQueueChunkLoading)
    }

    @MainActor
    func testReviewSubmissionFailureReloadFailureDoesNotRestoreStaleRollbackCard() throws {
        let suiteName = "review-submit-reload-failure-\(UUID().uuidString.lowercased())"
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

        let staleSubmittedCard = makePinnedRefreshCard(
            cardId: "submitted-card",
            dueAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:01:00.000Z"
        )
        let nextCard = makePinnedRefreshCard(
            cardId: "next-card",
            dueAt: "2026-04-18T09:03:00.000Z",
            updatedAt: "2026-04-18T09:02:00.000Z"
        )
        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: nil,
            cloudAuthService: CloudAuthService(),
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: guestCredentialStore,
            initialGlobalErrorMessage: ""
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = Workspace(
            workspaceId: staleSubmittedCard.workspaceId,
            name: "Test workspace",
            createdAt: "2026-04-18T08:00:00.000Z"
        )
        store.cards = [staleSubmittedCard, nextCard]
        store.decks = []
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: .allCards,
                reviewQueue: [nextCard],
                presentedReviewCard: nextCard,
                reviewCounts: ReviewCounts(dueCount: 2, totalCount: 2),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [staleSubmittedCard.cardId],
                reviewSubmissionFailure: nil
            )
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: staleSubmittedCard.workspaceId,
            cardId: staleSubmittedCard.cardId,
            reviewContext: ReviewSubmissionContext(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForBackgroundTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [nextCard]
            ),
            cardSnapshot: staleSubmittedCard,
            rating: .good,
            reviewedAtClient: "2026-04-18T09:10:00.000Z"
        )

        store.handleReviewSubmissionFailure(
            request: request,
            submissionError: LocalStoreError.validation("Submission failed")
        )

        XCTAssertEqual(store.presentedReviewCard?.cardId, nextCard.cardId)
        XCTAssertEqual(store.reviewQueue.map(\.cardId), [nextCard.cardId])
        XCTAssertEqual(store.effectiveReviewQueue.map(\.cardId), [nextCard.cardId])
        XCTAssertFalse(store.pendingReviewCardIds.contains(staleSubmittedCard.cardId))
        XCTAssertTrue(store.reviewSubmissionFailure?.message.contains("Reload failed") == true)
    }

    @MainActor
    func testReviewSubmissionFailureClassifiesStaleContextBeforeRefreshingReviewState() throws {
        let database = try self.makeDatabase()
        let suiteName = "review-submit-stale-before-refresh-\(UUID().uuidString.lowercased())"
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

        let submittedCard = makePinnedRefreshCard(
            cardId: "submitted-card",
            dueAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:01:00.000Z"
        )
        let currentCard = makePinnedRefreshCard(
            cardId: "current-card",
            dueAt: "2026-04-18T09:03:00.000Z",
            updatedAt: "2026-04-18T09:02:00.000Z"
        )
        let otherPendingCard = makePinnedRefreshCard(
            cardId: "other-pending-card",
            dueAt: "2026-04-18T09:04:00.000Z",
            updatedAt: "2026-04-18T09:03:00.000Z"
        )
        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: database,
            cloudAuthService: CloudAuthService(),
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: guestCredentialStore,
            initialGlobalErrorMessage: ""
        )
        defer {
            store.shutdownForTests()
        }
        store.reviewRuntime.cancelForAccountDeletion()
        store.workspace = Workspace(
            workspaceId: submittedCard.workspaceId,
            name: "Test workspace",
            createdAt: "2026-04-18T08:00:00.000Z"
        )
        store.cards = [submittedCard, currentCard, otherPendingCard]
        store.decks = []
        let existingFailure = ReviewSubmissionFailure(id: "existing-failure", message: "Existing failure")
        let publishedState = ReviewQueuePublishedState(
            selectedReviewFilter: .effort(level: .fast),
            reviewQueue: [currentCard],
            presentedReviewCard: currentCard,
            reviewCounts: ReviewCounts(dueCount: 7, totalCount: 9),
            isReviewHeadLoading: false,
            isReviewCountsLoading: true,
            isReviewQueueChunkLoading: true,
            pendingReviewCardIds: [submittedCard.cardId, otherPendingCard.cardId],
            reviewSubmissionFailure: existingFailure
        )
        store.applyReviewPublishedState(reviewState: publishedState)
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCard.workspaceId,
            cardId: submittedCard.cardId,
            reviewContext: ReviewSubmissionContext(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForBackgroundTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [currentCard]
            ),
            cardSnapshot: submittedCard,
            rating: .good,
            reviewedAtClient: "2026-04-18T09:10:00.000Z"
        )

        store.handleReviewSubmissionFailure(
            request: request,
            submissionError: LocalStoreError.validation("Submission failed")
        )

        XCTAssertEqual(store.selectedReviewFilter, publishedState.selectedReviewFilter)
        XCTAssertEqual(store.reviewQueue, publishedState.reviewQueue)
        XCTAssertEqual(store.presentedReviewCard, publishedState.presentedReviewCard)
        XCTAssertEqual(store.reviewCounts, publishedState.reviewCounts)
        XCTAssertEqual(store.isReviewHeadLoading, publishedState.isReviewHeadLoading)
        XCTAssertEqual(store.isReviewCountsLoading, publishedState.isReviewCountsLoading)
        XCTAssertEqual(store.isReviewQueueChunkLoading, publishedState.isReviewQueueChunkLoading)
        XCTAssertEqual(store.pendingReviewCardIds, [otherPendingCard.cardId])
        XCTAssertEqual(store.reviewSubmissionFailure, existingFailure)
    }

    @MainActor
    func testSuccessfulStaleReviewSubmissionClearsPendingWithoutReviewStateMutation() async throws {
        let suiteName = "review-submit-stale-success-\(UUID().uuidString.lowercased())"
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

        let staleSubmittedCard = makePinnedRefreshCard(
            cardId: "submitted-card",
            dueAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:01:00.000Z"
        )
        let currentCard = makePinnedRefreshCard(
            cardId: "current-card",
            dueAt: "2026-04-18T09:03:00.000Z",
            updatedAt: "2026-04-18T09:02:00.000Z"
        )
        let otherPendingCard = makePinnedRefreshCard(
            cardId: "other-pending-card",
            dueAt: "2026-04-18T09:04:00.000Z",
            updatedAt: "2026-04-18T09:03:00.000Z"
        )
        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: nil,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: nil,
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate(),
            reviewSubmissionExecutor: SuccessfulReviewSubmissionExecutor(card: staleSubmittedCard),
            reviewHeadLoader: { _, _, _, _, _, _ in
                XCTFail("Stale submission success must not start a review head load")
                return ReviewHeadLoadState(
                    resolvedReviewFilter: .allCards,
                    seedReviewQueue: [],
                    hasMoreCards: false
                )
            },
            reviewCountsLoader: { _, _, _, _ in
                XCTFail("Stale submission success must not load review counts")
                return ReviewCounts(dueCount: 0, totalCount: 0)
            },
            reviewQueueChunkLoader: { _, _, _, _, _, _ in
                XCTFail("Stale submission success must not load a review queue chunk")
                return ReviewQueueChunkLoadState(reviewQueueChunk: [], hasMoreCards: false)
            },
            reviewQueueWindowLoader: { _, _, _, _, _ in
                XCTFail("Stale submission success must not reconcile the review window")
                return ReviewQueueWindowLoadState(reviewQueue: [], hasMoreCards: false)
            },
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = Workspace(
            workspaceId: staleSubmittedCard.workspaceId,
            name: "Test workspace",
            createdAt: "2026-04-18T08:00:00.000Z"
        )
        store.cards = [staleSubmittedCard, currentCard, otherPendingCard]
        store.decks = []
        let publishedState = ReviewQueuePublishedState(
            selectedReviewFilter: .effort(level: .fast),
            reviewQueue: [currentCard],
            presentedReviewCard: currentCard,
            reviewCounts: ReviewCounts(dueCount: 7, totalCount: 9),
            isReviewHeadLoading: true,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: true,
            pendingReviewCardIds: [staleSubmittedCard.cardId, otherPendingCard.cardId],
            reviewSubmissionFailure: nil
        )
        store.applyReviewPublishedState(reviewState: publishedState)
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: staleSubmittedCard.workspaceId,
            cardId: staleSubmittedCard.cardId,
            reviewContext: ReviewSubmissionContext(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForBackgroundTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [currentCard]
            ),
            cardSnapshot: staleSubmittedCard,
            rating: .good,
            reviewedAtClient: "2026-04-18T09:10:00.000Z"
        )

        await store.processReviewSubmissionRequest(request: request)

        XCTAssertEqual(store.selectedReviewFilter, publishedState.selectedReviewFilter)
        XCTAssertEqual(store.reviewQueue, publishedState.reviewQueue)
        XCTAssertEqual(store.presentedReviewCard, publishedState.presentedReviewCard)
        XCTAssertEqual(store.reviewCounts, publishedState.reviewCounts)
        XCTAssertEqual(store.isReviewHeadLoading, publishedState.isReviewHeadLoading)
        XCTAssertEqual(store.isReviewCountsLoading, publishedState.isReviewCountsLoading)
        XCTAssertEqual(store.isReviewQueueChunkLoading, publishedState.isReviewQueueChunkLoading)
        XCTAssertEqual(store.pendingReviewCardIds, [otherPendingCard.cardId])
        XCTAssertNil(store.reviewSubmissionFailure)
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

private func makeReviewSubmissionSessionSignatureForBackgroundTest(
    selectedReviewFilter: ReviewFilter,
    reviewQueue: [Card]
) -> ReviewSessionSignature {
    makeReviewSessionSignature(
        selectedReviewFilter: selectedReviewFilter,
        reviewQueue: reviewQueue,
        schedulerSettings: nil,
        seedQueueSize: 8
    )
}

private struct SuccessfulReviewSubmissionExecutor: ReviewSubmissionExecuting {
    let card: Card

    func submitReview(workspaceId: String, submission: ReviewSubmission) async throws -> Card {
        self.card
    }
}

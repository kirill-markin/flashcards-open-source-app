import Foundation
import XCTest
@testable import Flashcards

final class ReviewBackgroundSubmissionSettlementTests: ProgressStoreTestCase {
    @MainActor
    func testStaleSuccessfulSubmissionInvalidatesOldFilterLoadAndReloadsFreshScope() async throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-submit-stale-success-reload-\(UUID().uuidString.lowercased())"
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

        let submittedCard = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Submitted", backText: "Answer", tags: ["A", "B"]),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let freshScopeCard = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Fresh scope", backText: "Answer", tags: ["B"]),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let submissionGate = ReviewReconcileAsyncGate()
        let firstHeadLoadGate = ReviewFirstInvocationAsyncGate()
        let firstCountsLoadGate = ReviewFirstInvocationAsyncGate()
        let freshHeadLoadGate = ReviewReconcileAsyncGate()
        let freshCountsLoadGate = ReviewReconcileAsyncGate()
        let submissionExecutor = GatedDatabaseReviewSubmissionExecutor(
            databaseURL: database.databaseURL,
            gate: submissionGate
        )
        let selectedFilter = makeReviewTagsFilter(tags: ["B"])
        let store = self.makeReviewStoreForIdentityTest(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: submissionExecutor,
            reviewHeadLoader: { _, _, resolvedReviewFilter, _, _, _ in
                if await firstHeadLoadGate.waitIfFirstInvocation() {
                    return ReviewHeadLoadState(
                        resolvedReviewFilter: resolvedReviewFilter,
                        seedReviewQueue: [submittedCard],
                        hasMoreCards: false
                    )
                }
                await freshHeadLoadGate.wait()
                return ReviewHeadLoadState(
                    resolvedReviewFilter: resolvedReviewFilter,
                    seedReviewQueue: [freshScopeCard],
                    hasMoreCards: false
                )
            },
            reviewCountsLoader: { _, _, _, _ in
                if await firstCountsLoadGate.waitIfFirstInvocation() {
                    return ReviewCounts(dueCount: 99, totalCount: 99)
                }
                await freshCountsLoadGate.wait()
                return ReviewCounts(dueCount: 1, totalCount: 1)
            },
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = [submittedCard, freshScopeCard]
        store.decks = []
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: .allCards,
                reviewQueue: [submittedCard, freshScopeCard],
                presentedReviewCard: freshScopeCard,
                reviewCounts: ReviewCounts(dueCount: 2, totalCount: 2),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [submittedCard.cardId],
                reviewSubmissionFailure: nil
            )
        )
        let request = ReviewSubmissionRequest(
            id: "stale-success-request",
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            cardId: submittedCard.cardId,
            reviewContext: ReviewSubmissionContext(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForBackgroundTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [freshScopeCard]
            ),
            cardSnapshot: submittedCard,
            rating: .good,
            reviewedAtClient: "2026-04-18T10:00:00.000Z",
            reviewedTimeZone: "UTC"
        )

        let submissionTask = Task { @MainActor in
            await store.processReviewSubmissionRequest(request: request)
        }
        await submissionGate.waitUntilEntered()

        XCTAssertTrue(
            store.startReviewLoad(
                reviewFilter: selectedFilter,
                now: try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:01:00.000Z"))
            )
        )
        let staleHeadTask = try XCTUnwrap(store.reviewRuntime.state.activeReviewLoadTask)
        let staleCountsTask = try XCTUnwrap(store.reviewRuntime.state.activeReviewCountsTask)
        await firstHeadLoadGate.waitUntilEntered()
        await firstCountsLoadGate.waitUntilEntered()

        await submissionGate.release()
        await submissionTask.value

        await freshHeadLoadGate.waitUntilEntered()
        await freshCountsLoadGate.waitUntilEntered()
        let freshHeadTask = try XCTUnwrap(store.reviewRuntime.state.activeReviewLoadTask)
        let freshCountsTask = try XCTUnwrap(store.reviewRuntime.state.activeReviewCountsTask)
        await freshHeadLoadGate.release()
        await freshCountsLoadGate.release()
        await freshHeadTask.value
        await freshCountsTask.value
        let freshState = store.currentReviewPublishedState()
        XCTAssertEqual(freshState.selectedReviewFilter, selectedFilter)
        XCTAssertEqual(freshState.reviewQueue.map(\.cardId), [freshScopeCard.cardId])
        XCTAssertEqual(freshState.reviewCounts, ReviewCounts(dueCount: 1, totalCount: 1))
        XCTAssertFalse(freshState.pendingReviewCardIds.contains(submittedCard.cardId))

        await firstHeadLoadGate.release()
        await firstCountsLoadGate.release()
        await staleHeadTask.value
        await staleCountsTask.value

        XCTAssertEqual(store.currentReviewPublishedState(), freshState)
    }
    @MainActor
    func testSchedulerWriteSnapshotReadFailurePreservesPublishedReviewState() throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-mutation-snapshot-read-failure-\(UUID().uuidString.lowercased())"
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

        let card = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Existing card", backText: "Answer", tags: []),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let store = self.makeReviewStoreForIdentityTest(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader
        )
        defer {
            store.shutdownForTests()
        }
        store.reviewRuntime.cancelForAccountDeletion()
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = [card]
        store.decks = []
        let publishedState = self.prepareReviewReloadFailureState(
            store: store,
            card: card,
            reviewFilter: .allCards
        )
        try database.core.executeScript(
            sql: "DROP TABLE decks;",
            errorContext: "Failed to arrange deck read failure"
        )

        XCTAssertThrowsError(
            try store.updateSchedulerSettings(
                desiredRetention: 0.87,
                learningStepsMinutes: [1, 10],
                relearningStepsMinutes: [10],
                maximumIntervalDays: 36_500,
                enableFuzz: false
            )
        ) { error in
            XCTAssertTrue(Flashcards.errorMessage(error: error).contains("decks"))
        }

        XCTAssertEqual(try database.loadBootstrapSnapshot().schedulerSettings.desiredRetention, 0.87)
        XCTAssertEqual(store.schedulerSettings, bootstrapSnapshot.schedulerSettings)
        self.assertSettledReviewReloadFailure(
            store: store,
            publishedState: publishedState,
            errorFragment: "decks"
        )
    }

    @MainActor
    func testSchedulerWriteFilterResolutionFailurePreservesPublishedReviewState() throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-mutation-filter-resolution-failure-\(UUID().uuidString.lowercased())"
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

        let card = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Tagged card", backText: "Answer", tags: ["A"]),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let store = self.makeReviewStoreForIdentityTest(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader
        )
        defer {
            store.shutdownForTests()
        }
        store.reviewRuntime.cancelForAccountDeletion()
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = [card]
        store.decks = []
        let publishedState = self.prepareReviewReloadFailureState(
            store: store,
            card: card,
            reviewFilter: makeReviewTagsFilter(tags: ["A"])
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            desiredRetention: 0.86,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36_500,
            enableFuzz: false
        )
        store.reviewRuntime.invalidateReviewSource()

        XCTAssertThrowsError(
            try store.reloadAfterReviewSourceMutation(
                now: try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:00:00.000Z")),
                resolvedReviewQueryLoader: { _, _, _ in
                    throw LocalStoreError.database("Review filter resolution failed")
                }
            )
        ) { error in
            XCTAssertEqual(Flashcards.errorMessage(error: error), "Review filter resolution failed")
        }

        XCTAssertEqual(try database.loadBootstrapSnapshot().schedulerSettings.desiredRetention, 0.86)
        XCTAssertEqual(store.schedulerSettings, bootstrapSnapshot.schedulerSettings)
        self.assertSettledReviewReloadFailure(
            store: store,
            publishedState: publishedState,
            errorFragment: "Review filter resolution failed"
        )
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
            reviewedAtClient: "2026-04-18T09:10:00.000Z",
            reviewedTimeZone: "UTC"
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
            selectedReviewFilter: .allCards,
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
            reviewedAtClient: "2026-04-18T09:10:00.000Z",
            reviewedTimeZone: "UTC"
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
    func testSuccessfulReviewSubmissionRefreshFailureSettlesInvalidatedLoads() async throws {
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
            selectedReviewFilter: .allCards,
            reviewQueue: [currentCard],
            presentedReviewCard: currentCard,
            reviewCounts: ReviewCounts(dueCount: 7, totalCount: 9),
            isReviewHeadLoading: true,
            isReviewCountsLoading: true,
            isReviewQueueChunkLoading: true,
            pendingReviewCardIds: [staleSubmittedCard.cardId, otherPendingCard.cardId],
            reviewSubmissionFailure: nil
        )
        store.applyReviewPublishedState(reviewState: publishedState)
        store.reviewRuntime.state.activeReviewLoadTask = Task {}
        store.reviewRuntime.state.activeReviewLoadRequestId = "head-request"
        store.reviewRuntime.state.activeReviewCountsTask = Task {}
        store.reviewRuntime.state.activeReviewCountsRequestId = "counts-request"
        store.reviewRuntime.state.activeReviewQueueChunkTask = Task {}
        store.reviewRuntime.state.activeReviewQueueChunkRequestId = "chunk-request"
        let initialSourceVersion = store.reviewRuntime.currentReviewSourceVersion()
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
            reviewedAtClient: "2026-04-18T09:10:00.000Z",
            reviewedTimeZone: "UTC"
        )

        await store.processReviewSubmissionRequest(request: request)

        XCTAssertEqual(store.selectedReviewFilter, publishedState.selectedReviewFilter)
        XCTAssertEqual(store.reviewQueue, publishedState.reviewQueue)
        XCTAssertEqual(store.presentedReviewCard, publishedState.presentedReviewCard)
        XCTAssertEqual(store.reviewCounts, publishedState.reviewCounts)
        XCTAssertFalse(store.isReviewHeadLoading)
        XCTAssertFalse(store.isReviewCountsLoading)
        XCTAssertFalse(store.isReviewQueueChunkLoading)
        XCTAssertEqual(store.pendingReviewCardIds, [otherPendingCard.cardId])
        XCTAssertNil(store.reviewSubmissionFailure)
        XCTAssertNil(store.reviewRuntime.state.activeReviewLoadTask)
        XCTAssertNil(store.reviewRuntime.state.activeReviewLoadRequestId)
        XCTAssertNil(store.reviewRuntime.state.activeReviewCountsTask)
        XCTAssertNil(store.reviewRuntime.state.activeReviewCountsRequestId)
        XCTAssertNil(store.reviewRuntime.state.activeReviewQueueChunkTask)
        XCTAssertNil(store.reviewRuntime.state.activeReviewQueueChunkRequestId)
        XCTAssertNotEqual(store.reviewRuntime.currentReviewSourceVersion(), initialSourceVersion)
        XCTAssertEqual(store.globalErrorMessage, "Local database is unavailable")
    }
}

private actor ReviewFirstInvocationAsyncGate {
    private var invocationCount: Int = 0
    private var hasEntered: Bool = false
    private var isReleased: Bool = false
    private var entryContinuation: CheckedContinuation<Void, Never>?
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    func waitIfFirstInvocation() async -> Bool {
        self.invocationCount += 1
        guard self.invocationCount == 1 else {
            return false
        }

        self.hasEntered = true
        self.entryContinuation?.resume()
        self.entryContinuation = nil
        if self.isReleased == false {
            await withCheckedContinuation { continuation in
                self.releaseContinuation = continuation
            }
        }
        return true
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

private actor GatedDatabaseReviewSubmissionExecutor: ReviewSubmissionExecuting {
    private let executor: ReviewSubmissionExecutor
    private let gate: ReviewReconcileAsyncGate

    init(databaseURL: URL, gate: ReviewReconcileAsyncGate) {
        self.executor = ReviewSubmissionExecutor(
            databaseURL: databaseURL,
            outboxMutationGate: ReviewSubmissionOutboxMutationGate()
        )
        self.gate = gate
    }

    func submitReview(workspaceId: String, submission: ReviewSubmission) async throws -> Card {
        await self.gate.wait()
        return try await self.executor.submitReview(workspaceId: workspaceId, submission: submission)
    }
}


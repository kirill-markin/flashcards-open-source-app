import Foundation
import XCTest
@testable import Flashcards

final class ReviewBackgroundIdentityTests: ProgressStoreTestCase {
    @MainActor
    func testBackgroundReviewReconcileAppliesCanonicalizedFilterIdentity() async throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-reconcile-filter-canonicalization-\(UUID().uuidString.lowercased())"
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

        let taggedCard = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Tagged", backText: "Answer", tags: ["A"]),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let untaggedCard = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Untagged", backText: "Answer", tags: []),
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
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = [taggedCard, untaggedCard]
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: makeReviewTagsFilter(tags: ["A"]),
                reviewQueue: [taggedCard],
                presentedReviewCard: taggedCard,
                reviewCounts: ReviewCounts(dueCount: 0, totalCount: 1),
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
        XCTAssertEqual(store.selectedReviewFilter, .allCards)
        XCTAssertEqual(Set(store.reviewQueue.map(\.cardId)), Set([taggedCard.cardId, untaggedCard.cardId]))
        XCTAssertEqual(
            FlashcardsStore.loadSelectedReviewFilter(
                userDefaults: userDefaults,
                decoder: JSONDecoder(),
                workspaceId: bootstrapSnapshot.workspace.workspaceId
            ),
            .allCards
        )
    }

    @MainActor
    func testBackgroundReviewReconcileRejectsStaleRequestedFilterAfterAwait() async throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-reconcile-stale-filter-\(UUID().uuidString.lowercased())"
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

        let currentCard = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Current", backText: "Answer", tags: ["A"]),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let gate = ReviewReconcileAsyncGate()
        let store = self.makeReviewStoreForIdentityTest(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: { _, _, _, _ in
                ReviewCounts(dueCount: 0, totalCount: 1)
            },
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: { _, _, _, _, _ in
                await gate.wait()
                return ReviewQueueWindowLoadState(reviewQueue: [currentCard], hasMoreCards: false)
            },
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = [currentCard]
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: .allCards,
                reviewQueue: [currentCard],
                presentedReviewCard: currentCard,
                reviewCounts: ReviewCounts(dueCount: 0, totalCount: 1),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [],
                reviewSubmissionFailure: nil
            )
        )
        let refreshTask = Task { @MainActor in
            try await store.refreshReviewState(
                now: try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:00:00.000Z")),
                mode: .backgroundReconcileSilently
            )
        }
        await gate.waitUntilEntered()
        let replacementState = ReviewQueuePublishedState(
            selectedReviewFilter: makeReviewTagsFilter(tags: ["Missing"]),
            reviewQueue: [],
            presentedReviewCard: nil,
            reviewCounts: ReviewCounts(dueCount: 0, totalCount: 0),
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: [],
            reviewSubmissionFailure: nil
        )
        store.applyReviewPublishedState(reviewState: replacementState)
        await gate.release()

        let didRefresh = try await refreshTask.value

        XCTAssertFalse(didRefresh)
        XCTAssertEqual(store.currentReviewPublishedState(), replacementState)
    }

    @MainActor
    func testBackgroundReviewReconcileRejectsOlderSameFilterResultAfterForegroundReloadRestoresState() async throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-reconcile-stale-same-filter-\(UUID().uuidString.lowercased())"
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

        let currentCard = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Current", backText: "Answer", tags: []),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let staleCard = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Stale", backText: "Answer", tags: []),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let gate = ReviewReconcileAsyncGate()
        let foregroundCounts = ReviewCounts(dueCount: 0, totalCount: 1)
        let store = self.makeReviewStoreForIdentityTest(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: { _, _, resolvedReviewFilter, _, _, _ in
                ReviewHeadLoadState(
                    resolvedReviewFilter: resolvedReviewFilter,
                    seedReviewQueue: [currentCard],
                    hasMoreCards: false
                )
            },
            reviewCountsLoader: { _, _, _, _ in
                foregroundCounts
            },
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: { _, _, _, _, _ in
                await gate.wait()
                return ReviewQueueWindowLoadState(reviewQueue: [staleCard], hasMoreCards: false)
            },
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = [currentCard, staleCard]
        let initialState = ReviewQueuePublishedState(
            selectedReviewFilter: .allCards,
            reviewQueue: [currentCard],
            presentedReviewCard: currentCard,
            reviewCounts: ReviewCounts(dueCount: 0, totalCount: 1),
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: [],
            reviewSubmissionFailure: nil
        )
        store.applyReviewPublishedState(reviewState: initialState)

        let reconcileTask = Task { @MainActor in
            try await store.refreshReviewState(
                now: try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:00:00.000Z")),
                mode: .backgroundReconcileSilently
            )
        }
        await gate.waitUntilEntered()

        XCTAssertTrue(
            store.startReviewLoad(
                reviewFilter: .allCards,
                now: try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:01:00.000Z"))
            )
        )
        let foregroundHeadTask = try XCTUnwrap(store.reviewRuntime.state.activeReviewLoadTask)
        let foregroundCountsTask = try XCTUnwrap(store.reviewRuntime.state.activeReviewCountsTask)
        await foregroundHeadTask.value
        await foregroundCountsTask.value
        let foregroundState = store.currentReviewPublishedState()
        XCTAssertEqual(foregroundState, initialState)

        await gate.release()
        let didRefresh = try await reconcileTask.value

        XCTAssertFalse(didRefresh)
        XCTAssertEqual(store.currentReviewPublishedState(), foregroundState)
    }

    @MainActor
    func testBackgroundReviewReconcileRestartsResolvedLoadWhenTagSourceChangesAfterAwait() async throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-reconcile-stale-tag-source-\(UUID().uuidString.lowercased())"
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

        let tagACard = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Tag A", backText: "Answer", tags: ["A"]),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let gate = ReviewReconcileAsyncGate()
        let requestedFilter = makeReviewTagsFilter(tags: ["A"])
        let store = self.makeReviewStoreForIdentityTest(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: { _, _, resolvedReviewFilter, _, _, _ in
                ReviewHeadLoadState(
                    resolvedReviewFilter: resolvedReviewFilter,
                    seedReviewQueue: [tagACard],
                    hasMoreCards: false
                )
            },
            reviewCountsLoader: { _, _, _, _ in
                ReviewCounts(dueCount: 0, totalCount: 1)
            },
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: { _, _, _, _, _ in
                await gate.wait()
                return ReviewQueueWindowLoadState(reviewQueue: [tagACard], hasMoreCards: false)
            },
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = [tagACard]
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: requestedFilter,
                reviewQueue: [tagACard],
                presentedReviewCard: tagACard,
                reviewCounts: ReviewCounts(dueCount: 0, totalCount: 1),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [],
                reviewSubmissionFailure: nil
            )
        )
        store.persistSelectedReviewFilter(reviewFilter: requestedFilter)
        let initialSourceVersion = store.reviewRuntime.currentReviewSourceVersion()

        let reconcileTask = Task { @MainActor in
            try await store.refreshReviewState(
                now: try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:00:00.000Z")),
                mode: .backgroundReconcileSilently
            )
        }
        await gate.waitUntilEntered()

        _ = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Tag B", backText: "Answer", tags: ["B"]),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let refreshOutcome = try store.refreshBootstrapSnapshotWithoutProgressContextRefresh(
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:01:00.000Z"))
        )
        XCTAssertTrue(refreshOutcome.cardsChanged)
        XCTAssertNotEqual(store.reviewRuntime.currentReviewSourceVersion(), initialSourceVersion)
        XCTAssertEqual(store.selectedReviewFilter, requestedFilter)

        await gate.release()
        let didRefresh = try await reconcileTask.value

        XCTAssertFalse(didRefresh)
        XCTAssertEqual(store.selectedReviewFilter, requestedFilter)
        XCTAssertEqual(
            FlashcardsStore.loadSelectedReviewFilter(
                userDefaults: userDefaults,
                decoder: JSONDecoder(),
                workspaceId: bootstrapSnapshot.workspace.workspaceId
            ),
            requestedFilter
        )
    }

    @MainActor
    func testReviewTimelineIdentityChangeAbortsPageQueryAndStartsResolvedLoad() async throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-timeline-filter-identity-\(UUID().uuidString.lowercased())"
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

        let taggedCard = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Tagged", backText: "Answer", tags: ["A"]),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let headGate = ReviewReconcileAsyncGate()
        let store = self.makeReviewStoreForIdentityTest(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: { _, _, resolvedReviewFilter, _, _, _ in
                await headGate.wait()
                return ReviewHeadLoadState(
                    resolvedReviewFilter: resolvedReviewFilter,
                    seedReviewQueue: [taggedCard],
                    hasMoreCards: false
                )
            },
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
            reviewTimelinePageLoader: { _, _, _, _, _, _ in
                XCTFail("Identity-changing timeline resolution must not query a page")
                return ReviewTimelinePage(cards: [], hasMoreCards: false)
            }
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = [taggedCard]
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: makeReviewTagsFilter(tags: ["A"]),
                reviewQueue: [taggedCard],
                presentedReviewCard: taggedCard,
                reviewCounts: ReviewCounts(dueCount: 0, totalCount: 1),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [],
                reviewSubmissionFailure: nil
            )
        )

        do {
            _ = try await store.loadReviewTimelinePage(limit: 20, offset: 0)
            XCTFail("Identity-changing timeline resolution must cancel the stale page request")
        } catch is CancellationError {
            XCTAssertTrue(store.isReviewHeadLoading)
        }

        XCTAssertEqual(store.selectedReviewFilter, .allCards)
        XCTAssertTrue(store.isReviewHeadLoading)
        let reviewHeadTask = try XCTUnwrap(store.reviewRuntime.state.activeReviewLoadTask)
        await headGate.waitUntilEntered()
        await headGate.release()
        await reviewHeadTask.value
    }
    @MainActor
    func testChunkLoadingRoutesResolvedIdentityChangesThroughFullReload() throws {
        let database = try self.makeDatabase()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let suiteName = "review-chunk-filter-identity-\(UUID().uuidString.lowercased())"
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

        let taggedCard = try database.saveCard(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            input: CardEditorInput(frontText: "Tagged", backText: "Answer", tags: ["A"]),
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
            reviewQueueChunkLoader: { _, _, _, _, _, _ in
                XCTFail("Identity-changing chunk resolution must not start a chunk loader")
                return ReviewQueueChunkLoadState(reviewQueueChunk: [], hasMoreCards: false)
            },
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader
        )
        defer {
            store.shutdownForTests()
        }
        store.workspace = bootstrapSnapshot.workspace
        store.schedulerSettings = bootstrapSnapshot.schedulerSettings
        store.cards = [taggedCard]
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: makeReviewTagsFilter(tags: ["A"]),
                reviewQueue: [taggedCard],
                presentedReviewCard: taggedCard,
                reviewCounts: ReviewCounts(dueCount: 0, totalCount: 1),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [],
                reviewSubmissionFailure: nil
            )
        )
        store.reviewRuntime.state.hasMoreReviewQueueCards = true

        store.startReviewQueueChunkLoadIfNeeded(
            now: try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T10:00:00.000Z"))
        )

        XCTAssertEqual(store.selectedReviewFilter, .allCards)
        XCTAssertTrue(store.isReviewHeadLoading)
        XCTAssertFalse(store.isReviewQueueChunkLoading)
    }
}


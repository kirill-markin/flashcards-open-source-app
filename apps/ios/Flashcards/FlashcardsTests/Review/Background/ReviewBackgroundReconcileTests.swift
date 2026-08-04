import Foundation
import XCTest
@testable import Flashcards

final class ReviewBackgroundReconcileTests: ProgressStoreTestCase {
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
            reviewQueueChunkLoader: { _, _, _, _, _, _ in
                try failUnexpectedReviewQueueChunkLoadForBackgroundReconcileTest()
            },
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
            reviewQueueChunkLoader: { _, _, _, _, _, _ in
                try failUnexpectedReviewQueueChunkLoadForBackgroundReconcileTest()
            },
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

    @MainActor
    private func makeReviewStoreForIdentityTest(
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
    private func prepareReviewReloadFailureState(
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
    private func assertSettledReviewReloadFailure(
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

private actor ReviewWindowLimitRecorder {
    private var limits: [Int] = []

    func record(limit: Int) {
        self.limits.append(limit)
    }

    func snapshot() -> [Int] {
        self.limits
    }
}

private actor ReviewReconcileAsyncGate {
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

private func makePinnedRefreshCard(cardId: String, dueAt: String, updatedAt: String) -> Card {
    FsrsSchedulerTestSupport.makeTestCard(
        cardId: cardId,
        tags: [],
        dueAt: dueAt,
        updatedAt: updatedAt
    )
}

private func failUnexpectedReviewQueueChunkLoadForBackgroundReconcileTest() throws -> ReviewQueueChunkLoadState {
    let message: String = "Background reconcile test unexpectedly requested a review queue chunk"
    XCTFail(message)
    throw LocalStoreError.validation(message)
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

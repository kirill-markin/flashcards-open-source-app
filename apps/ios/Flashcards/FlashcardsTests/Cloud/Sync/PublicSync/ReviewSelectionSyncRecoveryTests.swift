import Foundation
import XCTest
@testable import Flashcards

final class ReviewSelectionSyncRecoveryTests: LocalWorkspaceSyncTestCase {
    @MainActor
    func testAppliedRemotePullReportsPresentedReviewCardReplacementForSilentTrigger() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let currentCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Current question",
                backText: "Current answer",
                tags: [],
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let replacementCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Replacement question",
                backText: "Replacement answer",
                tags: [],
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let suiteName = "review-selection-applied-pull-\(UUID().uuidString.lowercased())"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let credentialStore = CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth")
        defer {
            try? credentialStore.clearCredentials()
            userDefaults.removePersistentDomain(forName: suiteName)
        }
        let store = self.makeReviewReconciliationStore(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore
        )
        defer {
            store.shutdownForTests()
        }
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))

        store.workspace = workspace
        store.schedulerSettings = try database.workspaceSettingsStore.loadWorkspaceSchedulerSettings(
            workspaceId: workspace.workspaceId
        )
        store.cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        store.cards = [currentCard, replacementCard]
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: .allCards,
                reviewQueue: [currentCard, replacementCard],
                presentedReviewCard: currentCard,
                reviewCounts: ReviewCounts(dueCount: 2, totalCount: 2),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [],
                reviewSubmissionFailure: nil
            )
        )

        let remoteDeletedAt = "2099-01-01T00:00:00.000Z"
        let applyResult = try database.applySyncChange(
            workspaceId: workspace.workspaceId,
            change: SyncChange(
                changeId: 1,
                entityType: .card,
                entityId: currentCard.cardId,
                action: .upsert,
                payload: .card(
                    self.makeRemoteDeletedCard(
                        card: currentCard,
                        deletedAt: remoteDeletedAt
                    )
                )
            )
        )
        XCTAssertTrue(applyResult.didApply)

        try await store.applySyncResultWithoutBlockingReset(
            syncResult: CloudSyncResult(
                appliedPullChangeCount: 1,
                reviewScheduleImpactingPullChangeCount: 1,
                changedEntityTypes: [.card],
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 0,
                acknowledgedReviewEventOperationCount: 0,
                acknowledgedReviewScheduleImpactingOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0,
                cleanedUpReviewScheduleImpactingOperationCount: 0
            ),
            now: now,
            trigger: self.makeManualSyncTrigger(now: now)
        )

        XCTAssertEqual(replacementCard.cardId, store.presentedReviewCard?.cardId)
        XCTAssertEqual(.reviewUpdatedOnAnotherDevice, store.currentTransientBanner?.kind)
    }

    @MainActor
    func testAcknowledgementOnlyResultDoesNotReportReviewReplacementForSilentTrigger() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let currentCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Current question",
                backText: "Current answer",
                tags: [],
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let suiteName = "review-selection-acknowledgement-\(UUID().uuidString.lowercased())"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let credentialStore = CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth")
        defer {
            try? credentialStore.clearCredentials()
            userDefaults.removePersistentDomain(forName: suiteName)
        }
        let store = self.makeReviewReconciliationStore(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore
        )
        defer {
            store.shutdownForTests()
        }
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))

        store.workspace = workspace
        store.schedulerSettings = try database.workspaceSettingsStore.loadWorkspaceSchedulerSettings(
            workspaceId: workspace.workspaceId
        )
        store.cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        store.cards = [currentCard]
        store.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: .allCards,
                reviewQueue: [currentCard],
                presentedReviewCard: currentCard,
                reviewCounts: ReviewCounts(dueCount: 1, totalCount: 1),
                isReviewHeadLoading: false,
                isReviewCountsLoading: false,
                isReviewQueueChunkLoading: false,
                pendingReviewCardIds: [],
                reviewSubmissionFailure: nil
            )
        )

        try await store.applySyncResultWithoutBlockingReset(
            syncResult: CloudSyncResult(
                appliedPullChangeCount: 0,
                reviewScheduleImpactingPullChangeCount: 0,
                changedEntityTypes: [],
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 1,
                acknowledgedReviewEventOperationCount: 0,
                acknowledgedReviewScheduleImpactingOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0,
                cleanedUpReviewScheduleImpactingOperationCount: 0
            ),
            now: now,
            trigger: self.makeManualSyncTrigger(now: now)
        )

        XCTAssertEqual(currentCard.cardId, store.presentedReviewCard?.cardId)
        XCTAssertNil(store.currentTransientBanner)
    }

    @MainActor
    func testApplySyncResultBroadlyResetsReviewSelectionAfterLocalIdRepair() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["tag"],
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let suiteName = "review-selection-recovery-\(UUID().uuidString.lowercased())"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let credentialStore = CloudCredentialStore(service: "tests-deck-filter-\(UUID().uuidString.lowercased())")
        defer {
            try? credentialStore.clearCredentials()
            userDefaults.removePersistentDomain(forName: suiteName)
        }
        let store = self.makeReviewFilterRecoveryStore(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            cloudSyncService: nil
        )
        defer {
            store.shutdownForTests()
        }
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))

        store.workspace = workspace
        store.schedulerSettings = try database.workspaceSettingsStore.loadWorkspaceSchedulerSettings(
            workspaceId: workspace.workspaceId
        )
        store.cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        store.selectedReviewFilter = .tag(tag: "tag")
        store.reviewQueue = [savedCard]
        store.presentedReviewCard = savedCard
        store.persistSelectedReviewFilter(reviewFilter: .tag(tag: "tag"))
        XCTAssertEqual(.tag(tag: "tag"), store.selectedReviewFilter)
        XCTAssertEqual(
            .tag(tag: "tag"),
            FlashcardsStore.loadSelectedReviewFilter(
                userDefaults: userDefaults,
                decoder: JSONDecoder(),
                workspaceId: workspace.workspaceId
            )
        )

        _ = try database.repairLocalIdForPublicSyncConflict(
            workspaceId: workspace.workspaceId,
            syncConflict: CloudSyncConflictDetails(
                phase: "push",
                entityType: .card,
                entityId: savedCard.cardId,
                entryIndex: 0,
                reviewEventIndex: nil,
                recoverable: true
            )
        )

        try await store.applySyncResultWithoutBlockingReset(
            syncResult: CloudSyncResult(
                appliedPullChangeCount: 0,
                reviewScheduleImpactingPullChangeCount: 0,
                changedEntityTypes: [.card],
                localIdRepairEntityTypes: [.card],
                acknowledgedOperationCount: 0,
                acknowledgedReviewEventOperationCount: 0,
                acknowledgedReviewScheduleImpactingOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0,
                cleanedUpReviewScheduleImpactingOperationCount: 0
            ),
            now: now,
            trigger: self.makeManualSyncTrigger(now: now)
        )

        XCTAssertEqual(.allCards, store.selectedReviewFilter)
        XCTAssertNil(store.presentedReviewCard)
        XCTAssertTrue(store.reviewQueue.isEmpty)
        XCTAssertEqual(
            .allCards,
            FlashcardsStore.loadSelectedReviewFilter(
                userDefaults: userDefaults,
                decoder: JSONDecoder(),
                workspaceId: workspace.workspaceId
            )
        )
    }

    @MainActor
    func testSyncCloudNowResetsReviewSelectionWhenLocalIdRepairFailureThrows() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["tag"],
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: "user-1",
            linkedWorkspaceId: workspace.workspaceId,
            activeWorkspaceId: workspace.workspaceId,
            linkedEmail: "user@example.com"
        )
        let suiteName = "review-selection-recovery-failure-\(UUID().uuidString.lowercased())"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let credentialStore = CloudCredentialStore(service: "tests-deck-filter-\(UUID().uuidString.lowercased())")
        defer {
            try? credentialStore.clearCredentials()
            userDefaults.removePersistentDomain(forName: suiteName)
        }
        try credentialStore.saveCredentials(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
            )
        )
        let cloudSyncService = AIChatStoreTestSupport.CloudSyncService()
        cloudSyncService.runLinkedSyncErrors = [
            CloudSyncLocalIdRepairFailure(
                syncResult: CloudSyncResult(
                    appliedPullChangeCount: 0,
                    reviewScheduleImpactingPullChangeCount: 0,
                    changedEntityTypes: [.card],
                    localIdRepairEntityTypes: [.card],
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    acknowledgedReviewScheduleImpactingOperationCount: 0,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0,
                    cleanedUpReviewScheduleImpactingOperationCount: 0
                ),
                underlyingError: LocalStoreError.validation("terminal sync failure after repair")
            )
        ]
        let store = self.makeReviewFilterRecoveryStore(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            cloudSyncService: cloudSyncService
        )
        defer {
            store.shutdownForTests()
        }
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))

        store.workspace = workspace
        store.schedulerSettings = try database.workspaceSettingsStore.loadWorkspaceSchedulerSettings(
            workspaceId: workspace.workspaceId
        )
        store.cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        store.cloudRuntime.setActiveCloudSession(linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId))
        store.selectedReviewFilter = .tag(tag: "tag")
        store.reviewQueue = [savedCard]
        store.presentedReviewCard = savedCard
        store.persistSelectedReviewFilter(reviewFilter: .tag(tag: "tag"))

        do {
            try await store.syncCloudNow(trigger: self.makeManualSyncTrigger(now: now))
            XCTFail("Expected sync failure after local id repair")
        } catch {
            XCTAssertTrue(Flashcards.errorMessage(error: error).contains("terminal sync failure after repair"))
        }

        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(.allCards, store.selectedReviewFilter)
        XCTAssertNil(store.presentedReviewCard)
        XCTAssertTrue(store.reviewQueue.isEmpty)
        XCTAssertEqual(
            .allCards,
            FlashcardsStore.loadSelectedReviewFilter(
                userDefaults: userDefaults,
                decoder: JSONDecoder(),
                workspaceId: workspace.workspaceId
            )
        )
        XCTAssertNil(store.lastSuccessfulCloudSyncAt)
        guard case .failed(let message) = store.syncStatus else {
            XCTFail("Expected failed sync status after sync failure")
            return
        }
        XCTAssertTrue(message.contains("terminal sync failure after repair"))
    }

    @MainActor
    func testRunLinkedSyncResetsReviewSelectionWhenLocalIdRepairFailureThrows() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["tag"],
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let suiteName = "review-selection-run-linked-recovery-\(UUID().uuidString.lowercased())"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let credentialStore = CloudCredentialStore(service: "tests-deck-filter-\(UUID().uuidString.lowercased())")
        defer {
            try? credentialStore.clearCredentials()
            userDefaults.removePersistentDomain(forName: suiteName)
        }
        let cloudSyncService = AIChatStoreTestSupport.CloudSyncService()
        cloudSyncService.runLinkedSyncErrors = [
            CloudSyncLocalIdRepairFailure(
                syncResult: CloudSyncResult(
                    appliedPullChangeCount: 0,
                    reviewScheduleImpactingPullChangeCount: 0,
                    changedEntityTypes: [.card],
                    localIdRepairEntityTypes: [.card],
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    acknowledgedReviewScheduleImpactingOperationCount: 0,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0,
                    cleanedUpReviewScheduleImpactingOperationCount: 0
                ),
                underlyingError: LocalStoreError.validation("terminal sync failure after repair")
            )
        ]
        let store = self.makeReviewFilterRecoveryStore(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            cloudSyncService: cloudSyncService
        )
        defer {
            store.shutdownForTests()
        }

        store.workspace = workspace
        store.schedulerSettings = try database.workspaceSettingsStore.loadWorkspaceSchedulerSettings(
            workspaceId: workspace.workspaceId
        )
        store.cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        store.selectedReviewFilter = .tag(tag: "tag")
        store.reviewQueue = [savedCard]
        store.presentedReviewCard = savedCard
        store.persistSelectedReviewFilter(reviewFilter: .tag(tag: "tag"))

        do {
            _ = try await store.runLinkedSync(
                linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
            )
            XCTFail("Expected sync failure after local id repair")
        } catch {
            XCTAssertTrue(Flashcards.errorMessage(error: error).contains("terminal sync failure after repair"))
        }

        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(.allCards, store.selectedReviewFilter)
        XCTAssertNil(store.presentedReviewCard)
        XCTAssertTrue(store.reviewQueue.isEmpty)
        XCTAssertEqual(
            .allCards,
            FlashcardsStore.loadSelectedReviewFilter(
                userDefaults: userDefaults,
                decoder: JSONDecoder(),
                workspaceId: workspace.workspaceId
            )
        )
        XCTAssertNil(store.lastSuccessfulCloudSyncAt)
    }

    @MainActor
    func testApplySyncResultPreservesSelectedDeckReviewFilterForNormalDeckChange() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedDeck = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(tags: ["medium"])
            )
        )
        let suiteName = "deck-filter-normal-change-\(UUID().uuidString.lowercased())"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let credentialStore = CloudCredentialStore(service: "tests-deck-filter-\(UUID().uuidString.lowercased())")
        defer {
            try? credentialStore.clearCredentials()
            userDefaults.removePersistentDomain(forName: suiteName)
        }
        let store = self.makeReviewFilterRecoveryStore(
            database: database,
            userDefaults: userDefaults,
            credentialStore: credentialStore,
            cloudSyncService: nil
        )
        defer {
            store.shutdownForTests()
        }
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))

        store.workspace = workspace
        store.schedulerSettings = try database.workspaceSettingsStore.loadWorkspaceSchedulerSettings(
            workspaceId: workspace.workspaceId
        )
        store.cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        store.selectedReviewFilter = .deck(deckId: savedDeck.deckId)
        store.persistSelectedReviewFilter(reviewFilter: .deck(deckId: savedDeck.deckId))
        _ = try database.updateDeck(
            workspaceId: workspace.workspaceId,
            deckId: savedDeck.deckId,
            input: DeckEditorInput(
                name: "Renamed deck",
                filterDefinition: buildDeckFilterDefinition(tags: ["medium"])
            )
        )

        try await store.applySyncResultWithoutBlockingReset(
            syncResult: CloudSyncResult(
                appliedPullChangeCount: 1,
                reviewScheduleImpactingPullChangeCount: 0,
                changedEntityTypes: [.deck],
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 0,
                acknowledgedReviewEventOperationCount: 0,
                acknowledgedReviewScheduleImpactingOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0,
                cleanedUpReviewScheduleImpactingOperationCount: 0
            ),
            now: now,
            trigger: self.makeManualSyncTrigger(now: now)
        )

        XCTAssertEqual(.deck(deckId: savedDeck.deckId), store.selectedReviewFilter)
        XCTAssertEqual(
            .deck(deckId: savedDeck.deckId),
            FlashcardsStore.loadSelectedReviewFilter(
                userDefaults: userDefaults,
                decoder: JSONDecoder(),
                workspaceId: workspace.workspaceId
            )
        )
    }

    @MainActor
    private func makeReviewReconciliationStore(
        database: LocalDatabase,
        userDefaults: UserDefaults,
        credentialStore: CloudCredentialStore
    ) -> FlashcardsStore {
        let guestCredentialStore = GuestCloudCredentialStore(
            service: "tests-review-reconciliation-guest-\(UUID().uuidString.lowercased())",
            bundle: .main,
            userDefaults: userDefaults
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
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
        store.updateCurrentVisibleTab(tab: .review)
        return store
    }

    private func makeRemoteDeletedCard(card: Card, deletedAt: String) -> Card {
        Card(
            cardId: card.cardId,
            workspaceId: card.workspaceId,
            frontText: card.frontText,
            backText: card.backText,
            cardType: card.cardType,
            metadata: card.metadata,
            tags: card.tags,
            dueAt: card.dueAt,
            createdAt: card.createdAt,
            reps: card.reps,
            lapses: card.lapses,
            fsrsCardState: card.fsrsCardState,
            fsrsStepIndex: card.fsrsStepIndex,
            fsrsStability: card.fsrsStability,
            fsrsDifficulty: card.fsrsDifficulty,
            fsrsLastReviewedAt: card.fsrsLastReviewedAt,
            fsrsScheduledDays: card.fsrsScheduledDays,
            clientUpdatedAt: deletedAt,
            lastModifiedByReplicaId: "remote-replica",
            lastOperationId: "remote-delete-operation",
            updatedAt: deletedAt,
            deletedAt: deletedAt
        )
    }
}

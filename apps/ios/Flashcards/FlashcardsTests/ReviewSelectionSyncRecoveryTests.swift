import Foundation
import XCTest
@testable import Flashcards

final class ReviewSelectionSyncRecoveryTests: LocalWorkspaceSyncTestCase {
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
                effortLevel: .medium
            ),
            cardId: nil
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
                changedEntityTypes: [.card],
                localIdRepairEntityTypes: [.card],
                acknowledgedOperationCount: 0,
                acknowledgedReviewEventOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0
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
                effortLevel: .medium
            ),
            cardId: nil
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
                    changedEntityTypes: [.card],
                    localIdRepairEntityTypes: [.card],
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0
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
                effortLevel: .medium
            ),
            cardId: nil
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
                    changedEntityTypes: [.card],
                    localIdRepairEntityTypes: [.card],
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0
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
                filterDefinition: buildDeckFilterDefinition(effortLevels: [.medium], tags: [])
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
                filterDefinition: buildDeckFilterDefinition(effortLevels: [.medium], tags: [])
            )
        )

        try await store.applySyncResultWithoutBlockingReset(
            syncResult: CloudSyncResult(
                appliedPullChangeCount: 1,
                changedEntityTypes: [.deck],
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 0,
                acknowledgedReviewEventOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0
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
}

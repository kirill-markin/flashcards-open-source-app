import Foundation
import XCTest
@testable import Flashcards

final class LocalWorkspaceLinkMigrationTests: XCTestCase {
    private var databaseURL: URL?
    private var database: LocalDatabase?

    override func tearDownWithError() throws {
        if let database {
            try database.close()
        }
        if let databaseURL {
            try? FileManager.default.removeItem(at: databaseURL)
        }
        self.database = nil
        self.databaseURL = nil
        CloudSyncRunnerTestURLProtocol.reset()
        try super.tearDownWithError()
    }

    func testWorkspaceIdentityForkUsesStableBackendCompatibleUuidV5Inputs() {
        XCTAssertEqual(
            "6cab5f77-fe75-5774-a07e-965887d8c4bd",
            forkedCardIdForWorkspace(
                sourceWorkspaceId: "workspace-local",
                destinationWorkspaceId: "workspace-linked",
                sourceCardId: "card-source"
            )
        )
        XCTAssertEqual(
            "55b8435f-64d5-5381-8dbb-f5a736616156",
            forkedDeckIdForWorkspace(
                sourceWorkspaceId: "workspace-local",
                destinationWorkspaceId: "workspace-linked",
                sourceDeckId: "deck-source"
            )
        )
        XCTAssertEqual(
            "c2d996b4-d588-5afe-b062-300de5d03dd4",
            forkedReviewEventIdForWorkspace(
                sourceWorkspaceId: "workspace-local",
                destinationWorkspaceId: "workspace-linked",
                sourceReviewEventId: "review-source"
            )
        )
    }

    func testMigrateLocalWorkspaceToLinkedWorkspaceReplacesLocalShellForNonEmptyRemoteWorkspace() throws {
        let database = try self.makeDatabase()
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: localWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.submitReview(
            workspaceId: localWorkspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )
        try self.updateSyncState(
            database: database,
            workspaceId: localWorkspace.workspaceId,
            hotChangeId: 123,
            reviewSequenceId: 456
        )

        try database.migrateLocalWorkspaceToLinkedWorkspace(
            localWorkspaceId: localWorkspace.workspaceId,
            linkedSession: self.makeLinkedSession(workspaceId: "workspace-linked"),
            remoteWorkspaceIsEmpty: false
        )

        XCTAssertEqual("workspace-linked", try database.workspaceSettingsStore.loadWorkspace().workspaceId)
        XCTAssertEqual(1, try self.loadWorkspaceIds(database: database).count)
        XCTAssertTrue(try database.loadActiveCards(workspaceId: "workspace-linked").isEmpty)
        XCTAssertTrue(try database.loadReviewEvents(workspaceId: "workspace-linked").isEmpty)
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
        XCTAssertNil(try self.loadSyncState(database: database, workspaceId: localWorkspace.workspaceId))
        XCTAssertEqual(
            SyncStateSnapshot(
                workspaceId: "workspace-linked",
                lastAppliedHotChangeId: 0,
                lastAppliedReviewSequenceId: 0,
                hasHydratedHotState: false,
                hasHydratedReviewHistory: false
            ),
            try self.loadSyncState(database: database, workspaceId: "workspace-linked")
        )
    }

    func testMigrateLocalWorkspaceToLinkedWorkspaceForksLocalDataForEmptyRemoteWorkspaceAndResetsSyncState() throws {
        let database = try self.makeDatabase()
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: localWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["tag"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let savedDeck = try database.createDeck(
            workspaceId: localWorkspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [], tags: ["tag"])
            )
        )
        _ = try database.submitReview(
            workspaceId: localWorkspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: localWorkspace.workspaceId,
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36500,
            enableFuzz: true
        )
        let sourceReviewEvent = try XCTUnwrap(try database.loadReviewEvents(workspaceId: localWorkspace.workspaceId).first)
        try self.updateSyncState(
            database: database,
            workspaceId: localWorkspace.workspaceId,
            hotChangeId: 123,
            reviewSequenceId: 456
        )
        let expectedForkedCardId = forkedCardIdForWorkspace(
            sourceWorkspaceId: localWorkspace.workspaceId,
            destinationWorkspaceId: "workspace-linked",
            sourceCardId: savedCard.cardId
        )
        let expectedForkedDeckId = forkedDeckIdForWorkspace(
            sourceWorkspaceId: localWorkspace.workspaceId,
            destinationWorkspaceId: "workspace-linked",
            sourceDeckId: savedDeck.deckId
        )
        let expectedForkedReviewEventId = forkedReviewEventIdForWorkspace(
            sourceWorkspaceId: localWorkspace.workspaceId,
            destinationWorkspaceId: "workspace-linked",
            sourceReviewEventId: sourceReviewEvent.reviewEventId
        )

        try database.migrateLocalWorkspaceToLinkedWorkspace(
            localWorkspaceId: localWorkspace.workspaceId,
            linkedSession: self.makeLinkedSession(workspaceId: "workspace-linked"),
            remoteWorkspaceIsEmpty: true
        )

        let migratedCards = try database.loadActiveCards(workspaceId: "workspace-linked")
        let migratedReviewEvents = try database.loadReviewEvents(workspaceId: "workspace-linked")
        let migratedCard = try XCTUnwrap(migratedCards.first)
        let migratedReviewEvent = try XCTUnwrap(migratedReviewEvents.first)
        let migratedDeck = try XCTUnwrap(try database.loadActiveDecks(workspaceId: "workspace-linked").first)
        let outboxRows = try self.loadOutboxRows(database: database)
        let cardOutboxRows = outboxRows.filter { row in
            row.entityType == SyncEntityType.card.rawValue
        }
        let deckOutboxRows = outboxRows.filter { row in
            row.entityType == SyncEntityType.deck.rawValue
        }
        let reviewEventOutboxRows = outboxRows.filter { row in
            row.entityType == SyncEntityType.reviewEvent.rawValue
        }
        let schedulerOutboxRows = outboxRows.filter { row in
            row.entityType == SyncEntityType.workspaceSchedulerSettings.rawValue
        }

        XCTAssertEqual(1, try self.loadWorkspaceIds(database: database).count)
        XCTAssertEqual(expectedForkedCardId, migratedCard.cardId)
        XCTAssertEqual("workspace-linked", migratedCard.workspaceId)
        XCTAssertEqual(["tag"], migratedCard.tags)
        XCTAssertEqual(expectedForkedDeckId, migratedDeck.deckId)
        XCTAssertEqual(1, migratedReviewEvents.count)
        XCTAssertEqual(expectedForkedReviewEventId, migratedReviewEvent.reviewEventId)
        XCTAssertEqual("workspace-linked", migratedReviewEvent.workspaceId)
        XCTAssertEqual(expectedForkedCardId, migratedReviewEvent.cardId)
        XCTAssertTrue(outboxRows.allSatisfy { row in row.workspaceId == "workspace-linked" })
        XCTAssertFalse(outboxRows.contains { row in row.entityId == savedCard.cardId })
        XCTAssertFalse(outboxRows.contains { row in row.entityId == savedDeck.deckId })
        XCTAssertFalse(outboxRows.contains { row in row.entityId == sourceReviewEvent.reviewEventId })
        XCTAssertTrue(
            try cardOutboxRows.allSatisfy { row in
                let payload = try JSONDecoder().decode(CardOutboxPayload.self, from: Data(row.payloadJson.utf8))
                return row.entityId == expectedForkedCardId && payload.cardId == expectedForkedCardId
            }
        )
        XCTAssertTrue(
            try deckOutboxRows.allSatisfy { row in
                let payload = try JSONDecoder().decode(DeckOutboxPayload.self, from: Data(row.payloadJson.utf8))
                return row.entityId == expectedForkedDeckId && payload.deckId == expectedForkedDeckId
            }
        )
        XCTAssertTrue(
            try reviewEventOutboxRows.allSatisfy { row in
                let payload = try JSONDecoder().decode(
                    ReviewEventOutboxPayload.self,
                    from: Data(row.payloadJson.utf8)
                )
                return row.entityId == expectedForkedReviewEventId
                    && payload.reviewEventId == expectedForkedReviewEventId
                    && payload.cardId == expectedForkedCardId
            }
        )
        XCTAssertEqual(["workspace-linked"], schedulerOutboxRows.map(\.entityId))
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)
        XCTAssertNil(try self.loadSyncState(database: database, workspaceId: localWorkspace.workspaceId))
        XCTAssertEqual(
            SyncStateSnapshot(
                workspaceId: "workspace-linked",
                lastAppliedHotChangeId: 0,
                lastAppliedReviewSequenceId: 0,
                hasHydratedHotState: false,
                hasHydratedReviewHistory: false
            ),
            try self.loadSyncState(database: database, workspaceId: "workspace-linked")
        )
    }

    func testRepairLocalIdForPublicCardSyncConflictRewritesCardReferencesAndOutbox() throws {
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
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )

        let recovery = try database.repairLocalIdForPublicSyncConflict(
            workspaceId: workspace.workspaceId,
            syncConflict: CloudSyncConflictDetails(
                phase: "push",
                entityType: .card,
                entityId: savedCard.cardId,
                entryIndex: nil,
                reviewEventIndex: nil,
                recoverable: true
            )
        )

        let replacementCardId = recovery.replacementEntityId
        let cards = try database.loadActiveCards(workspaceId: workspace.workspaceId)
        let reviewEvents = try database.loadReviewEvents(workspaceId: workspace.workspaceId)
        let outboxRows = try self.loadOutboxRows(database: database)
        XCTAssertEqual(.card, recovery.entityType)
        XCTAssertEqual(savedCard.cardId, recovery.sourceEntityId)
        XCTAssertNotEqual(savedCard.cardId, replacementCardId)
        XCTAssertNotNil(UUID(uuidString: replacementCardId))
        XCTAssertFalse(cards.contains { card in card.cardId == savedCard.cardId })
        XCTAssertTrue(cards.contains { card in card.cardId == replacementCardId })
        XCTAssertEqual(0, try self.loadCardTagCount(database: database, cardId: savedCard.cardId))
        XCTAssertEqual(1, try self.loadCardTagCount(database: database, cardId: replacementCardId))
        XCTAssertTrue(reviewEvents.allSatisfy { reviewEvent in reviewEvent.cardId == replacementCardId })
        XCTAssertFalse(outboxRows.contains { row in row.entityId == savedCard.cardId })
        XCTAssertTrue(
            try outboxRows
                .filter { row in row.entityType == SyncEntityType.card.rawValue }
                .allSatisfy { row in
                    let payload = try JSONDecoder().decode(CardOutboxPayload.self, from: Data(row.payloadJson.utf8))
                    return row.entityId == replacementCardId && payload.cardId == replacementCardId
                }
        )
        XCTAssertTrue(
            try outboxRows
                .filter { row in row.entityType == SyncEntityType.reviewEvent.rawValue }
                .allSatisfy { row in
                    let payload = try JSONDecoder().decode(
                        ReviewEventOutboxPayload.self,
                        from: Data(row.payloadJson.utf8)
                    )
                    return payload.cardId == replacementCardId
                }
        )
    }

    func testRepairLocalIdForPublicReviewEventSyncConflictRewritesReviewEventAndOutbox() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .easy,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )
        let sourceReviewEvent = try XCTUnwrap(try database.loadReviewEvents(workspaceId: workspace.workspaceId).first)

        let recovery = try database.repairLocalIdForPublicSyncConflict(
            workspaceId: workspace.workspaceId,
            syncConflict: CloudSyncConflictDetails(
                phase: "review_history_import",
                entityType: .reviewEvent,
                entityId: sourceReviewEvent.reviewEventId,
                entryIndex: nil,
                reviewEventIndex: 0,
                recoverable: true
            )
        )

        let replacementReviewEventId = recovery.replacementEntityId
        let reviewEvents = try database.loadReviewEvents(workspaceId: workspace.workspaceId)
        let outboxRows = try self.loadOutboxRows(database: database).filter { row in
            row.entityType == SyncEntityType.reviewEvent.rawValue
        }
        XCTAssertEqual(.reviewEvent, recovery.entityType)
        XCTAssertEqual(sourceReviewEvent.reviewEventId, recovery.sourceEntityId)
        XCTAssertNotEqual(sourceReviewEvent.reviewEventId, replacementReviewEventId)
        XCTAssertNotNil(UUID(uuidString: replacementReviewEventId))
        XCTAssertFalse(reviewEvents.contains { reviewEvent in reviewEvent.reviewEventId == sourceReviewEvent.reviewEventId })
        XCTAssertTrue(reviewEvents.contains { reviewEvent in
            reviewEvent.reviewEventId == replacementReviewEventId && reviewEvent.cardId == savedCard.cardId
        })
        XCTAssertTrue(
            try outboxRows.allSatisfy { row in
                let payload = try JSONDecoder().decode(
                    ReviewEventOutboxPayload.self,
                    from: Data(row.payloadJson.utf8)
                )
                return row.entityId == replacementReviewEventId
                    && payload.reviewEventId == replacementReviewEventId
                    && payload.cardId == savedCard.cardId
            }
        )
    }

    func testRepairLocalIdForPublicDeckSyncConflictRewritesDeckAndOutbox() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedDeck = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [.medium], tags: ["tag"])
            )
        )

        let recovery = try database.repairLocalIdForPublicSyncConflict(
            workspaceId: workspace.workspaceId,
            syncConflict: CloudSyncConflictDetails(
                phase: "bootstrap",
                entityType: .deck,
                entityId: savedDeck.deckId,
                entryIndex: 0,
                reviewEventIndex: nil,
                recoverable: true
            )
        )

        let replacementDeckId = recovery.replacementEntityId
        let decks = try database.loadActiveDecks(workspaceId: workspace.workspaceId)
        let deckOutboxRows = try self.loadOutboxRows(database: database).filter { row in
            row.entityType == SyncEntityType.deck.rawValue
        }
        XCTAssertEqual(.deck, recovery.entityType)
        XCTAssertEqual(savedDeck.deckId, recovery.sourceEntityId)
        XCTAssertNotEqual(savedDeck.deckId, replacementDeckId)
        XCTAssertNotNil(UUID(uuidString: replacementDeckId))
        XCTAssertFalse(decks.contains { deck in deck.deckId == savedDeck.deckId })
        XCTAssertTrue(decks.contains { deck in deck.deckId == replacementDeckId })
        XCTAssertTrue(
            try deckOutboxRows.allSatisfy { row in
                let payload = try JSONDecoder().decode(DeckOutboxPayload.self, from: Data(row.payloadJson.utf8))
                return row.entityId == replacementDeckId && payload.deckId == replacementDeckId
            }
        )
    }

    func testLinkedSyncRetriesAfterPublicCardSyncConflictRecovery() async throws {
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

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try Self.handleLinkedSyncRetryTestRequest(
                request: request,
                sourceCardId: savedCard.cardId
            )
        }

        let syncResult = try await CloudSyncRunner(database: database, transport: transport).runLinkedSync(
            linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
        )

        let cards = try database.loadActiveCards(workspaceId: workspace.workspaceId)
        let pushCardIds = CloudSyncRunnerTestURLProtocol.bootstrapPushCardIds
        XCTAssertTrue(syncResult.changedEntityTypes.contains(.card))
        XCTAssertEqual(2, pushCardIds.count)
        XCTAssertEqual(savedCard.cardId, pushCardIds.first)
        XCTAssertNotEqual(savedCard.cardId, pushCardIds.last)
        XCTAssertFalse(cards.contains { card in card.cardId == savedCard.cardId })
        XCTAssertTrue(cards.contains { card in card.cardId == pushCardIds.last })
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
    }

    func testLinkedSyncEmptyRemoteBootstrapPushesMoreThanTwoHundredHotEntriesInOneRequest() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cardCount: Int = 201
        let expectedEntryCount: Int = cardCount + 1

        for cardIndex in 0..<cardCount {
            _ = try database.saveCard(
                workspaceId: workspace.workspaceId,
                input: CardEditorInput(
                    frontText: "Question \(cardIndex)",
                    backText: "Answer \(cardIndex)",
                    tags: [],
                    effortLevel: .medium
                ),
                cardId: nil
            )
        }
        XCTAssertEqual(cardCount, try self.loadOutboxCount(database: database))

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try Self.handleLargeEmptyRemoteBootstrapRequest(
                request: request,
                expectedEntryCount: expectedEntryCount
            )
        }

        let syncResult = try await CloudSyncRunner(database: database, transport: transport).runLinkedSync(
            linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
        )

        let syncState = try XCTUnwrap(try self.loadSyncState(database: database, workspaceId: workspace.workspaceId))
        XCTAssertEqual([expectedEntryCount], CloudSyncRunnerTestURLProtocol.bootstrapPushEntryCounts)
        XCTAssertTrue(syncResult.changedEntityTypes.contains(.card))
        XCTAssertTrue(syncResult.changedEntityTypes.contains(.workspaceSchedulerSettings))
        XCTAssertEqual(cardCount, syncResult.cleanedUpOperationCount)
        XCTAssertEqual(77, syncState.lastAppliedHotChangeId)
        XCTAssertTrue(syncState.hasHydratedHotState)
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
    }

    func testLinkedSyncReturnsDeckChangeAfterPublicDeckPushConflictRecovery() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedDeck = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [.medium], tags: ["tag"])
            )
        )
        try self.updateSyncState(
            database: database,
            workspaceId: workspace.workspaceId,
            hotChangeId: 1,
            reviewSequenceId: 1
        )

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try Self.handleLinkedSyncPushRetryTestRequest(
                request: request,
                sourceEntityType: .deck,
                sourceEntityId: savedDeck.deckId
            )
        }

        let syncResult = try await CloudSyncRunner(database: database, transport: transport).runLinkedSync(
            linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
        )

        let decks = try database.loadActiveDecks(workspaceId: workspace.workspaceId)
        let pushEntityIds = CloudSyncRunnerTestURLProtocol.pushEntityIds
        XCTAssertTrue(syncResult.changedEntityTypes.contains(.deck))
        XCTAssertTrue(syncResult.localIdRepairEntityTypes.contains(.deck))
        XCTAssertTrue(syncResult.reviewDataChanged)
        XCTAssertEqual(2, pushEntityIds.count)
        XCTAssertEqual(savedDeck.deckId, pushEntityIds.first)
        XCTAssertNotEqual(savedDeck.deckId, pushEntityIds.last)
        XCTAssertFalse(decks.contains { deck in deck.deckId == savedDeck.deckId })
        XCTAssertTrue(decks.contains { deck in deck.deckId == pushEntityIds.last })
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
    }

    func testLinkedSyncRepairsMultipleDistinctPublicPushConflictsInOneAttempt() async throws {
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
        let savedDeck = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [.medium], tags: ["tag"])
            )
        )
        try self.updateSyncState(
            database: database,
            workspaceId: workspace.workspaceId,
            hotChangeId: 1,
            reviewSequenceId: 1
        )

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try Self.handleLinkedSyncMultiConflictPushRetryTestRequest(
                request: request,
                sourceCardId: savedCard.cardId,
                sourceDeckId: savedDeck.deckId
            )
        }

        let syncResult = try await CloudSyncRunner(database: database, transport: transport).runLinkedSync(
            linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
        )

        let cards = try database.loadActiveCards(workspaceId: workspace.workspaceId)
        let decks = try database.loadActiveDecks(workspaceId: workspace.workspaceId)
        let pushSnapshots = CloudSyncRunnerTestURLProtocol.pushEntitySnapshots
        XCTAssertTrue(syncResult.localIdRepairEntityTypes.contains(.card))
        XCTAssertTrue(syncResult.localIdRepairEntityTypes.contains(.deck))
        XCTAssertEqual(3, pushSnapshots.count)
        XCTAssertEqual(savedCard.cardId, pushSnapshots[0][SyncEntityType.card.rawValue])
        XCTAssertEqual(savedDeck.deckId, pushSnapshots[0][SyncEntityType.deck.rawValue])
        XCTAssertNotEqual(savedCard.cardId, pushSnapshots[1][SyncEntityType.card.rawValue])
        XCTAssertEqual(savedDeck.deckId, pushSnapshots[1][SyncEntityType.deck.rawValue])
        XCTAssertEqual(pushSnapshots[1][SyncEntityType.card.rawValue], pushSnapshots[2][SyncEntityType.card.rawValue])
        XCTAssertNotEqual(savedDeck.deckId, pushSnapshots[2][SyncEntityType.deck.rawValue])
        XCTAssertFalse(cards.contains { card in card.cardId == savedCard.cardId })
        XCTAssertFalse(decks.contains { deck in deck.deckId == savedDeck.deckId })
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
    }

    func testLinkedSyncBootstrapSkipsPendingLocalHotOutboxEntries() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Local dirty question",
                backText: "Local dirty answer",
                tags: ["local"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let savedDeck = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Local dirty deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [.medium], tags: ["local"])
            )
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspace.workspaceId,
            desiredRetention: 0.91,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36500,
            enableFuzz: true
        )
        XCTAssertEqual(3, try self.loadOutboxCount(database: database))

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try Self.handleDirtyBootstrapProtectionRequest(
                request: request,
                workspaceId: workspace.workspaceId,
                dirtyCardId: savedCard.cardId,
                dirtyDeckId: savedDeck.deckId
            )
        }

        _ = try await CloudSyncRunner(database: database, transport: transport).runLinkedSync(
            linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
        )

        let cards = try database.loadActiveCards(workspaceId: workspace.workspaceId)
        let dirtyCard = try XCTUnwrap(cards.first { card in card.cardId == savedCard.cardId })
        let cleanRemoteCard = try XCTUnwrap(cards.first { card in card.cardId == "remote-clean-card" })
        let dirtyDeck = try XCTUnwrap(
            try database.loadActiveDecks(workspaceId: workspace.workspaceId).first { deck in
                deck.deckId == savedDeck.deckId
            }
        )
        let schedulerSettings = try database.workspaceSettingsStore.loadWorkspaceSchedulerSettings(
            workspaceId: workspace.workspaceId
        )
        XCTAssertEqual("Local dirty question", dirtyCard.frontText)
        XCTAssertEqual("Clean remote question", cleanRemoteCard.frontText)
        XCTAssertEqual("Local dirty deck", dirtyDeck.name)
        XCTAssertEqual(0.91, schedulerSettings.desiredRetention, accuracy: 0.0001)
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
    }

    func testLinkedSyncBootstrapReplaysSkippedDirtyRowsWhenPushIsIgnored() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Local dirty question",
                backText: "Local dirty answer",
                tags: ["local"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        XCTAssertEqual(1, try self.loadOutboxCount(database: database))

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try Self.handleIgnoredDirtyBootstrapProtectionRequest(
                request: request,
                dirtyCardId: savedCard.cardId
            )
        }

        let syncResult = try await CloudSyncRunner(database: database, transport: transport).runLinkedSync(
            linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
        )

        let cards = try database.loadActiveCards(workspaceId: workspace.workspaceId)
        let dirtyCard = try XCTUnwrap(cards.first { card in card.cardId == savedCard.cardId })
        let syncState = try XCTUnwrap(try self.loadSyncState(database: database, workspaceId: workspace.workspaceId))
        XCTAssertEqual("Remote winning question", dirtyCard.frontText)
        XCTAssertEqual(["remote"], dirtyCard.tags)
        XCTAssertEqual(1, syncResult.acknowledgedOperationCount)
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
        XCTAssertEqual([0], CloudSyncRunnerTestURLProtocol.pullAfterHotChangeIds)
        XCTAssertEqual(20, syncState.lastAppliedHotChangeId)
        XCTAssertTrue(syncState.hasHydratedHotState)
    }

    func testLinkedSyncBootstrapRechecksFinalPageDirtyHotOutboxBeforeHydrating() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let dirtyCardId = "remote-final-page-card"
        try self.installFinalBootstrapDirtyOutboxTrigger(database: database, cardId: dirtyCardId)
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try Self.handleIgnoredDirtyBootstrapProtectionRequest(
                request: request,
                dirtyCardId: dirtyCardId
            )
        }

        let syncResult = try await CloudSyncRunner(database: database, transport: transport).runLinkedSync(
            linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
        )

        let cards = try database.loadActiveCards(workspaceId: workspace.workspaceId)
        let dirtyCard = try XCTUnwrap(cards.first { card in card.cardId == dirtyCardId })
        let syncState = try XCTUnwrap(try self.loadSyncState(database: database, workspaceId: workspace.workspaceId))
        XCTAssertEqual("Remote winning question", dirtyCard.frontText)
        XCTAssertEqual(["remote"], dirtyCard.tags)
        XCTAssertTrue(syncResult.changedEntityTypes.contains(.card))
        XCTAssertEqual(1, syncResult.acknowledgedOperationCount)
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
        XCTAssertEqual([0], CloudSyncRunnerTestURLProtocol.pullAfterHotChangeIds)
        XCTAssertEqual(20, syncState.lastAppliedHotChangeId)
        XCTAssertTrue(syncState.hasHydratedHotState)
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
        store.presentedReviewCardId = savedCard.cardId
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
        XCTAssertNil(store.presentedReviewCardId)
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
        store.presentedReviewCardId = savedCard.cardId
        store.persistSelectedReviewFilter(reviewFilter: .tag(tag: "tag"))

        do {
            try await store.syncCloudNow(trigger: self.makeManualSyncTrigger(now: now))
            XCTFail("Expected sync failure after local id repair")
        } catch {
            XCTAssertTrue(Flashcards.errorMessage(error: error).contains("terminal sync failure after repair"))
        }

        XCTAssertEqual(1, cloudSyncService.runLinkedSyncCallCount)
        XCTAssertEqual(.allCards, store.selectedReviewFilter)
        XCTAssertNil(store.presentedReviewCardId)
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
        store.presentedReviewCardId = savedCard.cardId
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
        XCTAssertNil(store.presentedReviewCardId)
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

    func testSwitchGuestUpgradeToLinkedWorkspaceFromRemoteRejectsPendingGuestOutboxBeforeDeletingGuestWorkspace() throws {
        let database = try self.makeDatabase()
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: localWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["guest"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.createDeck(
            workspaceId: localWorkspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [], tags: ["guest"])
            )
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: localWorkspace.workspaceId,
            desiredRetention: 0.91,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36500,
            enableFuzz: true
        )
        try self.updateSyncState(
            database: database,
            workspaceId: localWorkspace.workspaceId,
            hotChangeId: 123,
            reviewSequenceId: 456
        )
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)

        XCTAssertThrowsError(
            try database.switchGuestUpgradeToLinkedWorkspaceFromRemote(
                localWorkspaceId: localWorkspace.workspaceId,
                linkedSession: self.makeLinkedSession(workspaceId: "workspace-linked"),
                workspace: CloudWorkspaceSummary(
                    workspaceId: "workspace-linked",
                    name: "Existing workspace",
                    createdAt: "2026-04-01T00:00:00.000Z",
                    isSelected: true
                )
            )
        ) { error in
            XCTAssertTrue(Flashcards.errorMessage(error: error).contains("pending guest outbox entries remain"))
        }

        XCTAssertEqual(localWorkspace.workspaceId, try database.workspaceSettingsStore.loadWorkspace().workspaceId)
        XCTAssertEqual(1, try self.loadWorkspaceIds(database: database).count)
        XCTAssertTrue(try database.loadActiveCards(workspaceId: localWorkspace.workspaceId).contains { card in
            card.cardId == savedCard.cardId
        })
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)
        XCTAssertEqual(
            SyncStateSnapshot(
                workspaceId: localWorkspace.workspaceId,
                lastAppliedHotChangeId: 123,
                lastAppliedReviewSequenceId: 456,
                hasHydratedHotState: true,
                hasHydratedReviewHistory: true
            ),
            try self.loadSyncState(database: database, workspaceId: localWorkspace.workspaceId)
        )
    }

    func testSwitchGuestUpgradeToLinkedWorkspaceFromRemotePreservesLinkedOutboxOnResume() throws {
        let database = try self.makeDatabase()
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let linkedSession = self.makeLinkedSession(workspaceId: "workspace-linked")
        let linkedWorkspace = CloudWorkspaceSummary(
            workspaceId: "workspace-linked",
            name: "Existing workspace",
            createdAt: "2026-04-01T00:00:00.000Z",
            isSelected: true
        )

        try database.switchGuestUpgradeToLinkedWorkspaceFromRemote(
            localWorkspaceId: localWorkspace.workspaceId,
            linkedSession: linkedSession,
            workspace: linkedWorkspace
        )
        try self.updateSyncState(
            database: database,
            workspaceId: "workspace-linked",
            hotChangeId: 789,
            reviewSequenceId: 987
        )
        let savedLinkedCard = try database.saveCard(
            workspaceId: "workspace-linked",
            input: CardEditorInput(
                frontText: "Linked question",
                backText: "Linked answer",
                tags: ["linked"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let outboxRowsBeforeResume = try self.loadOutboxRows(database: database)
        XCTAssertTrue(outboxRowsBeforeResume.contains { row in row.entityId == savedLinkedCard.cardId })

        try database.switchGuestUpgradeToLinkedWorkspaceFromRemote(
            localWorkspaceId: "workspace-linked",
            linkedSession: linkedSession,
            workspace: linkedWorkspace
        )

        let outboxRowsAfterResume = try self.loadOutboxRows(database: database)
        XCTAssertEqual(outboxRowsBeforeResume.count, outboxRowsAfterResume.count)
        XCTAssertTrue(outboxRowsAfterResume.contains { row in row.entityId == savedLinkedCard.cardId })
        XCTAssertEqual(1, try database.loadActiveCards(workspaceId: "workspace-linked").count)
        XCTAssertEqual(
            SyncStateSnapshot(
                workspaceId: "workspace-linked",
                lastAppliedHotChangeId: 789,
                lastAppliedReviewSequenceId: 987,
                hasHydratedHotState: true,
                hasHydratedReviewHistory: true
            ),
            try self.loadSyncState(database: database, workspaceId: "workspace-linked")
        )
    }

    private func makeDatabase() throws -> LocalDatabase {
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
            .appendingPathComponent("flashcards.sqlite", isDirectory: false)
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    private func makeLinkedSession(workspaceId: String) -> CloudLinkedSession {
        CloudLinkedSession(
            userId: "user-1",
            workspaceId: workspaceId,
            email: "user@example.com",
            configurationMode: .official,
            apiBaseUrl: "https://api.flashcards-open-source-app.com/v1",
            authorization: .bearer("id-token")
        )
    }

    private func installFinalBootstrapDirtyOutboxTrigger(database: LocalDatabase, cardId: String) throws {
        let payloadJson: String = """
        {"cardId":"\(cardId)","frontText":"Local final-page dirty question","backText":"Local final-page dirty answer","tags":["local"],"effortLevel":"medium","dueAt":null,"createdAt":"2026-04-01T00:00:00.000Z","reps":0,"lapses":0,"fsrsCardState":"new","fsrsStepIndex":null,"fsrsStability":null,"fsrsDifficulty":null,"fsrsLastReviewedAt":null,"fsrsScheduledDays":null,"deletedAt":null}
        """
        let cardIdLiteral: String = self.sqliteTextLiteral(value: cardId)
        let payloadJsonLiteral: String = self.sqliteTextLiteral(value: payloadJson)

        try database.core.execute(
            sql: """
            CREATE TRIGGER final_bootstrap_dirty_outbox_after_card_insert
            AFTER INSERT ON cards
            WHEN NEW.card_id = \(cardIdLiteral)
            BEGIN
                UPDATE cards
                SET
                    front_text = 'Local final-page dirty question',
                    back_text = 'Local final-page dirty answer',
                    tags_json = '["local"]',
                    client_updated_at = '2030-01-01T00:00:00.000Z',
                    last_modified_by_replica_id = 'local-final-page-race',
                    last_operation_id = 'final-page-race-operation',
                    updated_at = '2030-01-01T00:00:00.000Z'
                WHERE workspace_id = NEW.workspace_id AND card_id = NEW.card_id;

                DELETE FROM card_tags
                WHERE workspace_id = NEW.workspace_id AND card_id = NEW.card_id;

                INSERT INTO card_tags (workspace_id, card_id, tag)
                VALUES (NEW.workspace_id, NEW.card_id, 'local');

                INSERT INTO outbox (
                    operation_id,
                    workspace_id,
                    installation_id,
                    entity_type,
                    entity_id,
                    operation_type,
                    payload_json,
                    client_updated_at,
                    created_at,
                    attempt_count,
                    last_error
                )
                VALUES (
                    'final-page-race-operation',
                    NEW.workspace_id,
                    'test-installation',
                    'card',
                    NEW.card_id,
                    'upsert',
                    \(payloadJsonLiteral),
                    '2030-01-01T00:00:00.000Z',
                    '2030-01-01T00:00:00.000Z',
                    0,
                    NULL
                );
            END
            """,
            values: []
        )
    }

    private func sqliteTextLiteral(value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "''"))'"
    }

    private static func handleLinkedSyncRetryTestRequest(
        request: URLRequest,
        sourceCardId: String
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/bootstrap") {
            let body = try self.jsonObjectBody(request: request)
            let mode = try XCTUnwrap(body["mode"] as? String)
            if mode == "pull" {
                return try self.jsonResponse(
                    request: request,
                    statusCode: 200,
                    body: """
                    {
                      "entries": [],
                      "nextCursor": null,
                      "hasMore": false,
                      "bootstrapHotChangeId": 0,
                      "remoteIsEmpty": true
                    }
                    """
                )
            }

            let entries = try XCTUnwrap(body["entries"] as? [[String: Any]])
            let cardEntry = try XCTUnwrap(entries.first { entry in
                entry["entityType"] as? String == SyncEntityType.card.rawValue
            })
            let cardEntityId = try XCTUnwrap(cardEntry["entityId"] as? String)
            CloudSyncRunnerTestURLProtocol.bootstrapPushCardIds.append(cardEntityId)
            if CloudSyncRunnerTestURLProtocol.bootstrapPushCardIds.count == 1 {
                return try self.jsonResponse(
                    request: request,
                    statusCode: 409,
                    body: """
                    {
                      "error": "Sync detected content copied from another workspace. Retry after forking ids.",
                      "requestId": "request-fork",
                      "code": "SYNC_WORKSPACE_FORK_REQUIRED",
                      "details": {
                        "syncConflict": {
                          "phase": "bootstrap",
                          "entityType": "card",
                          "entityId": "\(sourceCardId)",
                          "entryIndex": 0,
                          "recoverable": true
                        }
                      }
                    }
                    """
                )
            }

            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "appliedEntriesCount": 2,
                  "bootstrapHotChangeId": 1
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [],
                  "nextHotChangeId": 1,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 0,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    private static func handleLargeEmptyRemoteBootstrapRequest(
        request: URLRequest,
        expectedEntryCount: Int
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/bootstrap") {
            let body = try self.jsonObjectBody(request: request)
            let mode = try XCTUnwrap(body["mode"] as? String)
            if mode == "pull" {
                return try self.jsonResponse(
                    request: request,
                    statusCode: 200,
                    body: """
                    {
                      "entries": [],
                      "nextCursor": null,
                      "hasMore": false,
                      "bootstrapHotChangeId": 0,
                      "remoteIsEmpty": true
                    }
                    """
                )
            }

            XCTAssertEqual("push", mode)
            let entries = try XCTUnwrap(body["entries"] as? [[String: Any]])
            CloudSyncRunnerTestURLProtocol.bootstrapPushEntryCounts.append(entries.count)
            XCTAssertEqual(expectedEntryCount, entries.count)
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "appliedEntriesCount": \(entries.count),
                  "bootstrapHotChangeId": 77
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [],
                  "nextHotChangeId": 77,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 0,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    private static func handleLinkedSyncPushRetryTestRequest(
        request: URLRequest,
        sourceEntityType: SyncEntityType,
        sourceEntityId: String
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/push") {
            let body = try JSONDecoder().decode(PushRetryRequestBody.self, from: self.requestBodyData(request: request))
            let conflictingOperation = try XCTUnwrap(body.operations.first { operation in
                operation.entityType == sourceEntityType
            })
            let entityId = conflictingOperation.entityId
            CloudSyncRunnerTestURLProtocol.pushEntityIds.append(entityId)

            if CloudSyncRunnerTestURLProtocol.pushEntityIds.count == 1 {
                return try self.jsonResponse(
                    request: request,
                    statusCode: 409,
                    body: """
                    {
                      "error": "Sync detected content copied from another workspace. Retry after forking ids.",
                      "requestId": "request-fork",
                      "code": "SYNC_WORKSPACE_FORK_REQUIRED",
                      "details": {
                        "syncConflict": {
                          "phase": "push",
                          "entityType": "\(sourceEntityType.rawValue)",
                          "entityId": "\(sourceEntityId)",
                          "entryIndex": 0,
                          "recoverable": true
                        }
                      }
                    }
                    """
                )
            }

            let operationResults = body.operations.map { operation -> String in
                return """
                {
                  "operationId": "\(operation.operationId)",
                  "entityType": "\(operation.entityType.rawValue)",
                  "entityId": "\(operation.entityId)",
                  "status": "applied",
                  "resultingHotChangeId": 2,
                  "error": null
                }
                """
            }.joined(separator: ",")

            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "operations": [\(operationResults)]
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [],
                  "nextHotChangeId": 2,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 1,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    private static func handleLinkedSyncMultiConflictPushRetryTestRequest(
        request: URLRequest,
        sourceCardId: String,
        sourceDeckId: String
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/push") {
            let body = try JSONDecoder().decode(PushRetryRequestBody.self, from: self.requestBodyData(request: request))
            let entityIdsByType: [String: String] = body.operations.reduce(into: [:]) { result, operation in
                result[operation.entityType.rawValue] = operation.entityId
            }
            CloudSyncRunnerTestURLProtocol.pushEntitySnapshots.append(entityIdsByType)

            if CloudSyncRunnerTestURLProtocol.pushEntitySnapshots.count == 1 {
                return try self.workspaceForkRequiredJsonResponse(
                    request: request,
                    requestId: "request-fork-card",
                    entityType: .card,
                    entityId: sourceCardId
                )
            }

            if CloudSyncRunnerTestURLProtocol.pushEntitySnapshots.count == 2 {
                return try self.workspaceForkRequiredJsonResponse(
                    request: request,
                    requestId: "request-fork-deck",
                    entityType: .deck,
                    entityId: sourceDeckId
                )
            }

            let operationResults = body.operations.map { operation -> String in
                return """
                {
                  "operationId": "\(operation.operationId)",
                  "entityType": "\(operation.entityType.rawValue)",
                  "entityId": "\(operation.entityId)",
                  "status": "applied",
                  "resultingHotChangeId": 2,
                  "error": null
                }
                """
            }.joined(separator: ",")

            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "operations": [\(operationResults)]
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [],
                  "nextHotChangeId": 2,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 1,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    private static func handleDirtyBootstrapProtectionRequest(
        request: URLRequest,
        workspaceId: String,
        dirtyCardId: String,
        dirtyDeckId: String
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/bootstrap") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "entries": [
                    {
                      "entityType": "card",
                      "entityId": "\(dirtyCardId)",
                      "action": "upsert",
                      "payload": {
                        "cardId": "\(dirtyCardId)",
                        "frontText": "Remote bootstrap question",
                        "backText": "Remote bootstrap answer",
                        "tags": ["remote"],
                        "effortLevel": "medium",
                        "dueAt": null,
                        "createdAt": "2026-04-01T00:00:00.000Z",
                        "reps": 0,
                        "lapses": 0,
                        "fsrsCardState": "new",
                        "fsrsStepIndex": null,
                        "fsrsStability": null,
                        "fsrsDifficulty": null,
                        "fsrsLastReviewedAt": null,
                        "fsrsScheduledDays": null,
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-card-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z",
                        "deletedAt": null
                      }
                    },
                    {
                      "entityType": "card",
                      "entityId": "remote-clean-card",
                      "action": "upsert",
                      "payload": {
                        "cardId": "remote-clean-card",
                        "frontText": "Clean remote question",
                        "backText": "Clean remote answer",
                        "tags": ["remote"],
                        "effortLevel": "medium",
                        "dueAt": null,
                        "createdAt": "2026-04-01T00:00:00.000Z",
                        "reps": 0,
                        "lapses": 0,
                        "fsrsCardState": "new",
                        "fsrsStepIndex": null,
                        "fsrsStability": null,
                        "fsrsDifficulty": null,
                        "fsrsLastReviewedAt": null,
                        "fsrsScheduledDays": null,
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-clean-card-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z",
                        "deletedAt": null
                      }
                    },
                    {
                      "entityType": "deck",
                      "entityId": "\(dirtyDeckId)",
                      "action": "upsert",
                      "payload": {
                        "deckId": "\(dirtyDeckId)",
                        "name": "Remote bootstrap deck",
                        "filterDefinition": {
                          "version": 2,
                          "effortLevels": ["medium"],
                          "tags": ["remote"]
                        },
                        "createdAt": "2026-04-01T00:00:00.000Z",
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-deck-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z",
                        "deletedAt": null
                      }
                    },
                    {
                      "entityType": "workspace_scheduler_settings",
                      "entityId": "\(workspaceId)",
                      "action": "upsert",
                      "payload": {
                        "algorithm": "fsrs-6",
                        "desiredRetention": 0.5,
                        "learningStepsMinutes": [5],
                        "relearningStepsMinutes": [5],
                        "maximumIntervalDays": 30,
                        "enableFuzz": false,
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-settings-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z"
                      }
                    }
                  ],
                  "nextCursor": null,
                  "hasMore": false,
                  "bootstrapHotChangeId": 20,
                  "remoteIsEmpty": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/push") {
            let body = try JSONDecoder().decode(PushRetryRequestBody.self, from: self.requestBodyData(request: request))
            let operationResults = body.operations.map { operation -> String in
                return """
                {
                  "operationId": "\(operation.operationId)",
                  "entityType": "\(operation.entityType.rawValue)",
                  "entityId": "\(operation.entityId)",
                  "status": "applied",
                  "resultingHotChangeId": 21,
                  "error": null
                }
                """
            }.joined(separator: ",")

            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "operations": [\(operationResults)]
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [],
                  "nextHotChangeId": 21,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 0,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    private static func handleIgnoredDirtyBootstrapProtectionRequest(
        request: URLRequest,
        dirtyCardId: String
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/bootstrap") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "entries": [
                    {
                      "entityType": "card",
                      "entityId": "\(dirtyCardId)",
                      "action": "upsert",
                      "payload": {
                        "cardId": "\(dirtyCardId)",
                        "frontText": "Remote winning question",
                        "backText": "Remote winning answer",
                        "tags": ["remote"],
                        "effortLevel": "medium",
                        "dueAt": null,
                        "createdAt": "2026-04-01T00:00:00.000Z",
                        "reps": 0,
                        "lapses": 0,
                        "fsrsCardState": "new",
                        "fsrsStepIndex": null,
                        "fsrsStability": null,
                        "fsrsDifficulty": null,
                        "fsrsLastReviewedAt": null,
                        "fsrsScheduledDays": null,
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-card-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z",
                        "deletedAt": null
                      }
                    }
                  ],
                  "nextCursor": null,
                  "hasMore": false,
                  "bootstrapHotChangeId": 20,
                  "remoteIsEmpty": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/push") {
            let body = try JSONDecoder().decode(PushRetryRequestBody.self, from: self.requestBodyData(request: request))
            let operationResults = body.operations.map { operation -> String in
                return """
                {
                  "operationId": "\(operation.operationId)",
                  "entityType": "\(operation.entityType.rawValue)",
                  "entityId": "\(operation.entityId)",
                  "status": "ignored",
                  "resultingHotChangeId": null,
                  "error": null
                }
                """
            }.joined(separator: ",")

            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "operations": [\(operationResults)]
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            let body = try self.jsonObjectBody(request: request)
            let afterHotChangeId = try XCTUnwrap(body["afterHotChangeId"] as? NSNumber).int64Value
            CloudSyncRunnerTestURLProtocol.pullAfterHotChangeIds.append(afterHotChangeId)
            let changes: String
            if afterHotChangeId == 0 {
                changes = """
                    {
                      "changeId": 20,
                      "entityType": "card",
                      "entityId": "\(dirtyCardId)",
                      "action": "upsert",
                      "payload": {
                        "cardId": "\(dirtyCardId)",
                        "frontText": "Remote winning question",
                        "backText": "Remote winning answer",
                        "tags": ["remote"],
                        "effortLevel": "medium",
                        "dueAt": null,
                        "createdAt": "2026-04-01T00:00:00.000Z",
                        "reps": 0,
                        "lapses": 0,
                        "fsrsCardState": "new",
                        "fsrsStepIndex": null,
                        "fsrsStability": null,
                        "fsrsDifficulty": null,
                        "fsrsLastReviewedAt": null,
                        "fsrsScheduledDays": null,
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-card-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z",
                        "deletedAt": null
                      }
                    }
                """
            } else {
                changes = ""
            }

            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [\(changes)],
                  "nextHotChangeId": 20,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 0,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    private static func workspaceForkRequiredJsonResponse(
        request: URLRequest,
        requestId: String,
        entityType: SyncEntityType,
        entityId: String
    ) throws -> (HTTPURLResponse, Data) {
        try self.jsonResponse(
            request: request,
            statusCode: 409,
            body: """
            {
              "error": "Sync detected content copied from another workspace. Retry after forking ids.",
              "requestId": "\(requestId)",
              "code": "SYNC_WORKSPACE_FORK_REQUIRED",
              "details": {
                "syncConflict": {
                  "phase": "push",
                  "entityType": "\(entityType.rawValue)",
                  "entityId": "\(entityId)",
                  "entryIndex": 0,
                  "recoverable": true
                }
              }
            }
            """
        )
    }

    private static func jsonObjectBody(request: URLRequest) throws -> [String: Any] {
        let data = try self.requestBodyData(request: request)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any])
    }

    private static func requestBodyData(request: URLRequest) throws -> Data {
        if let httpBody = request.httpBody {
            return httpBody
        }

        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer {
            stream.close()
        }

        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let readCount = stream.read(&buffer, maxLength: buffer.count)
            if readCount > 0 {
                data.append(buffer, count: readCount)
            } else if readCount == 0 {
                return data
            } else {
                throw stream.streamError ?? URLError(.cannotDecodeRawData)
            }
        }
    }

    private static func jsonResponse(
        request: URLRequest,
        statusCode: Int,
        body: String
    ) throws -> (HTTPURLResponse, Data) {
        let url = try XCTUnwrap(request.url)
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: url,
                statusCode: statusCode,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )
        )
        return (response, Data(body.utf8))
    }

    @MainActor
    private func makeReviewFilterRecoveryStore(
        database: LocalDatabase,
        userDefaults: UserDefaults,
        credentialStore: CloudCredentialStore,
        cloudSyncService: (any CloudSyncServing)?
    ) -> FlashcardsStore {
        let guestCredentialStore = GuestCloudCredentialStore(
            service: "tests-deck-filter-guest-\(UUID().uuidString.lowercased())",
            bundle: .main,
            userDefaults: userDefaults
        )

        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate(),
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: { _, _, resolvedReviewFilter, _, _, _ in
                ReviewHeadLoadState(
                    resolvedReviewFilter: resolvedReviewFilter,
                    seedReviewQueue: [],
                    hasMoreCards: false
                )
            },
            reviewCountsLoader: { _, _, _, _ in
                ReviewCounts(dueCount: 0, totalCount: 0)
            },
            reviewQueueChunkLoader: { _, _, _, _, _, _ in
                ReviewQueueChunkLoadState(reviewQueueChunk: [], hasMoreCards: false)
            },
            reviewQueueWindowLoader: { _, _, _, _, _ in
                ReviewQueueWindowLoadState(reviewQueue: [], hasMoreCards: false)
            },
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
        store.updateCurrentVisibleTab(tab: .cards)
        return store
    }

    private func makeManualSyncTrigger(now: Date) -> CloudSyncTrigger {
        CloudSyncTrigger(
            source: .manualSyncNow,
            now: now,
            extendsFastPolling: false,
            allowsVisibleChangeBanner: false,
            surfacesGlobalErrorMessage: false
        )
    }

    private func updateSyncState(
        database: LocalDatabase,
        workspaceId: String,
        hotChangeId: Int64,
        reviewSequenceId: Int64
    ) throws {
        _ = try database.core.execute(
            sql: """
            UPDATE sync_state
            SET
                last_applied_hot_change_id = ?,
                last_applied_review_sequence_id = ?,
                has_hydrated_hot_state = 1,
                has_hydrated_review_history = 1,
                updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .integer(hotChangeId),
                .integer(reviewSequenceId),
                .text(nowIsoTimestamp()),
                .text(workspaceId)
            ]
        )
    }

    private func loadWorkspaceIds(database: LocalDatabase) throws -> [String] {
        try database.core.query(
            sql: "SELECT workspace_id FROM workspaces ORDER BY created_at ASC",
            values: []
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 0)
        }
    }

    private func loadOutboxCount(database: LocalDatabase) throws -> Int {
        Int(try database.core.scalarInt(
            sql: "SELECT COUNT(*) FROM outbox",
            values: []
        ))
    }

    private func loadCardTagCount(database: LocalDatabase, cardId: String) throws -> Int {
        Int(try database.core.scalarInt(
            sql: "SELECT COUNT(*) FROM card_tags WHERE card_id = ?",
            values: [.text(cardId)]
        ))
    }

    private func loadOutboxRows(database: LocalDatabase) throws -> [OutboxRow] {
        try database.core.query(
            sql: """
            SELECT workspace_id, entity_type, entity_id, payload_json
            FROM outbox
            ORDER BY created_at ASC, operation_id ASC
            """,
            values: []
        ) { statement in
            OutboxRow(
                workspaceId: DatabaseCore.columnText(statement: statement, index: 0),
                entityType: DatabaseCore.columnText(statement: statement, index: 1),
                entityId: DatabaseCore.columnText(statement: statement, index: 2),
                payloadJson: DatabaseCore.columnText(statement: statement, index: 3)
            )
        }
    }

    private func loadSyncState(database: LocalDatabase, workspaceId: String) throws -> SyncStateSnapshot? {
        try database.core.query(
            sql: """
            SELECT
                workspace_id,
                last_applied_hot_change_id,
                last_applied_review_sequence_id,
                has_hydrated_hot_state,
                has_hydrated_review_history
            FROM sync_state
            WHERE workspace_id = ?
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            SyncStateSnapshot(
                workspaceId: DatabaseCore.columnText(statement: statement, index: 0),
                lastAppliedHotChangeId: DatabaseCore.columnInt64(statement: statement, index: 1),
                lastAppliedReviewSequenceId: DatabaseCore.columnInt64(statement: statement, index: 2),
                hasHydratedHotState: DatabaseCore.columnInt64(statement: statement, index: 3) == 1,
                hasHydratedReviewHistory: DatabaseCore.columnInt64(statement: statement, index: 4) == 1
            )
        }.first
    }
}

private struct SyncStateSnapshot: Equatable {
    let workspaceId: String
    let lastAppliedHotChangeId: Int64
    let lastAppliedReviewSequenceId: Int64
    let hasHydratedHotState: Bool
    let hasHydratedReviewHistory: Bool
}

private struct OutboxRow {
    let workspaceId: String
    let entityType: String
    let entityId: String
    let payloadJson: String
}

private struct CardOutboxPayload: Decodable {
    let cardId: String
}

private struct DeckOutboxPayload: Decodable {
    let deckId: String
}

private struct ReviewEventOutboxPayload: Decodable {
    let reviewEventId: String
    let cardId: String
}

private struct PushRetryRequestBody: Decodable {
    let operations: [PushRetryOperationBody]
}

private struct PushRetryOperationBody: Decodable {
    let operationId: String
    let entityType: SyncEntityType
    let entityId: String
}

private final class CloudSyncRunnerTestURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
    nonisolated(unsafe) static var bootstrapPushCardIds: [String] = []
    nonisolated(unsafe) static var bootstrapPushEntryCounts: [Int] = []
    nonisolated(unsafe) static var pushEntityIds: [String] = []
    nonisolated(unsafe) static var pushEntitySnapshots: [[String: String]] = []
    nonisolated(unsafe) static var pullAfterHotChangeIds: [Int64] = []

    override class func canInit(with request: URLRequest) -> Bool {
        _ = request
        return true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let requestHandler = Self.requestHandler else {
            self.client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        do {
            let (response, data) = try requestHandler(self.request)
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        } catch {
            self.client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {
    }

    static func reset() {
        self.requestHandler = nil
        self.bootstrapPushCardIds = []
        self.bootstrapPushEntryCounts = []
        self.pushEntityIds = []
        self.pushEntitySnapshots = []
        self.pullAfterHotChangeIds = []
    }
}

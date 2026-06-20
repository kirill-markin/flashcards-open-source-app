import Foundation
import XCTest
@testable import Flashcards

final class LinkedSyncBootstrapAndRetryTests: LocalWorkspaceSyncTestCase {
    override func tearDownWithError() throws {
        CloudSyncRunnerTestURLProtocol.reset()
        try super.tearDownWithError()
    }

    func testCloudSyncResponseDecodeFailureDoesNotExposeSuccessfulResponseBody() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: [
                        "Content-Type": "application/json",
                        "X-Request-Id": "request-header",
                    ]
                )
            )
            let responseBody = Data(
                """
                {
                  "error": "front text: private card prompt; back text: private card answer",
                  "requestId": "request-body",
                  "code": "PRIVATE_BODY_CODE",
                  "guestToken": "private-token"
                }
                """.utf8
            )
            return (response, responseBody)
        }

        do {
            let _: CloudSyncDecodeFailureProbeResponse = try await transport.request(
                apiBaseUrl: "https://api.example.test/v1",
                authorizationHeader: "Bearer id-token",
                path: "/workspaces",
                method: "GET",
                body: Optional<String>.none
            )
            XCTFail("Expected cloud sync response decode failure")
        } catch let error as CloudSyncError {
            guard case .invalidResponse(let details, let statusCode) = error else {
                XCTFail("Expected invalidResponse, got \(error)")
                return
            }

            XCTAssertEqual(200, statusCode)
            XCTAssertEqual("Failed to decode cloud sync response", details.message)
            XCTAssertEqual("request-header", details.requestId)
            XCTAssertEqual("RESPONSE_DECODING_FAILED", details.code)
            XCTAssertNil(details.syncConflict)
            XCTAssertFalse(details.message.contains("private card answer"))
            XCTAssertFalse(details.message.contains("private-token"))
        }
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
            try LinkedSyncRunnerTestTransportSupport.handleLinkedSyncRetryTestRequest(
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
            try LinkedSyncRunnerTestTransportSupport.handleLargeEmptyRemoteBootstrapRequest(
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
            try LinkedSyncRunnerTestTransportSupport.handleLinkedSyncPushRetryTestRequest(
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
            try LinkedSyncRunnerTestTransportSupport.handleLinkedSyncMultiConflictPushRetryTestRequest(
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
            try LinkedSyncRunnerTestTransportSupport.handleDirtyBootstrapProtectionRequest(
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
            try LinkedSyncRunnerTestTransportSupport.handleIgnoredDirtyBootstrapProtectionRequest(
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
            try LinkedSyncRunnerTestTransportSupport.handleIgnoredDirtyBootstrapProtectionRequest(
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

    func testLinkedSyncImportsPendingReviewHistoryWhenHotStateAlreadyHydrated() async throws {
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
                rating: .good,
                reviewedAtClient: "2026-04-01T00:00:00.000Z",
                reviewedTimeZone: "UTC"
            )
        )
        let reviewEvent = try XCTUnwrap(try database.loadReviewEvents(workspaceId: workspace.workspaceId).first)
        try database.deleteAllOutboxEntries(workspaceId: workspace.workspaceId)
        try database.setLastAppliedHotChangeId(workspaceId: workspace.workspaceId, changeId: 20)
        try database.setLastAppliedReviewSequenceId(workspaceId: workspace.workspaceId, reviewSequenceId: 0)
        try database.setHasHydratedHotState(workspaceId: workspace.workspaceId, hasHydratedHotState: true)
        try database.setHasHydratedReviewHistory(workspaceId: workspace.workspaceId, hasHydratedReviewHistory: false)
        try database.setPendingReviewHistoryImport(workspaceId: workspace.workspaceId, pendingReviewHistoryImport: true)

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try LinkedSyncRunnerTestTransportSupport.handleReviewHistoryImportRecoveryRequest(
                request: request,
                reviewEvent: reviewEvent
            )
        }

        let syncResult = try await CloudSyncRunner(database: database, transport: transport).runLinkedSync(
            linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
        )

        let syncState = try XCTUnwrap(try self.loadSyncState(database: database, workspaceId: workspace.workspaceId))
        XCTAssertEqual([1], CloudSyncRunnerTestURLProtocol.reviewHistoryImportEventCounts)
        XCTAssertEqual([0], CloudSyncRunnerTestURLProtocol.reviewHistoryPullAfterSequenceIds)
        XCTAssertTrue(syncResult.changedEntityTypes.contains(.reviewEvent))
        XCTAssertEqual(5, syncState.lastAppliedReviewSequenceId)
        XCTAssertTrue(syncState.hasHydratedHotState)
        XCTAssertTrue(syncState.hasHydratedReviewHistory)
        XCTAssertFalse(try database.hasPendingReviewHistoryImport(workspaceId: workspace.workspaceId))
    }

    func testGuestLocalRecoveryImportsLegacyUnmarkedReviewHistoryWhenHotStateAlreadyHydrated() async throws {
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
                rating: .good,
                reviewedAtClient: "2026-04-01T00:00:00.000Z",
                reviewedTimeZone: "UTC"
            )
        )
        let reviewEvent = try XCTUnwrap(try database.loadReviewEvents(workspaceId: workspace.workspaceId).first)
        try database.deleteAllOutboxEntries(workspaceId: workspace.workspaceId)
        try database.setLastAppliedHotChangeId(workspaceId: workspace.workspaceId, changeId: 20)
        try database.setLastAppliedReviewSequenceId(workspaceId: workspace.workspaceId, reviewSequenceId: 0)
        try database.setHasHydratedHotState(workspaceId: workspace.workspaceId, hasHydratedHotState: true)
        try database.setHasHydratedReviewHistory(workspaceId: workspace.workspaceId, hasHydratedReviewHistory: false)
        try database.setPendingReviewHistoryImport(workspaceId: workspace.workspaceId, pendingReviewHistoryImport: false)

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try LinkedSyncRunnerTestTransportSupport.handleReviewHistoryImportRecoveryRequest(
                request: request,
                reviewEvent: reviewEvent
            )
        }

        let syncResult = try await CloudSyncRunner(database: database, transport: transport).runGuestLocalRecoveryLinkedSync(
            linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
        )

        let syncState = try XCTUnwrap(try self.loadSyncState(database: database, workspaceId: workspace.workspaceId))
        XCTAssertEqual([1], CloudSyncRunnerTestURLProtocol.reviewHistoryImportEventCounts)
        XCTAssertEqual([0], CloudSyncRunnerTestURLProtocol.reviewHistoryPullAfterSequenceIds)
        XCTAssertTrue(syncResult.changedEntityTypes.contains(.reviewEvent))
        XCTAssertEqual(5, syncState.lastAppliedReviewSequenceId)
        XCTAssertTrue(syncState.hasHydratedHotState)
        XCTAssertTrue(syncState.hasHydratedReviewHistory)
        XCTAssertFalse(try database.hasPendingReviewHistoryImport(workspaceId: workspace.workspaceId))
    }

    func testLinkedSyncPullsReviewHistoryWithoutImportWhenNoPendingImportMarker() async throws {
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
                rating: .good,
                reviewedAtClient: "2026-04-01T00:00:00.000Z",
                reviewedTimeZone: "UTC"
            )
        )
        try database.deleteAllOutboxEntries(workspaceId: workspace.workspaceId)
        try database.setLastAppliedHotChangeId(workspaceId: workspace.workspaceId, changeId: 20)
        try database.setLastAppliedReviewSequenceId(workspaceId: workspace.workspaceId, reviewSequenceId: 0)
        try database.setHasHydratedHotState(workspaceId: workspace.workspaceId, hasHydratedHotState: true)
        try database.setHasHydratedReviewHistory(workspaceId: workspace.workspaceId, hasHydratedReviewHistory: false)
        try database.setPendingReviewHistoryImport(workspaceId: workspace.workspaceId, pendingReviewHistoryImport: false)

        let remoteReviewEvent = ReviewEvent(
            reviewEventId: "remote-review-event",
            workspaceId: workspace.workspaceId,
            cardId: savedCard.cardId,
            replicaId: "remote-replica",
            clientEventId: "remote-client-event",
            rating: .easy,
            reviewedAtClient: "2026-04-02T00:00:00.000Z",
            reviewedTimeZone: "UTC",
            reviewedAtServer: "2026-04-02T00:00:01.000Z"
        )
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try LinkedSyncRunnerTestTransportSupport.handleReviewHistoryPullHydrationRequest(
                request: request,
                remoteReviewEvent: remoteReviewEvent,
                nextReviewSequenceId: 2
            )
        }

        let syncResult = try await CloudSyncRunner(database: database, transport: transport).runLinkedSync(
            linkedSession: self.makeLinkedSession(workspaceId: workspace.workspaceId)
        )

        let syncState = try XCTUnwrap(try self.loadSyncState(database: database, workspaceId: workspace.workspaceId))
        let reviewEvents = try database.loadReviewEvents(workspaceId: workspace.workspaceId)
        let importedReviewEvent = try XCTUnwrap(reviewEvents.first { event in
            event.reviewEventId == remoteReviewEvent.reviewEventId
        })
        XCTAssertTrue(syncResult.changedEntityTypes.contains(.reviewEvent))
        XCTAssertEqual("UTC", importedReviewEvent.reviewedTimeZone)
        XCTAssertTrue(CloudSyncRunnerTestURLProtocol.reviewHistoryImportEventCounts.isEmpty)
        XCTAssertEqual([0], CloudSyncRunnerTestURLProtocol.reviewHistoryPullAfterSequenceIds)
        XCTAssertEqual(2, syncState.lastAppliedReviewSequenceId)
        XCTAssertTrue(syncState.hasHydratedReviewHistory)
        XCTAssertFalse(try database.hasPendingReviewHistoryImport(workspaceId: workspace.workspaceId))
    }
}

private struct CloudSyncDecodeFailureProbeResponse: Decodable {
    let ok: Bool
}

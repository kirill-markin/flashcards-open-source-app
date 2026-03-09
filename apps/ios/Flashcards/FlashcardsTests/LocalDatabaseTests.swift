import Foundation
import XCTest
@testable import Flashcards

final class LocalDatabaseTests: XCTestCase {
    func testInitBootstrapsDefaultSnapshot() throws {
        let database = try self.makeDatabase()

        let snapshot = try database.loadStateSnapshot()

        XCTAssertEqual(snapshot.workspace.name, "Local Workspace")
        XCTAssertEqual(snapshot.userSettings.userId, "local-user")
        XCTAssertEqual(snapshot.schedulerSettings.algorithm, defaultSchedulerSettingsConfig.algorithm)
        XCTAssertEqual(snapshot.cards, [])
        XCTAssertEqual(snapshot.decks, [])
        XCTAssertEqual(snapshot.cloudSettings.cloudState, .disconnected)
    }

    func testCardCreateUpdateDeleteEnqueuesOutboxOperations() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front 1", backText: "Back 1"),
            cardId: nil
        )

        var snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.cards.count, 1)
        let cardId = try XCTUnwrap(snapshot.cards.first?.cardId)

        var outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 1)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .card(let payload) = entry.operation.payload {
                return payload.cardId == cardId && payload.deletedAt == nil && payload.frontText == "Front 1"
            }

            return false
        })

        try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front 2", backText: "Back 2"),
            cardId: cardId
        )

        snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.cards.first?.frontText, "Front 2")

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 2)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .card(let payload) = entry.operation.payload {
                return payload.cardId == cardId && payload.deletedAt == nil && payload.frontText == "Front 2"
            }

            return false
        })

        try database.deleteCard(workspaceId: workspaceId, cardId: cardId)

        snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.cards.count, 0)

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 3)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .card(let payload) = entry.operation.payload {
                return payload.cardId == cardId && payload.deletedAt != nil
            }

            return false
        })
    }

    func testBulkCardCreateUpdateDeleteEnqueuesOutboxOperations() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        let createdCards = try database.createCards(
            workspaceId: workspaceId,
            inputs: [
                self.makeCardInput(frontText: "Front 1", backText: "Back 1"),
                self.makeCardInput(frontText: "Front 2", backText: "Back 2")
            ]
        )

        var snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(createdCards.count, 2)
        XCTAssertEqual(snapshot.cards.count, 2)

        var outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 2)
        XCTAssertEqual(
            outboxEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            2
        )

        let updatedCards = try database.updateCards(
            workspaceId: workspaceId,
            updates: [
                CardUpdateInput(
                    cardId: createdCards[0].cardId,
                    input: CardEditorInput(
                        frontText: "Updated Front 1",
                        backText: createdCards[0].backText,
                        tags: createdCards[0].tags,
                        effortLevel: createdCards[0].effortLevel
                    )
                ),
                CardUpdateInput(
                    cardId: createdCards[1].cardId,
                    input: CardEditorInput(
                        frontText: createdCards[1].frontText,
                        backText: "Updated Back 2",
                        tags: ["tag-b"],
                        effortLevel: .long
                    )
                )
            ]
        )

        snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(updatedCards.count, 2)
        XCTAssertTrue(snapshot.cards.contains { card in
            card.cardId == createdCards[0].cardId && card.frontText == "Updated Front 1"
        })
        XCTAssertTrue(snapshot.cards.contains { card in
            card.cardId == createdCards[1].cardId && card.backText == "Updated Back 2" && card.effortLevel == .long
        })

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 4)

        let deleteResult = try database.deleteCards(
            workspaceId: workspaceId,
            cardIds: createdCards.map(\.cardId)
        )

        snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(deleteResult.deletedCount, 2)
        XCTAssertEqual(Set(deleteResult.deletedCardIds), Set(createdCards.map(\.cardId)))
        XCTAssertEqual(snapshot.cards.count, 0)

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 6)
        XCTAssertEqual(
            outboxEntries.filter { entry in
                if case .card(let payload) = entry.operation.payload {
                    return payload.deletedAt != nil
                }

                return false
            }.count,
            2
        )
    }

    func testBulkCreateCardsRollsBackOnInvalidInput() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        XCTAssertThrowsError(
            try database.createCards(
                workspaceId: workspaceId,
                inputs: [
                    self.makeCardInput(frontText: "Front 1", backText: "Back 1"),
                    self.makeCardInput(frontText: " ", backText: "Back 2")
                ]
            )
        ) { error in
            XCTAssertEqual(localizedMessage(error: error), "Card front text must not be empty")
        }

        let snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.cards.count, 0)
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50).count, 0)
    }

    func testBulkUpdateCardsRollsBackOnMissingCard() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId
        try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front 1", backText: "Back 1"),
            cardId: nil
        )
        let existingCard = try XCTUnwrap(try database.loadStateSnapshot().cards.first)

        XCTAssertThrowsError(
            try database.updateCards(
                workspaceId: workspaceId,
                updates: [
                    CardUpdateInput(
                        cardId: existingCard.cardId,
                        input: CardEditorInput(
                            frontText: "Changed Front",
                            backText: existingCard.backText,
                            tags: existingCard.tags,
                            effortLevel: existingCard.effortLevel
                        )
                    ),
                    CardUpdateInput(
                        cardId: "missing-card-id",
                        input: self.makeCardInput(frontText: "Front 2", backText: "Back 2")
                    )
                ]
            )
        ) { error in
            XCTAssertEqual(localizedMessage(error: error), "Card not found")
        }

        let snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.cards.count, 1)
        XCTAssertEqual(snapshot.cards.first?.frontText, "Front 1")
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50).count, 1)
    }

    func testBulkDeleteCardsRollsBackOnMissingCard() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId
        try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front 1", backText: "Back 1"),
            cardId: nil
        )
        let existingCard = try XCTUnwrap(try database.loadStateSnapshot().cards.first)

        XCTAssertThrowsError(
            try database.deleteCards(
                workspaceId: workspaceId,
                cardIds: [existingCard.cardId, "missing-card-id"]
            )
        ) { error in
            XCTAssertEqual(localizedMessage(error: error), "Card not found")
        }

        let snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.cards.count, 1)
        XCTAssertEqual(snapshot.cards.first?.cardId, existingCard.cardId)
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50).count, 1)
    }

    func testBulkUpdateCardsRejectsDuplicateCardIds() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId
        try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front 1", backText: "Back 1"),
            cardId: nil
        )
        let existingCard = try XCTUnwrap(try database.loadStateSnapshot().cards.first)

        XCTAssertThrowsError(
            try database.updateCards(
                workspaceId: workspaceId,
                updates: [
                    CardUpdateInput(cardId: existingCard.cardId, input: self.makeCardInput(frontText: "Front 2", backText: "Back 2")),
                    CardUpdateInput(cardId: existingCard.cardId, input: self.makeCardInput(frontText: "Front 3", backText: "Back 3"))
                ]
            )
        ) { error in
            XCTAssertEqual(localizedMessage(error: error), "Card batch must not contain duplicate cardId values")
        }

        let snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.cards.count, 1)
        XCTAssertEqual(snapshot.cards.first?.frontText, "Front 1")
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50).count, 1)
    }

    func testDeckCreateUpdateDeleteEnqueuesOutboxOperations() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        try database.createDeck(
            workspaceId: workspaceId,
            input: self.makeDeckInput(name: "Deck 1")
        )

        var snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.decks.count, 1)
        let deckId = try XCTUnwrap(snapshot.decks.first?.deckId)

        var outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 1)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .deck(let payload) = entry.operation.payload {
                return payload.deckId == deckId && payload.deletedAt == nil && payload.name == "Deck 1"
            }

            return false
        })

        try database.updateDeck(
            workspaceId: workspaceId,
            deckId: deckId,
            input: self.makeDeckInput(name: "Deck 2")
        )

        snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.decks.first?.name, "Deck 2")

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 2)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .deck(let payload) = entry.operation.payload {
                return payload.deckId == deckId && payload.deletedAt == nil && payload.name == "Deck 2"
            }

            return false
        })

        try database.deleteDeck(workspaceId: workspaceId, deckId: deckId)

        snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.decks.count, 0)

        outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 3)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .deck(let payload) = entry.operation.payload {
                return payload.deckId == deckId && payload.deletedAt != nil
            }

            return false
        })
    }

    func testSubmitReviewUpdatesCardAndEnqueuesReviewEventAndCardOperations() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId
        try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let cardId = try XCTUnwrap(try database.loadStateSnapshot().cards.first?.cardId)

        try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        let snapshot = try database.loadStateSnapshot()
        let reviewedCard = try XCTUnwrap(snapshot.cards.first)
        XCTAssertEqual(reviewedCard.cardId, cardId)
        XCTAssertNotNil(reviewedCard.dueAt)
        XCTAssertGreaterThan(reviewedCard.reps, 0)

        let reviewEvents = try database.loadReviewEvents(workspaceId: workspaceId)
        XCTAssertEqual(reviewEvents.count, 1)
        XCTAssertEqual(reviewEvents.first?.cardId, cardId)

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 3)
        XCTAssertEqual(
            outboxEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            2
        )
        XCTAssertEqual(
            outboxEntries.filter { entry in
                entry.operation.entityType == .reviewEvent
            }.count,
            1
        )
    }

    func testUpdateWorkspaceSchedulerSettingsPersistsAndEnqueuesOperation() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspaceId,
            desiredRetention: 0.92,
            learningStepsMinutes: [2, 12],
            relearningStepsMinutes: [15],
            maximumIntervalDays: 1200,
            enableFuzz: false
        )

        let snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.schedulerSettings.desiredRetention, 0.92, accuracy: 0.00000001)
        XCTAssertEqual(snapshot.schedulerSettings.learningStepsMinutes, [2, 12])
        XCTAssertEqual(snapshot.schedulerSettings.relearningStepsMinutes, [15])
        XCTAssertEqual(snapshot.schedulerSettings.maximumIntervalDays, 1200)
        XCTAssertFalse(snapshot.schedulerSettings.enableFuzz)

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 1)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .workspaceSchedulerSettings(let payload) = entry.operation.payload {
                return payload.desiredRetention == 0.92
                    && payload.learningStepsMinutes == [2, 12]
                    && payload.relearningStepsMinutes == [15]
                    && payload.maximumIntervalDays == 1200
                    && payload.enableFuzz == false
            }

            return false
        })
    }

    func testApplySyncChangePreservesLwwAndReviewEventIdempotency() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Local card", backText: "Local back"),
            cardId: nil
        )
        try database.createDeck(
            workspaceId: workspaceId,
            input: self.makeDeckInput(name: "Local deck")
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspaceId,
            desiredRetention: 0.91,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 365,
            enableFuzz: true
        )

        let localSnapshot = try database.loadStateSnapshot()
        let localCard = try XCTUnwrap(localSnapshot.cards.first)
        let localDeck = try XCTUnwrap(localSnapshot.decks.first)
        let localSettings = localSnapshot.schedulerSettings

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 1,
                entityType: .card,
                entityId: localCard.cardId,
                action: .upsert,
                payload: .card(
                    self.makeRemoteCard(
                        from: localCard,
                        frontText: "Older remote card",
                        clientUpdatedAt: "2026-03-07T00:00:00.000Z",
                        deviceId: "remote-device-old",
                        operationId: "remote-op-old"
                    )
                )
            )
        )

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 2,
                entityType: .deck,
                entityId: localDeck.deckId,
                action: .upsert,
                payload: .deck(
                    self.makeRemoteDeck(
                        from: localDeck,
                        name: "Older remote deck",
                        clientUpdatedAt: "2026-03-07T00:00:00.000Z",
                        deviceId: "remote-device-old",
                        operationId: "remote-op-old"
                    )
                )
            )
        )

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 3,
                entityType: .workspaceSchedulerSettings,
                entityId: workspaceId,
                action: .upsert,
                payload: .workspaceSchedulerSettings(
                    self.makeRemoteWorkspaceSettings(
                        from: localSettings,
                        desiredRetention: 0.8,
                        clientUpdatedAt: "2026-03-07T00:00:00.000Z",
                        deviceId: "remote-device-old",
                        operationId: "remote-op-old"
                    )
                )
            )
        )

        var snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.cards.first?.frontText, localCard.frontText)
        XCTAssertEqual(snapshot.decks.first?.name, localDeck.name)
        XCTAssertEqual(snapshot.schedulerSettings.desiredRetention, localSettings.desiredRetention, accuracy: 0.00000001)

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 4,
                entityType: .card,
                entityId: localCard.cardId,
                action: .upsert,
                payload: .card(
                    self.makeRemoteCard(
                        from: localCard,
                        frontText: "Newer remote card",
                        clientUpdatedAt: "2026-03-09T00:00:00.000Z",
                        deviceId: "remote-device-new",
                        operationId: "remote-op-new"
                    )
                )
            )
        )

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 5,
                entityType: .deck,
                entityId: localDeck.deckId,
                action: .upsert,
                payload: .deck(
                    self.makeRemoteDeck(
                        from: localDeck,
                        name: "Newer remote deck",
                        clientUpdatedAt: "2026-03-09T00:00:00.000Z",
                        deviceId: "remote-device-new",
                        operationId: "remote-op-new"
                    )
                )
            )
        )

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 6,
                entityType: .workspaceSchedulerSettings,
                entityId: workspaceId,
                action: .upsert,
                payload: .workspaceSchedulerSettings(
                    self.makeRemoteWorkspaceSettings(
                        from: localSettings,
                        desiredRetention: 0.95,
                        clientUpdatedAt: "2026-03-09T00:00:00.000Z",
                        deviceId: "remote-device-new",
                        operationId: "remote-op-new"
                    )
                )
            )
        )

        let remoteReviewEvent = ReviewEvent(
            reviewEventId: "remote-review-event",
            workspaceId: workspaceId,
            cardId: localCard.cardId,
            deviceId: "remote-device-new",
            clientEventId: "remote-client-event",
            rating: .good,
            reviewedAtClient: "2026-03-09T01:00:00.000Z",
            reviewedAtServer: "2026-03-09T01:00:01.000Z"
        )
        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 7,
                entityType: .reviewEvent,
                entityId: remoteReviewEvent.reviewEventId,
                action: .append,
                payload: .reviewEvent(remoteReviewEvent)
            )
        )
        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 8,
                entityType: .reviewEvent,
                entityId: remoteReviewEvent.reviewEventId,
                action: .append,
                payload: .reviewEvent(remoteReviewEvent)
            )
        )

        snapshot = try database.loadStateSnapshot()
        XCTAssertEqual(snapshot.cards.first?.frontText, "Newer remote card")
        XCTAssertEqual(snapshot.decks.first?.name, "Newer remote deck")
        XCTAssertEqual(snapshot.schedulerSettings.desiredRetention, 0.95, accuracy: 0.00000001)

        let reviewEvents = try database.loadReviewEvents(workspaceId: workspaceId)
        XCTAssertEqual(reviewEvents.filter { event in
            event.reviewEventId == remoteReviewEvent.reviewEventId
        }.count, 1)
    }

    func testBootstrapOutboxRecreatesMissingOperationsWithoutDuplicates() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let cardId = try XCTUnwrap(try database.loadStateSnapshot().cards.first?.cardId)
        try database.createDeck(
            workspaceId: workspaceId,
            input: self.makeDeckInput(name: "Deck")
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspaceId,
            desiredRetention: 0.93,
            learningStepsMinutes: [2, 8],
            relearningStepsMinutes: [12],
            maximumIntervalDays: 700,
            enableFuzz: true
        )
        try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.map { entry in
            entry.operationId
        })
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100).count, 0)

        try database.bootstrapOutbox(workspaceId: workspaceId)

        var recreatedEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(recreatedEntries.count, 4)
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .deck
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .workspaceSchedulerSettings
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .reviewEvent
            }.count,
            1
        )

        try database.bootstrapOutbox(workspaceId: workspaceId)
        recreatedEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(recreatedEntries.count, 4)
    }

    func testBootstrapOutboxSkipsReviewEventsFromAnotherDevice() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )

        let localCard = try XCTUnwrap(try database.loadStateSnapshot().cards.first)
        let remoteReviewEvent = ReviewEvent(
            reviewEventId: "remote-review-event",
            workspaceId: workspaceId,
            cardId: localCard.cardId,
            deviceId: "remote-device",
            clientEventId: "remote-client-event",
            rating: .good,
            reviewedAtClient: "2026-03-09T01:00:00.000Z",
            reviewedAtServer: "2026-03-09T01:00:01.000Z"
        )
        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 1,
                entityType: .reviewEvent,
                entityId: remoteReviewEvent.reviewEventId,
                action: .append,
                payload: .reviewEvent(remoteReviewEvent)
            )
        )

        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.map { entry in
            entry.operationId
        })

        try database.bootstrapOutbox(workspaceId: workspaceId)

        let recreatedEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(recreatedEntries.count, 2)
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .workspaceSchedulerSettings
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .reviewEvent
            }.count,
            0
        )
    }

    func testBootstrapOutboxDoesNotDuplicatePendingLocalReviewEvent() throws {
        let database = try self.makeDatabase()
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let cardId = try XCTUnwrap(try database.loadStateSnapshot().cards.first?.cardId)
        try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.compactMap { entry in
            entry.operation.entityType == .reviewEvent ? nil : entry.operationId
        })

        try database.bootstrapOutbox(workspaceId: workspaceId)

        let recreatedEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(recreatedEntries.count, 3)
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .workspaceSchedulerSettings
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .reviewEvent
            }.count,
            1
        )
    }

    private func makeDatabase() throws -> LocalDatabase {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: databaseDirectory)
        }
        return try LocalDatabase(databaseURL: databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false))
    }

    private func makeCardInput(frontText: String, backText: String) -> CardEditorInput {
        CardEditorInput(
            frontText: frontText,
            backText: backText,
            tags: ["tag-a"],
            effortLevel: .medium
        )
    }

    private func makeDeckInput(name: String) -> DeckEditorInput {
        DeckEditorInput(
            name: name,
            filterDefinition: buildDeckFilterDefinition(
                effortLevels: [.medium],
                combineWith: .and,
                tagsOperator: .containsAny,
                tags: ["tag-a"]
            )
        )
    }

    private func makeRemoteCard(
        from card: Card,
        frontText: String,
        clientUpdatedAt: String,
        deviceId: String,
        operationId: String
    ) -> Card {
        Card(
            cardId: card.cardId,
            workspaceId: card.workspaceId,
            frontText: frontText,
            backText: card.backText,
            tags: card.tags,
            effortLevel: card.effortLevel,
            dueAt: card.dueAt,
            reps: card.reps,
            lapses: card.lapses,
            fsrsCardState: card.fsrsCardState,
            fsrsStepIndex: card.fsrsStepIndex,
            fsrsStability: card.fsrsStability,
            fsrsDifficulty: card.fsrsDifficulty,
            fsrsLastReviewedAt: card.fsrsLastReviewedAt,
            fsrsScheduledDays: card.fsrsScheduledDays,
            clientUpdatedAt: clientUpdatedAt,
            lastModifiedByDeviceId: deviceId,
            lastOperationId: operationId,
            updatedAt: clientUpdatedAt,
            deletedAt: card.deletedAt
        )
    }

    private func makeRemoteDeck(
        from deck: Deck,
        name: String,
        clientUpdatedAt: String,
        deviceId: String,
        operationId: String
    ) -> Deck {
        Deck(
            deckId: deck.deckId,
            workspaceId: deck.workspaceId,
            name: name,
            filterDefinition: deck.filterDefinition,
            createdAt: deck.createdAt,
            clientUpdatedAt: clientUpdatedAt,
            lastModifiedByDeviceId: deviceId,
            lastOperationId: operationId,
            updatedAt: clientUpdatedAt,
            deletedAt: deck.deletedAt
        )
    }

    private func makeRemoteWorkspaceSettings(
        from settings: WorkspaceSchedulerSettings,
        desiredRetention: Double,
        clientUpdatedAt: String,
        deviceId: String,
        operationId: String
    ) -> WorkspaceSchedulerSettings {
        WorkspaceSchedulerSettings(
            algorithm: settings.algorithm,
            desiredRetention: desiredRetention,
            learningStepsMinutes: settings.learningStepsMinutes,
            relearningStepsMinutes: settings.relearningStepsMinutes,
            maximumIntervalDays: settings.maximumIntervalDays,
            enableFuzz: settings.enableFuzz,
            clientUpdatedAt: clientUpdatedAt,
            lastModifiedByDeviceId: deviceId,
            lastOperationId: operationId,
            updatedAt: clientUpdatedAt
        )
    }
}
